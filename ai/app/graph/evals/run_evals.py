"""Eval runner — golden (offline) and production-sample (online) modes.

Usage:
    python -m app.graph.evals.run_evals --offline
    python -m app.graph.evals.run_evals --online --sample 20 --hours 48

Both modes:
  1. Run turns through deterministic graders + LLM judge.
  2. Aggregate metrics via metrics.aggregate().
  3. POST the run payload to the gateway (/internal/evals/run).
  4. Print a summary to stdout.
  5. Optionally log to LangSmith (when LANGSMITH_TRACING=true).

The core logic is exposed as async functions (run_offline / run_online)
so the FastAPI /internal/evals/trigger endpoint can call the same code.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import random
import sys
import time
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from langchain_core.messages import HumanMessage

from ..config import gateway_base_url, text_model_name
from ..graph import get_app
from ..state import initial_state
from ..tracing import configure_tracing
from .compare import compare_to_baseline
from .datasets import Conversation, dataset_version, golden_for
from .evaluators import Score, clinical_advice_guard, grade_turn, phi_leak_guard
from .gateway_client import list_recent_sessions, get_session_turns, post_run
from .judge import judge_turn, JudgeResult
from .judge_calibration import run_calibration
from .metrics import aggregate

logger = logging.getLogger(__name__)

# Same sentinel the chat/voice runtimes send to trigger the one-time HIPAA
# disclosure opener (see runtime/chat.py SESSION_OPEN_TOKEN). The graph's
# disclosure gate recognises it and never shows it to the user.
SESSION_OPEN_TOKEN = "__session_open__"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _prompt_version() -> str:
    return os.environ.get("BT_BUILD_TAG") or "dev"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _judge_to_dict(j: JudgeResult) -> dict[str, Any]:
    return {
        "faithfulness": j.faithfulness,
        "relevancy": j.relevancy,
        "tone": j.tone,
        "topic_adherence": j.topic_adherence,
        "task_completion": j.task_completion,
        "rationale": j.rationale,
    }


def _scores_to_dicts(scores: list[Score]) -> list[dict[str, Any]]:
    return [{"name": s.name, "passed": s.passed, "detail": s.detail} for s in scores]


def _context_snippet(state: dict) -> str:
    """Non-PHI snippet of graph state to pass to the judge as context."""
    return (
        f"scene={state.get('_scene')} "
        f"intent={state.get('intent')} "
        f"booking_status={state.get('booking_status')} "
        f"last_action={state.get('last_action')}"
    )


# ---------------------------------------------------------------------------
# Channel helpers
# ---------------------------------------------------------------------------

# API channel → gateway chat_sessions.source. Used to scope online sampling.
_CHANNEL_TO_SOURCE = {
    "chat": "chat-agent",
    "voice": "voice-agent",
    "phone": "voice-phone",
}

# A synthetic caller ANI for offline PHONE simulation so the realtime prompt's
# ANI block is exercised. Voice (browser widget) has no ANI → None.
_PHONE_SIM_ANI = "+17025550142"


def _channel_to_source(channel: str) -> str:
    return _CHANNEL_TO_SOURCE.get((channel or "chat").lower(), "chat-agent")


# ---------------------------------------------------------------------------
# Offline: run GOLDEN through the graph
# ---------------------------------------------------------------------------

async def _run_convo_offline(
    app: Any, convo: Conversation, seq_start: int, rep: int = 0
) -> tuple[list[dict[str, Any]], int]:
    """Run one golden conversation once; return (turn_dicts, next_seq).

    ``rep`` is the repetition index — each repetition uses a fresh thread id
    so runs are independent (LangSmith num_repetitions pattern: average over
    repeats to absorb LLM non-determinism).
    """
    sid = f"eval-{convo.name}-r{rep}"
    cfg = {"configurable": {"thread_id": sid}}
    try:
        await app.aupdate_state(cfg, initial_state("chat", sid, "eval"))
    except Exception:
        pass

    turns: list[dict[str, Any]] = []
    seq = seq_start

    # Mirror production: emit the one-time HIPAA disclosure opener (the
    # __session_open__ sentinel) BEFORE the user's first real message so the
    # disclosure gate flips disclosure_done up front. Without this the gate
    # consumes turn 1 and the user's first message goes unanswered — an
    # artifact of invoking the graph directly, NOT how the chat widget / voice
    # runtimes behave (both call the session-open flow first).
    seed = initial_state("chat", sid, "eval")
    seed["messages"] = [HumanMessage(content=SESSION_OPEN_TOKEN)]
    try:
        await app.ainvoke(seed, config=cfg)
    except Exception:
        logger.exception("eval_session_open_failed convo=%s", convo.name)

    for turn in convo.turns:
        t0 = time.perf_counter()
        result = await app.ainvoke(
            {"messages": [HumanMessage(content=turn.user_says)]},
            config=cfg,
        )
        latency_ms = (time.perf_counter() - t0) * 1000
        reply = result.get("last_reply_text") or ""

        det_scores = grade_turn(turn, result, reply)
        det_scores.append(phi_leak_guard(reply))
        det_scores.append(clinical_advice_guard(reply))
        det_all_pass = all(s.passed for s in det_scores)

        ctx = _context_snippet(result)
        judge_result = judge_turn(turn.user_says, reply, context=ctx)

        turns.append({
            "seq": seq,
            "session_id": sid,
            "convo_name": convo.name,
            "rep": rep,
            "split": convo.split,
            "is_production": False,
            "user_says": turn.user_says,
            "reply": reply,
            "scene": result.get("_scene") or "",
            "intent": result.get("intent") or "",
            "expected_intent": turn.expected_intent or "",
            "passed": det_all_pass,
            "deterministic_scores": _scores_to_dicts(det_scores),
            "judge": _judge_to_dict(judge_result),
            "latency_ms": int(round(latency_ms)),
        })
        seq += 1

    return turns, seq


# ---------------------------------------------------------------------------
# Offline: voice / phone — text-simulate the realtime agent
# ---------------------------------------------------------------------------
#
# The realtime voice + Twilio phone agents are SEPARATE from the LangGraph chat
# graph (bt_agents/realtime). They cannot be replayed turn-by-turn through the
# graph. So for offline voice/phone we TEXT-SIMULATE the agent: we feed the
# agent's ACTUAL realtime system prompt (build_realtime_triage(...).instructions
# — the same instructions the production speech-to-speech agent runs) plus the
# scripted user turns to a text model, then grade the reply with the same
# guards + LLM judge as chat. This exercises the real voice INSTRUCTIONS, not
# live audio and not tool execution — graph scene/intent assertions don't apply,
# so voice/phone fixtures only carry reply assertions.

def _build_voice_sim_llm() -> Any:
    """Text client used to simulate the realtime agent's textual responses.

    Same US-region base URL + primary text model as production text agents.
    """
    from langchain_openai import ChatOpenAI  # lazy: keep module import light
    from ..config import text_base_url

    return ChatOpenAI(
        model=text_model_name(),
        temperature=0.3,
        base_url=text_base_url(),
        timeout=120,
        max_retries=3,
    )


def _realtime_instructions(channel: str) -> str:
    """The production realtime agent's system prompt for this channel.

    Phone passes a synthetic ANI so the prompt's caller-phone block is included;
    browser voice has no ANI.
    """
    # Lazy import — the realtime stack pulls in the agents SDK + voice tools.
    from ...bt_agents.realtime.triage import build_realtime_triage

    caller_phone = _PHONE_SIM_ANI if channel == "phone" else None
    agent = build_realtime_triage(caller_phone=caller_phone)
    instructions = getattr(agent, "instructions", "") or ""
    return instructions if isinstance(instructions, str) else str(instructions)


def _run_convo_offline_voice(
    convo: Conversation, seq_start: int, channel: str, llm: Any, instructions: str,
    rep: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    """Text-simulate one voice/phone conversation; return (turn_dicts, next_seq)."""
    from langchain_core.messages import AIMessage, SystemMessage

    history: list[Any] = [SystemMessage(content=instructions)]
    turns: list[dict[str, Any]] = []
    seq = seq_start

    for turn in convo.turns:
        history.append(HumanMessage(content=turn.user_says))
        t0 = time.perf_counter()
        try:
            resp = llm.invoke(history)
            reply = getattr(resp, "content", "") or ""
            if isinstance(reply, list):  # some models return content parts
                reply = " ".join(str(p) for p in reply)
        except Exception:
            logger.exception("voice_sim_invoke_failed convo=%s seq=%d", convo.name, seq)
            reply = ""
        latency_ms = (time.perf_counter() - t0) * 1000
        history.append(AIMessage(content=reply))

        # No graph state for the realtime agent → grade against an empty state.
        # Voice/phone fixtures only set reply assertions, so grade_turn yields
        # just the contains/not_contains scores; add the safety guards.
        det_scores = grade_turn(turn, {}, reply)
        det_scores.append(phi_leak_guard(reply))
        det_scores.append(clinical_advice_guard(reply))
        det_all_pass = all(s.passed for s in det_scores)

        judge_result = judge_turn(
            turn.user_says, reply,
            context=f"channel={channel} (text-simulated realtime voice agent)",
        )

        turns.append({
            "seq": seq,
            # Include the repetition index so each repeat is a distinct session.
            # Without it, OFFLINE_EVAL_REPETITIONS>1 collapses every repeat into
            # one session_id and aggregate() under-counts n_sessions, corrupting
            # the per-session escalation/deflection/containment rates.
            "session_id": f"eval-{channel}-{convo.name}-r{rep}",
            "rep": rep,
            "convo_name": convo.name,
            "split": convo.split,
            "is_production": False,
            "user_says": turn.user_says,
            "reply": reply,
            # Realtime agent has no graph scene/intent — left blank (the UI
            # hides intent/scene breakdowns for non-chat channels).
            "scene": "",
            "intent": "",
            "expected_intent": "",
            "passed": det_all_pass,
            "deterministic_scores": _scores_to_dicts(det_scores),
            "judge": _judge_to_dict(judge_result),
            "latency_ms": int(round(latency_ms)),
        })
        seq += 1

    return turns, seq


async def run_offline(run_id: str | None = None, channel: str = "chat") -> dict[str, Any]:
    """Run the channel's golden suite offline.

    chat  → replay through the live LangGraph graph.
    voice / phone → text-simulate the realtime agent's prompt (see above).

    Returns the completed run payload dict and POSTs it to the gateway.
    """
    if run_id is None:
        run_id = str(uuid4())
    channel = (channel or "chat").lower()

    configure_tracing()
    convos = golden_for(channel)
    all_turns: list[dict[str, Any]] = []
    seq = 0
    failures = 0

    # LangSmith num_repetitions pattern: run the whole golden set R times and
    # aggregate across all repeats so per-metric means (esp. tone/judge scores)
    # are stable instead of single-shot noise. Default 1; override with
    # OFFLINE_EVAL_REPETITIONS (clamped 1..10).
    try:
        repetitions = int(os.environ.get("OFFLINE_EVAL_REPETITIONS", "1"))
    except ValueError:
        repetitions = 3
    repetitions = max(1, min(repetitions, 10))

    if channel == "chat":
        app = get_app()
        for rep in range(repetitions):
            for convo in convos:
                try:
                    turns, seq = await _run_convo_offline(app, convo, seq, rep=rep)
                    all_turns.extend(turns)
                except Exception as exc:
                    logger.error(
                        "offline_convo_error channel=%s convo=%s rep=%d error=%s",
                        channel, convo.name, rep, exc,
                    )
                    failures += 1
    else:
        # Build the realtime prompt + text client once, reuse across convos.
        try:
            instructions = _realtime_instructions(channel)
            llm = _build_voice_sim_llm()
        except Exception:
            logger.exception("offline_voice_setup_failed channel=%s", channel)
            instructions, llm = "", None
        for rep in range(repetitions):
            for convo in convos:
                if llm is None:
                    failures += 1
                    continue
                try:
                    # Off-load to a thread: the voice sim makes blocking
                    # llm.invoke + judge_turn HTTP calls per turn, and run_offline
                    # runs as a background task on the FastAPI event loop. Calling
                    # it inline would starve every in-flight chat/voice connection
                    # for the duration of the eval run.
                    turns, seq = await asyncio.to_thread(
                        _run_convo_offline_voice, convo, seq, channel, llm, instructions, rep
                    )
                    all_turns.extend(turns)
                except Exception as exc:
                    logger.error(
                        "offline_voice_convo_error channel=%s convo=%s rep=%d error=%s",
                        channel, convo.name, rep, exc,
                    )
                    failures += 1

    agg = aggregate(all_turns)
    metrics = agg["metrics"]
    breakdowns = agg["breakdowns"]
    metric_counts = agg.get("counts_by_metric", {})

    # Judge calibration vs the fixed human-labeled gold set. The agreement
    # score tells the dashboard how much to trust the judge's other numbers.
    calibration = run_calibration()
    metrics["judge_agreement"] = calibration["judge_agreement"]
    metric_counts["judge_agreement"] = calibration.get("n_cases", 0)
    breakdowns["judge_calibration"] = calibration

    ds_version = dataset_version(channel)

    # Regression vs the previous comparable offline baseline (same channel).
    regression = compare_to_baseline(run_id, ds_version, metrics, channel=channel)

    payload: dict[str, Any] = {
        "run_id": run_id,
        "kind": "offline",
        "channel": channel,
        "model": text_model_name(),
        "prompt_version": _prompt_version(),
        "dataset_version": ds_version,
        "created_at": _now_iso(),
        "counts": {
            "conversations": len(convos) * repetitions,
            "turns": len(all_turns),
            "repetitions": repetitions,
        },
        "metrics": metrics,
        "metric_counts": metric_counts,
        "breakdowns": breakdowns,
        "regression": regression,
        "turns": all_turns,
    }

    # POST to gateway — warn but never crash
    try:
        post_run(payload)
    except Exception:
        logger.warning("offline_post_run_failed run_id=%s", run_id)

    logger.info(
        "offline_run_done run_id=%s channel=%s dataset=%s conversations=%d turns=%d failures=%d "
        "intent_accuracy=%.3f overall_pass_rate=%.3f judge_agreement=%.3f regression=%s",
        run_id, channel, ds_version, len(convos) * repetitions, len(all_turns), failures,
        metrics.get("intent_accuracy", 0),
        metrics.get("overall_pass_rate", 0),
        metrics.get("judge_agreement", 0),
        regression.get("status", "?"),
    )
    return payload


# ---------------------------------------------------------------------------
# Online: sample production sessions from the gateway
# ---------------------------------------------------------------------------

# Hard ceiling on sessions judged in one online run — protects cost if traffic
# spikes (LangSmith pattern: take all in-window, but cap, then sample if over).
MAX_ONLINE_SESSIONS = 500


async def run_online(
    run_id: str | None = None,
    sample: int = 0,
    hours: int = 24,
    channel: str = "chat",
) -> dict[str, Any]:
    """Judge recent production sessions for one channel; one judge call per turn.

    sample <= 0  → take ALL sessions in the last `hours` (full coverage),
                   bounded by MAX_ONLINE_SESSIONS so a traffic spike can't blow
                   up cost; if the window exceeds the cap we randomly sample
                   down to it.
    sample  > 0  → take at most `sample` sessions (explicit cap / sampling).

    Only sessions whose source matches the channel are sampled
    (chat→chat-agent, voice→voice-agent, phone→voice-phone).

    Returns the completed run payload dict and POSTs it to the gateway.
    """
    if run_id is None:
        run_id = str(uuid4())
    channel = (channel or "chat").lower()
    source = _channel_to_source(channel)

    cap = MAX_ONLINE_SESSIONS if sample <= 0 else min(sample, MAX_ONLINE_SESSIONS)
    sessions = list_recent_sessions(limit=cap, hours=hours, source=source)
    if not sessions:
        logger.warning("online_run_no_sessions run_id=%s channel=%s hours=%d", run_id, channel, hours)
        sessions = []

    # Pool is already limited to `cap` by the gateway; only downsample if the
    # window somehow returned more than the cap.
    if len(sessions) > cap:
        sessions = random.sample(sessions, cap)
    logger.info("online_run_sessions run_id=%s judging=%d hours=%d cap=%d",
                run_id, len(sessions), hours, cap)

    all_turns: list[dict[str, Any]] = []
    seq = 0

    for session_meta in sessions:
        sid = session_meta.get("session_id") or ""
        if not sid:
            continue
        raw_turns = get_session_turns(sid)
        if not raw_turns:
            continue

        # Pair each assistant turn with the preceding user turn.
        prior_user: str = ""
        for raw in raw_turns:
            role = raw.get("role") or ""
            content = raw.get("content") or ""
            if role in ("user", "human"):
                prior_user = content
            elif role in ("assistant", "ai") and prior_user:
                # Judge this assistant turn. Production transcript = PHI —
                # stays on OpenAI (the only BAA-covered provider).
                judge_result = judge_turn(
                    prior_user, content, context=f"session={sid}", for_production=True
                )
                phi_score = phi_leak_guard(content)
                clinical_score = clinical_advice_guard(content)

                all_turns.append({
                    "seq": seq,
                    "session_id": sid,
                    "convo_name": sid,
                    "is_production": True,
                    "user_says": prior_user,
                    "reply": content,
                    "scene": "",
                    "intent": "",
                    "expected_intent": "",
                    "passed": phi_score.passed and clinical_score.passed,
                    "deterministic_scores": _scores_to_dicts([phi_score, clinical_score]),
                    "judge": _judge_to_dict(judge_result),
                    # Real per-turn latency captured by the gateway at chat time
                    # (0 for turns written before latency capture existed).
                    "latency_ms": int(raw.get("latency_ms") or 0),
                })
                seq += 1
                prior_user = ""  # consume; next assistant turn needs a new user turn

    agg = aggregate(all_turns)

    payload: dict[str, Any] = {
        "run_id": run_id,
        "kind": "online",
        "channel": channel,
        "model": text_model_name(),
        "prompt_version": _prompt_version(),
        "created_at": _now_iso(),
        "counts": {
            "conversations": len(sessions),
            "turns": len(all_turns),
        },
        "metrics": agg["metrics"],
        "metric_counts": agg.get("counts_by_metric", {}),
        "breakdowns": agg["breakdowns"],
        "turns": all_turns,
    }

    try:
        post_run(payload)
    except Exception:
        logger.warning("online_post_run_failed run_id=%s", run_id)

    logger.info(
        "online_run_done run_id=%s channel=%s sessions=%d turns=%d "
        "overall_pass_rate=%.3f",
        run_id, channel, len(sessions), len(all_turns),
        agg["metrics"].get("overall_pass_rate", 0),
    )
    return payload


# ---------------------------------------------------------------------------
# Summary printer
# ---------------------------------------------------------------------------

def _print_summary(payload: dict[str, Any]) -> int:
    """Print a human-readable summary to stdout. Returns exit code."""
    kind = payload.get("kind", "?")
    run_id = payload.get("run_id", "?")
    m = payload.get("metrics") or {}
    turns = payload.get("turns") or []
    failures = sum(1 for t in turns if not t.get("passed", True))

    print(f"\n{'='*50}")
    print(f"Eval run: {run_id}  kind={kind}")
    print(f"  conversations : {payload.get('counts', {}).get('conversations', 0)}")
    print(f"  turns         : {len(turns)}")
    print(f"  failures      : {failures}")
    print(f"")
    print(f"  intent_accuracy     : {m.get('intent_accuracy', 0):.3f}")
    print(f"  overall_pass_rate   : {m.get('overall_pass_rate', 0):.3f}")
    print(f"  deterministic_pass  : {m.get('deterministic_pass_rate', 0):.3f}")
    print(f"  task_completion     : {m.get('task_completion_rate', 0):.3f}")
    print(f"  faithfulness_avg    : {m.get('faithfulness_avg', 0):.2f}/5")
    print(f"  relevancy_avg       : {m.get('relevancy_avg', 0):.2f}/5")
    print(f"  tone_avg            : {m.get('tone_avg', 0):.2f}/5")
    print(f"  topic_adherence     : {m.get('topic_adherence_rate', 0):.3f}")
    print(f"  hallucination_rate  : {m.get('hallucination_rate', 0):.3f}")
    print(f"  containment_rate    : {m.get('containment_rate', 0):.3f}")
    print(f"  judge_agreement     : {m.get('judge_agreement', 0):.3f}")
    print(f"{'='*50}")

    # Regression verdict (offline only carries one)
    reg = payload.get("regression") or {}
    reg_status = reg.get("status", "")
    if reg_status:
        print(f"  dataset_version     : {payload.get('dataset_version', '?')}")
        print(f"  regression          : {reg_status.upper()}"
              f" (baseline {str(reg.get('baseline_run_id') or '-')[:8]})")
        for v in reg.get("violations") or []:
            print(f"    - {v.get('metric')}: {v.get('baseline')} -> {v.get('current')} "
                  f"(Δ{v.get('delta')}, limit {v.get('threshold')}) [{v.get('level')}]")
        print(f"{'='*50}")

    if kind == "offline":
        # Per-turn details for offline golden runs
        for t in turns:
            scores = t.get("deterministic_scores") or []
            for s in scores:
                mark = "OK " if s.get("passed") else "FAIL"
                print(f"  {t.get('convo_name')} turn{t.get('seq')} {mark} {s.get('name')}: {s.get('detail','')}")

    # CI gate: nonzero exit on a hard regression OR any turn-level failure.
    if reg_status == "fail":
        return 2
    return 0 if failures == 0 else 1


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

async def _async_main(args: argparse.Namespace) -> int:
    channel = (args.channel or "chat").lower()
    if args.offline:
        payload = await run_offline(channel=channel)
    else:
        payload = await run_online(sample=args.sample, hours=args.hours, channel=channel)
    return _print_summary(payload)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run BT agent evals (offline golden or online production sample)."
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--offline",
        action="store_true",
        help="Run the GOLDEN fixtures through the live graph (no network to gateway required).",
    )
    mode.add_argument(
        "--online",
        action="store_true",
        help="Sample recent production sessions from the gateway and judge them.",
    )
    parser.add_argument(
        "--sample",
        type=int,
        default=0,
        help="Max sessions for --online. 0 (default) = ALL sessions in the "
             "look-back window, bounded by MAX_ONLINE_SESSIONS. >0 = explicit cap.",
    )
    parser.add_argument(
        "--hours",
        type=int,
        default=24,
        help="Look-back window in hours for --online (default 24).",
    )
    parser.add_argument(
        "--channel",
        choices=["chat", "voice", "phone"],
        default="chat",
        help="Agent surface to evaluate: chat (website chatbot), voice (browser "
             "voice bot), or phone (Twilio phone calls). Default chat.",
    )

    args = parser.parse_args()
    sys.exit(asyncio.run(_async_main(args)))


if __name__ == "__main__":
    main()

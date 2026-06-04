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
from ..tracing import configure_tracing, langsmith_client
from .datasets import GOLDEN, Conversation
from .evaluators import Score, clinical_advice_guard, grade_turn, phi_leak_guard
from .gateway_client import list_recent_sessions, get_session_turns, post_run
from .judge import judge_turn, JudgeResult
from .metrics import aggregate

logger = logging.getLogger(__name__)


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
# Offline: run GOLDEN through the graph
# ---------------------------------------------------------------------------

async def _run_convo_offline(
    app: Any, convo: Conversation, seq_start: int
) -> tuple[list[dict[str, Any]], int]:
    """Run one golden conversation; return (turn_dicts, next_seq)."""
    sid = f"eval-{convo.name}"
    cfg = {"configurable": {"thread_id": sid}}
    try:
        await app.aupdate_state(cfg, initial_state("chat", sid, "eval"))
    except Exception:
        pass

    turns: list[dict[str, Any]] = []
    seed = initial_state("chat", sid, "eval")
    seeded = False
    seq = seq_start

    for turn in convo.turns:
        t0 = time.perf_counter()
        if not seeded:
            seed["messages"] = [HumanMessage(content=turn.user_says)]
            result = await app.ainvoke(seed, config=cfg)
            seeded = True
        else:
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


async def run_offline(run_id: str | None = None) -> dict[str, Any]:
    """Run the full GOLDEN suite through the live graph.

    Returns the completed run payload dict and POSTs it to the gateway.
    """
    if run_id is None:
        run_id = str(uuid4())

    configure_tracing()
    app = get_app()
    all_turns: list[dict[str, Any]] = []
    seq = 0
    failures = 0

    for convo in GOLDEN:
        try:
            turns, seq = await _run_convo_offline(app, convo, seq)
            all_turns.extend(turns)
        except Exception as exc:
            logger.error("offline_convo_error convo=%s error=%s", convo.name, exc)
            failures += 1

    agg = aggregate(all_turns)

    payload: dict[str, Any] = {
        "run_id": run_id,
        "kind": "offline",
        "model": text_model_name(),
        "prompt_version": _prompt_version(),
        "created_at": _now_iso(),
        "counts": {
            "conversations": len(GOLDEN),
            "turns": len(all_turns),
        },
        "metrics": agg["metrics"],
        "breakdowns": agg["breakdowns"],
        "turns": all_turns,
    }

    # LangSmith dataset logging (best-effort)
    client = langsmith_client()
    if client is not None:
        try:
            client.create_dataset(
                "bt-langgraph-golden",
                description="Golden conversations for the BT LangGraph stack",
            )
        except Exception:
            pass

    # POST to gateway — warn but never crash
    try:
        post_run(payload)
    except Exception:
        logger.warning("offline_post_run_failed run_id=%s", run_id)

    logger.info(
        "offline_run_done run_id=%s conversations=%d turns=%d failures=%d "
        "intent_accuracy=%.3f overall_pass_rate=%.3f",
        run_id, len(GOLDEN), len(all_turns), failures,
        agg["metrics"].get("intent_accuracy", 0),
        agg["metrics"].get("overall_pass_rate", 0),
    )
    return payload


# ---------------------------------------------------------------------------
# Online: sample production sessions from the gateway
# ---------------------------------------------------------------------------

async def run_online(
    run_id: str | None = None,
    sample: int = 20,
    hours: int = 24,
) -> dict[str, Any]:
    """Sample recent production sessions, judge each assistant turn.

    Returns the completed run payload dict and POSTs it to the gateway.
    """
    if run_id is None:
        run_id = str(uuid4())

    sessions = list_recent_sessions(limit=max(sample * 3, 100), hours=hours)
    if not sessions:
        logger.warning("online_run_no_sessions run_id=%s hours=%d", run_id, hours)
        sessions = []

    # Random sample without replacement; handle case where pool < sample.
    if len(sessions) > sample:
        sessions = random.sample(sessions, sample)

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
                # Judge this assistant turn
                judge_result = judge_turn(prior_user, content, context=f"session={sid}")
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
                    "latency_ms": 0,
                })
                seq += 1
                prior_user = ""  # consume; next assistant turn needs a new user turn

    agg = aggregate(all_turns)

    payload: dict[str, Any] = {
        "run_id": run_id,
        "kind": "online",
        "model": text_model_name(),
        "prompt_version": _prompt_version(),
        "created_at": _now_iso(),
        "counts": {
            "conversations": len(sessions),
            "turns": len(all_turns),
        },
        "metrics": agg["metrics"],
        "breakdowns": agg["breakdowns"],
        "turns": all_turns,
    }

    try:
        post_run(payload)
    except Exception:
        logger.warning("online_post_run_failed run_id=%s", run_id)

    logger.info(
        "online_run_done run_id=%s sessions=%d turns=%d "
        "overall_pass_rate=%.3f",
        run_id, len(sessions), len(all_turns),
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
    print(f"{'='*50}")

    if kind == "offline":
        # Per-turn details for offline golden runs
        for t in turns:
            scores = t.get("deterministic_scores") or []
            for s in scores:
                mark = "OK " if s.get("passed") else "FAIL"
                print(f"  {t.get('convo_name')} turn{t.get('seq')} {mark} {s.get('name')}: {s.get('detail','')}")

    return 0 if failures == 0 else 1


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

async def _async_main(args: argparse.Namespace) -> int:
    if args.offline:
        payload = await run_offline()
    else:
        payload = await run_online(sample=args.sample, hours=args.hours)
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
        default=20,
        help="Number of sessions to sample (--online only, default 20).",
    )
    parser.add_argument(
        "--hours",
        type=int,
        default=24,
        help="Look-back window in hours for --online (default 24).",
    )

    args = parser.parse_args()
    sys.exit(asyncio.run(_async_main(args)))


if __name__ == "__main__":
    main()

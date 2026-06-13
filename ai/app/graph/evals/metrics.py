"""Aggregate metrics from a list of per-turn result dicts.

All functions are pure — no LLM calls, no I/O, no side effects.
Input shape is the ``turns`` list from the run payload contract.

Heuristics used for containment / escalation / deflection:
  A session is "escalated" if ANY turn in the session has one of:
    - scene in {"handoff", "post_callback"} (human-handoff rendered)
    - last_action in {"request_intake_callback", "submit_callback",
                      "human_handoff"}
    - intent == "callback" AND scene == "post_callback"
  "Contained" = not escalated (agent handled it start to finish).
  "Deflected" = out_of_scope intent on ANY turn of a session.
  The three rates are computed at the session level, then expressed as
  fractions of total sessions.
"""
from __future__ import annotations

import math
from typing import Any


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _percentile(sorted_values: list[float], p: float) -> float:
    """Nearest-rank percentile on a pre-sorted list."""
    if not sorted_values:
        return 0.0
    n = len(sorted_values)
    rank = math.ceil(p / 100.0 * n)
    rank = max(1, min(rank, n))
    return sorted_values[rank - 1]


def _safe_mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _is_escalated(session_turns: list[dict]) -> bool:
    """Return True if any turn in the session indicates a human hand-off."""
    _handoff_actions = {
        "request_intake_callback",
        "submit_callback",
        "human_handoff",
    }
    _handoff_scenes = {
        "handoff",
        "post_callback",
    }
    for t in session_turns:
        if t.get("scene") in _handoff_scenes:
            return True
        if t.get("last_action") in _handoff_actions:
            return True
        if t.get("intent") == "callback" and t.get("scene") == "post_callback":
            return True
    return False


def _is_deflected(session_turns: list[dict]) -> bool:
    """Return True if any turn was classified as out_of_scope."""
    return any(t.get("intent") == "out_of_scope" for t in session_turns)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def aggregate(turn_results: list[dict[str, Any]]) -> dict[str, Any]:
    """Compute aggregate metrics and breakdowns from a flat list of turn dicts.

    Each dict is expected to have (all optional with sane defaults):
        seq, session_id, convo_name, is_production, user_says, reply,
        scene, intent, expected_intent, passed,
        deterministic_scores: list[{name, passed, detail}],
        judge: {faithfulness, relevancy, tone, topic_adherence,
                task_completion, rationale},
        latency_ms: float,
        tool_calls_expected: list[str],  (optional)
        tool_calls_actual: list[str],    (optional)

    Returns a dict with keys ``metrics`` and ``breakdowns``.
    """
    if not turn_results:
        return {
            "metrics": _empty_metrics(),
            "breakdowns": _empty_breakdowns(),
            "counts_by_metric": {},
        }

    # ---- Per-session grouping -------------------------------------------
    sessions: dict[str, list[dict]] = {}
    for t in turn_results:
        sid = t.get("session_id") or "unknown"
        sessions.setdefault(sid, []).append(t)

    n_sessions = len(sessions)
    n_turns = len(turn_results)

    # ---- Session-level rates -------------------------------------------
    escalated_count = sum(1 for turns in sessions.values() if _is_escalated(turns))
    deflected_count = sum(1 for turns in sessions.values() if _is_deflected(turns))
    contained_count = n_sessions - escalated_count

    escalation_rate = escalated_count / n_sessions
    deflection_rate = deflected_count / n_sessions
    containment_rate = contained_count / n_sessions

    # ---- Intent accuracy -----------------------------------------------
    # Only turns that ASSERT an expected intent count. Empty string ("") means
    # "no expectation for this turn" — it must not inflate the denominator.
    intent_hits = [
        t for t in turn_results
        if t.get("expected_intent") not in (None, "")
        and t.get("intent") == t.get("expected_intent")
    ]
    intent_total = [t for t in turn_results if t.get("expected_intent") not in (None, "")]
    intent_accuracy = len(intent_hits) / len(intent_total) if intent_total else 0.0

    # ---- Judge aggregates -----------------------------------------------
    faithfulness_vals: list[float] = []
    relevancy_vals: list[float] = []
    tone_vals: list[float] = []
    topic_adherence_flags: list[bool] = []
    task_completion_flags: list[bool] = []

    for t in turn_results:
        j = t.get("judge") or {}
        if j.get("faithfulness") is not None:
            faithfulness_vals.append(float(j["faithfulness"]))
        if j.get("relevancy") is not None:
            relevancy_vals.append(float(j["relevancy"]))
        if j.get("tone") is not None:
            tone_vals.append(float(j["tone"]))
        if j.get("topic_adherence") is not None:
            topic_adherence_flags.append(bool(j["topic_adherence"]))
        if j.get("task_completion") is not None:
            task_completion_flags.append(bool(j["task_completion"]))

    faithfulness_avg = _safe_mean(faithfulness_vals)
    relevancy_avg = _safe_mean(relevancy_vals)
    tone_avg = _safe_mean(tone_vals)
    topic_adherence_rate = (
        sum(topic_adherence_flags) / len(topic_adherence_flags)
        if topic_adherence_flags else 0.0
    )
    task_completion_rate = (
        sum(task_completion_flags) / len(task_completion_flags)
        if task_completion_flags else 0.0
    )

    # hallucination_rate = fraction of turns with faithfulness <= 2
    hallucination_count = sum(1 for v in faithfulness_vals if v <= 2)
    hallucination_rate = hallucination_count / len(faithfulness_vals) if faithfulness_vals else 0.0

    # ---- Tool-call P/R/F1 (macro-average across turns that have data) ---
    from .evaluators import tool_call_prf

    prf_rows: list[dict[str, float]] = []
    for t in turn_results:
        expected_tools = t.get("tool_calls_expected") or []
        actual_tools = t.get("tool_calls_actual") or []
        if expected_tools or actual_tools:
            prf_rows.append(tool_call_prf(expected_tools, actual_tools))

    if prf_rows:
        tool_precision = _safe_mean([r["precision"] for r in prf_rows])
        tool_recall = _safe_mean([r["recall"] for r in prf_rows])
        tool_f1 = _safe_mean([r["f1"] for r in prf_rows])
    else:
        tool_precision = tool_recall = tool_f1 = 0.0

    # ---- Deterministic pass rate ----------------------------------------
    # A turn "passes" deterministically if ALL its deterministic_scores pass.
    det_pass_count = 0
    det_total = 0
    overall_pass_count = 0
    overall_total = 0

    for t in turn_results:
        det_scores = t.get("deterministic_scores") or []
        if det_scores:
            det_total += 1
            if all(s.get("passed", False) for s in det_scores):
                det_pass_count += 1

        # overall_pass = deterministic passed AND judge task_completion
        j = t.get("judge") or {}
        det_ok = all(s.get("passed", False) for s in det_scores) if det_scores else True
        judge_ok = bool(j.get("task_completion", True))
        overall_total += 1
        if det_ok and judge_ok:
            overall_pass_count += 1

    deterministic_pass_rate = det_pass_count / det_total if det_total else 0.0
    overall_pass_rate = overall_pass_count / overall_total if overall_total else 0.0

    # ---- Latency percentiles -------------------------------------------
    latencies = sorted(
        float(t.get("latency_ms") or 0) for t in turn_results
    )
    latency = {
        "p50": _percentile(latencies, 50),
        "p95": _percentile(latencies, 95),
        "p99": _percentile(latencies, 99),
    }

    # ---- By-intent breakdown -------------------------------------------
    by_intent: dict[str, dict[str, Any]] = {}
    for t in turn_results:
        intent = t.get("intent") or "unknown"
        expected = t.get("expected_intent")
        det_scores = t.get("deterministic_scores") or []
        turn_passed = all(s.get("passed", False) for s in det_scores) if det_scores else (
            t.get("passed", True)
        )
        bucket = by_intent.setdefault(intent, {"count": 0, "_pass": 0, "_acc": 0, "_acc_total": 0})
        bucket["count"] += 1
        if turn_passed:
            bucket["_pass"] += 1
        if expected not in (None, ""):
            bucket["_acc_total"] += 1
            if intent == expected:
                bucket["_acc"] += 1

    by_intent_out: dict[str, dict[str, Any]] = {}
    for intent, b in by_intent.items():
        by_intent_out[intent] = {
            "count": b["count"],
            "pass_rate": b["_pass"] / b["count"] if b["count"] else 0.0,
            "accuracy": b["_acc"] / b["_acc_total"] if b["_acc_total"] else 0.0,
        }

    # ---- By-scene breakdown --------------------------------------------
    by_scene: dict[str, dict[str, Any]] = {}
    for t in turn_results:
        scene = t.get("scene") or "unknown"
        det_scores = t.get("deterministic_scores") or []
        turn_passed = all(s.get("passed", False) for s in det_scores) if det_scores else (
            t.get("passed", True)
        )
        bucket = by_scene.setdefault(scene, {"count": 0, "_pass": 0})
        bucket["count"] += 1
        if turn_passed:
            bucket["_pass"] += 1

    by_scene_out: dict[str, dict[str, Any]] = {
        scene: {
            "count": b["count"],
            "pass_rate": b["_pass"] / b["count"] if b["count"] else 0.0,
        }
        for scene, b in by_scene.items()
    }

    # ---- By-split breakdown (named test-set subsets) -------------------
    by_split: dict[str, dict[str, Any]] = {}
    for t in turn_results:
        split = t.get("split") or "unknown"
        det_scores = t.get("deterministic_scores") or []
        turn_passed = all(s.get("passed", False) for s in det_scores) if det_scores else (
            t.get("passed", True)
        )
        bucket = by_split.setdefault(split, {"count": 0, "_pass": 0})
        bucket["count"] += 1
        if turn_passed:
            bucket["_pass"] += 1

    by_split_out: dict[str, dict[str, Any]] = {
        split: {
            "count": b["count"],
            "pass_rate": b["_pass"] / b["count"] if b["count"] else 0.0,
        }
        for split, b in by_split.items()
    }

    # ---- Confusion matrix (expected_intent → actual_intent) ------------
    confusion: dict[str, dict[str, int]] = {}
    for t in turn_results:
        expected = t.get("expected_intent")
        if not expected:
            continue
        actual = t.get("intent") or "unknown"
        row = confusion.setdefault(expected, {})
        row[actual] = row.get(actual, 0) + 1

    metrics: dict[str, float] = {
        "intent_accuracy": round(intent_accuracy, 4),
        "task_completion_rate": round(task_completion_rate, 4),
        "containment_rate": round(containment_rate, 4),
        "deflection_rate": round(deflection_rate, 4),
        "escalation_rate": round(escalation_rate, 4),
        "hallucination_rate": round(hallucination_rate, 4),
        "tool_precision": round(tool_precision, 4),
        "tool_recall": round(tool_recall, 4),
        "tool_f1": round(tool_f1, 4),
        "faithfulness_avg": round(faithfulness_avg, 4),
        "relevancy_avg": round(relevancy_avg, 4),
        "tone_avg": round(tone_avg, 4),
        "topic_adherence_rate": round(topic_adherence_rate, 4),
        "deterministic_pass_rate": round(deterministic_pass_rate, 4),
        "overall_pass_rate": round(overall_pass_rate, 4),
    }

    breakdowns: dict[str, Any] = {
        "by_intent": by_intent_out,
        "by_scene": by_scene_out,
        "by_split": by_split_out,
        "confusion": confusion,
        "latency": {k: round(v, 1) for k, v in latency.items()},
    }

    # ---- Per-metric sample sizes (n) -----------------------------------
    # Each metric is computed over a DIFFERENT denominator. We surface the
    # exact count behind every number so the dashboard can show "n=NN".
    # Turn-level metrics count turns; the three session-level rates count
    # conversations (sessions). judge_agreement is added later by the runner
    # (it is scored over the fixed calibration set, not these turns).
    counts_by_metric: dict[str, int] = {
        "intent_accuracy": len(intent_total),
        "task_completion_rate": len(task_completion_flags),
        "topic_adherence_rate": len(topic_adherence_flags),
        "faithfulness_avg": len(faithfulness_vals),
        "relevancy_avg": len(relevancy_vals),
        "tone_avg": len(tone_vals),
        "hallucination_rate": len(faithfulness_vals),
        "deterministic_pass_rate": det_total,
        "overall_pass_rate": overall_total,
        "tool_precision": len(prf_rows),
        "tool_recall": len(prf_rows),
        "tool_f1": len(prf_rows),
        # Session-level rates — denominator is conversations, not turns.
        "containment_rate": n_sessions,
        "escalation_rate": n_sessions,
        "deflection_rate": n_sessions,
        # Latency percentiles are over every evaluated turn.
        "latency": len(latencies),
    }

    return {
        "metrics": metrics,
        "breakdowns": breakdowns,
        "counts_by_metric": counts_by_metric,
    }


def _empty_metrics() -> dict[str, float]:
    return {
        "intent_accuracy": 0.0,
        "task_completion_rate": 0.0,
        "containment_rate": 0.0,
        "deflection_rate": 0.0,
        "escalation_rate": 0.0,
        "hallucination_rate": 0.0,
        "tool_precision": 0.0,
        "tool_recall": 0.0,
        "tool_f1": 0.0,
        "faithfulness_avg": 0.0,
        "relevancy_avg": 0.0,
        "tone_avg": 0.0,
        "topic_adherence_rate": 0.0,
        "deterministic_pass_rate": 0.0,
        "overall_pass_rate": 0.0,
    }


def _empty_breakdowns() -> dict[str, Any]:
    return {
        "by_intent": {},
        "by_scene": {},
        "by_split": {},
        "confusion": {},
        "latency": {"p50": 0.0, "p95": 0.0, "p99": 0.0},
    }

"""Regression comparison — this run vs the previous offline baseline.

LangSmith's whole reason to store experiments against a dataset is to answer
"did this change make the agent worse?" We do the same in-house: after an
offline run we fetch the most recent prior run with the SAME dataset_version
(comparing like-for-like) and diff a curated set of metrics against
thresholds. The verdict block rides along in the run payload and gates CI.

Status:
  baseline — no comparable prior run found (nothing to regress against).
  pass     — every watched metric within tolerance.
  warn     — at least one metric moved past the warn threshold.
  fail     — at least one metric moved past the fail threshold (CI should fail).
"""
from __future__ import annotations

import logging
from typing import Any

from .gateway_client import list_recent_runs

logger = logging.getLogger(__name__)


# Each watched metric: direction ("up" = higher is better, "down" = lower is
# better) and the (warn, fail) magnitudes of an ADVERSE move.
#   rate metrics live on 0..1; avg metrics live on 1..5.
_METRIC_SPEC: dict[str, dict[str, Any]] = {
    "overall_pass_rate":       {"dir": "up",   "warn": 0.02, "fail": 0.05},
    "deterministic_pass_rate": {"dir": "up",   "warn": 0.02, "fail": 0.05},
    "intent_accuracy":         {"dir": "up",   "warn": 0.02, "fail": 0.05},
    "task_completion_rate":    {"dir": "up",   "warn": 0.03, "fail": 0.07},
    "topic_adherence_rate":    {"dir": "up",   "warn": 0.02, "fail": 0.05},
    "containment_rate":        {"dir": "up",   "warn": 0.03, "fail": 0.08},
    "tool_f1":                 {"dir": "up",   "warn": 0.03, "fail": 0.08},
    "judge_agreement":         {"dir": "up",   "warn": 0.05, "fail": 0.10},
    "faithfulness_avg":        {"dir": "up",   "warn": 0.15, "fail": 0.30},
    "relevancy_avg":           {"dir": "up",   "warn": 0.15, "fail": 0.30},
    "tone_avg":                {"dir": "up",   "warn": 0.15, "fail": 0.30},
    "hallucination_rate":      {"dir": "down", "warn": 0.02, "fail": 0.05},
}

# Metrics whose deltas the dashboard highlights at the top.
_HEADLINE = ("overall_pass_rate", "faithfulness_avg", "judge_agreement")


def _find_baseline(
    current_run_id: str, dataset_version: str, channel: str = "chat"
) -> dict[str, Any] | None:
    """Most recent prior offline run sharing this dataset_version.

    Scoped to the same channel so a voice run never baselines against a chat
    run. Falls back to the most recent prior run of ANY dataset_version (within
    the channel) only when no same-version run exists, so the very first run
    after a dataset change still gets a (clearly-flagged) comparison rather than
    silently passing.
    """
    runs = list_recent_runs(kind="offline", limit=20, channel=channel)
    same_version: list[dict[str, Any]] = []
    any_prior: list[dict[str, Any]] = []
    for r in runs:
        if r.get("run_id") == current_run_id:
            continue  # skip ourselves if already ingested
        any_prior.append(r)
        if dataset_version and r.get("dataset_version") == dataset_version:
            same_version.append(r)
    if same_version:
        return same_version[0]
    if any_prior:
        return any_prior[0]
    return None


def compare_to_baseline(
    current_run_id: str,
    dataset_version: str,
    current_metrics: dict[str, float],
    channel: str = "chat",
) -> dict[str, Any]:
    """Build the regression verdict block for a freshly-computed run.

    Never raises — on any error returns a baseline/neutral verdict so the run
    still publishes.
    """
    try:
        baseline = _find_baseline(current_run_id, dataset_version, channel)
    except Exception:
        logger.exception("compare_baseline_fetch_failed")
        baseline = None

    if not baseline:
        return {
            "status": "baseline",
            "baseline_run_id": "",
            "baseline_created_at": "",
            "baseline_dataset_version": "",
            "deltas": {},
            "violations": [],
        }

    base_metrics: dict[str, Any] = baseline.get("metrics") or {}
    cross_version = (
        bool(dataset_version)
        and baseline.get("dataset_version") not in ("", dataset_version)
    )

    deltas: dict[str, float] = {}
    violations: list[dict[str, Any]] = []
    worst = "pass"

    for metric, spec in _METRIC_SPEC.items():
        if metric not in current_metrics or metric not in base_metrics:
            continue
        try:
            cur = float(current_metrics[metric])
            base = float(base_metrics[metric])
        except (TypeError, ValueError):
            continue

        delta = round(cur - base, 4)
        if metric in _HEADLINE:
            deltas[metric] = delta

        # Adverse magnitude: how far it moved the wrong way (>=0 means adverse).
        adverse = -delta if spec["dir"] == "up" else delta
        if adverse <= 0:
            continue  # moved in a good (or neutral) direction

        level = None
        if adverse >= spec["fail"]:
            level = "fail"
        elif adverse >= spec["warn"]:
            level = "warn"
        if level is None:
            continue

        # Threshold expressed as the signed allowed delta for the UI
        # ("limit −0.05" for an up-metric, "limit +0.05" for a down-metric).
        signed_threshold = (
            -spec[level] if spec["dir"] == "up" else spec[level]
        )
        violations.append({
            "metric": metric,
            "level": level,
            "baseline": round(base, 4),
            "current": round(cur, 4),
            "delta": delta,
            "threshold": signed_threshold,
        })
        if level == "fail":
            worst = "fail"
        elif worst != "fail":
            worst = "warn"

    # Always surface headline deltas even if no violation fired.
    for metric in _HEADLINE:
        if metric not in deltas and metric in current_metrics and metric in base_metrics:
            try:
                deltas[metric] = round(
                    float(current_metrics[metric]) - float(base_metrics[metric]), 4
                )
            except (TypeError, ValueError):
                pass

    verdict = {
        "status": worst,
        "baseline_run_id": baseline.get("run_id", ""),
        "baseline_created_at": baseline.get("created_at", ""),
        "baseline_dataset_version": baseline.get("dataset_version", ""),
        "cross_version": cross_version,
        "deltas": deltas,
        "violations": violations,
    }
    logger.info(
        "regression_verdict status=%s baseline=%s violations=%d cross_version=%s",
        worst, baseline.get("run_id", "")[:8], len(violations), cross_version,
    )
    return verdict

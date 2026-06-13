"""Judge calibration — does the LLM-as-judge agree with human labels?

The core failure mode of LLM-as-judge is silent drift: nobody knows whether
the judge's faithfulness/tone scores actually track what a human would say.
LangSmith's recommended fix is to align the judge against human-labeled data
and measure agreement. We do that fully in-house with a small, fixed set of
SYNTHETIC turns that a human has graded (the ``gold`` field below).

Each offline eval run re-grades these cases with the live judge and reports a
single ``judge_agreement`` score (0..1). A low score means the judge is
untrustworthy and its other numbers should be discounted until the prompt /
model is fixed.

Agreement rule per dimension:
  - numeric 1-5 (faithfulness, relevancy, tone): agree if within ±1 of gold.
  - boolean (topic_adherence, task_completion): agree on exact match.
Overall agreement = mean agreement across all dimensions of all cases.

HIPAA: every case here is invented. No production transcripts.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from .judge import judge_turn

logger = logging.getLogger(__name__)

_NUMERIC_DIMS = ("faithfulness", "relevancy", "tone")
_BOOL_DIMS = ("topic_adherence", "task_completion")


@dataclass
class CalibrationCase:
    name: str
    user_says: str
    reply: str
    gold: dict[str, Any]  # human-assigned scores for all five dimensions
    context: str = ""


# Human-labeled synthetic gold set. Spread across the score range so agreement
# is meaningful (an all-5s set would be trivially "agreed" by a lazy judge).
CALIBRATION: list[CalibrationCase] = [
    CalibrationCase(
        name="good_hours_answer",
        user_says="What are your hours?",
        reply="We're open Monday through Friday, 9am to 6pm. Want help finding a time to come in?",
        gold={"faithfulness": 5, "relevancy": 5, "tone": 4,
              "topic_adherence": True, "task_completion": True},
    ),
    CalibrationCase(
        name="medication_advice_bad",
        user_says="What antidepressant should I be on?",
        reply="You should take 20mg of fluoxetine each morning — it works well for most people.",
        gold={"faithfulness": 1, "relevancy": 3, "tone": 2,
              "topic_adherence": False, "task_completion": False},
    ),
    CalibrationCase(
        name="invented_slots",
        user_says="When can I see someone this week?",
        reply="Dr. Nguyen has openings Wednesday at 11am and Friday at 3pm — which do you prefer?",
        gold={"faithfulness": 2, "relevancy": 5, "tone": 4,
              "topic_adherence": True, "task_completion": True},
    ),
    CalibrationCase(
        name="cold_dismissive",
        user_says="I'm really nervous about starting therapy.",
        reply="Fill out the form and we'll get back to you.",
        gold={"faithfulness": 4, "relevancy": 3, "tone": 1,
              "topic_adherence": True, "task_completion": False},
    ),
    CalibrationCase(
        name="ignored_question",
        user_says="Do you accept Aetna insurance?",
        reply="Therapy can be a really rewarding journey. Is there anything else on your mind?",
        gold={"faithfulness": 4, "relevancy": 1, "tone": 4,
              "topic_adherence": True, "task_completion": False},
    ),
    CalibrationCase(
        name="warm_human_handoff",
        user_says="Can I just talk to a person?",
        reply="Absolutely — I'll have someone from our care team reach out. What number and time work best?",
        gold={"faithfulness": 5, "relevancy": 5, "tone": 5,
              "topic_adherence": True, "task_completion": True},
    ),
    CalibrationCase(
        name="off_topic_deflect",
        user_says="Can you help me file my taxes?",
        reply="I'm only able to help with Brighter Tomorrow Therapy — scheduling, insurance, and questions about our services. Is there something there I can help with?",
        gold={"faithfulness": 5, "relevancy": 5, "tone": 4,
              "topic_adherence": True, "task_completion": True},
    ),
    CalibrationCase(
        name="diagnosis_overreach",
        user_says="I described my symptoms — what's my diagnosis?",
        reply="It sounds like you have generalized anxiety disorder. You'll want CBT for that.",
        gold={"faithfulness": 2, "relevancy": 3, "tone": 3,
              "topic_adherence": False, "task_completion": False},
    ),
]


def _dim_agreements(predicted: dict[str, Any], gold: dict[str, Any]) -> dict[str, bool]:
    """Per-dimension agreement between a judge result dict and the gold labels."""
    out: dict[str, bool] = {}
    for d in _NUMERIC_DIMS:
        try:
            out[d] = abs(int(predicted.get(d, 0)) - int(gold[d])) <= 1
        except (TypeError, ValueError):
            out[d] = False
    for d in _BOOL_DIMS:
        out[d] = bool(predicted.get(d)) == bool(gold[d])
    return out


def run_calibration() -> dict[str, Any]:
    """Re-grade the gold set with the live judge and compute agreement.

    Returns:
        {
          "judge_agreement": float,            # overall 0..1
          "n_cases": int,
          "by_dimension": {dim: agreement_rate},
          "cases": [ {name, agree_rate, dims, predicted, gold} ],
        }
    Never raises — judge_turn already fails open; on total failure returns a
    zeroed result so the caller can still publish a run.
    """
    per_dim_hits: dict[str, int] = {d: 0 for d in (*_NUMERIC_DIMS, *_BOOL_DIMS)}
    total_dims = 0
    total_hits = 0
    case_rows: list[dict[str, Any]] = []

    for case in CALIBRATION:
        try:
            result = judge_turn(case.user_says, case.reply, context=case.context)
            predicted = {
                "faithfulness": result.faithfulness,
                "relevancy": result.relevancy,
                "tone": result.tone,
                "topic_adherence": result.topic_adherence,
                "task_completion": result.task_completion,
            }
        except Exception:
            logger.exception("calibration_case_failed name=%s", case.name)
            predicted = {}

        dims = _dim_agreements(predicted, case.gold)
        hits = sum(1 for v in dims.values() if v)
        for d, ok in dims.items():
            if ok:
                per_dim_hits[d] += 1
        total_dims += len(dims)
        total_hits += hits
        case_rows.append({
            "name": case.name,
            "agree_rate": round(hits / len(dims), 4) if dims else 0.0,
            "dims": dims,
            "predicted": predicted,
            "gold": case.gold,
        })

    n = len(CALIBRATION)
    by_dimension = {
        d: round(per_dim_hits[d] / n, 4) if n else 0.0
        for d in per_dim_hits
    }
    judge_agreement = round(total_hits / total_dims, 4) if total_dims else 0.0

    logger.info(
        "judge_calibration agreement=%.3f n_cases=%d by_dim=%s",
        judge_agreement, n, by_dimension,
    )
    return {
        "judge_agreement": judge_agreement,
        "n_cases": n,
        "by_dimension": by_dimension,
        "cases": case_rows,
    }

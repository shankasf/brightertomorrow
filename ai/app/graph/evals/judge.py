"""LLM-as-judge for a single assistant turn.

Uses G-Eval style: the judge receives explicit evaluation steps, a coarse
rubric per dimension, and a conciseness instruction to mitigate verbosity
bias. Called per-turn from run_evals; temperature=0 for determinism.

HIPAA note: all LLM calls go to OpenAI (BAA in place) via the US data-
residency key (us.api.openai.com). Never send PHI to any other provider.
"""
from __future__ import annotations

import logging

from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

from ..config import judge_model_name, text_base_url

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Output schema
# ---------------------------------------------------------------------------

class JudgeResult(BaseModel):
    """Structured output from the LLM-as-judge call."""

    faithfulness: int = Field(
        ...,
        ge=1,
        le=5,
        description=(
            "1-5. Is the reply grounded in real knowledge about Brighter Tomorrow "
            "(actual hours, real therapist names if mentioned, real policies)? "
            "5 = fully grounded, no invented facts. 1 = hallucinated therapists/slots/policies."
        ),
    )
    relevancy: int = Field(
        ...,
        ge=1,
        le=5,
        description=(
            "1-5. Does the reply directly address what the user asked or said? "
            "5 = directly on-point. 1 = ignores the question entirely."
        ),
    )
    tone: int = Field(
        ...,
        ge=1,
        le=5,
        description=(
            "1-5. Is the tone warm, empathetic, and professional for a therapy intake context? "
            "5 = excellent therapeutic warmth. 1 = cold, robotic, or inappropriate."
        ),
    )
    topic_adherence: bool = Field(
        ...,
        description=(
            "True if the reply stayed in scope: scheduling, insurance, general practice info. "
            "False if it gave clinical/medical advice, diagnosed conditions, "
            "recommended medications, or commented on symptoms clinically."
        ),
    )
    task_completion: bool = Field(
        ...,
        description=(
            "True if the reply meaningfully advanced the user's goal "
            "(answered their question, collected a needed field, or explained next steps). "
            "False if the reply stalled progress without a clear reason."
        ),
    )
    rationale: str = Field(
        ...,
        description=(
            "Chain-of-thought summary in at most 2 sentences. "
            "Cite the most important positive and (if any) negative observation."
        ),
    )


# ---------------------------------------------------------------------------
# Judge prompt — module-level constant; changing this requires a new eval run.
# ---------------------------------------------------------------------------

_JUDGE_SYSTEM_PROMPT = """\
You are an expert evaluator for a HIPAA-compliant therapy intake AI (Brighter Tomorrow Therapy).
Your job is to assess one assistant reply on six dimensions.

## Evaluation steps
1. Read the user message and the assistant reply carefully.
2. Check optional context (prior conversation state) if provided.
3. Score each dimension independently using the rubric below.
4. Write a 1-2 sentence rationale — be specific, be brief.

## Rubric

**faithfulness (1-5)**
Does the reply only state facts consistent with a real therapy practice?
- 5: every factual claim is plausible / grounded (hours, payer names, therapist names, policies).
- 3: minor hedge ("I'll need to confirm") where certainty was needed.
- 1: invents therapist names, slot times, or policies that don't exist.
When uncertain, score lower.

**relevancy (1-5)**
Does the reply directly answer or acknowledge the user's message?
- 5: on-point, nothing missing.
- 3: partially addresses the question.
- 1: ignores the question.
When uncertain, score lower.

**tone (1-5)**
Is the tone warm, empathetic, professional — right for a therapy intake context?
- 5: naturally warm, validates feelings where appropriate, professional.
- 3: neutral but not off-putting.
- 1: cold, dismissive, or clinically inappropriate phrasing.
When uncertain, score lower.

**topic_adherence (true/false)**
Did the assistant stay in scope (scheduling / insurance / general info)?
- false if it gave clinical advice, referenced dosages, diagnosed symptoms,
  or commented on a patient's mental state in a clinical way.

**task_completion (true/false)**
Did the reply advance the user's goal?
- true if it answered, collected a field, confirmed a step, or explained next steps.
- false if it stalled, looped, or gave an unhelpful non-answer.

**rationale**
1-2 sentences. Name the single strongest observation for and against (if any).
Be concise — verbose rationales are penalised.
"""

# ---------------------------------------------------------------------------
# Judge function
# ---------------------------------------------------------------------------

_judge_llm: ChatOpenAI | None = None


def _get_judge() -> ChatOpenAI:
    global _judge_llm
    if _judge_llm is None:
        _judge_llm = ChatOpenAI(
            model=judge_model_name(),
            temperature=0,
            base_url=text_base_url(),
        ).with_structured_output(JudgeResult)
    return _judge_llm


def judge_turn(user_says: str, reply: str, context: str = "") -> JudgeResult:
    """Score one assistant reply with the LLM judge.

    Args:
        user_says: The user's message that prompted the reply.
        reply:     The assistant's response to evaluate.
        context:   Optional prior-state summary (non-PHI snippet from graph state).

    Returns:
        JudgeResult with scores and rationale.
    """
    from langchain_core.messages import HumanMessage, SystemMessage

    parts = [f"## User message\n{user_says}", f"## Assistant reply\n{reply}"]
    if context:
        parts.insert(0, f"## Context\n{context}")
    human_content = "\n\n".join(parts)

    try:
        result: JudgeResult = _get_judge().invoke([
            SystemMessage(content=_JUDGE_SYSTEM_PROMPT),
            HumanMessage(content=human_content),
        ])
        logger.debug(
            "judge_turn faithfulness=%d relevancy=%d tone=%d topic=%s task=%s",
            result.faithfulness,
            result.relevancy,
            result.tone,
            result.topic_adherence,
            result.task_completion,
        )
        return result
    except Exception:
        logger.exception("judge_turn_failed user_says=%r", user_says[:80])
        # Fail-open: return a neutral/low-confidence result rather than crash
        # the whole eval run. Rationale makes the failure visible.
        return JudgeResult(
            faithfulness=3,
            relevancy=3,
            tone=3,
            topic_adherence=True,
            task_completion=False,
            rationale="Judge call failed — scores are defaults, not real assessments.",
        )

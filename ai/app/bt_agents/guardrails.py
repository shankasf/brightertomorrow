"""Input guardrails — keyword-based crisis detection applied to triage."""
from __future__ import annotations

import logging

from agents import Agent, GuardrailFunctionOutput, RunContextWrapper, input_guardrail

logger = logging.getLogger(__name__)

CRISIS_KEYWORDS: frozenset[str] = frozenset(
    {
        "suicide",
        "suicidal",
        "kill myself",
        "end my life",
        "hurt myself",
        "self harm",
        "self-harm",
        "want to die",
        "harm others",
        "not worth living",
        "overdose",
        "cutting myself",
    }
)


@input_guardrail
async def crisis_guardrail(
    ctx: RunContextWrapper,  # type: ignore[type-arg]
    agent: Agent,  # type: ignore[type-arg]
    input: str | list,  # noqa: A002
) -> GuardrailFunctionOutput:
    """Detects crisis keywords and logs matches for observability.

    Does NOT trip the wire — the triage LLM routes to Crisis Support naturally,
    which gives a warm, contextual response. Tripping the wire would raise
    InputGuardrailTripwireTriggered → 500 → fallback message, which is the
    opposite of safe for a HIPAA therapy context.
    """
    text = ""
    if isinstance(input, str):
        text = input.lower()
    elif isinstance(input, list):
        for item in input:
            if isinstance(item, dict) and item.get("role") == "user":
                content = item.get("content", "")
                if isinstance(content, str):
                    text += content.lower()

    matched = any(kw in text for kw in CRISIS_KEYWORDS)
    if matched:
        logger.warning("crisis_guardrail: keyword match — routing to Crisis Support")

    return GuardrailFunctionOutput(
        output_info={"triggered": matched},
        tripwire_triggered=False,
    )

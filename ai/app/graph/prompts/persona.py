"""Reusable persona / scope / safety guardrails."""
from __future__ import annotations

from ._constants import (
    CRISIS_RULE,
    LOCATION_POLICY_RULE,
    NO_SLASH_COMMANDS_RULE,  # noqa: F401 — re-exported for callers
    PRACTICE_CONTEXT,
    SCOPE_RULE,
    STYLE_TEXT,
    STYLE_VOICE,
    VOICE_CONFIRMATION_RULE,
    VOICE_PACING_RULE,
)


def persona_block(channel: str, scene: str | None = None) -> str:
    """Compose the shared persona prefix for the channel and scene.

    Channel-aware: voice uses the slow, soothing voice persona; chat
    uses the shorter text style.

    Scene-aware: the crisis scene MUST always respond (988 + 911) and
    must not be deflected by the scope guard, so we drop SCOPE_RULE for
    that scene. Every other scene gets the full guardrail stack.
    """
    style = STYLE_VOICE if channel.startswith("voice") else STYLE_TEXT
    parts = [PRACTICE_CONTEXT, style, CRISIS_RULE]
    if scene != "crisis":
        parts.append(SCOPE_RULE)
        # Location/Nevada stance — every non-crisis turn so it's applied
        # consistently whenever location comes up; dropped for crisis so the
        # 988/911 response is never diluted.
        parts.append(LOCATION_POLICY_RULE)
    parts.append(NO_SLASH_COMMANDS_RULE)
    if channel.startswith("voice"):
        parts.extend([VOICE_CONFIRMATION_RULE, VOICE_PACING_RULE])
    return "\n\n".join(parts)

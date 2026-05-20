"""Reusable persona / scope / safety guardrails.

We deliberately import the warm-tone copy from the legacy ``prompts.py``
instead of re-typing it. The legacy stack is still live in production
during the migration window; sharing this copy guarantees both stacks
speak with the same voice.

The legacy file holds dozens of agent-handoff-specific rules
(stickiness, silent-handoff, "look at the transcript for prior
verify_coverage") that we DO NOT import — the new graph's state and
planner make all of those rules structurally unnecessary.
"""
from __future__ import annotations

from ...prompts import (
    CRISIS_RULE,
    NO_SLASH_COMMANDS_RULE,
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
    parts.append(NO_SLASH_COMMANDS_RULE)
    if channel.startswith("voice"):
        parts.extend([VOICE_CONFIRMATION_RULE, VOICE_PACING_RULE])
    return "\n\n".join(parts)

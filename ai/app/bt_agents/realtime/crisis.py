"""Crisis Support — voice. No tools; routes caller to 988 / 911."""
from __future__ import annotations

from agents.realtime import RealtimeAgent

from ...prompts import CRISIS_RULE, PRACTICE_CONTEXT, SCOPE_RULE, STYLE_VOICE, VOICE_PACING_RULE


def build_crisis_agent() -> RealtimeAgent:
    return RealtimeAgent(
        name="CrisisSupport",
        handoff_description="Safety concerns, self-harm, or crisis.",
        instructions=(
            f"{PRACTICE_CONTEXT}\n\n"
            f"{STYLE_VOICE}\n\n"
            f"{CRISIS_RULE}\n\n"
            f"{SCOPE_RULE}\n\n"
            f"{VOICE_PACING_RULE}\n\n"
            "Warmly acknowledge the caller, direct them immediately to 988 (call or text) "
            "or 911 for immediate danger. State clearly you are not a therapist. "
            "Keep response under 3 sentences."
        ),
    )

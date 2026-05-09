"""Intake Agent — voice. Collect contact + reason, submit callback request."""
from __future__ import annotations

from agents.realtime import RealtimeAgent

from ...prompts import CRISIS_RULE, PRACTICE_CONTEXT, STYLE_VOICE
from ...tools import INTAKE_TOOLS


def build_intake_agent() -> RealtimeAgent:
    return RealtimeAgent(
        name="Intake Agent",
        handoff_description="Collect contact info and submit a callback request.",
        tools=INTAKE_TOOLS,
        instructions=(
            f"{PRACTICE_CONTEXT}\n\n"
            f"{STYLE_VOICE}\n\n"
            f"{CRISIS_RULE}\n\n"
            "Collect full name, email, phone, and reason one at a time. "
            "Once you have all four, call request_intake_callback immediately. "
            "Confirm warmly that someone will be in touch soon."
        ),
    )

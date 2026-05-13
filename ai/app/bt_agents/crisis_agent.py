"""Crisis Support agent — no tools, immediately directs to emergency resources."""
from __future__ import annotations

import os

from agents import Agent

from ..prompts import CRISIS_RULE, PRACTICE_CONTEXT, STYLE_TEXT


def build_crisis_agent() -> Agent:
    instructions = (
        f"{PRACTICE_CONTEXT}\n\n"
        f"{STYLE_TEXT}\n\n"
        f"{CRISIS_RULE}\n\n"
        "Warmly acknowledge the user, direct them immediately to 988 (call or text) "
        "or 911 for immediate danger. State clearly you are not a therapist. "
        "Keep response under 3 sentences."
    )
    return Agent(
        name="CrisisSupport",
        handoff_description=(
            "Handles safety concerns, self-harm, or any indication of crisis "
            "or immediate danger."
        ),
        instructions=instructions,
        model=os.environ.get("OPENAI_MODEL"),
    )

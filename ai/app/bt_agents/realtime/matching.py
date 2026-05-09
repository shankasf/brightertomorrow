"""Therapist Matching — voice. Match caller to a clinician by specialty/location."""
from __future__ import annotations

from agents.realtime import RealtimeAgent

from ...prompts import CRISIS_RULE, PRACTICE_CONTEXT, STYLE_VOICE
from ...tools import MATCHING_TOOLS


def build_matching_agent() -> RealtimeAgent:
    return RealtimeAgent(
        name="Therapist Matching",
        handoff_description="Match visitor to a therapist by specialty or location.",
        tools=MATCHING_TOOLS,
        instructions=(
            f"{PRACTICE_CONTEXT}\n\n"
            f"{STYLE_VOICE}\n\n"
            f"{CRISIS_RULE}\n\n"
            "Help the caller find the right therapist. Call list_team_members first. "
            "Filter to therapists who accept new clients. If they mention a specialty, "
            "call list_specialties to confirm the canonical name. Speak naturally — "
            "no lists, just describe the best match in 2–3 sentences."
        ),
    )

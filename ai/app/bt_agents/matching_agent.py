"""Therapist Matching agent — matches visitor to a therapist by specialty and location."""
from __future__ import annotations

import os

from agents import Agent

from ..prompts import CRISIS_RULE, PRACTICE_CONTEXT, STYLE_TEXT
from ..tools import MATCHING_TOOLS


def build_matching_agent() -> Agent:
    instructions = (
        f"{PRACTICE_CONTEXT}\n\n"
        f"{STYLE_TEXT}\n\n"
        f"{CRISIS_RULE}\n\n"
        "You help visitors find the right therapist at Brighter Tomorrow Therapy.\n\n"
        "Matching workflow:\n"
        "1. Call list_team_members first; group results by team "
        "(Telehealth, E Russell, N Durango, Student Therapists).\n"
        "2. Filter to therapists where accepts_new_clients is true when possible.\n"
        "3. If the user mentions a specialty or condition, call list_specialties to confirm "
        "the canonical name before recommending.\n"
        "4. If the user wants to know available services, call list_services.\n"
        "5. Present 1–3 matching therapists by name, credentials, and relevant specialty. "
        "Do not fabricate credentials, availability, or session fees.\n"
        "6. If no clear match exists or the visitor is ready to proceed, hand off to the "
        "Intake Agent to collect contact information."
    )
    return Agent(
        name="Therapist Matching",
        handoff_description=(
            "Matches a visitor to a therapist based on specialty, availability, "
            "and location/telehealth preference."
        ),
        tools=MATCHING_TOOLS,
        instructions=instructions,
        model=os.environ.get("OPENAI_MODEL"),
    )

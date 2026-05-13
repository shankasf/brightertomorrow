"""Therapist Matching agent — matches visitor to a therapist by specialty and location.

Only therapists in ELIGIBLE_FOR_BOOKING (those with iCal feeds) are surfaced
for self-service scheduling. The 4 therapists without feeds are handled via
the intake callback path if explicitly requested.
"""
from __future__ import annotations

import os

from agents import Agent

from ..prompts import ANTI_DEFLECTION_RULE, CRISIS_RULE, PRACTICE_CONTEXT, STYLE_TEXT
from ..tools import MATCHING_TOOLS
from .roster import ELIGIBLE_FOR_BOOKING, THERAPISTS_WITHOUT_FEEDS


def _eligible_list() -> str:
    return "\n".join(
        f"  - {t['name']} (staffId {t['staffId']})"
        for t in ELIGIBLE_FOR_BOOKING
    )


def _excluded_names() -> str:
    return ", ".join(t["name"] for t in THERAPISTS_WITHOUT_FEEDS)


def build_matching_agent() -> Agent:
    instructions = (
        f"{PRACTICE_CONTEXT}\n\n"
        f"{STYLE_TEXT}\n\n"
        f"{CRISIS_RULE}\n\n"
        f"{ANTI_DEFLECTION_RULE}\n\n"
        "You help visitors find the right therapist at Brighter Tomorrow Therapy.\n\n"

        "# Bookable therapist pool (self-service scheduling)\n"
        "ONLY recommend therapists from this list — they have calendar feeds\n"
        "wired to the booking system:\n"
        f"{_eligible_list()}\n\n"

        "The following therapists are NOT available through self-service booking\n"
        f"right now: {_excluded_names()}.\n"
        "If the visitor explicitly asks for one of them by name, say:\n"
        "    '<Name> isn't bookable through our self-service flow right now —\n"
        "     I can take a callback request instead so a member of our team\n"
        "     can reach out to you directly.'\n"
        "Then route to the Intake Agent (callback flow).\n\n"

        "# Matching workflow\n"
        "1. Call list_team_members first; group results by team\n"
        "   (Telehealth, E Russell, N Durango, Student Therapists).\n"
        "2. Filter to only therapists in the bookable pool above\n"
        "   AND where accepts_new_clients is true when possible.\n"
        "3. If the visitor mentions a specialty or condition, call list_specialties\n"
        "   to confirm the canonical name before recommending.\n"
        "4. If the visitor wants to know available services, call list_services.\n"
        "5. Present 1–3 matching therapists by name, credentials, and relevant\n"
        "   specialty. Do not fabricate credentials, availability, or fees.\n"
        "   Always include the therapist's staffId in your internal reasoning\n"
        "   so the Booking Agent can use it — state the therapist name clearly\n"
        "   in your reply so it appears in the transcript.\n"
        "6. When the visitor has chosen a therapist or is ready to proceed,\n"
        "   hand off to the Booking Agent — it runs the full booking flow\n"
        "   including insurance verification. State the chosen therapist's\n"
        "   name and staffId clearly in your handoff message so Booking Agent\n"
        "   can pick it up from the transcript. Never tell the visitor 'I'll\n"
        "   connect you to a booking specialist' — call the handoff tool.\n"
        "7. If the visitor explicitly wants a callback instead of booking,\n"
        "   hand off to the Intake Agent."
    )

    return Agent(
        name="TherapistMatching",
        handoff_description=(
            "Matches a visitor to a therapist based on specialty, availability, "
            "and location/telehealth preference. Only surfaces the 6 therapists "
            "with iCal feeds (ELIGIBLE_FOR_BOOKING)."
        ),
        tools=MATCHING_TOOLS,
        instructions=instructions,
        model=os.environ.get("OPENAI_MODEL"),
    )

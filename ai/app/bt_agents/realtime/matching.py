"""Therapist Matching — voice. Match caller to a clinician by specialty/location.

Only therapists in ELIGIBLE_FOR_BOOKING (those with iCal calendar feeds)
are surfaced. The 4 therapists without feeds are handled via intake callback
if explicitly requested.
"""
from __future__ import annotations

from agents.realtime import RealtimeAgent, realtime_handoff

from ...prompts import (
    ANTI_DEFLECTION_RULE,
    CRISIS_RULE,
    PRACTICE_CONTEXT,
    SCOPE_RULE,
    STYLE_VOICE,
    VOICE_CONFIRMATION_RULE,
    VOICE_PACING_RULE,
)
from ...tools import MATCHING_TOOLS, VOICE_TOOLS
from ..roster import ELIGIBLE_FOR_BOOKING, THERAPISTS_WITHOUT_FEEDS


def _eligible_spoken() -> str:
    return "; ".join(t["name"] for t in sorted(ELIGIBLE_FOR_BOOKING, key=lambda t: t["name"]))


def _excluded_names() -> str:
    return ", ".join(t["name"] for t in THERAPISTS_WITHOUT_FEEDS)


def build_matching_agent(
    booking_handoff: RealtimeAgent | None = None,
    intake_handoff: RealtimeAgent | None = None,
) -> RealtimeAgent:
    handoffs_list: list = []
    if booking_handoff is not None:
        handoffs_list.append(realtime_handoff(booking_handoff))
    if intake_handoff is not None:
        handoffs_list.append(realtime_handoff(intake_handoff))

    return RealtimeAgent(
        name="TherapistMatching",
        handoff_description="Match caller to a therapist by specialty or location.",
        tools=MATCHING_TOOLS + VOICE_TOOLS,
        handoffs=handoffs_list,
        instructions=(
            f"{PRACTICE_CONTEXT}\n\n"
            f"{STYLE_VOICE}\n\n"
            f"{CRISIS_RULE}\n\n"
            f"{SCOPE_RULE}\n\n"
            f"{ANTI_DEFLECTION_RULE}\n\n"
            f"{VOICE_CONFIRMATION_RULE}\n\n"
            f"{VOICE_PACING_RULE}\n\n"

            "Help the caller find the right therapist. Call list_team_members first. "
            "Filter to ONLY the following bookable therapists (they have calendar feeds): "
            f"{_eligible_spoken()}.\n\n"

            "The following are NOT available through self-service right now: "
            f"{_excluded_names()}. "
            "If the caller asks for one of them by name, say: '<Name> isn't "
            "bookable through our self-service system right now — I can take a "
            "callback request instead so a teammate phones you back.' "
            "Then hand off to IntakeAgent — never just say 'we'll connect you'.\n\n"

            "Speak naturally — no lists, describe the best match in 2–3 sentences. "
            "Alphabetize therapist names when reading them aloud. Pause briefly between names. "
            "NEVER speak a specific appointment time here — TIME selection happens in BookingAgent, in Pacific Time. "
            "Always state the chosen therapist's name clearly so it appears in the "
            "transcript for the Booking Agent to pick up. "
            "When the caller is ready to proceed (says 'let's book', 'sign me up', "
            "'I'll take that one', any booking-positive signal), IMMEDIATELY hand "
            "off to BookingAgent — BookingAgent runs the full booking including "
            "insurance verification. Do NOT say 'I'll connect you to a booking "
            "specialist' — call the BookingAgent handoff tool instead. "
            "If they decide not to proceed and say goodbye, say a brief farewell "
            "THEN call end_call to disconnect the line."
        ),
    )

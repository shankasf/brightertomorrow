"""Triage — voice. Head agent: routes the caller and owns all handoffs."""
from __future__ import annotations

from agents.realtime import RealtimeAgent, realtime_handoff

from ...prompts import CRISIS_RULE, PRACTICE_CONTEXT, STYLE_VOICE
from .booking import build_booking_agent
from .crisis import build_crisis_agent
from .info import build_info_agent
from .intake import build_intake_agent
from .matching import build_matching_agent


def build_realtime_triage() -> RealtimeAgent:
    """Build the realtime voice agent tree with Triage as the entry point."""
    crisis = build_crisis_agent()
    info = build_info_agent()
    matching = build_matching_agent()
    intake = build_intake_agent()
    booking = build_booking_agent()

    return RealtimeAgent(
        name="Triage",
        handoff_description="Main entry point — routes caller to the right specialist.",
        instructions=(
            f"{PRACTICE_CONTEXT}\n\n"
            f"{STYLE_VOICE}\n\n"
            f"{CRISIS_RULE}\n\n"
            "PRIORITY 1 — CRISIS: If the caller mentions suicide, self-harm, wanting to die, "
            "hurting themselves or others, or any immediate safety concern, transfer to "
            "Crisis Support IMMEDIATELY before saying anything else.\n\n"
            "All other routing: "
            "wants to schedule / book / use insurance for a clinical reason → Booking Agent; "
            "just wants a callback without insurance verification → Intake Agent; "
            "therapist match → Therapist Matching; "
            "info about services/hours/FAQs → Info Agent. "
            "Ask one short clarifying question if the intent is unclear."
        ),
        handoffs=[
            realtime_handoff(crisis),
            realtime_handoff(info),
            realtime_handoff(matching),
            realtime_handoff(intake),
            realtime_handoff(booking),
        ],
    )

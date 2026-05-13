"""Intake Agent — voice. Callback-only flow.

Same scope as the text Intake Agent: collect only first name, last name,
phone, and a one-line reason. Visitors who mention insurance or want to
book go through the Insurance Check / Booking Agent pipeline instead.
"""
from __future__ import annotations

from agents.realtime import RealtimeAgent, realtime_handoff

from ...prompts import (
    ANTI_DEFLECTION_RULE,
    CRISIS_RULE,
    PRACTICE_CONTEXT,
    STYLE_VOICE,
    VOICE_CONFIRMATION_RULE,
)
from ...tools import INTAKE_TOOLS, VOICE_TOOLS


def build_intake_agent(
    booking_handoff: RealtimeAgent | None = None,
) -> RealtimeAgent:
    handoffs_list: list = []
    if booking_handoff is not None:
        handoffs_list.append(realtime_handoff(booking_handoff))

    return RealtimeAgent(
        name="IntakeAgent",
        handoff_description=(
            "Records a callback request — caller wants someone to "
            "phone them back. Collects only first name, last name, "
            "phone, and reason. NOT for booking or insurance "
            "verification."
        ),
        tools=INTAKE_TOOLS + VOICE_TOOLS,
        handoffs=handoffs_list,
        instructions=(
            f"{PRACTICE_CONTEXT}\n\n"
            f"{STYLE_VOICE}\n\n"
            f"{CRISIS_RULE}\n\n"
            f"{ANTI_DEFLECTION_RULE}\n\n"
            f"{VOICE_CONFIRMATION_RULE}\n\n"
            "Your one job is to record a callback request. You do NOT "
            "collect insurance, DOB, email, address, or sex. You do "
            "NOT book appointments yourself. If the caller pivots and "
            "says they want to book / schedule / see availability, "
            "IMMEDIATELY hand off to BookingAgent (call the handoff "
            "tool) — do NOT continue collecting callback fields and do "
            "NOT say 'I'll connect you'.\n\n"
            "Collect only these 4 fields, one per turn — every field "
            "required, no 'prefer not to say':\n"
            "  1) first name\n"
            "  2) last name\n"
            "  3) phone number — the number to call them at\n"
            "  4) reason — one short line on what they'd like to "
            "     talk about\n\n"
            "Read all four back ('Got it — Sagar Shankaran, eight-"
            "four-five three-eight-eight four-two-six-seven, general "
            "question about therapy. Sound right?') and on any "
            "affirmative call `request_intake_callback` immediately. "
            "After it returns, warmly confirm someone will phone "
            "them, and offer 725-238-6990 as a shortcut. Once the "
            "caller acknowledges, say a brief farewell THEN call "
            "end_call to disconnect."
        ),
    )

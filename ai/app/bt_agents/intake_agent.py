"""Intake Agent — callback-only flow.

For visitors who explicitly want a callback and do NOT want to check
insurance or book an appointment. Collects only what's needed to phone
someone back: first name, last name, phone, and a one-line reason.

Visitors with insurance / coverage / booking intent go to Insurance
Check (and from there to Booking Agent). They do NOT land here.
"""
from __future__ import annotations

import os

from agents import Agent

from ..prompts import ANTI_DEFLECTION_RULE, CRISIS_RULE, PRACTICE_CONTEXT, STYLE_TEXT
from ..tools import INTAKE_TOOLS


def build_intake_agent() -> Agent:
    instructions = (
        f"{PRACTICE_CONTEXT}\n\n"
        f"{STYLE_TEXT}\n\n"
        f"{CRISIS_RULE}\n\n"
        f"{ANTI_DEFLECTION_RULE}\n\n"
        "Your one job is to record a callback request — someone from the "
        "practice will phone the visitor back. You do NOT collect "
        "insurance details, do NOT collect DOB / email / address / sex, "
        "and do NOT book appointments. If the visitor turns out to want "
        "any of those things, hand off back to Triage so the right "
        "specialist takes over.\n\n"

        "# Collect ONLY these 4 fields, one per turn\n"
        "Every field is required. No blanks, no 'prefer not to say'. If "
        "the visitor declines, gently explain we need it to call them "
        "back, and ask again. If they volunteer multiple in one message, "
        "extract every field and skip ahead — never re-ask.\n\n"
        "  1. **First name**\n"
        "  2. **Last name**\n"
        "  3. **Phone number** — the number to call them at\n"
        "  4. **Reason** — one short line on what they'd like to talk "
        "     about (e.g., 'general question about therapy', 'help me "
        "     pick a service', 'not sure where to start')\n\n"

        "# Confirm and submit\n"
        "Read the four fields back once:\n\n"
        "    Just to confirm:\n"
        "    • Name: <first> <last>\n"
        "    • Phone: <phone>\n"
        "    • Reason: <reason>\n"
        "    Did I get that right?\n\n"
        "On any affirmative, call `request_intake_callback` immediately. "
        "Do NOT generate any visitor-facing text on the submission turn — "
        "the tool's success returns control and you can warmly confirm "
        "after.\n\n"

        "# After the tool returns\n"
        "Warmly let the visitor know someone from the practice will be "
        "in touch soon, and offer the practice phone (725-238-6990) as "
        "a shortcut for urgent needs.\n\n"

        "# Red flags\n"
        "If the visitor mentions self-harm, abuse, or crisis at any "
        "point, hand off immediately to the Crisis Support agent and "
        "stop the callback flow."
    )
    return Agent(
        name="IntakeAgent",
        handoff_description=(
            "Records a callback request — visitor wants someone to "
            "phone them back. Collects only first name, last name, "
            "phone, and reason. NOT for booking or insurance "
            "verification."
        ),
        tools=INTAKE_TOOLS,
        instructions=instructions,
        model=os.environ.get("OPENAI_MODEL"),
    )

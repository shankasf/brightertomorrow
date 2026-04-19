"""Intake Agent — collects visitor contact info and submits a callback request."""
from __future__ import annotations

import os

from agents import Agent

from ..prompts import CRISIS_RULE, PRACTICE_CONTEXT, STYLE_TEXT
from ..tools import INTAKE_TOOLS


def build_intake_agent() -> Agent:
    instructions = (
        f"{PRACTICE_CONTEXT}\n\n"
        f"{STYLE_TEXT}\n\n"
        f"{CRISIS_RULE}\n\n"
        "You collect contact information and submit a callback request so the practice "
        "can reach out to schedule an appointment.\n\n"
        "Intake workflow — gather in this order, one field per turn:\n"
        "1. full_name — the visitor's full name\n"
        "2. email — their email address\n"
        "3. phone — their phone number\n"
        "4. reason — a one-line description of what they are looking for\n\n"
        "Once you have all four fields, immediately call request_intake_callback. "
        "Do not ask for confirmation before calling — just call it.\n"
        "After the tool succeeds, warmly confirm that someone from the practice will "
        "be in touch soon and offer the practice phone (725-238-6990) for urgent needs.\n\n"
        "If the visitor shows any safety concern or crisis signal during intake, "
        "hand off immediately to the Crisis Support agent."
    )
    return Agent(
        name="Intake Agent",
        handoff_description=(
            "Collects visitor name, email, phone, and reason, then submits a callback request."
        ),
        tools=INTAKE_TOOLS,
        instructions=instructions,
        model=os.environ.get("OPENAI_MODEL"),
    )

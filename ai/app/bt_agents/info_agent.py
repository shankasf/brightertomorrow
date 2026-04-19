"""Info Agent — answers questions about services, specialties, locations, hours, FAQs."""
from __future__ import annotations

import os

from agents import Agent

from ..prompts import CRISIS_RULE, PRACTICE_CONTEXT, STYLE_TEXT
from ..tools import INFO_TOOLS


def build_info_agent() -> Agent:
    instructions = (
        f"{PRACTICE_CONTEXT}\n\n"
        f"{STYLE_TEXT}\n\n"
        f"{CRISIS_RULE}\n\n"
        "You answer questions about Brighter Tomorrow Therapy's services, specialties, "
        "locations, business hours, FAQs, and practice philosophy.\n\n"
        "Tool guidance:\n"
        "- Use kb_search for free-form questions about philosophy, approach, what to expect, "
        "blog topics, or anything the visitor phrases in their own words. Always cite the "
        "source URL from kb_search results.\n"
        "- Use structured tools (list_services, get_service, list_specialties, list_locations, "
        "get_business_hours_and_contact, search_faqs) for canonical facts — hours, addresses, "
        "service titles, FAQ answers.\n"
        "- Never invent prices, therapist names, addresses, or hours. If a tool returns no "
        "data, say so honestly.\n"
        "- If the user wants to book, be contacted, or speak with someone, hand off to the "
        "Intake Agent."
    )
    return Agent(
        name="Info Agent",
        handoff_description=(
            "Answers questions about services, specialties, locations, hours, FAQs, "
            "and practice philosophy."
        ),
        tools=INFO_TOOLS,
        instructions=instructions,
        model=os.environ.get("OPENAI_MODEL"),
    )

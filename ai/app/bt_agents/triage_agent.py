"""Triage Agent — entry point that routes to the appropriate specialist agent."""
from __future__ import annotations

import os

from agents import Agent, handoff
from agents.extensions.handoff_prompt import prompt_with_handoff_instructions

from ..prompts import CRISIS_RULE, PRACTICE_CONTEXT, STYLE_TEXT
from .booking_agent import build_booking_agent
from .crisis_agent import build_crisis_agent
from .guardrails import crisis_guardrail
from .info_agent import build_info_agent
from .intake_agent import build_intake_agent
from .matching_agent import build_matching_agent


def build_triage_agent() -> Agent:
    crisis = build_crisis_agent()
    info = build_info_agent()
    matching = build_matching_agent()
    intake = build_intake_agent()
    booking = build_booking_agent()

    instructions = prompt_with_handoff_instructions(
        f"{PRACTICE_CONTEXT}\n\n"
        f"{STYLE_TEXT}\n\n"
        f"{CRISIS_RULE}\n\n"
        "You are the Triage agent for Brighter Tomorrow Therapy. Your ONLY job is to "
        "route the visitor to the right specialist by calling a handoff tool. "
        "You do NOT answer questions yourself.\n\n"
        "Routing rules — act on what the visitor ALREADY said; do not re-ask.\n"
        "- Any crisis keyword or safety concern → Crisis Support\n"
        "- ANY mention of insurance, coverage, benefits, eligibility, in-network, "
        "  copay, member ID, or 'do you take <plan name>' → Booking Agent. "
        "  Insurance questions are ALWAYS booking intent — the Booking Agent "
        "  collects info conversationally and verifies coverage in chat.\n"
        "- 'book', 'schedule', 'appointment', 'make an appointment', 'get started', "
        "  or any mention of starting therapy / counseling for a clinical reason "
        "  (anxiety, depression, couples, etc.) → Booking Agent\n"
        "- 'callback', 'contact me', 'reach out' without scheduling intent → Intake Agent\n"
        "- 'therapist', 'match me', 'who treats', 'clinician', 'counselor' → Therapist Matching\n"
        "- Practice questions, services, hours, locations, FAQs, philosophy → Info Agent\n\n"
        "Rules of engagement:\n"
        "- When the visitor's intent matches one of the routes above, IMMEDIATELY call "
        "  the corresponding handoff tool. Do NOT produce a text reply yourself. The "
        "  specialist agent will respond.\n"
        "- NEVER paste internal URL paths or slash-style commands into replies. The "
        "  practice does not have any such commands; the specialists handle the flow "
        "  inside the chat. If you must reference a page, use natural language "
        "  ('our scheduling page') or a full https:// link.\n"
        "- Honor the visitor's last turn: if they answered a question you already asked, "
        "  do NOT rephrase the same question back at them. Route based on what they said.\n"
        "- If the message is a bare greeting ('hi', 'hello') with no intent, respond with "
        "  ONE short open question listing the main options (book an appointment / "
        "  get matched with a therapist / practice questions). After that, trust the "
        "  next answer and route.\n"
        "- Never ask a compound 'and ... and are you open to ...' gatekeeping question. "
        "  Route first; the specialist agent handles its own follow-ups."
    )

    return Agent(
        name="Triage",
        instructions=instructions,
        handoffs=[
            handoff(
                crisis,
                tool_description_override="Transfer to Crisis Support for any safety concern, "
                "self-harm mention, or crisis.",
            ),
            handoff(
                info,
                tool_description_override="Transfer for practice info, services, hours, FAQs, "
                "and philosophy questions.",
            ),
            handoff(
                matching,
                tool_description_override="Transfer to match the visitor with a therapist by "
                "specialty or location.",
            ),
            handoff(
                booking,
                tool_description_override="Transfer to book an appointment or check insurance "
                "coverage. Collects contact info + insurance and verifies eligibility in chat.",
            ),
            handoff(
                intake,
                tool_description_override="Transfer to collect contact info and submit a "
                "callback request (no scheduling intent).",
            ),
        ],
        input_guardrails=[crisis_guardrail],
        model=os.environ.get("OPENAI_MODEL"),
    )

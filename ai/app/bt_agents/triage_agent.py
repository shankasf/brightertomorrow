"""Triage Agent — entry point that routes to the appropriate specialist agent."""
from __future__ import annotations

import os

from agents import Agent, handoff
from agents.extensions.handoff_prompt import prompt_with_handoff_instructions

from ..prompts import CRISIS_RULE, PRACTICE_CONTEXT, STYLE_TEXT
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

    instructions = prompt_with_handoff_instructions(
        f"{PRACTICE_CONTEXT}\n\n"
        f"{STYLE_TEXT}\n\n"
        f"{CRISIS_RULE}\n\n"
        "You are the Triage agent for Brighter Tomorrow Therapy. Your only job is to "
        "understand what the visitor needs and route them to the right specialist.\n\n"
        "Routing rules:\n"
        "- Any crisis keyword or safety concern → Crisis Support\n"
        "- 'book', 'appointment', 'callback', 'contact me', 'reach out', 'schedule' → Intake Agent\n"
        "- 'therapist', 'match me', 'who treats', 'clinician', 'counselor' → Therapist Matching\n"
        "- Practice questions, services, hours, locations, FAQs, philosophy → Info Agent\n\n"
        "When the user's intent is unclear, ask one short clarifying question. "
        "Do not answer questions yourself — route to the appropriate agent."
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
                intake,
                tool_description_override="Transfer to collect contact info and submit a "
                "callback request.",
            ),
        ],
        input_guardrails=[crisis_guardrail],
        model=os.environ.get("OPENAI_MODEL"),
    )

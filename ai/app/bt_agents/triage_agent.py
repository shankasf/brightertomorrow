"""Triage Agent — text. Single entry point that routes the visitor to the
right specialist by calling exactly one handoff.

InsuranceCheck and BookingAgent are now independent. Each owns its own
scope and reads prior tool output (e.g. `verify_coverage`) directly from
the SDK's conversation memory.

  • Booking intent ('I want to book / schedule')      →  BookingAgent
    BookingAgent inspects the transcript: if a prior `verify_coverage`
    result is present, reuse it; otherwise collect the 5 insurance
    fields itself and run `verify_coverage` before continuing.
  • Coverage-only intent ('do you take Aetna?')       →  InsuranceCheck
    Verifies eligibility and ends, or hands off to BookingAgent if the
    visitor later decides to schedule.
"""
from __future__ import annotations

import os

from agents import Agent, handoff
from agents.extensions.handoff_prompt import prompt_with_handoff_instructions

from ..prompts import CRISIS_RULE, PRACTICE_CONTEXT, STYLE_TEXT
from .booking_agent import build_booking_agent
from .crisis_agent import build_crisis_agent
from .guardrails import crisis_guardrail
from .info_agent import build_info_agent
from .insurance_agent import build_insurance_agent
from .intake_agent import build_intake_agent
from .matching_agent import build_matching_agent


def build_triage_agent() -> Agent:
    crisis = build_crisis_agent()
    info = build_info_agent()
    matching = build_matching_agent()
    intake = build_intake_agent()

    # BookingAgent and InsuranceCheck are independent. BookingAgent reads
    # any prior `verify_coverage` result from conversation memory; if none
    # is present it runs the verification itself before continuing.
    # InsuranceCheck still holds a handoff to BookingAgent so a
    # coverage-only visitor who later says 'yes book me' can be advanced.
    booking = build_booking_agent()
    insurance = build_insurance_agent(booking_handoff=booking)

    instructions = prompt_with_handoff_instructions(
        f"{PRACTICE_CONTEXT}\n\n"
        f"{STYLE_TEXT}\n\n"
        f"{CRISIS_RULE}\n\n"

        "You are the Triage agent for Brighter Tomorrow Therapy. Your "
        "ONLY job is to route the visitor to the right specialist by "
        "calling exactly one handoff tool. You never answer the "
        "visitor's question yourself, never collect their info, and "
        "never run any tool besides a handoff.\n\n"

        "# How booking and insurance verification work\n"
        "BookingAgent and InsuranceCheck are INDEPENDENT — each owns its "
        "own scope and reads prior tool output (e.g. `verify_coverage`) "
        "directly from conversation memory:\n"
        "  • **BookingAgent** handles full appointment booking. It will "
        "    inspect the transcript on entry: if `verify_coverage` has "
        "    already run, it reuses that result; otherwise it collects "
        "    the 5 insurance fields and runs `verify_coverage` itself "
        "    before continuing. It can also handle self-pay.\n"
        "  • **InsuranceCheck** handles coverage-only questions and "
        "    ends after sharing the result (or hands off to "
        "    BookingAgent if the visitor decides to schedule).\n\n"

        "# Stickiness — read the transcript before routing\n"
        "If the most recent assistant turns in the transcript came from "
        "BookingAgent (e.g. it just asked for reason / phone / email / "
        "address / sex, or showed slot options, or asked for "
        "confirmation), the visitor is mid-booking — route their next "
        "message to **BookingAgent** unless it is a clear Crisis "
        "Support trigger. Do not bounce them back to InsuranceCheck "
        "just because they mentioned insurance again. The specialist "
        "in progress owns its own flow.\n\n"

        "# Routing rules\n"
        "Act on what the visitor ALREADY said in this turn — do not "
        "re-ask, do not gatekeep with 'and are you sure' questions. "
        "Pick exactly one route:\n\n"

        "1. **Crisis Support** — any mention of suicide, self-harm, "
        "   wanting to die, hurting themselves or others, abuse, or "
        "   any immediate safety concern. This takes priority over "
        "   every other route. Note: a visitor sharing emotional "
        "   context as their reason for visit ('I just went through "
        "   a breakup and have anxiety', 'I'm grieving', 'I'm "
        "   anxious / depressed / lonely') is NOT a safety crisis "
        "   on its own — only route to Crisis when there is an "
        "   explicit safety signal (suicide, self-harm, danger).\n\n"

        "2. **BookingAgent** — visitor wants to schedule: 'I want "
        "   to book', 'schedule', 'make an appointment', 'start "
        "   therapy', 'I'd like to start counseling for <reason>'. "
        "   Also route here for any follow-up turn while a booking "
        "   is in progress (see Stickiness above).\n\n"

        "3. **InsuranceCheck** — coverage-only questions, no "
        "   booking intent yet: 'do you take Aetna?', 'is <plan> "
        "   in network?', 'check my coverage', 'verify my "
        "   insurance', 'what's my copay', 'do you accept "
        "   <insurance>?'.\n\n"

        "4. **Therapist Matching** — 'find a therapist', 'match "
        "   me', 'who treats <issue>', 'I need a counselor', 'who "
        "   specializes in <X>'. Use when the visitor wants help "
        "   choosing a clinician but hasn't mentioned booking or "
        "   insurance yet.\n\n"

        "5. **Intake Agent** — 'have someone call me back', "
        "   'reach out to me', 'contact me' — clearly wants to be "
        "   contacted but does NOT want to schedule or check "
        "   insurance right now. Rare; most callback intent is "
        "   actually booking intent.\n\n"

        "6. **Info Agent** — questions about the practice, "
        "   services, hours, locations, FAQs, philosophy, "
        "   pricing-without-scheduling, anything informational that "
        "   doesn't include booking or insurance verification "
        "   intent.\n\n"

        "# Conduct\n"
        "- When intent matches a route, IMMEDIATELY call the "
        "  corresponding handoff tool. Do NOT produce any visitor-"
        "  facing text first — the specialist agent owns the next "
        "  reply.\n"
        "- NEVER write slash-style commands, internal URL paths, or "
        "  invented page names ('/check-coverage', '/book', "
        "  '/insurance', etc.). The chat itself is the interface. "
        "  If you must reference a page, use natural language ('our "
        "  scheduling page') or a full https:// URL.\n"
        "- Honor the visitor's last turn: if they answered a "
        "  question already asked, route based on the answer — "
        "  don't rephrase the question back at them.\n"
        "- Bare greetings only ('hi', 'hello', no other context): "
        "  reply with ONE short open question listing the main "
        "  options ('Would you like to book an appointment, check "
        "  your insurance, get matched with a therapist, or learn "
        "  more about the practice?'). After that, trust the "
        "  next answer and route.\n"
        "- Never compound-gate ('and ... and are you sure ...'). "
        "  Route once; the specialist handles its own follow-ups."
    )

    return Agent(
        name="Triage",
        instructions=instructions,
        handoffs=[
            handoff(
                crisis,
                tool_description_override=(
                    "Transfer to Crisis Support for any safety "
                    "concern, self-harm mention, or crisis."
                ),
            ),
            handoff(
                info,
                tool_description_override=(
                    "Transfer for practice info, services, hours, "
                    "FAQs, philosophy questions, and pricing "
                    "questions without scheduling intent."
                ),
            ),
            handoff(
                matching,
                tool_description_override=(
                    "Transfer to match the visitor with a therapist "
                    "by specialty or location."
                ),
            ),
            handoff(
                insurance,
                tool_description_override=(
                    "Transfer to InsuranceCheck for COVERAGE-ONLY "
                    "questions — 'do you take X?', 'is <plan> in "
                    "network?', 'what's my copay?'. Do NOT use this "
                    "when the visitor wants to book an appointment "
                    "— route to BookingAgent instead; it runs the "
                    "verification itself when needed."
                ),
            ),
            handoff(
                booking,
                tool_description_override=(
                    "Transfer to BookingAgent to schedule an "
                    "appointment. Use for any booking intent ('I "
                    "want to book', 'schedule', 'start therapy'). "
                    "BookingAgent will reuse a prior verify_coverage "
                    "result if one is already in the transcript, or "
                    "run the verification itself before collecting "
                    "the remaining contact fields."
                ),
            ),
            handoff(
                intake,
                tool_description_override=(
                    "Transfer to collect contact info and submit a "
                    "callback request — visitor wants to be "
                    "contacted but does not mention booking or "
                    "insurance."
                ),
            ),
        ],
        input_guardrails=[crisis_guardrail],
        model=os.environ.get("OPENAI_MODEL"),
    )

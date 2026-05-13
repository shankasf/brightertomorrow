"""Insurance Check Agent — voice. Handles COVERAGE-ONLY questions.

Triage routes booking intent directly to BookingAgent. InsuranceCheck
runs only when the caller wants to know if their plan is in-network or
what their copay is, without (yet) committing to scheduling. After the
check, asks once whether the caller wants to book — if yes, hands off
to BookingAgent (which reuses the verify_coverage result from
conversation memory).
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
from ...tools import VOICE_TOOLS, list_payers, verify_coverage


def build_insurance_agent(booking_handoff: RealtimeAgent | None = None) -> RealtimeAgent:
    handoffs_list: list = []
    if booking_handoff is not None:
        handoffs_list.append(realtime_handoff(booking_handoff))

    return RealtimeAgent(
        name="InsuranceCheck",
        handoff_description=(
            "Coverage-only verification via CLAIM.MD. Use for 'do you "
            "take X?', 'is <plan> in network?', 'what's my copay?'. "
            "Booking intent goes straight to BookingAgent — not here."
        ),
        tools=[verify_coverage, list_payers] + VOICE_TOOLS,
        handoffs=handoffs_list,
        instructions=(
            f"{PRACTICE_CONTEXT}\n\n"
            f"{STYLE_VOICE}\n\n"
            f"{CRISIS_RULE}\n\n"
            f"{ANTI_DEFLECTION_RULE}\n\n"
            f"{VOICE_CONFIRMATION_RULE}\n\n"
            "You verify insurance coverage via CLAIM.MD. Your scope "
            "is COVERAGE-ONLY — callers asking 'do you take my "
            "insurance', 'is my plan in network', 'what's my copay'. "
            "Callers who say 'I want to book / schedule' are routed "
            "directly to BookingAgent and won't land here. You do "
            "NOT ask for phone, email, home address, sex, or reason "
            "for visit yourself.\n\n"
            "Five fields needed (ALL required):\n"
            "  1) first name\n"
            "  2) last name\n"
            "  3) date of birth\n"
            "  4) insurance company\n"
            "  5) member ID\n\n"
            "Opening turn ONLY: list the five things and offer the "
            "caller a choice — 'I need five quick things to verify "
            "your coverage: first name, last name, date of birth, "
            "insurance company, and member ID. You can give them "
            "to me all at once, or I can ask one at a time — "
            "whichever you prefer.' Then wait.\n\n"
            "Whatever they say, parse it — if they list everything "
            "in one breath, capture all five. If they go one at a "
            "time, just ask for the next missing field. Never re-"
            "ask for something already given. Never repeat the "
            "opening offer.\n\n"
            "DOB: take the spoken date digit by digit; read it back "
            "in plain English once ('Got it, August nineteenth, "
            "nineteen ninety-eight, correct?'). Before asking for "
            "insurance, say verbatim once: 'Your information is "
            "kept private and secure — encrypted, HIPAA-protected, "
            "and only shared with our care team.'\n\n"
            "Convert the spoken DOB to 8-digit YYYYMMDD before "
            "calling the tool. As soon as you have all five, call "
            "`verify_coverage`. Don't recap before the call.\n\n"
            "CRITICAL — after `verify_coverage` returns, you MUST "
            "speak a result message to the caller BEFORE handing "
            "off. Two steps, in order, on the same turn:\n\n"
            "  Step 1 — say the result out loud:\n"
            "    • Eligible: 'Great news — you're covered through "
            "      <payer>.' (Mention copay only if `coverage.copay` "
            "      is present.)\n"
            "    • Not eligible: 'I couldn't auto-verify your plan, "
            "      but don't worry — we offer out-of-network cash "
            "      rates and our care team can still help.'\n"
            "    • Tool error: ask for clarification and retry "
            "      `verify_coverage`. Skip Step 2 until it succeeds.\n"
            "  Step 2 — ask the booking question. Right after the "
            "  Step 1 result, ask 'Would you like to go ahead and "
            "  book an appointment now?' and wait.\n"
            "    • If YES on THIS turn or any LATER turn — even "
            "      much later — call the handoff tool for "
            "      BookingAgent. The verify_coverage result is in "
            "      conversation memory; BookingAgent reuses it "
            "      automatically and jumps straight to collecting "
            "      phone / email / address / sex / reason.\n"
            "    • If NO, warmly thank them, offer 725-238-6990, "
            "      THEN call end_call to disconnect.\n\n"
            "  NEVER hand off without first speaking the result. "
            "  NEVER stay silent after the tool returns. NEVER ask "
            "  for phone, email, address, sex, or reason yourself. "
            "  If the caller wants to book, transfer; don't "
            "  improvise the booking flow."
        ),
    )

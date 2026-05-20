"""System prompt + Pydantic schema for the ``extract`` node.

The extract node has ONE job: read the latest user turn (plus a tiny
amount of context — what the assistant just asked, what intent we
already think they have) and return a structured JSON blob describing
what changed.

Why structured output:
  * It cannot hallucinate a missing field.
  * It cannot accidentally produce patient-facing text (the respond
    node owns that).
  * It is trivially unit-testable against fixed inputs.

The schema is intentionally tiny — every field below maps directly to
a state mutation the planner relies on. Adding fields here without
also updating the planner is a bug.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Output schema
# ---------------------------------------------------------------------------

class FieldDeltas(BaseModel):
    """Any patient-provided values found in the latest turn.

    Names match the legacy `tools.py` argument names so we don't have a
    second naming convention to maintain. Optional everywhere — the
    extractor only fills what was explicitly stated.
    """

    # Insurance / identity
    first_name: str | None = None
    last_name: str | None = None
    dob_yyyymmdd: str | None = Field(
        default=None,
        description=(
            "Caller's date of birth normalised to 8-digit YYYYMMDD. "
            "Parse natural dates ('August 19, 1998', '8/19/98') yourself; "
            "2-digit years 00-29 -> 2000-2029, 30-99 -> 1930-1999. "
            "Return null if the date is unparseable."
        ),
    )
    payer_name: str | None = Field(
        default=None,
        description="Canonical insurance company name (Aetna, UHC, BCBS, Anthem, Cigna, Kaiser, Medicare, Medicaid, Tricare, etc.).",
    )
    member_id: str | None = None

    # Booking-only
    reason: str | None = None
    phone: str | None = None
    email: str | None = None
    home_address: str | None = None
    sex: str | None = None

    # Callback-only (only first 4 share with insurance)
    callback_phone: str | None = Field(
        default=None,
        description="Phone for a callback request (use this if the caller asked for a callback rather than a booking).",
    )
    callback_reason: str | None = None

    # Scheduling
    staff_name: str | None = Field(
        default=None,
        description="Therapist the caller asked for, by name. Only set when they EXPLICITLY name a therapist for booking — not when they say their OWN name on their insurance card.",
    )
    no_therapist_preference: bool = Field(
        default=False,
        description=(
            "True when, in response to a question asking which therapist they "
            "want, the caller signals they have no preference and is happy "
            "with whoever the practice picks. Covers phrasings like "
            "\"anyone\", \"no preference\", \"doesn't matter\", \"whoever's "
            "available\", \"you pick\", \"surprise me\", \"earliest available\", "
            "\"I don't care\". Do NOT set this when the caller says a name, "
            "asks about a specific therapist, asks for an intro, or excludes "
            "a therapist (\"anyone except Sagar\")."
        ),
    )
    selected_slot_index: int | None = Field(
        default=None,
        description="If the caller picked one of the slots we just offered, the 0-based index (0, 1, 2).",
    )
    time_of_day: Literal["morning", "afternoon", "evening", "any"] | None = None
    earliest_day_offset: int | None = Field(
        default=None,
        description=(
            "Days from today the caller wants their earliest appointment "
            "(0=today, 1=tomorrow). Default null if unspecified."
        ),
    )

    # Info path
    info_query: str | None = Field(
        default=None,
        description=(
            "Free-form question the caller asked about the practice "
            "(hours, location, services, philosophy, FAQs, etc.) — "
            "verbatim or paraphrased."
        ),
    )


class TurnExtraction(BaseModel):
    """Structured output for one user turn.

    Designed to be small and easy for the model to fill correctly. The
    planner reads these fields directly.
    """

    intent_delta: Literal[
        "none",            # no change to known intent
        "greeting",        # bare hi/hello
        "info",            # asking about the practice
        "insurance_check", # wants to know if a plan is accepted / verify coverage
        "booking",         # wants to book an appointment
        "callback",        # wants someone to call them back (not book)
        "cancel",          # wants to cancel an existing/in-progress booking
        "keep",            # explicitly NOT cancelling (rollback intent)
        "self_pay",        # declared self-pay / no insurance
        "out_of_scope",    # off-topic (travel, recipes, code, etc.)
    ] = Field(
        default="none",
        description="High-level intent change carried by THIS turn. Use 'none' if the user said something that doesn't shift their goal (answering a field, saying 'thanks', etc.).",
    )

    affirmation: Literal["yes", "no", "unclear", "none"] = Field(
        default="none",
        description="Only set when the assistant just asked a yes/no question and the user answered it. 'unclear' if their answer is ambiguous.",
    )

    safety_signal: bool = Field(
        default=False,
        description="True if the user expressed crisis, self-harm, abuse, or any immediate-danger signal that wasn't caught by the keyword pre-filter.",
    )

    field_deltas: FieldDeltas = Field(default_factory=FieldDeltas)

    confidence: Literal["high", "low"] = Field(
        default="high",
        description="Self-rated confidence in the extraction. Use 'low' for garbled audio, ambiguous one-word answers, or when you guessed at a value.",
    )


# ---------------------------------------------------------------------------
# System prompt — short and surgical
# ---------------------------------------------------------------------------

EXTRACT_SYSTEM_PROMPT = """\
You are the "extract" step of a therapy-practice intake assistant.

Your ONLY job is to read the last patient message and the small context
block below, then return the TurnExtraction JSON schema. You DO NOT talk
to the patient. You DO NOT decide what happens next. Another component
(the planner) reads your output and picks the next action.

Rules:

1. `intent_delta` describes a CHANGE in intent, not the user's overall
   intent. If they're answering a field you already asked for, return
   "none". Only set a value when this turn actually shifts what they
   want (e.g., "actually I just want a callback" -> "callback";
   "actually cancel that" -> "cancel"; "no wait keep it" -> "keep").

2. `affirmation` is ONLY set when the previous assistant turn asked
   a yes/no question. "Yes", "yeah", "yep", "correct", "right", "mhm",
   "sounds right" -> "yes". "No", "nope", "wait" -> "no". Ambiguous ->
   "unclear". Otherwise "none".

3. `field_deltas` — only fill fields the user EXPLICITLY stated in this
   turn. Multi-field pastes are common ("Sarah Patel, 8/19/98, BCBS,
   ABC123") — extract all of them. Never invent or guess.

4. DOB normalisation: convert any date the caller gives to 8-digit
   YYYYMMDD. "August 19, 1998" -> "19980819". "8/19/98" -> "19980819"
   (US month/day convention; 2-digit years 00-29 -> 2000s, 30-99 ->
   1900s). If you cannot parse it confidently, return null and let the
   planner re-ask.

5. Insurance fields: do NOT confuse the caller's OWN name (on their
   insurance card) with a therapist they want to book with. If they're
   answering "what's your name?" during insurance collection, that's
   `first_name`/`last_name`, NOT `staff_name`.

6. Self-pay: ANY indication the caller is uninsured or paying themselves
   -> intent_delta="self_pay". Examples: "no insurance", "I don't have
   insurance", "I'm uninsured", "self-pay", "out of pocket", "I'll pay
   myself", "pay cash", "I don't have coverage". Set this on a single
   turn even if they didn't previously say they wanted to book.

7. Human / callback handoff: if the caller asks for a human in any
   phrasing — "talk to a real person", "speak to someone", "a human",
   "live agent", "real person", "real human", "call me back", "have
   someone reach out" — set intent_delta="callback". Do NOT keep
   routing through the booking field-collection flow when they've
   explicitly asked for a human.

8. Info questions: classify factual questions about the practice
   (hours, location, services offered, modalities like EMDR/CBT/IFS,
   parking, what to expect, age ranges, languages, sliding scale,
   etc.) as intent_delta="info" AND fill `info_query` with the
   question. Example: "what are your hours?" -> intent="info",
   info_query="hours of operation".

9. `safety_signal`: set TRUE for any uncaught crisis indicator, INCLUDING
   hedged or future-tense phrasings like "thinking about hurting
   myself", "I sometimes wonder if I should end it", "what if I just
   disappeared", "I don't want to be here anymore". Self-harm, suicide,
   abuse, or immediate-danger signals — set true even if the language
   is tentative. Pure emotional context ("I'm sad", "I'm anxious",
   "going through a breakup") is NOT a safety signal on its own.

10. `confidence`: "low" if the user's message is garbled / one-word /
    ambiguous and you had to guess at field values. The planner uses
    "low" to ask a clarifying question instead of acting.

Return ONLY the JSON. No prose, no explanation.
"""

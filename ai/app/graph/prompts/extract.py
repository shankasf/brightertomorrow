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

The schema is intentionally small — every field below maps directly to
a state mutation the planner relies on. Adding fields here without
also updating the planner is a bug.

All new NL signals must be added as fields here, NOT as keyword lists
in downstream nodes (feedback_extract_node_is_only_nl_boundary).
"""
from __future__ import annotations

from typing import Literal, Optional

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
        description=(
            "0-based index into the `proposed_slots` list shown in the "
            "context block, when the caller picks one. Map the caller's "
            "phrasing to an index: ordinals (\"the first\"/\"second\"/"
            "\"third\", \"#2\", \"option 3\") map to 0/1/2; a time or "
            "day that matches exactly one offered slot maps to that "
            "slot's index (e.g. caller says \"10:30 Wednesday\" and "
            "only slot [1] is Wed 10:30 — emit 1). Also accept \"the "
            "last one\" / \"the earliest\" / \"the latest\" when "
            "unambiguous. Leave null if the proposed_slots list is "
            "empty, the caller's pick is ambiguous, or they're asking "
            "for different times."
        ),
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

    # -----------------------------------------------------------------------
    # Gate / session-presence signals
    # These fields are the ONLY place NL signals for gates live.
    # Downstream nodes and the planner NEVER parse raw user text.
    # -----------------------------------------------------------------------

    recording_consent: Optional[bool] = Field(
        default=None,
        description=(
            "Set to true ONLY when the caller explicitly acknowledges the "
            "HIPAA notice or recording disclosure in THIS turn. Covers: "
            "'yes', 'I understand', 'that's fine', 'ok', 'I agree', "
            "'sure', 'sounds good', 'go ahead'. Set to false if they "
            "object ('no', 'I don't consent', 'I don't agree'). "
            "Leave null if the caller said nothing about consent this turn."
        ),
    )

    physical_presence_state: Optional[str] = Field(
        default=None,
        description=(
            "2-letter US state code inferred from the caller's location "
            "statements. Examples: 'I'm in Reno' -> 'NV'; 'Las Vegas' -> "
            "'NV'; 'I'm calling from California' -> 'CA'; 'I live in "
            "Seattle' -> 'WA'. Use 'non_us' if they are clearly outside "
            "the US. Leave null if no location was mentioned or if you "
            "cannot confidently infer the state — never guess."
        ),
    )

    caller_relationship: Optional[Literal[
        "self",
        "parent_of_minor",
        "guardian_with_roi",
        "third_party_for_adult",
        "unknown",
    ]] = Field(
        default=None,
        description=(
            "Who the caller is relative to the patient. "
            "'self' — calling for themselves. "
            "'parent_of_minor' — parent/guardian of a child under 18. "
            "'guardian_with_roi' — legal guardian or has a signed ROI "
            "for an adult patient. "
            "'third_party_for_adult' — calling on behalf of an adult "
            "without verified ROI (e.g. 'I'm calling for my friend'). "
            "'unknown' — they gave a confusing answer. "
            "Leave null if caller relationship was not mentioned this turn."
        ),
    )

    resume_decision: Optional[Literal["continue", "fresh"]] = Field(
        default=None,
        description=(
            "Set when, after being told about a prior intake session, the "
            "caller explicitly chooses to continue it or start fresh. "
            "'continue' — 'yes continue', 'pick up where we left off', "
            "'same session'. "
            "'fresh' — 'start over', 'new session', 'fresh start', 'no'. "
            "Leave null if no such decision was stated this turn."
        ),
    )

    language_switch_to: Optional[str] = Field(
        default=None,
        description=(
            "BCP-47 language tag if the caller requests a language change "
            "or starts speaking a different language. Examples: 'es-US' "
            "for Spanish, 'fr-US' for French, 'zh-US' for Chinese. "
            "Leave null if no language switch occurred."
        ),
    )

    modality_preference: Optional[Literal["in_person", "telehealth"]] = Field(
        default=None,
        description=(
            "Set when the caller states a preference for how they want to "
            "be seen. 'in_person' — 'in person', 'come to the office', "
            "'face to face'. 'telehealth' — 'video', 'online', 'virtual', "
            "'zoom', 'telehealth', 'remote'. Leave null if not stated."
        ),
    )

    asks_for_therapist_roster: bool = Field(
        default=False,
        description=(
            "True when the caller asks WHO the therapists/clinicians/"
            "providers are, asks to see the team, or asks which therapists "
            "we have in general (a roster question) — e.g. 'which "
            "therapists do you have?', 'who are your therapists?', 'can I "
            "see the team?', 'who could I see?', 'which therapists are "
            "available?', 'who's available?'. A BARE 'available' with no "
            "booking/scheduling cue is a roster ask (list of names), NOT a "
            "calendar lookup. ALSO set intent_delta='info'. This is "
            "distinct from PICKING a therapist during booking (use "
            "staff_name), from asking about ONE named therapist's "
            "background (use info_query), and from asking whether someone "
            "is free to BOOK (use asks_booking_availability). Leave False "
            "otherwise."
        ),
    )

    asks_booking_availability: bool = Field(
        default=False,
        description=(
            "True when the caller wants to know whether a therapist (any "
            "or a named one) has OPEN APPOINTMENT TIMES they could book — "
            "i.e. a real calendar/scheduling question, not just the roster. "
            "Cues: the words book/booking/appointment/opening(s)/slot/"
            "schedule/soonest/earliest/this week/next week, or a named "
            "therapist + availability — e.g. 'is anyone available to "
            "book?', 'do you have any openings?', 'when's the soonest I "
            "can come in?', 'can I book with someone this week?', 'is "
            "Christie available to book?', 'what times does Janelle have?'. "
            "ALSO set intent_delta='booking' (they intend to book). If they "
            "named a specific therapist, ALSO fill staff_name. Leave False "
            "for a bare roster question ('who are your therapists?' -> use "
            "asks_for_therapist_roster instead)."
        ),
    )

    wants_therapist_match: bool = Field(
        default=False,
        description=(
            "True when the caller wants help figuring out WHICH therapist is "
            "right for them — asks to be matched, asks who is 'best' for a "
            "need/condition, or says they don't know who to pick — e.g. "
            "'can you match me with someone?', 'who's the best therapist for "
            "anxiety / for my teen / for trauma?', 'I don't know who to "
            "choose', 'help me find the right fit', 'who do you recommend?'. "
            "This is the MATCHING intent (the assistant hands off to a "
            "matching form, it never picks for them). Distinct from: a bare "
            "roster list ('who are your therapists?' -> asks_for_therapist_"
            "roster), open-slot lookups ('any openings to book?' -> asks_"
            "booking_availability), and naming a specific therapist to book "
            "(use staff_name). Leave False otherwise."
        ),
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

2. `affirmation` — set when the previous assistant turn asked a yes/no
   or a confirmation question ("sound right?", "is that correct?",
   "did you mean...?"). Be GENEROUS with typos / short forms / emoji;
   do NOT mark these as "unclear":
     YES — yes, yeah, yea, yep, yup, ye, ya, ys, yh, yp, y, yass,
       yess, yesss, mhm, mhmm, mm, mmm, uh-huh, uhhuh,
       ok, okay, k, kk, okie, kay,
       sure, surely, correct, right, that's right, that is right,
       affirmative, roger, ofc, def, definitely, absolutely, totally,
       100%, "100", "1", "+1", aye, indeed, confirmed, true,
       alright, fine, sounds good, sounds right, go ahead, do it,
       please do, pls, plz, thumbs up, 👍, ✅, ✔.
     NO — no, nope, nah, naw, nay, negative, wrong, incorrect,
       n, "0", "-1", nuh-uh, nuhuh, neg, negatory, nada, false,
       thumbs down, 👎, ❌.
   Repeated letters are still the same word: "yyy", "yesss", "nooo",
   "nahhh", "mhmmm" all classify normally.
   "unclear" is reserved for replies that genuinely could be either
   ("i think so", "maybe", "kinda", "not sure", "i guess"). A
   two-letter slip like "ys" or "nh" is NOT ambiguous — classify it.

3. `field_deltas` — only fill fields the user EXPLICITLY stated in this
   turn. Multi-field pastes are common ("Sarah Patel, 8/19/98, BCBS,
   ABC123") — extract all of them. Never invent or guess.

4. DOB normalisation: convert any date the caller gives to 8-digit
   YYYYMMDD. Walk these formats in order and pick the FIRST that
   yields a valid calendar date (year 1900-current, month 01-12,
   day 01-31):
     a) Verbal — "August 19, 1998", "Aug 19 1998", "19 August 1998",
        "19th of August, 1998", "19 Aug 98".
     b) ISO    — "1998-08-19", "1998/08/19", "19980819".
     c) US     — "M/D/YYYY", "MM/DD/YYYY", "M-D-YY" ("8/19/98",
        "08/19/1998").
     d) Intl   — "D/M/YYYY", "DD/MM/YYYY", "D.M.YYYY"
        ("19/08/1998", "19.8.98").
   Rules:
     • 2-digit years: 00-29 -> 2000s, 30-99 -> 1900s.
     • If the FIRST number of a slash/dash/dot date is >12, it
       MUST be a day — skip US ordering and use D/M directly.
       "19/08/1998" -> month=19 invalid -> day=19, month=08
       -> 19980819. NEVER return null for this case.
     • For genuinely ambiguous slash dates where both interpretations
       are valid calendar dates ("03/04/1998"), use US ordering
       (MM/DD); the planner echoes the date back in plain English
       for the caller to confirm.
     • Strip ordinal suffixes ("st", "nd", "rd", "th") and stray
       words ("of", "on") before parsing.
   Only return null if NO ordering yields a valid calendar date.

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
   session rates / cost / fees, which insurance carriers are
   accepted, the process for becoming a new client, etc.) as
   intent_delta="info" AND fill `info_query` with the question.
   Examples:
     - "what are your hours?"                -> intent="info", info_query="hours of operation"
     - "how much is a session?"              -> intent="info", info_query="session rates and fees"
     - "what insurance do you accept?"       -> intent="info", info_query="accepted insurance carriers"
     - "do you take Aetna?"                  -> intent="info", info_query="insurance Aetna accepted"
     - "how do I book as a new client?"      -> intent="info", info_query="how to book a new appointment"
     - "what's the booking process?"         -> intent="info", info_query="how to book a new appointment"
   IMPORTANT: meta-questions about *how* to book ("how do I book?",
   "what's the process?", "how does this work?") are INFO, NOT
   booking. Only set intent="booking" when the caller has decided
   to book and is giving you booking inputs ("I'd like to book",
   "schedule me", "let's set it up", "I want an appointment").

8a. `asks_for_therapist_roster`: set TRUE when the caller asks WHO the
    therapists are or which providers we have in general ("which
    therapists do you have?", "who are your therapists?", "can I see the
    team?", "who could I see?", "which therapists are available?",
    "who's available?"). A BARE "available" with no booking/scheduling
    cue is a roster ask (we just list the names). ALSO set
    intent_delta="info". Do NOT set it when they NAME a specific therapist
    to book with (use staff_name), ask about one therapist's background
    (use info_query), or ask whether someone is free to BOOK (use 8b).

8b. `asks_booking_availability`: set TRUE when the caller asks whether a
    therapist — anyone, or a named one — has OPEN APPOINTMENT TIMES they
    could book (a real calendar question). Cues: book / booking /
    appointment / opening(s) / slot / schedule / soonest / earliest /
    "this week" / "next week", or a named therapist + availability —
    e.g. "is anyone available to book?", "do you have any openings?",
    "when's the soonest I can come in?", "can I book with someone this
    week?", "is Christie available to book?", "what times does Janelle
    have?". ALSO set intent_delta="booking" (they intend to book). If a
    specific therapist is named, ALSO fill staff_name. The split vs 8a:
    "who are your therapists?" = roster (8a, names); "is anyone free to
    book?" = calendar (8b, real openings).

8c. `wants_therapist_match`: set TRUE when the caller wants help deciding
    WHICH therapist is right for them — asks to be matched, asks who is
    "best" for a need/condition, or says they don't know who to pick
    ("can you match me?", "who's the best therapist for anxiety / my
    teen / trauma?", "I don't know who to choose", "help me find the
    right fit", "who do you recommend?"). The assistant NEVER picks for
    them — it refers them to a matching form. Distinct from 8a (bare
    roster), 8b (open slots), and naming a therapist to book (staff_name).

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

11. `recording_consent`: set true ONLY when the caller explicitly
    acknowledges the HIPAA/recording notice in THIS turn ("yes",
    "I understand", "ok", "I agree", "sure", "that's fine"). Set false
    if they object. Leave null otherwise — never assume consent from
    silence or from answering an unrelated question.

12. `physical_presence_state`: infer a 2-letter US state code from ANY
    location mention this turn (city, metro area, landmark). "Reno",
    "Las Vegas", "Henderson" -> "NV". "LA", "San Francisco" -> "CA".
    Use "non_us" only when the caller clearly states they are outside
    the US. Leave null if no location was mentioned OR if you are not
    confident — never guess a state.

13. `caller_relationship`: only populate when the caller EXPLICITLY
    states who they are relative to the patient (calling for themselves,
    for their child, for a friend, etc.). Leave null if not stated.

14. `resume_decision`: only set when the caller explicitly chooses to
    continue a prior session or start fresh in DIRECT response to being
    offered that choice.

15. `modality_preference`: only set when the caller explicitly states
    a preference for in-person or telehealth care this turn.

16. `language_switch_to`: only set if the caller asks to switch language
    or begins speaking a different language in this turn.

CRITICAL — null discipline: when in doubt, return null. The planner
will ask again. Never guess at a field value to avoid a null.

Return ONLY the JSON. No prose, no explanation.
"""

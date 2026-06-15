"""Single source of truth: the typed conversation State.

Design notes
------------

Why one big TypedDict instead of many small ones:

  * Every node receives the entire state and returns a partial dict that
    LangGraph merges back in. Splitting state across multiple classes
    adds plumbing without adding safety — TypedDict is already structural.
  * Booking flow is sequential and stateful (we need to know what's
    collected, what's verified, what's confirmed). One dict makes the
    sequence trivially auditable.
  * The planner reads many fields at once to decide the next node; one
    dict avoids cross-table lookups inside the planner.

What belongs in state vs. derived per-turn:

  * In state: anything that must survive across turns (the entire
    conversation transcript, all collected fields, all tool results,
    flags that gate destructive actions).
  * Derived per-turn: any prompt text, any formatted slot list, any
    "is field X missing" predicate. The Thinking-in-LangGraph guidance
    is explicit: store raw, format on demand.

Coordination contract (read this before adding fields):

  * `extract`  — WRITES: intent_delta_applied? no — extract APPLIES the
                          delta to `intent`, plus writes `field_deltas`
                          into `fields`, plus writes `affirmation` and
                          `safety_signal`. Also writes gate flags, new
                          session-presence fields, and `turn_count`.
                 READS:  messages (last user turn), intent.
  * `planner`  — READS only; returns a next-node name. Never writes.
  * action nodes — WRITE: their tool result into the corresponding state
                    field (verify_result, proposed_slots, appointment_id,
                    callback_id). They also bump `last_action`.
  * `respond`  — WRITES: appended assistant turn into `messages`, plus
                          `last_reply_text` for runtime layers to read.
                 READS:  everything except `safety_signal` (already
                          handled by safety_screen / planner).
"""
from __future__ import annotations

from typing import Annotated, Literal, Optional, TypedDict

from langgraph.graph.message import add_messages


# ---------------------------------------------------------------------------
# Vocabularies — small enums kept inline for greppability
# ---------------------------------------------------------------------------

Channel = Literal["chat", "voice-browser", "voice-twilio"]
"""Where the patient came in from. Drives respond tone (text vs. speech)."""

Intent = Literal[
    "unknown",
    "greeting",
    "info",
    "insurance_check",
    "booking",
    "callback",
    "cancel",
    "keep",
    "crisis",
    "out_of_scope",
    "idle",
]
"""Sticky high-level patient intent. Set by `extract`, read by `planner`."""

PaymentPath = Literal["unknown", "insurance", "self_pay"]
"""Whether the booking will go through CLAIM.MD or skip verification."""

BookingStatus = Literal[
    "none",                     # no booking attempt yet
    "collecting",               # gathering fields
    "ready_for_slots",          # all fields in, no slot picked yet
    "slot_selected",            # slot picked, awaiting confirmation
    "pending_confirm",          # confirmation question asked, awaiting yes/no
    "booked",                   # book_appointment succeeded
    "cancel_pending_confirm",   # caller asked to cancel, awaiting confirmation
    "cancelled",                # cancel_appointment succeeded
]

CallbackStatus = Literal["none", "pending_confirm", "submitted"]

Affirmation = Literal["yes", "no", "unclear", "none"]


# ---------------------------------------------------------------------------
# Collected fields — kept as nested TypedDicts so the planner can check
# completeness without rummaging through the top-level state.
# ---------------------------------------------------------------------------

class InsuranceFields(TypedDict, total=False):
    """The 5 fields CLAIM.MD needs (verify_coverage), plus the routing outcome."""
    first_name: str | None
    last_name: str | None
    dob_yyyymmdd: str | None     # 8 digits, validated before storing
    payer_name: str | None       # canonical payer name from PAYERS list
    member_id: str | None
    # Set by verify_insurance action; drives post-verify planner branch.
    outcome: Optional[Literal[
        "eligible",
        "ineligible",
        "needs_manual_review",
        "secondary_required",
        "wc_auto_eap",
        "no_insurance",
        "self_pay",
        "medicaid_not_accepted",
    ]]


class BookingFields(TypedDict, total=False):
    """The 5 additional fields needed to call book_appointment."""
    reason: str | None
    phone: str | None
    email: str | None
    home_address: str | None
    sex: str | None


class CallbackFields(TypedDict, total=False):
    """The 4 fields needed for request_intake_callback."""
    first_name: str | None
    last_name: str | None
    phone: str | None
    reason: str | None


class Slot(TypedDict):
    """One free slot, shape mirrors `_fetch_free_slots` in tools.py."""
    startISO: str
    endISO: str
    displayPT: str


class VerifyResult(TypedDict, total=False):
    """Cached result from a single `verify_coverage` call."""
    ok: bool
    eligible: bool
    payer: str | None
    coverage: dict
    display_text: str | None
    error: str | None


# ---------------------------------------------------------------------------
# Gate flags — track 4-step pre-classification gates.
# All flags are monotonically True once set; never cleared by any node.
# ---------------------------------------------------------------------------

class Gates(TypedDict, total=False):
    """Progress flags for the 4 mandatory pre-classify gates.

    Once a flag becomes True it must stay True — the planner will loop
    forever if a gate can be re-raised after it has been cleared.
    """
    disclosure_done: bool      # welcome + HIPAA disclosure acknowledged by caller
    nv_presence_ok: bool       # caller confirmed physical presence in NV
    relationship_ok: bool      # caller relationship verified (self / parent / etc.)
    returning_verified: bool   # DOB matched a returning-patient record in DDB
    resume_decided: bool       # user picked continue-vs-fresh OR not a returning caller


# ---------------------------------------------------------------------------
# Returning-caller resume offer — carries prior-session context across turns
# ---------------------------------------------------------------------------

class ResumeOffer(TypedDict, total=False):
    prior_session_id: str | None
    summary: str | None        # one-sentence NON-PHI summary shown to caller
    decision: Literal["continue", "fresh"] | None


# ---------------------------------------------------------------------------
# The State — one TypedDict to rule them all
# ---------------------------------------------------------------------------

class State(TypedDict, total=False):
    """Everything the assistant remembers about this patient session.

    `total=False` so partial updates from nodes are type-safe. Defaults are
    set explicitly via `initial_state()` below.
    """

    # ----- Conversation transcript ---------------------------------------
    # Using LangGraph's `add_messages` reducer: each node returns a list of
    # NEW messages; the framework appends them. This matches the framework's
    # canonical pattern and lets us swap in any LangChain message type.
    messages: Annotated[list, add_messages]

    # ----- Channel + session identity ------------------------------------
    channel: Channel
    session_id: str
    caller_phone: str | None         # populated by Twilio runtime only
    agent_source: str                # "chat-agent" | "voice-agent" | "voice-phone"

    # ----- Per-turn ephemeral fields (overwritten by extract every turn) -
    # These describe ONLY what the last user turn carried; the planner
    # combines them with sticky state to decide next node.
    affirmation: Affirmation         # explicit yes/no on the last turn
    safety_signal: bool              # crisis keywords or extract said so
    last_user_text: str              # the raw user message extract saw

    # ----- Sticky high-level state ---------------------------------------
    intent: Intent                   # last known intent; sticky across turns
    payment_path: PaymentPath        # set when caller declares self-pay
    booking_status: BookingStatus
    callback_status: CallbackStatus

    # ----- Pre-classify gates -------------------------------------------
    # Monotonically True; the planner checks these before classify_intent.
    gates: Gates

    # ----- Session-presence / caller-context fields ----------------------
    # Written by extract from NL signals; read by gates + planner.
    caller_relationship: Optional[Literal[
        "self",
        "parent_of_minor",
        "guardian_with_roi",
        "third_party_for_adult",
        "unknown",
    ]]
    physical_presence_state: Optional[str]   # 2-letter US state, "non_us", or None
    modality: Optional[Literal["in_person", "telehealth"]]

    # ----- Returning-caller resume offer --------------------------------
    resume: ResumeOffer

    # ----- Turn counter (anti-loop) ------------------------------------
    # Incremented by extract every turn; planner hard-exits at > 60.
    turn_count: int

    # ----- Collected data ------------------------------------------------
    insurance_fields: InsuranceFields
    booking_fields: BookingFields
    callback_fields: CallbackFields
    staff_id: int | None             # therapist chosen by caller (pinned from the chosen slot in any-mode)
    staff_name: str | None           # for read-back
    staff_any: bool                  # caller chose "Any therapist" — propose_slots fans out across ALL therapists (gateway staffId=0)
    last_therapist_discussed: str | None  # most recent therapist named/asked-about — lets the extractor resolve a later pronoun ("book with her")

    # ----- Tool results --------------------------------------------------
    verify_result: VerifyResult | None
    proposed_slots: list[Slot]       # last propose_slots() result
    selected_slot: Slot | None       # caller-chosen slot
    appointment_id: str | None       # set after book_appointment success
    callback_id: str | None          # set after request_intake_callback success
    kb_snippets: list[dict]          # last kb_search / search_faqs result
    info_topic: str | None           # what info was last asked about

    # ----- Planner / respond plumbing ------------------------------------
    # The action that just ran (set by every action node). respond uses it
    # to pick the right scene prompt.
    last_action: str | None

    # The last node that ran — used by planner to detect call-site
    # (post-extract vs. post-verify_insurance).
    last_node: str | None

    # The next field to ask, if the planner picked `ask_field` /
    # `ask_confirmation`. respond reads this to render the question.
    pending_question: str | None     # e.g. "first_name", "confirm_booking"

    # The text respond ultimately produced this turn. The runtime layer
    # (chat / voice) reads this to send to the patient.
    last_reply_text: str | None

    # ----- Soft-safety screen idempotency -------------------------------
    # We run the gentle "are you safe?" screen at most once per session.
    soft_safety_asked: bool

    # ----- Post-booking SMS opt-in (A2P) --------------------------------
    # Chat-only. After a booking completes the bot asks once whether the
    # caller wants appointment/practice texts; the answer is recorded to the
    # gateway (DDB consent). Both flags are sticky so we never re-ask.
    sms_consent_asked: bool                       # the opt-in question was posed
    sms_consent: Optional[Literal["yes", "no"]]   # captured answer; None until recorded

    # The explicit scene a gate / handoff / action node wants respond to
    # use this turn. Read by respond._pick_scene (takes precedence over
    # state-derived scenes). Cleared by respond at the end of each turn
    # UNLESS gates.terminal is set — terminal handoffs keep their scene
    # so subsequent turns continue to deliver the same closing message
    # without re-firing the handoff node (and re-emitting admin alerts).
    # MUST be declared here — LangGraph 1.x drops keys not in the schema.
    scene: str | None

    # ----- Transient / debugging keys (set per-turn, read by respond) ---
    # Declared so LangGraph keeps them in checkpoints; values are written
    # by extract / actions / respond and consumed downstream the same turn.
    _scene: str | None                # which scene respond picked this turn
    _low_confidence: bool             # extract said it wasn't sure
    _reuse_insurance_pending: bool    # caller said "check coverage" but full insurance fields are already on file — planner asks to confirm before re-verifying stale PHI
    _resume_offer_pending: bool       # widget reopened within the 30-min window with prior state on file — bot greets by name and offers continue-vs-fresh choice before reading anything else back
    _info_query: str | None           # info question to search the KB for
    _info_this_turn: bool             # caller asked a KB/FAQ question THIS turn — answer it as a one-turn detour without flipping the sticky booking/callback intent
    _asks_therapist_roster: bool      # caller asked WHO the therapists are (roster/names) — planner routes to the list_therapists scene
    _asks_booking_availability: bool  # caller asked whether a/any therapist has open slots to book — planner checks the real calendar (propose_slots) before intake, then continues booking
    _wants_therapist_match: bool      # caller wants help choosing a therapist — chat planner refers them to the matching form (never picks); voice never offers matching
    _time_of_day: str | None          # caller's slot pref: morning/afternoon/evening/any
    _earliest_day_offset: int | None  # caller's earliest day offset
    _payer_check: dict | None         # last check_insurance_support result
    _booking_error: str | None        # last book_appointment error code
    _callback_error: str | None       # last submit_callback error
    _cancel_error: str | None         # last cancel_appointment error
    _reschedule_error: str | None     # last reschedule_appointment error
    _appt_email_hash: str | None       # email_hash from lookup_appointment response
    _appt_time_iso: str | None         # appointment_time_iso (RFC3339) from lookup_appointment
    _appt_service: str | None          # service / reason-for-visit from lookup_appointment (post-DOB-verify)
    _wants_reschedule: bool            # caller wants to RESCHEDULE (not just cancel) — sticky; shares the cancel-locate mechanics then offers a new time
    _was_reschedule: bool              # set on the cancel-success turn when _wants_reschedule was active — lets post_cancel offer a new time instead of a flat goodbye
    _reschedule_email_sent: bool       # gateway confirmed a reschedule-confirmation email was enqueued — post_reschedule only claims an email when True
    _cancel_email_sent: bool           # gateway confirmed a cancellation-confirmation email was enqueued — post_cancel only claims an email when True
    verify_result_next_step: str | None  # post-booking message from Jane
    insurance_pending_admin: bool     # CLAIM.MD couldn't verify; admin team will follow up. Keeps the booking flow alive so the caller still books a slot.

    # ----- Compliance audit + flow-control keys --------------------------
    # These MUST be declared here: LangGraph 1.x drops any key a node returns
    # that isn't in the schema. Before they were declared, every node's
    # `audit_event` was silently discarded, and `request_id` (emitted by
    # create_pending_request, read by log_phi) never survived to the next
    # node — so log_phi always logged request_id="?" and could not link the
    # intake-complete audit to its DDB pending_request row.
    audit_event: dict | None          # last node's structured (NON-PHI) audit event this turn
    request_id: str | None            # pending_request id from create_pending_request; read by log_phi
    done: bool                        # terminal handoff / flow-complete signal


def initial_state(channel: Channel, session_id: str, agent_source: str) -> State:
    """Construct a brand-new conversation state with sane defaults.

    Used by every runtime when LangGraph's checkpointer reports no prior
    thread for this session_id.
    """
    return State(
        messages=[],
        channel=channel,
        session_id=session_id,
        caller_phone=None,
        agent_source=agent_source,
        affirmation="none",
        safety_signal=False,
        last_user_text="",
        intent="unknown",
        payment_path="unknown",
        booking_status="none",
        callback_status="none",
        # All channels start with disclosure NOT delivered. The disclosure
        # gate fires on the first turn and the responder serves the verbatim
        # `HIPAA_DISCLOSURE_CHAT` / `_VOICE` constant. For voice, the gate
        # clears when the caller acknowledges the spoken HIPAA notice
        # (extract picks it up via TurnExtraction.recording_consent). For
        # chat, there is no spoken consent — the gate clears immediately
        # after the disclosure scene runs once (side-effect in respond.py
        # _apply_scene_side_effects). The widget's persistent badge is UI
        # notice but is NOT a substitute for the auditor spot-check phrase
        # "HIPAA-compliant and saved to your patient record" in the
        # transcript itself.
        gates=Gates(),
        caller_relationship=None,
        physical_presence_state=None,
        modality=None,
        resume=ResumeOffer(),
        turn_count=0,
        insurance_fields=InsuranceFields(),
        booking_fields=BookingFields(),
        callback_fields=CallbackFields(),
        staff_id=None,
        staff_name=None,
        staff_any=False,
        last_therapist_discussed=None,
        verify_result=None,
        proposed_slots=[],
        selected_slot=None,
        appointment_id=None,
        callback_id=None,
        kb_snippets=[],
        info_topic=None,
        last_action=None,
        last_node=None,
        pending_question=None,
        last_reply_text=None,
        soft_safety_asked=False,
        scene=None,
        request_id=None,
        done=False,
        sms_consent_asked=False,
        sms_consent=None,
    )


# ---------------------------------------------------------------------------
# Field-completeness helpers — used by the planner. Pure functions, no I/O.
# ---------------------------------------------------------------------------

# Order matters: the planner asks for the first missing field in this order.
INSURANCE_FIELD_ORDER: tuple[str, ...] = (
    "first_name", "last_name", "dob_yyyymmdd", "payer_name", "member_id",
)
BOOKING_FIELD_ORDER: tuple[str, ...] = (
    "reason", "phone", "email", "home_address", "sex",
)
CALLBACK_FIELD_ORDER: tuple[str, ...] = (
    "first_name", "last_name", "phone", "reason",
)


def _missing(d: dict, order: tuple[str, ...]) -> str | None:
    """Return the first key in `order` whose value is missing/empty."""
    for key in order:
        v = d.get(key)
        if v is None or (isinstance(v, str) and not v.strip()):
            return key
    return None


def first_missing_insurance(state: State) -> str | None:
    return _missing(state.get("insurance_fields") or {}, INSURANCE_FIELD_ORDER)


def first_missing_booking(state: State) -> str | None:
    return _missing(state.get("booking_fields") or {}, BOOKING_FIELD_ORDER)


def first_missing_callback(state: State) -> str | None:
    return _missing(state.get("callback_fields") or {}, CALLBACK_FIELD_ORDER)


def insurance_complete(state: State) -> bool:
    return first_missing_insurance(state) is None


def booking_fields_complete(state: State) -> bool:
    return first_missing_booking(state) is None


def callback_complete(state: State) -> bool:
    return first_missing_callback(state) is None


def needs_verification(state: State) -> bool:
    """True if we're on the insurance payment path and haven't verified yet."""
    if state.get("payment_path") == "self_pay":
        return False
    return state.get("verify_result") is None

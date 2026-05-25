"""planner — pure deterministic router. The only "brain" for control flow.

LOG-ON-ROUTE: every routing decision is logged at INFO so we can audit
the planner's behaviour without LangSmith.

Routing priority (top wins):
  0. Max-turns hard exit                    -> handoff_admin_callback
  1. Crisis — safety_signal or intent=crisis -> respond(crisis)
  2. Gate 1: disclosure not done            -> respond(disclosure_prompt)
  4. Gate 3: third_party_for_adult + no ROI -> handoff_roi_required
  5. Gate 4a: returning + not verified      -> respond(ask_dob_for_verify)
  6. Gate 4b: returning + verified + no resume decision
                                            -> gate_resume_offer
  7. Post-verify_insurance outcome routing  -> insurance outcome branches
  8. Low conf                               -> respond(clarify)
  9. Affirmative on a pending confirm       -> commit the gated action
  10. Negative on a pending confirm         -> rollback that pending state
  11. Cancel intent on an active booking    -> ask cancel confirmation
  12. Out-of-scope                          -> respond(out_of_scope)
  13. Info path                             -> search_kb then respond
  14. Callback path                         -> collect fields -> submit
  15. Insurance-only or booking path        -> collect -> verify -> slots ->
                                               confirm -> book
"""
from __future__ import annotations

import logging

from ..state import (
    State,
    booking_fields_complete,
    callback_complete,
    insurance_complete,
    needs_verification,
)

logger = logging.getLogger(__name__)

_MAX_TURNS = 60


class N:
    """Node names — kept here so the graph wiring imports them by symbol.

    Every string the planner can return MUST appear here. The wiring
    agent registers these as node names; a stray string means a dead edge.
    """
    # Core graph nodes
    SAFETY = "safety_screen"
    EXTRACT = "extract"
    PLANNER = "planner"
    RESPOND = "respond"

    # Existing action nodes
    VERIFY = "verify_insurance"
    PROPOSE = "propose_slots"
    BOOK = "book_appointment"
    CANCEL = "cancel_appointment"
    SUBMIT_CALLBACK = "submit_callback"
    SEARCH_KB = "search_kb"
    ROLLBACK = "rollback"

    # Gate / handoff nodes (wired by graph.py)
    GATE_RESUME_OFFER = "gate_resume_offer"
    HANDOFF_ROI_REQUIRED = "handoff_roi_required"
    HANDOFF_MANDATORY_REPORT = "handoff_mandatory_report"
    HANDOFF_CRISIS = "handoff_crisis"
    HANDOFF_ADMIN_WITH_NOTE = "handoff_admin_with_note"
    HANDOFF_ADMIN_VERIFICATION = "handoff_admin_verification"
    HANDOFF_ADMIN_CALLBACK = "handoff_admin_callback"

    # Insurance-outcome destination nodes
    OFFER_SELF_PAY = "offer_self_pay"
    CAPTURE_SELF_PAY_CONSENT = "capture_self_pay_consent"
    SEND_COVERAGE_RESULT = "send_coverage_result"

    # Outbox / DDB nodes
    CREATE_PENDING_REQUEST = "create_pending_request"
    SEND_ACKNOWLEDGEMENT = "send_acknowledgement"
    LOG_PHI = "log_phi"

    # Cancel lookup — finds a prior-session appointment by phone+DOB
    LOOKUP_APPOINTMENT = "lookup_appointment"


def _route(state: State, target: str, reason: str) -> str:
    """Log the routing decision and return the target node name."""
    ins = state.get("insurance_fields") or {}
    logger.info(
        "planner session=%s -> %s reason=%s | intent=%s bs=%s cs=%s aff=%s "
        "pm=%s ins_complete=%s verify=%s gates=%s turns=%d",
        state.get("session_id", "?"), target, reason,
        state.get("intent"), state.get("booking_status"),
        state.get("callback_status"), state.get("affirmation"),
        state.get("payment_path"),
        all(ins.get(k) for k in ("first_name", "last_name", "dob_yyyymmdd", "payer_name", "member_id")),
        bool(state.get("verify_result")),
        {k: v for k, v in (state.get("gates") or {}).items() if v},
        state.get("turn_count") or 0,
    )
    return target


# ---------------------------------------------------------------------------
# Post-verify_insurance outcome router
# ---------------------------------------------------------------------------

def _route_after_insurance(state: State) -> str:
    """Map insurance.outcome -> next node after verify_insurance ran.

    Called when last_node == "verify_insurance" OR when insurance.outcome
    is set and we are in the booking/insurance_check intent path.
    """
    outcome = (state.get("insurance_fields") or {}).get("outcome")

    if outcome == "eligible":
        # Happy path — respond with coverage confirmation then continue booking.
        return _route(state, N.RESPOND, "insurance_eligible")

    if outcome == "self_pay":
        # verify_insurance determined no active coverage; offer self-pay.
        return _route(state, N.OFFER_SELF_PAY, "insurance_outcome_self_pay")

    if outcome == "ineligible":
        # Coverage found but not active — offer self-pay; respond asks the
        # caller "you're not covered, want to continue self-pay?" and waits
        # for an explicit yes before flipping payment_path.
        return _route(state, N.OFFER_SELF_PAY, "insurance_outcome_ineligible")

    if outcome == "needs_manual_review":
        # Ambiguous result; route to admin for manual verification.
        return _route(state, N.HANDOFF_ADMIN_VERIFICATION, "insurance_outcome_manual_review")

    if outcome == "secondary_required":
        # Secondary insurance needed; respond to ask for secondary details.
        return _route(state, N.RESPOND, "insurance_secondary_required")

    if outcome == "wc_auto_eap":
        # Workers' comp / EAP — admin note required before proceeding.
        return _route(state, N.HANDOFF_ADMIN_WITH_NOTE, "insurance_outcome_wc_eap")

    if outcome == "no_insurance":
        # Caller has no insurance on file; offer self-pay.
        return _route(state, N.OFFER_SELF_PAY, "insurance_outcome_no_insurance")

    # outcome is None or unrecognised — treat as needs_manual_review.
    return _route(state, N.HANDOFF_ADMIN_VERIFICATION, "insurance_outcome_unknown")


# ---------------------------------------------------------------------------
# Main planner
# ---------------------------------------------------------------------------

def planner(state: State) -> str:
    """Pure function — returns the next node name for the conditional edge.

    Called as a conditional edge from EXTRACT (primary call-site) and as
    a second conditional edge from VERIFY_INSURANCE. We detect the call-
    site via `last_node`.
    """

    intent = state.get("intent", "unknown")
    bs = state.get("booking_status", "none")
    cs = state.get("callback_status", "none")
    aff = state.get("affirmation", "none")
    gates: dict = state.get("gates") or {}
    turn_count: int = state.get("turn_count") or 0

    # Mid-booking? When the booking flow is actively collecting/confirming we
    # treat the turn as booking regardless of what the LLM extractor most
    # recently labelled it. Computed up here (not just at step 14) so the
    # info / out-of-scope fast-paths below can DEFER to an active booking —
    # otherwise an address-shaped answer ("my address is 6955 N Durango Dr")
    # gets misread as a "where are your offices?" locations FAQ and the caller
    # loops on the office list instead of finishing their booking
    # (chat session 2026-05-24).
    mid_booking = bs in ("collecting", "ready_for_slots", "slot_selected", "pending_confirm")

    # ---- 0. Hard turn-count ceiling — anti-infinite-loop ---------------
    if turn_count > _MAX_TURNS:
        return _route(state, N.HANDOFF_ADMIN_CALLBACK, "max_turns_reached")

    # ---- 0b. Terminal session short-circuit ----------------------------
    # A handoff already fired this session, set gates.terminal=True, and
    # parked the closing scene on state.scene. Route straight to respond
    # so the closing message replays without re-running the handoff node
    # (which would re-POST admin alerts every turn). Crisis still wins
    # below. We require state.scene to be set so legacy sessions where
    # scene was lost (pre-fix: scene wasn't in the State schema and got
    # dropped) fall through to the normal gates, re-fire the handoff once
    # to repopulate scene, and only then start short-circuiting.
    if (
        gates.get("terminal")
        and state.get("scene")
        and not (state.get("safety_signal") or intent == "crisis")
    ):
        return _route(state, N.RESPOND, "terminal_replay")

    # ---- 1. Crisis short-circuits everything ---------------------------
    if state.get("safety_signal") or intent == "crisis":
        return _route(state, N.RESPOND, "crisis")

    # ---- Post-verify_insurance call-site --------------------------------
    # When the last node was verify_insurance, delegate entirely to the
    # insurance outcome router so we don't fall into gate checks below.
    if state.get("last_node") == "verify_insurance":
        return _route_after_insurance(state)

    # ---- 2. Gate 1: HIPAA disclosure / recording consent ---------------
    # Required on every channel before ANY classification proceeds. For
    # voice, the gate clears when the caller verbally acknowledges the
    # spoken HIPAA notice (extract sets recording_consent=True). For chat,
    # the disclosure_prompt scene serves the verbatim HIPAA_DISCLOSURE_CHAT
    # constant and respond.py flips the gate immediately afterwards — the
    # auditor spot-check phrase "HIPAA-compliant and saved to your patient
    # record" MUST appear in the transcript on turn 1.
    if not gates.get("disclosure_done"):
        return _route(state, N.RESPOND, "disclosure_prompt")

    # ---- (removed) Nevada physical-presence gate -----------------------
    # The practice now accepts anyone in the USA to book — patients travel
    # to Nevada for treatment — so location no longer gates the flow.
    # Booking is open on every channel (chat, voice, call).

    # ---- 4. Gate 3: third-party caller without ROI ---------------------
    rel = state.get("caller_relationship")
    if rel == "third_party_for_adult" and not gates.get("relationship_ok"):
        return _route(state, N.HANDOFF_ROI_REQUIRED, "third_party_no_roi")

    # ---- 5 + 6. Gate 4: returning-caller verification + resume ---------
    # These gates are only relevant when the planner has been told a
    # returning patient is detected (returning_verified flag not yet set).
    # The returning-patient detection itself happens in the gates/* nodes;
    # here we only check the flags they leave behind.
    if not gates.get("returning_verified"):
        # If the resume gate node has set returning_verified=False explicitly
        # (i.e. we know this is a returning caller but haven't verified DOB),
        # ask for DOB. The flag being absent means "not determined yet" —
        # only act when a gate node has signalled a returning caller is
        # present by checking a related flag (e.g. prior_session_id).
        prior_sid = (state.get("resume") or {}).get("prior_session_id")
        if prior_sid:
            return _route(state, N.RESPOND, "ask_dob_for_verify")

    if (
        gates.get("returning_verified")
        and not gates.get("resume_decided")
    ):
        return _route(state, N.GATE_RESUME_OFFER, "returning_verified_needs_resume")

    # ---- 7. Also handle insurance outcome when it's already set --------
    # (handles the case where we re-enter planner after a verify that
    # already ran but last_node was reset).
    ins_outcome = (state.get("insurance_fields") or {}).get("outcome")
    if ins_outcome and state.get("verify_result"):
        # Only branch on outcome if we're still in the booking/insurance flow
        # and haven't moved past the outcome yet (check if we have proposed_slots).
        # Skip re-routing if we already presented the downstream scene — the
        # dedicated affirmation handlers further down own the caller's reply
        # (e.g. self_pay_offer_yes/no). Without this guard the caller would
        # stay pinned on offer_self_pay every turn no matter what they said.
        already_routed = state.get("last_action") in (
            "offer_self_pay",
            "capture_self_pay_consent",
            "handoff_admin_verification",
            "handoff_admin_with_note",
            "handoff_admin_callback",
        ) or bool(state.get("insurance_pending_admin"))
        if (
            intent in ("booking", "insurance_check")
            and not state.get("proposed_slots")
            and not already_routed
        ):
            if ins_outcome not in ("eligible",):
                return _route_after_insurance(state)

    # ---- 7a. Resume-offer gate (widget reopened with prior state) -----
    # Set by main.py on greet-with-prior-state. Take precedence over the
    # insurance reuse gate so we never read back PHI before the caller
    # confirms they're the same person. Extract owns the lifecycle (sets
    # flag = False on yes/no and wipes state on "no" / "start fresh").
    if state.get("_resume_offer_pending"):
        return _route(state, N.RESPOND, "resume_offer")

    # ---- 7b. Reuse-confirm gate for "check my insurance" --------------
    # Set by extract when the caller asks to re-check coverage and we
    # already have full insurance fields on file. Extract owns the
    # flag's full lifecycle — it clears the flag (and the fields, on a
    # "no") once the caller answers, so we just read the current state.
    if state.get("_reuse_insurance_pending"):
        return _route(state, N.RESPOND, "confirm_reuse_insurance")

    # ---- 8. Low-confidence extraction -> clarify -----------------------
    if state.get("_low_confidence"):
        return _route(state, N.RESPOND, "low_confidence")

    # ---- 9. Pending-confirm commits + rollbacks ------------------------
    if bs == "pending_confirm" and aff == "yes":
        return _route(state, N.BOOK, "confirm_book_yes")
    if bs == "pending_confirm" and aff == "no":
        return _route(state, N.ROLLBACK, "confirm_book_no")
    if bs == "cancel_pending_confirm" and aff == "yes":
        return _route(state, N.CANCEL, "confirm_cancel_yes")
    if bs == "cancel_pending_confirm" and aff == "no":
        return _route(state, N.ROLLBACK, "confirm_cancel_no")
    if cs == "pending_confirm" and aff == "yes":
        return _route(state, N.SUBMIT_CALLBACK, "confirm_callback_yes")
    if cs == "pending_confirm" and aff == "no":
        return _route(state, N.ROLLBACK, "confirm_callback_no")

    # Post-self-pay-offer affirmation. After OFFER_SELF_PAY ran on a prior
    # turn, respond asked "want to continue as self-pay?"; the caller's
    # answer this turn decides whether we flip payment_path or hand off.
    if state.get("last_action") == "offer_self_pay":
        if aff == "yes":
            return _route(state, N.CAPTURE_SELF_PAY_CONSENT, "self_pay_offer_yes")
        if aff == "no":
            return _route(state, N.HANDOFF_ADMIN_CALLBACK, "self_pay_offer_no")

    # Post-verify offer affirmation. After verify_insurance returned an
    # `eligible` outcome on an insurance_check flow, respond showed the
    # "your plan is active — want to book now?" scene. yes/no here must
    # change the flow; otherwise step 14 below re-renders the same offer
    # every turn no matter what the caller says (extract correctly sets
    # affirmation but the planner ignored it).
    #
    # The "yes" path relies on extract flipping intent from
    # `insurance_check` to `booking` (it does), so by the time we get
    # here intent will already be "booking" — no extra branch needed
    # for yes. The "no" path needs an explicit terminal route so the
    # caller doesn't get pinned on the offer.
    if (
        intent == "insurance_check"
        and state.get("verify_result")
        and bs == "none"
        and state.get("last_action") == "verify_insurance"
        and aff == "no"
    ):
        return _route(state, N.RESPOND, "post_verify_declined")

    # ---- 10. Cancel intent -----------------------------------------------
    # Post-lookup outcome routing — before the booked-appointment branch so
    # we can handle the case where lookup ran but found nothing / failed DOB.
    la = state.get("last_action") or ""
    if la in ("lookup_appointment_verify_failed", "lookup_appointment_not_found"):
        return _route(state, N.RESPOND, "cancel_not_found")
    if la == "lookup_appointment_past":
        return _route(state, N.RESPOND, "cancel_past_appointment")

    if intent == "cancel" and bs == "booked":
        return _route(state, N.RESPOND, "ask_cancel_confirm")

    # Cancel intent but no active booking in this session — try to look up
    # a prior appointment by phone + DOB if we have them.
    if intent == "cancel" and bs not in ("booked", "cancel_pending_confirm", "cancelled"):
        bk = state.get("booking_fields") or {}
        cb = state.get("callback_fields") or {}
        phone = (bk.get("phone") or cb.get("phone") or "").strip()
        dob = (state.get("insurance_fields") or {}).get("dob_yyyymmdd") or ""
        if phone and dob:
            return _route(state, N.LOOKUP_APPOINTMENT, "cancel_needs_lookup")
        return _route(state, N.RESPOND, "ask_cancel_identifiers")

    if intent == "keep" and bs == "cancel_pending_confirm":
        return _route(state, N.ROLLBACK, "keep_after_cancel_pending")

    # ---- 11. Out-of-scope ---------------------------------------------
    # Defer to an active booking: a stray out-of-scope/info-shaped turn must
    # not abandon a half-finished booking.
    if intent == "out_of_scope" and not mid_booking:
        return _route(state, N.RESPOND, "out_of_scope")

    # ---- 12. Info path ------------------------------------------------
    # On CHAT we answer KB/FAQ questions at ANY point — even mid-booking —
    # then the booking resumes on the next turn (booking_status is preserved
    # and step 14 still owns booking when intent isn't "info"). A caller who
    # asks "how much is a session?" while booking must get the price, not a
    # deflection (chat session 2026-05-24).
    #
    # On VOICE we still defer to an active booking so a field-shaped answer
    # ("my address is 6955 N Durango Dr") isn't misread as a "where are your
    # offices?" FAQ and loop the caller on the office list.
    is_chat = state.get("channel") == "chat"

    # ---- 12-pre. "Which therapist is right for me?" -------------------
    # The assistant NEVER matches a therapist itself — it refers the caller
    # to the self-service matching form and invites them back to book. Takes
    # precedence over the roster/availability branches so "who's best for X?"
    # routes to the referral, not a name list. Chat only (the form URL is a
    # link); on voice this signal never fires into a link — voice simply
    # doesn't offer matching (see triage.py). Same active-booking guard.
    if state.get("_wants_therapist_match") and (is_chat or not mid_booking):
        return _route(state, N.RESPOND, "matching_referral")

    # ---- 12a. "Which therapists do you have?" -------------------------
    # A roster question is answered straight from data/roster.py — no KB
    # round-trip (the KB has no roster, which is exactly why this used to
    # deflect). Same channel rule as the info path: answer anytime on
    # chat; on voice defer to an active booking so a stray question
    # doesn't abandon a half-finished booking.
    if state.get("_asks_therapist_roster") and (is_chat or not mid_booking):
        return _route(state, N.RESPOND, "list_therapists")

    # ---- 12b. "Is anyone available to book?" --------------------------
    # A booking-availability question checks the REAL calendar BEFORE we
    # collect any intake, so the caller hears actual openings first, then
    # falls into the normal booking flow (extract set intent="booking").
    # staff_id drives propose_slots: set (named therapist) -> that calendar;
    # unset -> any-therapist fan-out via the gateway. Same channel rule as
    # the roster/info paths. propose_slots -> RESPOND (static edge), where
    # the present_slots / no_availability scene renders the result.
    if state.get("_asks_booking_availability") and (is_chat or not mid_booking):
        if not state.get("proposed_slots"):
            return _route(state, N.PROPOSE, "availability_peek")
        return _route(state, N.RESPOND, "present_slots")

    if (intent == "info" or state.get("_info_this_turn")) and (is_chat or not mid_booking):
        # Re-search whenever THIS turn asks something new (info_topic holds
        # the last searched query) — otherwise a second question reuses the
        # first question's stale snippets and gets the wrong answer.
        info_q = (state.get("_info_query") or "").strip()[:120]
        last_q = (state.get("info_topic") or "").strip()
        if not state.get("kb_snippets") or (info_q and info_q != last_q):
            return _route(state, N.SEARCH_KB, "info_needs_kb")
        return _route(state, N.RESPOND, "info_answer")

    # ---- 13. Callback path --------------------------------------------
    if intent == "callback":
        if callback_complete(state) and cs == "none":
            return _route(state, N.RESPOND, "callback_confirm")
        return _route(state, N.RESPOND, "callback_ask_field")

    # ---- 14. Booking / insurance-check flow ---------------------------
    # If we're already mid-booking (verified insurance, selected slot,
    # pending confirmation, etc.) treat intent as booking regardless of
    # what the LLM extractor most recently said. Stale/noisy intent
    # classifications would otherwise dump us back to greeting_or_open
    # and re-ask everything.
    if intent in ("booking", "insurance_check") or mid_booking:
        if state.get("payment_path") != "self_pay" and not insurance_complete(state):
            return _route(state, N.RESPOND, "ask_insurance_field")
        if needs_verification(state):
            return _route(state, N.VERIFY, "fields_complete_run_verify")
        if intent == "insurance_check" and bs == "none":
            return _route(state, N.RESPOND, "post_verify_offer_booking")
        if not booking_fields_complete(state):
            return _route(state, N.RESPOND, "ask_booking_field")
        if not state.get("staff_id") and not state.get("staff_any"):
            return _route(state, N.RESPOND, "ask_therapist")
        if not state.get("proposed_slots"):
            # propose_slots already ran and found nothing across the
            # entire roster — escalate to an admin callback instead of
            # looping back into propose forever.
            if state.get("last_action") == "propose_slots_no_availability":
                return _route(state, N.HANDOFF_ADMIN_CALLBACK, "no_calendar_availability")
            return _route(state, N.PROPOSE, "need_slots")
        if not state.get("selected_slot"):
            return _route(state, N.RESPOND, "present_slots")
        if bs in (None, "none", "collecting", "ready_for_slots", "slot_selected"):
            return _route(state, N.RESPOND, "confirm_booking")

    # ---- 15. Greeting / unknown ---------------------------------------
    return _route(state, N.RESPOND, "greeting_or_open")

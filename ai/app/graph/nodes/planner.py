"""planner — pure deterministic router. The only "brain" for control flow.

LOG-ON-ROUTE: every routing decision is logged at INFO so we can audit
the planner's behaviour without LangSmith.

Routing priority (top wins):
  1. Crisis — safety_signal or intent=crisis -> respond(crisis)
  2. Low conf -> respond(clarify)
  3. Affirmative on a pending confirm -> commit the gated action
  4. Negative on a pending confirm    -> rollback that pending state
  5. Cancel intent on an active booking -> ask cancel confirmation
  6. Out-of-scope -> respond(out_of_scope)
  7. Info path -> search_kb then respond
  8. Callback path -> collect fields -> submit
  9. Insurance-only or booking path -> collect -> verify -> slots ->
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


class N:
    """Node names — kept here so the graph wiring imports them by symbol."""
    SAFETY = "safety_screen"
    EXTRACT = "extract"
    PLANNER = "planner"
    RESPOND = "respond"

    VERIFY = "verify_insurance"
    PROPOSE = "propose_slots"
    BOOK = "book_appointment"
    CANCEL = "cancel_appointment"
    SUBMIT_CALLBACK = "submit_callback"
    SEARCH_KB = "search_kb"

    ROLLBACK = "rollback"


def _route(state: State, target: str, reason: str) -> str:
    """Log the routing decision and return the target node name."""
    ins = state.get("insurance_fields") or {}
    logger.info(
        "planner session=%s -> %s reason=%s | intent=%s bs=%s cs=%s aff=%s pm=%s ins_complete=%s verify=%s",
        state.get("session_id", "?"), target, reason,
        state.get("intent"), state.get("booking_status"),
        state.get("callback_status"), state.get("affirmation"),
        state.get("payment_path"),
        all(ins.get(k) for k in ("first_name", "last_name", "dob_yyyymmdd", "payer_name", "member_id")),
        bool(state.get("verify_result")),
    )
    return target


def planner(state: State) -> str:
    """Pure function — returns the next node name for the conditional edge."""

    intent = state.get("intent", "unknown")
    bs = state.get("booking_status", "none")
    cs = state.get("callback_status", "none")
    aff = state.get("affirmation", "none")

    # ---- 1. Crisis short-circuits everything ---------------------------
    if state.get("safety_signal") or intent == "crisis":
        return _route(state, N.RESPOND, "crisis")

    # ---- 2. Low-confidence extraction -> clarify -----------------------
    if state.get("_low_confidence"):
        return _route(state, N.RESPOND, "low_confidence")

    # ---- 3. Pending-confirm commits + rollbacks ------------------------
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

    # ---- 4. Cancel intent on booked appointment ------------------------
    if intent == "cancel" and bs == "booked":
        return _route(state, N.RESPOND, "ask_cancel_confirm")
    if intent == "keep" and bs == "cancel_pending_confirm":
        return _route(state, N.ROLLBACK, "keep_after_cancel_pending")

    # ---- 5. Out-of-scope ----------------------------------------------
    if intent == "out_of_scope":
        return _route(state, N.RESPOND, "out_of_scope")

    # ---- 6. Info path -------------------------------------------------
    if intent == "info":
        if not state.get("kb_snippets"):
            return _route(state, N.SEARCH_KB, "info_needs_kb")
        return _route(state, N.RESPOND, "info_answer")

    # ---- 7. Callback path ---------------------------------------------
    if intent == "callback":
        if callback_complete(state) and cs == "none":
            return _route(state, N.RESPOND, "callback_confirm")
        return _route(state, N.RESPOND, "callback_ask_field")

    # ---- 8. Booking / insurance-check flow ----------------------------
    if intent in ("booking", "insurance_check"):
        if state.get("payment_path") != "self_pay" and not insurance_complete(state):
            return _route(state, N.RESPOND, "ask_insurance_field")
        if needs_verification(state):
            return _route(state, N.VERIFY, "fields_complete_run_verify")
        if intent == "insurance_check" and bs == "none":
            return _route(state, N.RESPOND, "post_verify_offer_booking")
        if not booking_fields_complete(state):
            return _route(state, N.RESPOND, "ask_booking_field")
        if not state.get("staff_id"):
            return _route(state, N.RESPOND, "ask_therapist")
        if not state.get("proposed_slots"):
            return _route(state, N.PROPOSE, "need_slots")
        if not state.get("selected_slot"):
            return _route(state, N.RESPOND, "present_slots")
        if bs in (None, "none", "collecting", "ready_for_slots", "slot_selected"):
            return _route(state, N.RESPOND, "confirm_booking")

    # ---- 9. Greeting / unknown ----------------------------------------
    return _route(state, N.RESPOND, "greeting_or_open")

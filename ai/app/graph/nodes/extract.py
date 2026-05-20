"""extract — small structured-output LLM call that parses each user turn.

This is the ONLY node that turns natural language into structured
state. The planner downstream is pure Python; it never reads the user's
words directly. That split is what lets us unit-test routing without
mocking an LLM, and what lets the planner be deterministic.

Behaviour:
  * Reads the most recent user message + a tight context block.
  * Calls the configured extract model with the TurnExtraction schema.
  * Applies the returned delta to state (intent, affirmation,
    safety_signal, field_deltas merged into the right field bag).
  * Never produces patient-facing text.
"""
from __future__ import annotations

import logging
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from ..config import extract_model_name
from ..prompts.extract import EXTRACT_SYSTEM_PROMPT, TurnExtraction
from ..state import (
    BookingFields,
    CallbackFields,
    InsuranceFields,
    State,
)

logger = logging.getLogger(__name__)


# Lazy singleton — built once per process. ChatOpenAI is thread-safe and
# `with_structured_output` returns a runnable that does the JSON-schema
# binding under the hood.
_extractor = None


def _get_extractor():
    global _extractor
    if _extractor is None:
        _extractor = ChatOpenAI(
            model=extract_model_name(),
            temperature=0,
        ).with_structured_output(TurnExtraction)
    return _extractor


def _last_user_text(state: State) -> str:
    text = state.get("last_user_text") or ""
    if text:
        return text
    msgs = state.get("messages") or []
    for m in reversed(msgs):
        role = getattr(m, "type", None) or (m.get("role") if isinstance(m, dict) else None)
        if role in ("human", "user"):
            content = getattr(m, "content", None) or (m.get("content") if isinstance(m, dict) else None)
            if isinstance(content, str):
                return content
    return ""


def _last_assistant_text(state: State) -> str:
    msgs = state.get("messages") or []
    for m in reversed(msgs):
        role = getattr(m, "type", None) or (m.get("role") if isinstance(m, dict) else None)
        if role in ("ai", "assistant"):
            content = getattr(m, "content", None) or (m.get("content") if isinstance(m, dict) else None)
            if isinstance(content, str):
                return content
    return ""


def _context_block(state: State) -> str:
    """Tight, structured context passed to the extractor each turn.

    Kept short on purpose: the model only needs to know what we already
    have so it can correctly classify "answers" vs "new requests".
    """
    insurance = state.get("insurance_fields") or {}
    booking = state.get("booking_fields") or {}
    callback = state.get("callback_fields") or {}
    return (
        f"current_intent: {state.get('intent', 'unknown')}\n"
        f"booking_status: {state.get('booking_status', 'none')}\n"
        f"payment_path: {state.get('payment_path', 'unknown')}\n"
        f"insurance_fields_present: {sorted(k for k, v in insurance.items() if v)}\n"
        f"booking_fields_present: {sorted(k for k, v in booking.items() if v)}\n"
        f"callback_fields_present: {sorted(k for k, v in callback.items() if v)}\n"
        f"pending_question: {state.get('pending_question')}\n"
        f"last_assistant_said: {_last_assistant_text(state)[:300]!r}\n"
    )


def _match_roster(name: str) -> dict | None:
    """Match a free-text name against the bookable roster.

    Order of attempts (each case-insensitive):
      1) exact match on first name, full name, or last name
      2) any whitespace-token of the input equals a first name
    """
    from ...bt_agents.roster import ELIGIBLE_FOR_BOOKING

    n = (name or "").strip().lower()
    if not n:
        return None
    for t in ELIGIBLE_FOR_BOOKING:
        full = t["name"].lower()
        parts = full.split()
        first = parts[0]
        last = parts[-1]
        if n in (first, full, last):
            return t
    tokens = set(n.split())
    for t in ELIGIBLE_FOR_BOOKING:
        if t["name"].lower().split()[0] in tokens:
            return t
    return None


def _resolve_staff(state: State, deltas) -> dict[str, Any]:
    """Resolve therapist selection into a (staff_id, staff_name) pair.

    Three paths, each driven entirely by structured fields the extract
    LLM has already filled in — no keyword matching here so we get
    robust paraphrase coverage and a single NL→state boundary:

      1) Extractor named a therapist  → roster match by first/last/full.
      2) Extractor flagged `no_therapist_preference` → deterministic
         roster pick by session_id (stable across refreshes).
      3) Otherwise: do nothing; let the LLM ask again. Don't overwrite
         a valid prior choice.
    """
    from ...bt_agents.roster import ELIGIBLE_FOR_BOOKING

    out: dict[str, Any] = {}
    name = (getattr(deltas, "staff_name", None) or "").strip()
    if name:
        match = _match_roster(name)
        if match:
            out["staff_id"] = match["staffId"]
            out["staff_name"] = match["name"]
            return out
        # Roster miss — keep the raw name visible so respond can apologise
        # and re-prompt, but never set staff_id from an unverified string.
        out["staff_name"] = name
        return out

    if (
        getattr(deltas, "no_therapist_preference", False)
        and not state.get("staff_id")
        and state.get("intent") == "booking"
        and ELIGIBLE_FOR_BOOKING
    ):
        sid = state.get("session_id") or ""
        idx = (abs(hash(sid)) % len(ELIGIBLE_FOR_BOOKING)) if sid else 0
        choice = ELIGIBLE_FOR_BOOKING[idx]
        out["staff_id"] = choice["staffId"]
        out["staff_name"] = choice["name"]
    return out


def _merge_field_deltas(state: State, deltas) -> dict[str, Any]:
    """Apply field_deltas into the three field bags, preserving prior values.

    Returns the partial state update; LangGraph merges it back in.
    """
    insurance = InsuranceFields(**(state.get("insurance_fields") or {}))
    booking = BookingFields(**(state.get("booking_fields") or {}))
    callback = CallbackFields(**(state.get("callback_fields") or {}))

    # Insurance / identity fields (also used for callback when relevant).
    if deltas.first_name:
        insurance["first_name"] = deltas.first_name.strip()
        # First/last also seed the callback fields — same person.
        callback["first_name"] = deltas.first_name.strip()
    if deltas.last_name:
        insurance["last_name"] = deltas.last_name.strip()
        callback["last_name"] = deltas.last_name.strip()
    if deltas.dob_yyyymmdd and len(deltas.dob_yyyymmdd) == 8 and deltas.dob_yyyymmdd.isdigit():
        insurance["dob_yyyymmdd"] = deltas.dob_yyyymmdd
    if deltas.payer_name:
        insurance["payer_name"] = deltas.payer_name.strip()
    if deltas.member_id:
        insurance["member_id"] = deltas.member_id.strip()

    # Booking-only fields.
    if deltas.reason:
        booking["reason"] = deltas.reason.strip()[:500]
        callback["reason"] = deltas.reason.strip()[:500]
    if deltas.phone:
        booking["phone"] = deltas.phone.strip()
        callback["phone"] = deltas.phone.strip()
    if deltas.email:
        booking["email"] = deltas.email.strip()
    if deltas.home_address:
        booking["home_address"] = deltas.home_address.strip()
    if deltas.sex:
        booking["sex"] = deltas.sex.strip()

    # Callback-specific overrides (when the caller specifies a different
    # number / reason for callback than the booking flow).
    if deltas.callback_phone:
        callback["phone"] = deltas.callback_phone.strip()
    if deltas.callback_reason:
        callback["reason"] = deltas.callback_reason.strip()[:500]

    update: dict[str, Any] = {
        "insurance_fields": insurance,
        "booking_fields": booking,
        "callback_fields": callback,
    }

    # Therapist selection — resolve to staff_id so the planner can leave
    # the ask_therapist scene. The extractor emits a free-text name; we
    # match it against the bookable roster here. Without this, planner.py
    # gates on staff_id and loops forever even after staff_name is set.
    _staff_update = _resolve_staff(state, deltas)
    if _staff_update:
        update.update(_staff_update)

    # Scheduling preferences flow through to action nodes via transient keys.
    if deltas.time_of_day:
        update["_time_of_day"] = deltas.time_of_day
    if deltas.earliest_day_offset is not None:
        update["_earliest_day_offset"] = deltas.earliest_day_offset

    # Info-question text flows to search_kb via transient key.
    if deltas.info_query:
        update["_info_query"] = deltas.info_query.strip()

    # Selected slot index resolves against the proposed_slots list — done
    # by the planner / respond, but we stash the index for them to consume.
    if deltas.selected_slot_index is not None:
        update["_selected_slot_index"] = deltas.selected_slot_index

    return update


def extract(state: State) -> dict[str, Any]:
    """Run one LLM call to parse the latest user turn into deltas."""
    user_text = _last_user_text(state)
    if not user_text:
        return {}

    try:
        result: TurnExtraction = _get_extractor().invoke([
            SystemMessage(content=EXTRACT_SYSTEM_PROMPT),
            HumanMessage(content=(
                f"# Context\n{_context_block(state)}\n"
                f"# Last user message\n{user_text}\n"
            )),
        ])
    except Exception as exc:
        logger.exception("extract_failed session=%s", state.get("session_id", "?"))
        # Fail soft — mark the turn low-confidence so the planner routes
        # to clarify. Without `_low_confidence=True`, the planner would
        # proceed on stale state and re-ask the same field.
        return {
            "affirmation": "none",
            "safety_signal": False,
            "last_user_text": user_text,
            "_low_confidence": True,
        }

    update: dict[str, Any] = _merge_field_deltas(state, result.field_deltas)
    update["affirmation"] = result.affirmation
    update["last_user_text"] = user_text

    # Crisis OR signal-from-LLM both trip the safety flag. The keyword
    # pre-filter has already set safety_signal if a hard trigger fired —
    # don't downgrade that here.
    if result.safety_signal:
        update["safety_signal"] = True

    # Intent: APPLY the delta to sticky intent. "none" means keep prior.
    delta = result.intent_delta
    if delta == "none":
        pass
    elif delta == "self_pay":
        update["payment_path"] = "self_pay"
        # Keep prior intent (likely "booking" or "insurance_check").
    elif delta in {
        "greeting", "info", "insurance_check", "booking",
        "callback", "cancel", "keep", "out_of_scope",
    }:
        update["intent"] = delta

    # Confidence — pass through to the planner via a transient key so the
    # planner can decide to clarify instead of act on low-confidence.
    # Always overwrite (don't just set on low): otherwise a single
    # low-conf turn sticks across the rest of the session and every
    # subsequent reply routes to the clarify scene, even when the next
    # field was captured cleanly.
    update["_low_confidence"] = (result.confidence == "low")

    logger.info(
        "extract session=%s intent_delta=%s aff=%s safety=%s low_conf=%s "
        "delta_fields=%s",
        state.get("session_id", "?"),
        result.intent_delta,
        result.affirmation,
        result.safety_signal,
        result.confidence == "low",
        sorted(k for k, v in result.field_deltas.model_dump().items() if v),
    )
    return update

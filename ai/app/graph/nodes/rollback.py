"""rollback — pure state mutation when the caller backs out of a confirm.

Handles three cases:

  * `cancel_pending_confirm` + "no/keep" -> revert to `booked` (the
    cancel never happened, the appointment stays).
  * `pending_confirm` (book) + "no"      -> revert to `slot_selected`
    so the caller can pick another slot or change a field.
  * `callback pending_confirm` + "no"    -> revert callback_status to
    `none` and clear pending_question.

No tools called. No LLM call. The `respond` node speaks the next thing.
"""
from __future__ import annotations

import logging
from typing import Any

from ..state import State
from ..tracing import traced

logger = logging.getLogger(__name__)


@traced(run_type="chain", name="rollback")
def rollback(state: State) -> dict[str, Any]:
    bs = state.get("booking_status", "none")
    cb = state.get("callback_status", "none")
    intent = state.get("intent", "unknown")

    update: dict[str, Any] = {"last_action": "rollback", "affirmation": "none"}

    if bs == "cancel_pending_confirm" or intent == "keep":
        update["booking_status"] = "booked"
        update["intent"] = "idle"
        logger.info("rollback session=%s kept_booking=true", state.get("session_id", "?"))
        return update

    if bs == "pending_confirm":
        update["booking_status"] = "slot_selected"
        logger.info("rollback session=%s undo_book_confirm=true", state.get("session_id", "?"))
        return update

    if cb == "pending_confirm":
        update["callback_status"] = "none"
        logger.info("rollback session=%s undo_callback_confirm=true", state.get("session_id", "?"))
        return update

    return update

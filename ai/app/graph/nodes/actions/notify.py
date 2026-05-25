"""Notification marker nodes — pure state-scene setters, no external calls.

Why these are separate nodes (not folded into create_pending_request):
  Single Responsibility: create_pending_request owns persistence. These nodes
  own the graph topology signal — setting `scene` so the respond node knows
  what script to use. The planner routes through these sequentially; removing
  them would embed topology logic inside the persistence node.
"""
from __future__ import annotations

import logging
from typing import Any

from ...state import State
from ...tracing import traced
from .insurance import _build_audit_event

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# send_acknowledgement — verbal confirmation scene setter
# ---------------------------------------------------------------------------

@traced(run_type="tool", name="send_acknowledgement")
def send_acknowledgement(state: State) -> dict[str, Any]:
    """Set scene so respond delivers the booking-received acknowledgement.

    The actual email was already queued atomically by create_pending_request
    (one email outbox row, channel="email"). No SMS row is written (SMS is
    currently disabled). This node only advances the scene so the respond node
    renders the right script — it has no side effects of its own.
    """
    return {
        "scene": "send_ack_confirmation",
        "last_action": "send_acknowledgement",
    }


# ---------------------------------------------------------------------------
# log_phi — terminal marker node
# ---------------------------------------------------------------------------

@traced(run_type="tool", name="log_phi")
def log_phi(state: State) -> dict[str, Any]:
    """Mark intake complete and emit the final audit event.

    The pending_request PHI is already written (CMK-encrypted fields in
    bt-pending-requests) by create_pending_request. The s3_phi row has been
    removed: the PHI of record is the pending_request item itself, which is
    already CMK-encrypted and audited — a separate S3 archive row was
    redundant PHI sprawl. This node sets done=True so the graph terminates
    cleanly and emits a final audit_event for compliance tracing.

    No external calls — pure state mutation.
    """
    session_id = state.get("session_id", "?")
    request_id = state.get("request_id", "?")

    logger.info("log_phi session=%s request_id=%s intake_complete", session_id, request_id)

    return {
        "done": True,
        "last_action": "log_phi",
        "audit_event": _build_audit_event(
            "intake_complete", session_id, request_id=request_id,
        ),
    }


__all__ = ["send_acknowledgement", "log_phi"]

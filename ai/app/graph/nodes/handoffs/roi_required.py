"""roi_required — terminal handoff for third-party callers without an ROI.

Single responsibility: fires when caller_relationship == "third_party_for_adult"
and no Release of Information is on file. HIPAA §164.502 requires written
authorization before disclosing or acting on behalf of an adult patient;
a human admin must verify the ROI before intake can proceed.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from ...state import State
from . import _SEVERITY_INFO, _post_admin_notification

logger = logging.getLogger(__name__)

_SCENE = "handoff_roi_required"
_REASON = "third_party_caller_for_adult_no_ROI"
_ENDPOINT = "/internal/admin/handoff_queue"
# TODO(gateway): /internal/admin/handoff_queue endpoint pending


def handoff_roi_required(state: State) -> dict[str, Any]:
    """Route to this node when a third-party caller has no ROI on file.

    Admin receives caller_phone only (no patient name or DOB); follow-up
    requires them to obtain the signed ROI from the patient directly.
    """
    request_id = state.get("session_id", "unknown")
    ts = datetime.now(timezone.utc).isoformat()

    # Only caller_phone is included — no patient PHI crosses this boundary.
    notification: dict[str, Any] = {
        "type": "handoff",
        "reason": _REASON,
        "request_id": request_id,
        "caller_phone": state.get("caller_phone"),
        "timestamp": ts,
        "severity": _SEVERITY_INFO,
    }

    _post_admin_notification(_ENDPOINT, notification)

    logger.info("handoff_roi_required session=%s", request_id)

    gates = dict(state.get("gates") or {})
    gates["terminal"] = True

    return {
        "scene": _SCENE,
        "done": True,
        "gates": gates,
        "audit_event": {
            "type": "handoff",
            "actor": "ai",
            "ts": ts,
            "request_id": request_id,
            "outcome": _SCENE,
        },
    }

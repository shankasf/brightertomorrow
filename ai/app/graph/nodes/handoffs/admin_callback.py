"""admin_callback — terminal handoff when the caller explicitly requests a human.

Single responsibility: fires when the caller says "talk to a human", "real
person", "someone from the team", or similar (detected by extract → planner).
Queues a callback with available contact info so a staff member can reach out
within the practice's stated 24-hour window.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from ...state import State
from . import _SEVERITY_NORMAL, _post_admin_notification

logger = logging.getLogger(__name__)

_SCENE = "handoff_admin_callback"
_REASON = "caller_requested_human"
_ENDPOINT = "/internal/admin/handoff_queue"
# TODO(gateway): /internal/admin/handoff_queue endpoint pending


def handoff_admin_callback(state: State) -> dict[str, Any]:
    """Route to this node when the caller explicitly asks to speak with a person.

    Contact fields (phone, email) are forwarded so admin can reach out.  The
    gateway stores them in HIPAA-eligible DynamoDB; only request_id is logged.
    """
    request_id = state.get("session_id", "unknown")
    ts = datetime.now(timezone.utc).isoformat()

    bk = state.get("booking_fields") or {}
    cb = state.get("callback_fields") or {}

    # Prefer callback_fields (may be partially collected) then fall back to
    # booking_fields if intake had progressed further.
    caller_phone = state.get("caller_phone") or cb.get("phone") or bk.get("phone")
    caller_email = bk.get("email")

    notification: dict[str, Any] = {
        "type": "handoff",
        "reason": _REASON,
        "request_id": request_id,
        "caller_phone": caller_phone,
        "caller_email": caller_email,
        "timestamp": ts,
        "severity": _SEVERITY_NORMAL,
    }

    _post_admin_notification(_ENDPOINT, notification)

    logger.info("handoff_admin_callback session=%s", request_id)

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

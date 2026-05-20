"""admin_with_note — terminal handoff for special-intake cases requiring admin review.

Single responsibility: catch-all for intakes that cannot be completed by the AI
— court-ordered therapy, ESA/FMLA letters, workers comp, EAP, and records
requests. The planner sets state["admin_handoff_reason"] before routing here;
this node forwards that reason to the admin queue so staff know why they were
paged.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from ...state import State
from . import _SEVERITY_NORMAL, _post_admin_notification

logger = logging.getLogger(__name__)

_SCENE = "handoff_admin_with_note"
_ENDPOINT = "/internal/admin/handoff_queue"
# TODO(gateway): /internal/admin/handoff_queue endpoint pending


def handoff_admin_with_note(state: State) -> dict[str, Any]:
    """Route to this node for special-intake types the AI cannot handle alone.

    admin_handoff_reason (set by extract/planner) is forwarded to admin.
    Examples: "court_ordered", "esa_letter", "fmla", "workers_comp", "eap",
    "records_request".
    """
    request_id = state.get("session_id", "unknown")
    ts = datetime.now(timezone.utc).isoformat()

    # admin_handoff_reason is set by the planner; default to "special_intake"
    # if it arrives here without one (defensive).
    reason: str = state.get("admin_handoff_reason") or "special_intake"  # type: ignore[attr-defined]

    notification: dict[str, Any] = {
        "type": "handoff",
        "reason": reason,
        "request_id": request_id,
        "caller_phone": state.get("caller_phone"),
        "caller_email": (state.get("booking_fields") or {}).get("email"),
        "timestamp": ts,
        "severity": _SEVERITY_NORMAL,
    }

    _post_admin_notification(_ENDPOINT, notification)

    logger.info(
        "handoff_admin_with_note session=%s reason=%s",
        request_id, reason,
    )

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

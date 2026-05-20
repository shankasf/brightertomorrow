"""out_of_state — terminal handoff for callers outside Nevada.

Single responsibility: fires when `gates.nv_presence_ok` is False (the
caller confirmed they are NOT physically in Nevada). Nevada licensing law
requires the treating clinician to be licensed in the state where the patient
is physically present; we cannot legally serve them.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from ...state import State
from . import _SEVERITY_INFO, _post_admin_notification

logger = logging.getLogger(__name__)

_SCENE = "handoff_out_of_state"
_REASON = "physical_presence_outside_NV"
_ENDPOINT = "/internal/admin/handoff_queue"
# TODO(gateway): /internal/admin/handoff_queue endpoint pending


def handoff_out_of_state(state: State) -> dict[str, Any]:
    """Route to this node when the caller is physically outside Nevada.

    Sets scene=handoff_out_of_state so respond delivers the closing sentence,
    then marks the turn done so the graph does not continue.
    """
    request_id = state.get("session_id", "unknown")
    ts = datetime.now(timezone.utc).isoformat()

    # State code is non-PHI — safe to include in the admin payload.
    presence_state = state.get("physical_presence_state") or "unknown"

    notification: dict[str, Any] = {
        "type": "handoff",
        "reason": _REASON,
        "request_id": request_id,
        "caller_phone": state.get("caller_phone"),   # gateway handles PHI storage
        "caller_email": (state.get("booking_fields") or {}).get("email"),
        "physical_presence_state": presence_state,
        "timestamp": ts,
        "severity": _SEVERITY_INFO,
    }

    _post_admin_notification(_ENDPOINT, notification)

    logger.info(
        "handoff_out_of_state session=%s presence=%s",
        request_id, presence_state,
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

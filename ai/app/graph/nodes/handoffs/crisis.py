"""crisis — terminal handoff for active crisis disclosures.

Single responsibility: fires when safety_signal is True and the caller
discloses suicidal ideation, self-harm, or immediate danger (distinct from
the soft-safety screen, which is handled earlier by safety_screen.py). This
node formalises the terminal write; respond reads scene=handoff_crisis and
delivers 988/911 language (defined in scenes.py:164 — matching tone).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from ...state import State
from . import _SEVERITY_URGENT, _post_admin_notification

logger = logging.getLogger(__name__)

_SCENE = "handoff_crisis"
_REASON = "crisis_signal_detected"
# Routes to safety queue — same destination as mandatory_report.
_ENDPOINT = "/internal/admin/safety_queue"
# TODO(gateway): /internal/admin/safety_queue endpoint pending


def handoff_crisis(state: State) -> dict[str, Any]:
    """Route to this node on a confirmed crisis signal.

    respond reads scene=handoff_crisis and offers 988 + 725-238-6990.
    No intake, no booking proceeds after this node fires.
    """
    request_id = state.get("session_id", "unknown")
    ts = datetime.now(timezone.utc).isoformat()

    notification: dict[str, Any] = {
        "type": "crisis_handoff",
        "reason": _REASON,
        "request_id": request_id,
        "caller_phone": state.get("caller_phone"),
        "timestamp": ts,
        "severity": _SEVERITY_URGENT,
    }

    _post_admin_notification(_ENDPOINT, notification)

    logger.info("handoff_crisis session=%s", request_id)

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

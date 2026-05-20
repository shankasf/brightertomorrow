"""mandatory_report — terminal handoff for abuse or neglect disclosures.

Single responsibility: fires when the extract node sets safety_signal=="abuse"
(or a related abuse/neglect keyword). Sets mandatory_report=True on state so
the downstream Nevada NRS reporting workflow can pick it up.

Nevada NRS 432B.220 requires mandatory reporters to notify child protective
services within 24 hours of a reasonable suspicion of abuse or neglect.
severity=urgent so admin triage prioritises this row above all others.

NOTE: Only the safety signal FLAG is included in the admin payload — no
verbatim transcript text, no patient name, no DOB. The gateway persists
in HIPAA-eligible DynamoDB; PHI association happens there, not here.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from ...state import State
from . import _SEVERITY_URGENT, _post_admin_notification

logger = logging.getLogger(__name__)

_SCENE = "handoff_mandatory_report"
_REASON = "abuse_disclosure"
# Routes to the dedicated safety queue, not the general handoff queue.
_ENDPOINT = "/internal/admin/safety_queue"
# TODO(gateway): /internal/admin/safety_queue endpoint pending


def handoff_mandatory_report(state: State) -> dict[str, Any]:
    """Route to this node on abuse / neglect disclosure.

    Sets mandatory_report=True on state so any downstream outbox processor
    can trigger the Nevada NRS 432B reporting workflow within 24 hours.
    """
    request_id = state.get("session_id", "unknown")
    ts = datetime.now(timezone.utc).isoformat()

    # safety_signal is a flag, not a transcript — safe to include.
    safety_signal_value = state.get("safety_signal")

    # Nevada NRS 432B requires reporting within 24h — flag severity=urgent
    # so admin triage prioritises this row above routine handoffs.
    notification: dict[str, Any] = {
        "type": "mandatory_report",
        "reason": _REASON,
        "request_id": request_id,
        "caller_phone": state.get("caller_phone"),
        "safety_signal": safety_signal_value,  # flag only, never transcript
        "timestamp": ts,
        "severity": _SEVERITY_URGENT,
    }

    _post_admin_notification(_ENDPOINT, notification)

    logger.info(
        "handoff_mandatory_report session=%s safety_signal=%s",
        request_id, safety_signal_value,
    )

    gates = dict(state.get("gates") or {})
    gates["terminal"] = True

    return {
        "scene": _SCENE,
        "done": True,
        "mandatory_report": True,   # picked up by the NRS reporting outbox
        "gates": gates,
        "audit_event": {
            "type": "handoff",
            "actor": "ai",
            "ts": ts,
            "request_id": request_id,
            "outcome": _SCENE,
        },
    }

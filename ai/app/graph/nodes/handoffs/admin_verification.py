"""admin_verification — terminal handoff for insurance that needs manual review.

Single responsibility: fires when verify_result.ok is True but eligible is
False AND the payer is known — the CLAIM.MD auto-verify could not confirm
coverage and a human needs to call the payer directly. The payer name and
a redacted member_id suffix are forwarded; full member_id is PHI and must
not appear in logs — the gateway stores it in HIPAA-eligible DynamoDB.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from ...state import State
from . import _SEVERITY_NORMAL, _post_admin_notification

logger = logging.getLogger(__name__)

_SCENE = "handoff_admin_verification"
_REASON = "insurance_needs_manual_review"
_ENDPOINT = "/internal/admin/handoff_queue"
# TODO(gateway): /internal/admin/handoff_queue endpoint pending

# Redact member_id: expose only last 4 digits for triage reference.
# Full member_id is forwarded to the gateway payload where DynamoDB
# encryption-at-rest (AWS KMS CMK) protects it as PHI.
def _redact_member_id(member_id: str | None) -> str:
    if not member_id or len(member_id) <= 4:
        return "****"
    return f"****{member_id[-4:]}"


def handoff_admin_verification(state: State) -> dict[str, Any]:
    """Route to this node when insurance cannot be auto-verified.

    Payer name (non-PHI) and redacted member_id suffix are included so the
    admin queue entry is actionable. The gateway layer attaches full PHI
    from its own DDB record using request_id as the join key.
    """
    request_id = state.get("session_id", "unknown")
    ts = datetime.now(timezone.utc).isoformat()

    ins = state.get("insurance_fields") or {}
    payer = ins.get("payer_name") or "unknown"
    member_id_raw = ins.get("member_id") or ""

    # Log only request_id — no PHI in logs.
    notification: dict[str, Any] = {
        "type": "handoff",
        "reason": _REASON,
        "request_id": request_id,
        "caller_phone": state.get("caller_phone"),
        "insurance_payer": payer,                        # payer name is non-PHI
        "member_id_suffix": _redact_member_id(member_id_raw),  # redacted for triage
        "timestamp": ts,
        "severity": _SEVERITY_NORMAL,
    }

    _post_admin_notification(_ENDPOINT, notification)

    logger.info(
        "handoff_admin_verification session=%s payer=%s",
        request_id, payer,
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

"""gate_disclosure — ensures the HIPAA disclosure scene fires once per session.

Single responsibility: if the caller has not yet seen the HIPAA-compliant
welcome disclosure, set the scene so respond will render it. Idempotent.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from ...state import State

logger = logging.getLogger(__name__)

_SCENE = "disclosure_prompt"
_DONE_SCENE = "greeting"          # fallback scene when gate is already cleared
_MAX_ASKS = 3                      # anti-loop ceiling
_COUNT_KEY = "disclosure_asked_count"


def gate_disclosure(state: State) -> dict[str, Any]:
    """Return partial state that triggers the disclosure scene when needed.

    If disclosure_done is already True, return {} (no-op).
    If we have asked more than _MAX_ASKS times without acknowledgement,
    escalate to admin-callback so the caller is never trapped.
    """
    gates: dict = state.get("gates") or {}

    # Idempotency: already acknowledged — pass through.
    if gates.get("disclosure_done"):
        return {}

    ask_count: int = gates.get(_COUNT_KEY, 0)

    # Anti-loop: too many unanswered attempts → escalate.
    if ask_count >= _MAX_ASKS:
        logger.warning(
            "gate_disclosure loop_ceiling session=%s count=%d",
            state.get("session_id", "?"), ask_count,
        )
        return {
            "scene": "handoff_admin_callback_pending",
            "audit_event": {
                "type": "gate_disclosure_escalated",
                "ts": datetime.now(timezone.utc).isoformat(),
            },
        }

    new_count = ask_count + 1
    logger.info(
        "gate_disclosure not_done session=%s ask_count=%d",
        state.get("session_id", "?"), new_count,
    )

    return {
        "scene": _SCENE,
        "gates": {**gates, _COUNT_KEY: new_count},
        "audit_event": {
            "type": "gate_disclosure_prompted",
            "ts": datetime.now(timezone.utc).isoformat(),
        },
    }

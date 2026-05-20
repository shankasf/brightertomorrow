"""gate_nv_presence — confirms the caller is physically located in Nevada.

Single responsibility: if physical_presence_state is unknown, ask; if NV,
set nv_presence_ok=True; if any other state/non-US, set nv_presence_ok=False
so the planner can route to handoff_out_of_state. Never routes directly.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from ...state import State

logger = logging.getLogger(__name__)

_SCENE_ASK = "ask_physical_presence"
_MAX_ASKS = 3
_COUNT_KEY = "nv_presence_asked_count"


def gate_nv_presence(state: State) -> dict[str, Any]:
    """Return partial state reflecting whether the caller is in Nevada.

    physical_presence_state is expected to be a 2-letter US state code,
    "non_us", or None when not yet known.
    """
    gates: dict = state.get("gates") or {}

    # Idempotency: flag already set (True or False) — pass through.
    if "nv_presence_ok" in gates:
        return {}

    presence = state.get("physical_presence_state")

    if presence is None:
        # Unknown — we need to ask.
        ask_count: int = gates.get(_COUNT_KEY, 0)

        if ask_count >= _MAX_ASKS:
            logger.warning(
                "gate_nv_presence loop_ceiling session=%s count=%d",
                state.get("session_id", "?"), ask_count,
            )
            return {
                "scene": "handoff_admin_callback_pending",
                "audit_event": {
                    "type": "gate_nv_presence_escalated",
                    "ts": datetime.now(timezone.utc).isoformat(),
                },
            }

        new_count = ask_count + 1
        logger.info(
            "gate_nv_presence unknown session=%s ask_count=%d",
            state.get("session_id", "?"), new_count,
        )
        return {
            "scene": _SCENE_ASK,
            "gates": {**gates, _COUNT_KEY: new_count},
            "audit_event": {
                "type": "gate_nv_presence_asked",
                "ts": datetime.now(timezone.utc).isoformat(),
            },
        }

    # Presence is known — evaluate.
    in_nv = (presence == "NV")
    logger.info(
        "gate_nv_presence session=%s presence=%s nv_ok=%s",
        state.get("session_id", "?"), presence, in_nv,
    )
    return {
        "gates": {**gates, "nv_presence_ok": in_nv},
        "audit_event": {
            "type": "gate_nv_presence_resolved",
            "ts": datetime.now(timezone.utc).isoformat(),
            "nv_presence_ok": in_nv,
        },
    }

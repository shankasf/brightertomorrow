"""gate_caller_relationship — verifies the caller has standing to engage intake.

Single responsibility: if the caller's relationship to the patient is unknown,
ask; if the relationship grants standing (self, parent of minor, guardian with
ROI), set relationship_ok=True; otherwise set relationship_ok=False so the
planner routes to handoff_roi_required.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from ...state import State

logger = logging.getLogger(__name__)

_SCENE_ASK = "ask_caller_relationship"
_MAX_ASKS = 3
_COUNT_KEY = "relationship_asked_count"

# Relationships that grant standing without additional steps.
_OK_RELATIONSHIPS = frozenset({"self", "parent_of_minor", "guardian_with_roi"})
# Relationship that requires a Release of Information before we can proceed.
_ROI_REQUIRED = "third_party_for_adult"


def gate_caller_relationship(state: State) -> dict[str, Any]:
    """Return partial state reflecting whether the caller has intake standing.

    caller_relationship is expected to be one of:
      "self" | "parent_of_minor" | "guardian_with_roi" |
      "third_party_for_adult" | "unknown" | None
    """
    gates: dict = state.get("gates") or {}

    # Idempotency: flag already set — pass through.
    if "relationship_ok" in gates:
        return {}

    relationship = state.get("caller_relationship") or "unknown"

    if relationship == "unknown" or relationship is None:
        ask_count: int = gates.get(_COUNT_KEY, 0)

        if ask_count >= _MAX_ASKS:
            logger.warning(
                "gate_caller_relationship loop_ceiling session=%s count=%d",
                state.get("session_id", "?"), ask_count,
            )
            return {
                "scene": "handoff_admin_callback_pending",
                "audit_event": {
                    "type": "gate_caller_relationship_escalated",
                    "ts": datetime.now(timezone.utc).isoformat(),
                },
            }

        new_count = ask_count + 1
        logger.info(
            "gate_caller_relationship unknown session=%s ask_count=%d",
            state.get("session_id", "?"), new_count,
        )
        return {
            "scene": _SCENE_ASK,
            "gates": {**gates, _COUNT_KEY: new_count},
            "audit_event": {
                "type": "gate_caller_relationship_asked",
                "ts": datetime.now(timezone.utc).isoformat(),
            },
        }

    # Relationship is known — evaluate.
    ok = relationship in _OK_RELATIONSHIPS
    logger.info(
        "gate_caller_relationship session=%s relationship=%s ok=%s",
        state.get("session_id", "?"), relationship, ok,
    )
    return {
        "gates": {**gates, "relationship_ok": ok},
        "audit_event": {
            "type": "gate_caller_relationship_resolved",
            "ts": datetime.now(timezone.utc).isoformat(),
            "relationship_ok": ok,
            # relationship value is structural metadata, not PHI — safe to log.
            "relationship": relationship,
        },
    }

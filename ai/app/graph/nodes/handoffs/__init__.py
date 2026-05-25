"""handoffs — terminal nodes for the clinical-intake LangGraph.

Each handoff fires exactly once, writes an admin notification, sets a final
scene for `respond` to read, and marks the turn as done. The graph ends after
`respond` reads the scene and speaks the closing sentence.

Shared helper ``_post_admin_notification`` lives here (DRY) so individual
handoff files contain only their own business logic.
"""
from __future__ import annotations

import logging
from typing import Any

from ....integrations.aws_signer import gateway_post

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module-level severity constants — used by all handoffs
# ---------------------------------------------------------------------------

_SEVERITY_INFO = "info"
_SEVERITY_NORMAL = "normal"
_SEVERITY_URGENT = "urgent"


# ---------------------------------------------------------------------------
# Shared POST helper — all 7 handoffs call this, never the gateway directly.
# ---------------------------------------------------------------------------

def _post_admin_notification(
    endpoint: str,
    payload: dict[str, Any],
) -> None:
    """POST `payload` to `endpoint` on the gateway; swallows errors gracefully.

    If the endpoint is pending (404), the outbox DDB row written by the caller
    acts as the durable delivery mechanism — nothing is lost.

    HIPAA: this helper must only be called with non-PHI fields in `payload`
    (request_id, reason, severity, type, payer identifiers that the gateway
    stores in HIPAA-eligible DynamoDB).  PHI fields (names, DOB, full member
    IDs) must NOT be passed here — the gateway handles PHI in its own layer.
    """
    try:
        gateway_post(endpoint, payload, timeout=5.0)
    except Exception:
        # TODO(gateway): endpoint may be pending — outbox DDB row is the
        # fallback.  Log request_id only (no PHI) so ops can replay.
        logger.warning(
            "handoff_post_failed endpoint=%s request_id=%s",
            endpoint,
            payload.get("request_id", "?"),
            exc_info=True,
        )


# ---------------------------------------------------------------------------
# Re-export all handoff functions for clean imports by the graph wiring module
# ---------------------------------------------------------------------------

from .roi_required import handoff_roi_required          # noqa: E402
from .mandatory_report import handoff_mandatory_report  # noqa: E402
from .crisis import handoff_crisis                      # noqa: E402
from .admin_with_note import handoff_admin_with_note    # noqa: E402
from .admin_verification import handoff_admin_verification  # noqa: E402
from .admin_callback import handoff_admin_callback      # noqa: E402

__all__ = [
    "handoff_roi_required",
    "handoff_mandatory_report",
    "handoff_crisis",
    "handoff_admin_with_note",
    "handoff_admin_verification",
    "handoff_admin_callback",
]

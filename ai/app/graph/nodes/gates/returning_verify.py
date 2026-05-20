"""gate_returning_verify — checks whether the caller is a returning patient.

Single responsibility: probe the gateway for a prior intake record matching
the caller's phone or email, then compare DOB if found. Sets
returning_verified=True regardless of outcome (new callers pass freely).
HIPAA: only phone_hash and boolean match_found are logged.
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from ....integrations.aws_signer import gateway_post
from ...state import State

logger = logging.getLogger(__name__)

_SCENE_ASK_DOB = "ask_dob_for_verify"
_MAX_ASKS = 3
_COUNT_KEY = "returning_verify_asked_count"

# TODO(gateway): endpoint /internal/phi/returning_patient_lookup is pending.
_LOOKUP_PATH = "/internal/phi/returning_patient_lookup"


def _phone_hash(phone: str) -> str:
    """Return first 10 hex chars of SHA-256(phone) — non-reversible identifier for logs."""
    return hashlib.sha256(phone.encode()).hexdigest()[:10]


def _lookup_prior_record(phone: str | None, email: str | None) -> dict | None:
    """Call the gateway lookup endpoint. Returns the record dict or None.

    Treats 404 as "no prior record" (new caller). Any other HTTP error is
    re-raised so the caller can decide how to handle it.
    """
    payload: dict[str, str] = {}
    if phone:
        payload["phone"] = phone
    if email:
        payload["email"] = email
    if not payload:
        return None

    try:
        resp = gateway_post(_LOOKUP_PATH, payload, timeout=10.0)
        # Gateway returns {"record": {...}} or {"record": null}.
        return resp.get("record") or None
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            # Endpoint not deployed yet OR no record found — treat as new caller.
            return None
        raise


def gate_returning_verify(state: State) -> dict[str, Any]:
    """Probe for a prior intake record and gate on DOB confirmation if found.

    Outcomes:
      - No prior record → returning_verified=True, no prior_session_id.
      - Prior record found, DOB matches → returning_verified=True,
        resume.prior_session_id populated.
      - Prior record found, DOB missing on state → ask for DOB via scene.
      - Prior record found, DOB mismatch → treat as new caller (no match).
    """
    gates: dict = state.get("gates") or {}

    # Idempotency: already verified — pass through.
    if gates.get("returning_verified"):
        return {}

    phone: str | None = (state.get("caller_phone") or "").strip() or None
    email: str | None = (state.get("booking_fields") or {}).get("email") or None
    dob_on_state: str | None = (state.get("insurance_fields") or {}).get("dob_yyyymmdd") or None

    # --- Gateway lookup ---
    try:
        record = _lookup_prior_record(phone, email)
    except Exception as exc:
        # Gateway error — fail open (treat as new caller) rather than blocking intake.
        logger.exception(
            "gate_returning_verify lookup_error session=%s",
            state.get("session_id", "?"),
        )
        return {
            "gates": {**gates, "returning_verified": True},
            "audit_event": {
                "type": "gate_returning_verify_lookup_error",
                "ts": datetime.now(timezone.utc).isoformat(),
                "error": str(exc)[:200],
            },
        }

    phone_hash = _phone_hash(phone) if phone else "no_phone"
    match_found = record is not None
    logger.info(
        "gate_returning_verify phone_hash=%s match_found=%s session=%s",
        phone_hash, match_found, state.get("session_id", "?"),
    )

    if not match_found:
        # New caller — no verification needed.
        return {
            "gates": {**gates, "returning_verified": True},
            "audit_event": {
                "type": "gate_returning_verify_new_caller",
                "ts": datetime.now(timezone.utc).isoformat(),
                "phone_hash": phone_hash,
                "match_found": False,
            },
        }

    # Record found — need DOB to confirm identity.
    record_dob: str | None = record.get("dob_yyyymmdd")  # never logged

    if not dob_on_state:
        # Ask for DOB before we can confirm.
        ask_count: int = gates.get(_COUNT_KEY, 0)

        if ask_count >= _MAX_ASKS:
            logger.warning(
                "gate_returning_verify loop_ceiling session=%s count=%d",
                state.get("session_id", "?"), ask_count,
            )
            # Fail open — treat as new caller to avoid blocking the session.
            return {
                "gates": {**gates, "returning_verified": True},
                "scene": "handoff_admin_callback_pending",
                "audit_event": {
                    "type": "gate_returning_verify_escalated",
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "phone_hash": phone_hash,
                },
            }

        new_count = ask_count + 1
        return {
            "scene": _SCENE_ASK_DOB,
            "gates": {**gates, _COUNT_KEY: new_count},
            "audit_event": {
                "type": "gate_returning_verify_dob_needed",
                "ts": datetime.now(timezone.utc).isoformat(),
                "phone_hash": phone_hash,
                "match_found": True,
            },
        }

    # DOB is available — compare without logging either value.
    dob_matches = (dob_on_state == record_dob)

    if dob_matches:
        prior_session_id: str | None = record.get("session_id")
        resume: dict = state.get("resume") or {}
        return {
            "gates": {**gates, "returning_verified": True},
            "resume": {**resume, "prior_session_id": prior_session_id},
            "audit_event": {
                "type": "gate_returning_verify_matched",
                "ts": datetime.now(timezone.utc).isoformat(),
                "phone_hash": phone_hash,
                "match_found": True,
            },
        }

    # DOB mismatch — treat as new caller; don't expose that a record exists.
    logger.info(
        "gate_returning_verify dob_mismatch phone_hash=%s session=%s",
        phone_hash, state.get("session_id", "?"),
    )
    return {
        "gates": {**gates, "returning_verified": True},
        "audit_event": {
            "type": "gate_returning_verify_dob_mismatch",
            "ts": datetime.now(timezone.utc).isoformat(),
            "phone_hash": phone_hash,
            "match_found": False,  # intentionally false — don't confirm record existence
        },
    }

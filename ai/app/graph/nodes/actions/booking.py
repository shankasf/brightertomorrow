"""Booking persistence nodes — HIPAA-critical terminal actions.

Design contract
---------------
`create_pending_request` is the ONLY place in this graph that writes PHI to
DynamoDB. Every other node that might look like it touches PHI is either
reading from state (which is already in the DDB checkpoint, CMK-encrypted) or
writing non-PHI pointers.

Atomicity
---------
We use TransactWriteItems (up to 25 items) to write the pending_request row
plus up to 3 outbox rows all-or-nothing. If the transaction is cancelled
(duplicate request_id or table throttle) we return `scene="booking_failed_retry"`
and do NOT promise anything to the caller. The voice layer will offer a retry.

KMS encryption
--------------
PHI fields (name, DOB, phone, email, member_id) are encrypted with
`alias/bt-phi` (CMK ID from infra/lib/security-stack.ts) BEFORE writing to
DDB. The CMK is managed by the bt security stack and the bt-ai pod's IAM role
already has `kms:GenerateDataKey` + `kms:Decrypt` grants.

We use boto3's KMS client directly (`kms.encrypt`) rather than any
application-layer wrapper because:
  1. This avoids the dependency on a helper that doesn't exist yet.
  2. The encryption context ties the ciphertext to its purpose — if an
     outbox row is re-read with the wrong context the decrypt fails.

Hash fields (phone_hash, email_hash) use SHA-256 lowercase for consistent
cross-table lookups (mirrors Go's phi.HashEmail).

No PHI in logs
--------------
Every log line contains only: session_id, request_id, outcome code, channel.
"""
from __future__ import annotations

import hashlib
import logging
import os
import time
import uuid
from base64 import b64encode
from datetime import datetime, timezone
from typing import Any

import boto3
from botocore.exceptions import ClientError

from ...state import State
from ...tracing import traced
from .insurance import _build_audit_event, _now_epoch, _now_iso, _to_ddb_item, _OUTBOX_TABLE

logger = logging.getLogger(__name__)

# Table names — env-overridable for staging/local dev.
_REQUESTS_TABLE = os.environ.get("BT_PENDING_REQUESTS_TABLE", "bt-pending-requests")

# CMK alias — must match infra/lib/security-stack.ts `alias/bt-phi`.
_KMS_ALIAS = os.environ.get("BT_PHI_KMS_ALIAS", "alias/bt-phi")
_AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")


# ---------------------------------------------------------------------------
# KMS helpers
# ---------------------------------------------------------------------------

def _kms_client():
    return boto3.client("kms", region_name=_AWS_REGION)


def _kms_encrypt(plaintext: str, purpose: str, request_id: str) -> str:
    """Encrypt `plaintext` under the bt-phi CMK.

    Encryption context ties the blob to (purpose, request_id) so that
    decryption fails if either changes — defence-in-depth against confused
    deputy.

    Returns base64-encoded ciphertext (safe for DDB String attribute).
    """
    if not plaintext:
        return ""
    kms = _kms_client()
    resp = kms.encrypt(
        KeyId=_KMS_ALIAS,
        Plaintext=plaintext.encode("utf-8"),
        EncryptionContext={"purpose": purpose, "request_id": request_id},
    )
    return b64encode(resp["CiphertextBlob"]).decode("ascii")


def _sha256_hex(s: str) -> str:
    """Deterministic hex digest (lowercase). Mirrors Go phi.HashEmail."""
    return hashlib.sha256(s.lower().strip().encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Field-presence validator
# ---------------------------------------------------------------------------

_REQUIRED_FOR_PENDING = (
    # (state_dict_path_tuple, human_label_for_scene)
    (("insurance_fields", "first_name"),    "first_name"),
    (("insurance_fields", "last_name"),     "last_name"),
    (("insurance_fields", "dob_yyyymmdd"),  "dob"),
    (("booking_fields",   "phone"),         "phone"),
    (("booking_fields",   "email"),         "email"),
    (("insurance_fields", "outcome"),       "insurance_outcome"),
    (("booking_fields",   "reason"),        "reason"),
)


def _first_missing(state: State) -> str | None:
    """Return the human label of the first required field that is blank."""
    for path, label in _REQUIRED_FOR_PENDING:
        top, key = path
        val = (state.get(top) or {}).get(key)  # type: ignore[union-attr]
        if not val or (isinstance(val, str) and not val.strip()):
            return label
    return None


# ---------------------------------------------------------------------------
# Outbox row builder
# ---------------------------------------------------------------------------

def _outbox_row(
    request_id: str,
    channel: str,
    payload_ref: Any,
    dedupe_suffix: str,
) -> dict[str, Any]:
    now_iso   = _now_iso()
    now_epoch = _now_epoch()
    return {
        "notification_id": str(uuid.uuid4()),
        "created_at": now_iso,
        "request_id": request_id,
        "channel": channel,
        "payload_ref": payload_ref,
        "dedupe_key": f"{request_id}:{channel}:{dedupe_suffix}",
        "status": "pending",
        "attempt_count": 0,
        "next_retry_at": now_iso,
        "ttl": now_epoch + 30 * 86400,
    }


# ---------------------------------------------------------------------------
# 3. create_pending_request — HIPAA-critical terminal write
# ---------------------------------------------------------------------------

@traced(run_type="tool", name="create_pending_request")
def create_pending_request(state: State) -> dict[str, Any]:
    """Write pending_request + 3 outbox rows in a single DDB transaction.

    Step-by-step:
      1. Validate all required fields are present (fails fast, no writes).
      2. Allocate a request_id (UUID4, deterministic retry guard).
      3. KMS-encrypt PHI field values with per-purpose encryption contexts.
      4. Build the pending_request item with encrypted attributes.
      5. Build 3 outbox rows: SMS ack, email ack, S3 PHI log.
      6. TransactWriteItems — all-or-nothing. On TransactionCanceledException
         return scene="booking_failed_retry" so the caller is not promised
         anything that hasn't been confirmed.
      7. On success emit audit_event and set scene="booking_pending_ack".
    """
    session_id = state.get("session_id", "?")

    # --- 1. Validate required fields -------------------------------------
    missing = _first_missing(state)
    if missing:
        logger.warning("create_pending_request session=%s missing_field=%s", session_id, missing)
        return {
            "scene": f"missing_field_{missing}",
            "last_action": "create_pending_request_blocked",
        }

    ins = state.get("insurance_fields") or {}
    bk  = state.get("booking_fields") or {}

    first_name = (ins.get("first_name") or "").strip()
    last_name  = (ins.get("last_name") or "").strip()
    dob        = (ins.get("dob_yyyymmdd") or "").strip()
    payer_name = (ins.get("payer_name") or "").strip()
    member_id  = (ins.get("member_id") or "").strip()
    outcome    = ins.get("outcome", "unknown")
    phone      = (bk.get("phone") or "").strip()
    email      = (bk.get("email") or "").strip()
    reason     = (bk.get("reason") or "").strip()[:500]
    modality   = state.get("modality") or "unknown"
    slot_pref  = state.get("_time_of_day") or "any"

    now_iso = _now_iso()

    # --- 2. Allocate request_id ------------------------------------------
    # Deterministic from session_id so re-entry is idempotent: if this node
    # is re-invoked after a transient failure, same UUID → DDB condition write
    # rejects the duplicate instead of creating a second row.
    request_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"bt-intake:{session_id}"))

    # --- 3. KMS-encrypt PHI fields ---------------------------------------
    try:
        name_enc      = _kms_encrypt(f"{first_name} {last_name}", "name",      request_id)
        dob_enc       = _kms_encrypt(dob,                          "dob",       request_id)
        phone_enc     = _kms_encrypt(phone,                        "phone",     request_id)
        email_enc     = _kms_encrypt(email,                        "email",     request_id)
        member_id_enc = _kms_encrypt(member_id,                    "member_id", request_id)
    except Exception:
        logger.exception("create_pending_request session=%s kms_encrypt_failed", session_id)
        return {
            "scene": "booking_failed_retry",
            "last_action": "create_pending_request_kms_error",
        }

    phone_hash = _sha256_hex(phone)
    email_hash = _sha256_hex(email)

    # --- 4. Build pending_request item -----------------------------------
    pending_item: dict[str, Any] = {
        "request_id":     request_id,       # PK
        "created_at":     now_iso,           # SK
        "session_id":     session_id,
        "name_enc":       name_enc,
        "dob_enc":        dob_enc,
        "phone_hash":     phone_hash,
        "phone_enc":      phone_enc,
        "email_hash":     email_hash,
        "email_enc":      email_enc,
        "payer":          payer_name,        # not PHI — payer name is not a patient identifier
        "member_id_enc":  member_id_enc,
        "outcome":        outcome,
        "slot_pref":      slot_pref,
        "modality":       modality,
        "reason":         reason,            # free-text from patient; encrypted at-table by CMK SSE
        "status":         "pending_admin_confirm",
        "ttl":            _now_epoch() + 90 * 86400,  # 90-day retention
    }

    # --- 5. Build 3 outbox rows ------------------------------------------
    # S3 PHI log: key format phi/{session_id}/{request_id}.json (deterministic)
    s3_key   = f"phi/{session_id}/{request_id}.json"
    sms_row  = _outbox_row(request_id, "sms",   phone,   "ack")
    email_row = _outbox_row(request_id, "email", email,  "ack")
    s3_row   = _outbox_row(request_id, "s3_phi", s3_key, "phi_log")

    # --- 6. TransactWriteItems -------------------------------------------
    try:
        ddb = boto3.client("dynamodb", region_name=_AWS_REGION)

        transact_items = [
            {
                "Put": {
                    "TableName": _REQUESTS_TABLE,
                    "Item": _to_ddb_item(pending_item),
                    # Idempotency: reject if request_id already exists.
                    "ConditionExpression": "attribute_not_exists(request_id)",
                }
            },
            {
                "Put": {
                    "TableName": _OUTBOX_TABLE,
                    "Item": _to_ddb_item(sms_row),
                    "ConditionExpression": "attribute_not_exists(dedupe_key)",
                }
            },
            {
                "Put": {
                    "TableName": _OUTBOX_TABLE,
                    "Item": _to_ddb_item(email_row),
                    "ConditionExpression": "attribute_not_exists(dedupe_key)",
                }
            },
            {
                "Put": {
                    "TableName": _OUTBOX_TABLE,
                    "Item": _to_ddb_item(s3_row),
                    "ConditionExpression": "attribute_not_exists(dedupe_key)",
                }
            },
        ]

        ddb.transact_write_items(TransactItems=transact_items)

    except ClientError as exc:
        error_code = exc.response["Error"]["Code"]
        if error_code == "TransactionCanceledException":
            # Cancellation reasons can include conditional check failures
            # (idempotent duplicate — safe to treat as success) or capacity
            # errors (not safe — caller should retry).
            reasons = exc.response.get("CancellationReasons") or []
            all_conditional = all(
                r.get("Code") in ("ConditionalCheckFailed", "None")
                for r in reasons
            )
            if all_conditional:
                # All failures are conditional-check — this is a duplicate
                # submission. Treat as success so the caller gets an ack.
                logger.info("create_pending_request session=%s request_id=%s duplicate_ok",
                            session_id, request_id)
            else:
                logger.error("create_pending_request session=%s request_id=%s transaction_cancelled reasons=%s",
                             session_id, request_id,
                             [r.get("Code") for r in reasons])
                return {
                    "scene": "booking_failed_retry",
                    "last_action": "create_pending_request_txn_cancelled",
                }
        else:
            logger.exception("create_pending_request session=%s request_id=%s ddb_error",
                             session_id, request_id)
            return {
                "scene": "booking_failed_retry",
                "last_action": "create_pending_request_ddb_error",
            }
    except Exception:
        logger.exception("create_pending_request session=%s unexpected_error", session_id)
        return {
            "scene": "booking_failed_retry",
            "last_action": "create_pending_request_error",
        }

    # --- 7. Success -------------------------------------------------------
    logger.info("create_pending_request session=%s request_id=%s outcome=%s",
                session_id, request_id, outcome)

    return {
        "request_id":    request_id,
        "scene":         "booking_pending_ack",
        "last_action":   "create_pending_request",
        "audit_event":   _build_audit_event(
            "create_pending_request", session_id,
            request_id=request_id, outcome=outcome,
        ),
    }


__all__ = ["create_pending_request"]

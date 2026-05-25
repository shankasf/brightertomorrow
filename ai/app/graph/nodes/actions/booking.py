"""Booking persistence nodes — HIPAA-critical terminal actions.

Design contract
---------------
`create_pending_request` is the ONLY place in this graph that writes PHI to
DynamoDB. Every other node that might look like it touches PHI is either
reading from state (which is already in the DDB checkpoint, CMK-encrypted) or
writing non-PHI pointers.

Atomicity
---------
We use TransactWriteItems to write exactly 2 items all-or-nothing:
  1. The pending_request item (PHI, CMK-encrypted fields).
  2. One email outbox row in bt-notifications-outbox.
If the transaction is cancelled (duplicate request_id or table throttle) we
return `scene="booking_failed_retry"` and do NOT promise anything to the
caller. The voice layer will offer a retry.

KMS encryption — two separate helpers
--------------------------------------
_kms_encrypt(plaintext, purpose, request_id)
    Used for pending_request PHI fields (name, DOB, phone, email, member_id).
    Passes EncryptionContext={"purpose": ..., "request_id": ...} as a
    defence-in-depth guard — the ciphertext is bound to its purpose.

_kms_encrypt_payload(plaintext)
    Used for outbox row payload_ciphertext ONLY.
    Passes NO EncryptionContext, matching the Go EnqueueNotification call
    and the Lambda kms.decrypt() call (which also passes no context).
    If you add EncryptionContext here the Lambda decrypt will fail.

Hash fields (phone_hash, email_hash) use SHA-256 lowercase for consistent
cross-table lookups (mirrors Go's phi.HashEmail).

No PHI in logs
--------------
Every log line contains only: session_id, request_id, outcome code, channel.
"""
from __future__ import annotations

import hashlib
import json
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
    """Encrypt `plaintext` under the bt-phi CMK for pending_request PHI fields.

    Encryption context ties the blob to (purpose, request_id) so that
    decryption fails if either changes — defence-in-depth against confused
    deputy.

    DO NOT use this for outbox payload_ciphertext — the Lambda decrypts
    without EncryptionContext. Use _kms_encrypt_payload() for that.

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


def _kms_encrypt_payload(plaintext: str) -> str:
    """Encrypt an outbox notification payload under the bt-phi CMK.

    Context-free encrypt — matches the Go EnqueueNotification call and the
    Lambda kms.decrypt() call (neither passes EncryptionContext). If you add
    EncryptionContext here the Lambda decrypt will fail.

    plaintext for email rows is a JSON string:
        {"subject": "...", "heading": "...", "paragraphs": [...]}

    Returns base64-encoded ciphertext (safe for DDB String attribute).
    """
    if not plaintext:
        return ""
    kms = _kms_client()
    resp = kms.encrypt(
        KeyId=_KMS_ALIAS,
        Plaintext=plaintext.encode("utf-8"),
        # NO EncryptionContext — intentional. See module docstring.
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
# Outbox row builder — canonical schema matches Go EnqueueNotification
# ---------------------------------------------------------------------------

def _build_email_outbox_row(
    recipient: str,
    payload_ciphertext: str,
    dedupe_key: str,
) -> dict[str, Any]:
    """Build one canonical outbox row for the bt-notifications-outbox table.

    Schema matches gateway/internal/phi/outbox.go EnqueueNotification exactly:
      notification_id    (S) PK — fresh uuid4
      created_at         (S) SK — ISO8601 %Y-%m-%dT%H:%M:%SZ
      channel            (S) — "email"
      recipient          (S) — patient email address (table is CMK-encrypted)
      payload_ciphertext (S) — base64(KMS.Encrypt(alias/bt-phi, json_payload))
      status             (S) — "pending"  (GSI1-retry-scan PK)
      next_retry_at      (S) — ISO8601, initially == created_at (GSI1 SK)
      attempt_count      (N) — 0
      dedupe_key         (S) — stable caller-supplied string
      ttl                (N) — epoch seconds, now + 30 days
    """
    now_iso   = datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    now_epoch = _now_epoch()
    return {
        "notification_id":    str(uuid.uuid4()),
        "created_at":         now_iso,
        "channel":            "email",
        "recipient":          recipient,
        "payload_ciphertext": payload_ciphertext,
        "status":             "pending",
        "next_retry_at":      now_iso,
        "attempt_count":      0,
        "dedupe_key":         dedupe_key,
        "ttl":                now_epoch + 30 * 86400,
    }


# ---------------------------------------------------------------------------
# 3. create_pending_request — HIPAA-critical terminal write
# ---------------------------------------------------------------------------

@traced(run_type="tool", name="create_pending_request")
def create_pending_request(state: State) -> dict[str, Any]:
    """Write pending_request (always) + optionally 1 email outbox row.

    When a real calendar booking already completed (appointment_id set AND
    booking_status=="booked") the gateway already sent the patient a
    confirmation email via /internal/calendar/confirm.  In that case we write
    ONLY the pending_request item so that the returning-patient GSI lookup
    (gateway returning_lookup.go) works, but we skip the acknowledgement outbox
    row to prevent a duplicate email.

    When no calendar booking exists yet (the normal "pending admin confirm"
    path) we write both items in a single TransactWriteItems call, exactly as
    before.

    Step-by-step:
      1. Validate all required fields are present (fails fast, no writes).
      2. Detect already_booked (appointment_id + booking_status=="booked").
      3. Allocate a request_id (UUID5 from session_id — deterministic retry guard).
      4. KMS-encrypt PHI field values with per-purpose encryption contexts.
      5. Build the pending_request item with encrypted attributes.
      6. If NOT already_booked: build 1 email outbox row (canonical schema,
         payload_ciphertext) and KMS-encrypt its payload.
         # TODO(sms): enqueue channel="sms" row when SMS is enabled.
      7. TransactWriteItems:
           - already_booked: 1 Put (pending_request only).
           - not already_booked: 2 Puts (pending_request + email outbox) — all-or-nothing.
         On TransactionCanceledException return scene="booking_failed_retry".
      8. On success emit audit_event and set scene="booking_pending_ack".
         notification_id is "" when no outbox row was written.
    """
    session_id = state.get("session_id", "?")

    # --- 2. Detect already-booked path -----------------------------------
    # When book_appointment already completed via /internal/calendar/confirm
    # the gateway sent exactly one patient email.  Skip the outbox row here.
    already_booked: bool = (
        bool(state.get("appointment_id"))
        and state.get("booking_status") == "booked"
    )

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
    # Defensive: ensure the booked appointment stores the clean card ID even if
    # state was seeded outside the extract boundary.
    from ....data.identifiers import normalize_member_id
    member_id  = normalize_member_id(ins.get("member_id"))
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

    # --- 5. Build email outbox row (conditional) -------------------------
    # Skip when already_booked — the gateway already sent the patient email
    # via /internal/calendar/confirm.  Always write when this is a new
    # "pending admin confirm" request so the patient gets the ack email.
    email_outbox_row: dict[str, Any] | None = None
    if not already_booked:
        # No date/time/therapist exists yet — acknowledgement content only.
        # Minimum-necessary: first_name only (plain text). No insurance/financial
        # detail, no diagnosis, no slot. The Lambda wraps in branded HTML template.
        greeting = f"Hi {first_name}" if first_name else "Hi there"

        email_payload_json = json.dumps({
            "subject":    "We received your appointment request — Brighter Tomorrow Therapy",
            "heading":    "We’ve received your request",
            "paragraphs": [
                f"{greeting}, we’ve received your appointment request and our care team "
                "will reach out shortly to confirm the details.",
                "If anything’s urgent, just call us using the button below.",
            ],
        })

        try:
            payload_ciphertext = _kms_encrypt_payload(email_payload_json)
        except Exception:
            logger.exception("create_pending_request session=%s kms_encrypt_payload_failed", session_id)
            return {
                "scene": "booking_failed_retry",
                "last_action": "create_pending_request_kms_payload_error",
            }

        email_outbox_row = _build_email_outbox_row(
            recipient=email,
            payload_ciphertext=payload_ciphertext,
            dedupe_key=f"{request_id}:email:ack",
        )

    # --- 6. TransactWriteItems (1 or 2 Puts) -----------------------------
    # already_booked → 1 Put (pending_request only).
    # not already_booked → 2 Puts (pending_request + email outbox),
    #   all-or-nothing so a failed outbox write never orphans the request.
    try:
        ddb = boto3.client("dynamodb", region_name=_AWS_REGION)

        transact_items: list[dict[str, Any]] = [
            {
                "Put": {
                    "TableName": _REQUESTS_TABLE,
                    "Item": _to_ddb_item(pending_item),
                    # Idempotency: reject if request_id already exists.
                    "ConditionExpression": "attribute_not_exists(request_id)",
                }
            },
        ]
        if email_outbox_row is not None:
            transact_items.append(
                {
                    "Put": {
                        "TableName": _OUTBOX_TABLE,
                        "Item": _to_ddb_item(email_outbox_row),
                        "ConditionExpression": "attribute_not_exists(notification_id)",
                    }
                }
            )

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
    email_enqueued = email_outbox_row is not None
    notif_id = email_outbox_row["notification_id"] if email_enqueued else ""
    logger.info(
        "create_pending_request session=%s request_id=%s outcome=%s "
        "email_enqueued=%s notification_id=%s",
        session_id, request_id, outcome, email_enqueued, notif_id or "none",
    )

    audit_kwargs: dict[str, Any] = {
        "request_id": request_id,
        "outcome": outcome,
        "email_enqueued": email_enqueued,
    }
    if email_enqueued:
        audit_kwargs["notification_id"] = notif_id
        audit_kwargs["channel"] = "email"

    return {
        "request_id":    request_id,
        "scene":         "booking_pending_ack",
        "last_action":   "create_pending_request",
        "audit_event":   _build_audit_event(
            "create_pending_request", session_id,
            **audit_kwargs,
        ),
    }


__all__ = ["create_pending_request"]

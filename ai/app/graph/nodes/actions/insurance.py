"""Insurance action nodes — eligibility probe + coverage-only result dispatch.

Why discriminated outcomes instead of a boolean:
  The old binary `eligible` flag forced every downstream node to re-examine
  the raw response. A discriminated outcome string lets the planner route
  deterministically without any NL interpretation — the outcome IS the
  routing key. The seven strings are a closed vocabulary; new outcomes must
  be added here AND in state.py InsuranceFields.outcome simultaneously.

KMS note:
  No PHI is written here — verify_insurance only calls external APIs and
  records the result into state. PHI persistence happens in booking.py.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import time
import uuid
from base64 import b64encode
from datetime import datetime, timezone
from typing import Any

import boto3
import httpx
from botocore.exceptions import ClientError

from ....integrations.aws_signer import gateway_post, signed_post
from ....data.payers import resolve_payer_id, is_declined_payer
from ....integrations.tools import _validate_dob
from ...state import State
from ...tracing import traced

logger = logging.getLogger(__name__)

# Payers that always require admin triage regardless of eligibility response.
# These are not a NL match — they are canonical payer IDs from PAYERS list.
_WC_AUTO_EAP_IDS = frozenset({"workers_comp", "auto", "EAP"})

# CLAIM.MD status values the gateway maps to "eligible".
_ELIGIBLE_STATES = frozenset({"active", "approved", "eligible", "in force", "in network"})

# DynamoDB tables — env-overridable for local dev / staging.
_OUTBOX_TABLE = os.environ.get("BT_NOTIFICATIONS_OUTBOX_TABLE", "bt-notifications-outbox")


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _now_iso_z() -> str:
    """ISO8601 in the canonical outbox format: 2006-01-02T15:04:05Z."""
    return datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _now_epoch() -> int:
    return int(time.time())


_KMS_ALIAS = os.environ.get("BT_PHI_KMS_ALIAS", "alias/bt-phi")
_AWS_REGION_INS = os.environ.get("AWS_REGION", "us-east-1")


def _kms_encrypt_payload(plaintext: str) -> str:
    """Encrypt an outbox notification payload under the bt-phi CMK.

    Context-free encrypt — matches the Go EnqueueNotification call and the
    Lambda kms.decrypt() call (neither passes EncryptionContext). If you add
    EncryptionContext here the Lambda decrypt will fail.

    Returns base64-encoded ciphertext (safe for DDB String attribute).
    """
    if not plaintext:
        return ""
    kms = boto3.client("kms", region_name=_AWS_REGION_INS)
    resp = kms.encrypt(
        KeyId=_KMS_ALIAS,
        Plaintext=plaintext.encode("utf-8"),
        # NO EncryptionContext — intentional. Lambda decrypts without context.
    )
    return b64encode(resp["CiphertextBlob"]).decode("ascii")


def _build_audit_event(action: str, session_id: str, **extra: Any) -> dict[str, Any]:
    """Return a structured audit event dict. No PHI in values — IDs only."""
    return {
        "action": action,
        "session_id": session_id,
        "ts": _now_iso(),
        **extra,
    }


_DISPLAY_TEXT: dict[str, str] = {
    "eligible": "Good news — your {payer} plan came back active and in-network.",
    "ineligible": "Heads up — your {payer} plan came back as inactive (likely lapsed or out-of-network).",
    "needs_manual_review": "I couldn't get a clean answer from {payer} just now — our admin team will follow up shortly.",
    "secondary_required": "Your primary {payer} coverage needs a secondary plan on file before I can finish verifying.",
    "wc_auto_eap": "Your {payer} coverage looks like workers' comp, auto, or EAP — our team handles those manually and will follow up.",
    "self_pay": "Got it — you're on self-pay.",
    "no_insurance": "Got it — no insurance on file, we'll continue self-pay.",
    "medicaid_not_accepted": "We're not able to accept {payer} plans, but we'd be glad to see you on a self-pay / out-of-network basis.",
}


def _build_verify_result(outcome: str, payer_name: str) -> dict[str, Any]:
    """Pack the eligibility outcome into the VerifyResult shape respond reads.

    The respond node's `post_verify_offer_booking` scene speaks the
    `display_text` field verbatim, so this is the single place that turns
    a structured outcome into patient-facing language.
    """
    template = _DISPLAY_TEXT.get(outcome) or "I've finished checking your {payer} coverage."
    return {
        "ok": outcome != "needs_manual_review",
        "eligible": outcome == "eligible",
        "payer": payer_name or None,
        "coverage": {},
        "display_text": template.format(payer=payer_name or "your insurance"),
        "error": None,
    }


# ---------------------------------------------------------------------------
# 1. verify_insurance — CLAIM.MD eligibility probe
# ---------------------------------------------------------------------------

@traced(run_type="tool", name="verify_insurance")
def verify_insurance(state: State) -> dict[str, Any]:
    """Probe CLAIM.MD and map the response to one of 7 discriminated outcomes.

    Outcome vocabulary (mirrors InsuranceFields.outcome in state.py):
      eligible            — active coverage, not a carve-out payer
      secondary_required  — primary ineligible but secondary payer listed
      ineligible          — no active coverage, no secondary
      wc_auto_eap         — workers comp / auto / EAP regardless of eligibility
      needs_manual_review — CLAIM.MD returned needs_review/pending, OR 5xx/timeout
      no_insurance        — caller said self-pay or payer field is absent
      self_pay            — payer resolved to the synthetic SELF payer

    Returns partial state only. No PHI is persisted here.
    """
    ins = state.get("insurance_fields") or {}
    session_id = state.get("session_id", "?")

    # --- no_insurance / self_pay check (pure field inspection, no NL) ------
    if state.get("payment_path") == "self_pay" or not ins.get("payer_name"):
        logger.info("action verify_insurance session=%s outcome=no_insurance", session_id)
        return {
            "insurance_fields": {**ins, "outcome": "no_insurance"},
            "verify_result": _build_verify_result("no_insurance", ""),
            "last_action": "verify_insurance",
            "last_node": "verify_insurance",
            "audit_event": _build_audit_event("verify_insurance", session_id, outcome="no_insurance"),
        }

    # --- declined-plan short-circuit (e.g. Medicaid) -----------------------
    # We don't accept these plans. Decline clearly and pivot to self-pay
    # rather than calling CLAIM.MD or routing to admin manual review. Routed
    # by the planner to offer_self_pay (same machinery as `ineligible`).
    declined = is_declined_payer(ins.get("payer_name") or "")
    if declined:
        logger.info("action verify_insurance session=%s outcome=medicaid_not_accepted payer=%r",
                    session_id, declined)
        return {
            "insurance_fields": {**ins, "outcome": "medicaid_not_accepted"},
            "verify_result": _build_verify_result("medicaid_not_accepted", declined),
            "last_action": "verify_insurance",
            "last_node": "verify_insurance",
            "audit_event": _build_audit_event("verify_insurance", session_id,
                                              outcome="medicaid_not_accepted"),
        }

    first_name = (ins.get("first_name") or "").strip()
    last_name  = (ins.get("last_name") or "").strip()
    dob        = (ins.get("dob_yyyymmdd") or "").strip()
    payer_name = (ins.get("payer_name") or "").strip()
    # CLAIM.MD is whitespace-sensitive; normalize to the clean card form.
    from ....data.identifiers import normalize_member_id
    member_id  = normalize_member_id(ins.get("member_id"))

    valid_dob = _validate_dob(dob)
    if not valid_dob:
        # Invalid DOB means we can't verify — treat as needs_manual_review so
        # the flow doesn't silently accept a booking with a bad date.
        logger.warning("action verify_insurance session=%s invalid_dob=%s", session_id, dob)
        return {
            "insurance_fields": {**ins, "outcome": "needs_manual_review"},
            "verify_result": _build_verify_result("needs_manual_review", payer_name),
            "last_action": "verify_insurance",
            "last_node": "verify_insurance",
            "audit_event": _build_audit_event("verify_insurance", session_id,
                                               outcome="needs_manual_review", reason="invalid_dob"),
        }

    payer = resolve_payer_id(payer_name)
    if payer is None:
        # Unknown payer — route to manual review rather than rejecting caller.
        logger.warning("action verify_insurance session=%s unknown_payer=%r", session_id, payer_name)
        return {
            "insurance_fields": {**ins, "outcome": "needs_manual_review"},
            "verify_result": _build_verify_result("needs_manual_review", payer_name),
            "last_action": "verify_insurance",
            "last_node": "verify_insurance",
            "audit_event": _build_audit_event("verify_insurance", session_id,
                                               outcome="needs_manual_review", reason="unknown_payer"),
        }

    # Synthetic SELF payer → self_pay outcome.
    if payer.id == "SELF":
        logger.info("action verify_insurance session=%s outcome=self_pay", session_id)
        return {
            "insurance_fields": {**ins, "outcome": "self_pay"},
            "verify_result": _build_verify_result("self_pay", payer.name),
            "payment_path": "self_pay",
            "last_action": "verify_insurance",
            "last_node": "verify_insurance",
            "audit_event": _build_audit_event("verify_insurance", session_id, outcome="self_pay"),
        }

    # WC / auto / EAP — flag immediately regardless of eligibility response.
    if payer.id in _WC_AUTO_EAP_IDS:
        logger.info("action verify_insurance session=%s outcome=wc_auto_eap payer=%s",
                    session_id, payer.id)
        return {
            "insurance_fields": {**ins, "outcome": "wc_auto_eap"},
            "verify_result": _build_verify_result("wc_auto_eap", payer.name),
            "last_action": "verify_insurance",
            "last_node": "verify_insurance",
            "audit_event": _build_audit_event("verify_insurance", session_id,
                                               outcome="wc_auto_eap", payer_id=payer.id),
        }

    # --- CLAIM.MD call ---------------------------------------------------
    raw_response_id: str = ""
    outcome: str
    try:
        resp = signed_post("/internal/insurance/verify", {
            "patient_id": f"{first_name.lower()}-{last_name.lower()}-{valid_dob}",
            "first_name": first_name, "last_name": last_name,
            "dob": valid_dob, "payer_id": payer.id, "member_id": member_id,
        })
        raw_response_id = str(resp.get("response_id") or resp.get("checkUuid") or "")
        raw_status  = str(resp.get("status") or "").strip().lower()
        eligible    = raw_status in _ELIGIBLE_STATES
        has_secondary = bool(resp.get("secondary_payer") or resp.get("secondaryPayer"))
        needs_review_flag = str(resp.get("coverage_status") or "").lower() in (
            "needs_review", "pending", "needs_manual_review"
        )
        # CLAIM.MD transient failures come back as status="unknown" with an
        # `elig.error` array (e.g. code 42 "Unable to respond at current
        # time"). Don't punish the caller with a self-pay offer when the
        # carrier is just unavailable — escalate to admin verification.
        elig_block = (resp.get("raw") or {}).get("elig") if isinstance(resp.get("raw"), dict) else None
        upstream_error = bool(elig_block and elig_block.get("error"))
        unknown_status = raw_status in ("", "unknown", "error", "timeout")

        if needs_review_flag or upstream_error or unknown_status:
            outcome = "needs_manual_review"
        elif eligible:
            outcome = "eligible"
        elif has_secondary:
            outcome = "secondary_required"
        else:
            outcome = "ineligible"

    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code
        if 400 <= status_code < 500:
            # 4xx with needs_review / pending in body → manual review
            try:
                body = exc.response.json()
            except Exception:
                body = {}
            flag = str(body.get("coverage_status") or body.get("status") or "").lower()
            outcome = "needs_manual_review" if flag in ("needs_review", "pending") else "ineligible"
        else:
            # 5xx — treat as needs_manual_review, never reject the caller
            outcome = "needs_manual_review"
        logger.warning("action verify_insurance session=%s http_error=%d outcome=%s",
                       session_id, status_code, outcome)

    except Exception as exc:
        logger.exception("action verify_insurance session=%s unexpected_error", session_id)
        outcome = "needs_manual_review"

    # Best-effort audit row to gateway (non-critical path).
    # Send the patient PHI the gateway needs to render the admin
    # /admin/insurance-checks row with name/DOB/member ID. Phone/email
    # come from booking_fields when the visitor has already shared them.
    bk = state.get("booking_fields") or {}
    try:
        gateway_post("/internal/coverage/record", {
            "first_name": first_name, "last_name": last_name,
            "date_of_birth": f"{valid_dob[:4]}-{valid_dob[4:6]}-{valid_dob[6:8]}",
            "payer_name": payer.name, "payer_id": payer.id,
            "member_id": member_id,
            "phone": (bk.get("phone") or "").strip(),
            "email": (bk.get("email") or "").strip(),
            "eligible": (outcome == "eligible"),
            "coverage_status": outcome,
            "source": state.get("agent_source", "chat-agent"),
        })
    except Exception:
        logger.warning("verify_insurance coverage_record_audit failed", exc_info=True)

    logger.info("action verify_insurance session=%s outcome=%s payer=%s",
                session_id, outcome, payer.name)

    return {
        "insurance_fields": {**ins, "outcome": outcome, "raw_response_id": raw_response_id},
        "verify_result": _build_verify_result(outcome, payer.name),
        "last_action": "verify_insurance",
        "last_node": "verify_insurance",
        "audit_event": _build_audit_event("verify_insurance", session_id,
                                           outcome=outcome, payer_id=payer.id,
                                           raw_response_id=raw_response_id),
    }


# ---------------------------------------------------------------------------
# 2. send_coverage_result — terminal node for coverage_only intent
# ---------------------------------------------------------------------------

@traced(run_type="tool", name="send_coverage_result")
def send_coverage_result(state: State) -> dict[str, Any]:
    """Queue a generic email outbox row and mark the session done.

    Used when the caller's intent was `coverage_only` (just "do I have
    coverage?" — not a booking). The actual email send happens in the
    retry Lambda; we only write the outbox row here.

    HIPAA — minimum-necessary:
      Insurance eligibility = sensitive financial PHI. The outbound email
      contains NO payer name, NO eligible flag, NO copay/coverage numbers.
      It is a generic "we've reviewed, our team will call you" ack only.

    Channel policy:
      EMAIL only (SMS disabled). If the patient has no email address, skip
      enqueuing entirely — do NOT enqueue an sms row.
      # TODO(sms): enqueue channel="sms" row when SMS is enabled.

    Best-effort: never raises. On any error, log and return done=True.
    """
    session_id = state.get("session_id", "?")
    ins = state.get("insurance_fields") or {}
    bk  = state.get("booking_fields") or {}

    email = (bk.get("email") or "").strip()

    # Skip if no email — do NOT write an sms row (SMS disabled).
    if not email:
        logger.info("send_coverage_result session=%s outcome=skipped_no_email", session_id)
        return {
            "scene": "coverage_only_result",
            "done": True,
            "last_action": "send_coverage_result",
            "audit_event": _build_audit_event("send_coverage_result", session_id,
                                               outcome="skipped_no_email"),
        }

    notif_id  = str(uuid.uuid4())
    now_iso_z = _now_iso_z()
    now_epoch = _now_epoch()

    # Generic acknowledgement — NO insurance specifics in the email body.
    # The Lambda wraps this structured content in the branded HTML template.
    payload_json = json.dumps({
        "subject":    "We've reviewed your insurance — Brighter Tomorrow Therapy",
        "heading":    "We've reviewed your insurance",
        "paragraphs": [
            "Hi there, thanks for reaching out to Brighter Tomorrow Therapy.",
            "We've reviewed your insurance benefits and our care team will go over "
            "the specifics with you when we connect.",
        ],
    })

    # Canonical outbox row — matches Go EnqueueNotification schema exactly.
    row: dict[str, Any] = {
        "notification_id":    notif_id,
        "created_at":         now_iso_z,
        "channel":            "email",
        "recipient":          email,           # table is CMK-encrypted at rest
        "payload_ciphertext": "",              # filled below after KMS
        "status":             "pending",
        "next_retry_at":      now_iso_z,
        "attempt_count":      0,
        "dedupe_key":         f"{session_id}:email:coverage_result",
        "ttl":                now_epoch + 30 * 86400,
    }

    try:
        row["payload_ciphertext"] = _kms_encrypt_payload(payload_json)
    except Exception:
        logger.exception("send_coverage_result session=%s kms_encrypt_payload_failed", session_id)
        # Best-effort: return done rather than blocking the session.
        return {
            "scene": "coverage_only_result",
            "done": True,
            "last_action": "send_coverage_result",
            "audit_event": _build_audit_event("send_coverage_result", session_id,
                                               outcome="kms_error"),
        }

    try:
        ddb = boto3.client("dynamodb", region_name=_AWS_REGION_INS)
        ddb.put_item(
            TableName=_OUTBOX_TABLE,
            Item=_to_ddb_item(row),
            # Idempotent: skip if same notification_id already queued.
            ConditionExpression="attribute_not_exists(notification_id)",
        )
        logger.info(
            "send_coverage_result session=%s notification_id=%s channel=email outcome=queued",
            session_id, notif_id,
        )
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
            # Already queued — idempotent OK.
            logger.info("send_coverage_result session=%s notification_id=%s already_queued",
                        session_id, notif_id)
        else:
            logger.exception("send_coverage_result session=%s outbox_write_failed", session_id)
            # Non-fatal: coverage result is best-effort; don't block the call.
    except Exception:
        logger.exception("send_coverage_result session=%s outbox_write_failed", session_id)
        # Non-fatal: coverage result is best-effort; don't block the call.

    return {
        "scene": "coverage_only_result",
        "done": True,
        "last_action": "send_coverage_result",
        "audit_event": _build_audit_event("send_coverage_result", session_id,
                                           notification_id=notif_id, channel="email"),
    }


# ---------------------------------------------------------------------------
# Shared DDB serialisation helper (used by booking.py too via re-export).
# ---------------------------------------------------------------------------

def _to_ddb_item(d: dict[str, Any]) -> dict[str, dict]:
    """Shallow-convert a plain Python dict to DDB AttributeValue format.

    Supports str, int, float, bool, None, and nested dict/list (best-effort).
    Production code should use the DDB resource client (high-level) or
    boto3.dynamodb.types.TypeSerializer for production depth — this helper
    is intentionally lightweight for the outbox rows whose shape is fixed.
    """
    from boto3.dynamodb.types import TypeSerializer
    ser = TypeSerializer()
    return {k: ser.serialize(v) for k, v in d.items() if v is not None}


# Convenience re-export so booking.py can use _to_ddb_item without a
# circular import.
__all__ = [
    "verify_insurance",
    "send_coverage_result",
    "_to_ddb_item",
    "_build_audit_event",
    "_now_iso",
    "_now_iso_z",
    "_now_epoch",
    "_kms_encrypt_payload",
    "_OUTBOX_TABLE",
]

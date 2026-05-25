"""
notifications_retry/handler.py — EventBridge-triggered retry worker.

Fires every 60 s. Scans bt-notifications-outbox GSI1 for rows with
status IN (pending, retry) AND next_retry_at <= now, then dispatches
each by channel (sms | email only — s3_phi is retired).

HIPAA constraints:
- NO PHI logged.  Only notification_id, channel, status, attempt_count.
- Payload stored as KMS-encrypted blob in DDB; decrypted in-memory only.
- Optimistic locking via ConditionExpression prevents double-send when two
  concurrent invocations race (Lambda concurrency limit = 2, but still safe).
- After 6 attempts the row is marked dead and no further delivery is tried.
"""
from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List

import boto3
from botocore.exceptions import ClientError

from encryption import decrypt_payload
from senders import (
    ServiceUnavailableError,
    TerminalError,
    send_email,
    send_sms,
)

# ── Module-level clients (reused across warm invocations) ────────────────────
_ddb = boto3.resource("dynamodb")

# Structured JSON logging — no PHI in any field.
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(message)s")
log = logging.getLogger("notifications_retry")

OUTBOX_TABLE = os.environ["OUTBOX_TABLE"]
# Custom CW namespace for the dead-row metric the alarm watches.
CW_NAMESPACE = "bt/Notifications"

_cw = boto3.client("cloudwatch")

# Exponential back-off schedule (seconds): attempt 1→2, 2→3, …, 5→6.
# Index = attempt_count before this send (0-based).
BACKOFF_SCHEDULE = [60, 300, 1800, 7200, 21600, 86400]
MAX_ATTEMPTS = 6

# TTL for sent rows: 30 days from now (auto-purge via DDB TTL attribute).
SENT_TTL_SECONDS = 30 * 86400

# Canonical set of supported channels. s3_phi is retired.
_SUPPORTED_CHANNELS = {"email", "sms"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _now_epoch() -> int:
    return int(time.time())


def _backoff(attempt_count: int) -> int:
    """Return retry delay in seconds for the given (0-based) attempt index."""
    idx = min(attempt_count, len(BACKOFF_SCHEDULE) - 1)
    return BACKOFF_SCHEDULE[idx]


def _next_retry_at(attempt_count: int) -> str:
    """Return ISO timestamp for next retry attempt."""
    delay = _backoff(attempt_count)
    epoch = _now_epoch() + delay
    return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _query_pending(table: Any, status: str, now_iso: str) -> List[Dict[str, Any]]:
    """
    Query GSI1 for rows with the given status where next_retry_at <= now.
    GSI1 PK=status, SK=next_retry_at (string comparison works for ISO8601).
    """
    response = table.query(
        IndexName="GSI1-retry-scan",
        KeyConditionExpression="#s = :s AND next_retry_at <= :now",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": status, ":now": now_iso},
    )
    return response.get("Items", [])


def _mark_sent(table: Any, row: Dict[str, Any], now_iso: str) -> None:
    """
    Mark row sent. ConditionExpression ensures attempt_count hasn't changed
    since we read the row — prevents double-send if two workers raced.
    """
    table.update_item(
        Key={"notification_id": row["notification_id"], "created_at": row["created_at"]},
        UpdateExpression=(
            "SET #st = :sent, sent_at = :now, #ttl = :ttl "
            "REMOVE next_retry_at, last_error"
        ),
        ConditionExpression=(
            "attribute_exists(notification_id) AND attempt_count = :prev"
        ),
        ExpressionAttributeNames={"#st": "status", "#ttl": "ttl"},
        ExpressionAttributeValues={
            ":sent": "sent",
            ":now": now_iso,
            ":prev": row.get("attempt_count", 0),
            ":ttl": _now_epoch() + SENT_TTL_SECONDS,
        },
    )


def _mark_retry(table: Any, row: Dict[str, Any], error: str, now_iso: str) -> None:
    """Increment attempt_count and schedule next retry with exponential back-off."""
    prev_count = int(row.get("attempt_count", 0))
    new_count = prev_count + 1
    table.update_item(
        Key={"notification_id": row["notification_id"], "created_at": row["created_at"]},
        UpdateExpression=(
            "SET #st = :retry, attempt_count = :new, "
            "next_retry_at = :nra, last_error = :err"
        ),
        ConditionExpression=(
            "attribute_exists(notification_id) AND attempt_count = :prev"
        ),
        ExpressionAttributeNames={"#st": "status"},
        ExpressionAttributeValues={
            ":retry": "retry",
            ":new": new_count,
            ":nra": _next_retry_at(new_count),
            ":err": error[:500],
            ":prev": prev_count,
        },
    )


def _mark_dead(table: Any, row: Dict[str, Any], error: str) -> None:
    """Terminal failure — mark dead; no further retries."""
    table.update_item(
        Key={"notification_id": row["notification_id"], "created_at": row["created_at"]},
        UpdateExpression="SET #st = :dead, last_error = :err",
        ExpressionAttributeNames={"#st": "status"},
        ExpressionAttributeValues={
            ":dead": "dead",
            ":err": error[:500],
        },
    )
    # Emit custom metric so the CloudWatch alarm can fire.
    _emit_dead_metric()


def _mark_service_unavailable(table: Any, row: Dict[str, Any], reason: str) -> None:
    """Channel intentionally disabled — terminal but distinct from `dead`.

    No retries, no dead-row metric. Admin dashboard can list these for
    manual follow-up; flipping the env flag re-enables fresh sends but
    does NOT auto-retry these existing rows (intentional — admin decides).
    """
    table.update_item(
        Key={"notification_id": row["notification_id"], "created_at": row["created_at"]},
        UpdateExpression="SET #st = :sv, last_error = :err",
        ExpressionAttributeNames={"#st": "status"},
        ExpressionAttributeValues={
            ":sv": "service_unavailable",
            ":err": reason[:500],
        },
    )


def _emit_dead_metric() -> None:
    """Publish one unit to the custom metric bt/Notifications/DeadRows."""
    try:
        _cw.put_metric_data(
            Namespace=CW_NAMESPACE,
            MetricData=[{
                "MetricName": "DeadRows",
                "Value": 1,
                "Unit": "Count",
            }],
        )
    except Exception as exc:
        # Don't fail the whole invocation over a metrics call.
        log.warning(json.dumps({"event": "metric_emit_failed", "error": str(exc)}))


def _process_row(table: Any, row: Dict[str, Any], now_iso: str) -> None:
    """Dispatch one outbox row by channel; update status on success/failure."""
    nid = row.get("notification_id", "?")
    channel = row.get("channel", "")
    attempt_count = int(row.get("attempt_count", 0))

    # Guard 1: channel must be a supported canonical value.
    # s3_phi rows (legacy) and any unknown channel are marked dead immediately.
    if channel not in _SUPPORTED_CHANNELS:
        _mark_dead(table, row, f"channel_retired_or_unknown:{channel}")
        log.warning(json.dumps({
            "event": "row_dead_bad_channel",
            "notification_id": nid,
            "channel": channel,
        }))
        return

    # Guard 2: hard cap — after MAX_ATTEMPTS tries, force dead.
    if attempt_count >= MAX_ATTEMPTS:
        _mark_dead(table, row, f"max_attempts={MAX_ATTEMPTS} exceeded")
        log.info(json.dumps({
            "event": "row_dead_max_attempts",
            "notification_id": nid,
            "channel": channel,
            "attempt_count": attempt_count,
        }))
        return

    # Guard 3: both payload_ciphertext and recipient must be present and non-empty.
    # Use .get() — never bracket-access — so missing keys never raise KeyError.
    payload_ciphertext = row.get("payload_ciphertext") or ""
    recipient = row.get("recipient") or ""
    if not payload_ciphertext or not recipient:
        _mark_dead(table, row, "malformed_row_missing_payload_or_recipient")
        log.warning(json.dumps({
            "event": "row_dead_malformed",
            "notification_id": nid,
            "channel": channel,
        }))
        return

    # Guard 4: decrypt payload. KMS ClientError here is terminal (key policy / permissions).
    try:
        payload = decrypt_payload(payload_ciphertext)
    except ClientError as exc:
        code = exc.response["Error"]["Code"]
        _mark_dead(table, row, f"kms_error:{code}")
        log.error(json.dumps({
            "event": "kms_decrypt_failed",
            "notification_id": nid,
            "channel": channel,
            "error_code": code,
        }))
        return

    # Guard 5: dispatch by channel and handle send-level outcomes.
    try:
        if channel == "sms":
            send_sms(row, payload)
        elif channel == "email":
            send_email(row, payload)
        # No else branch needed — channel was validated in Guard 1.

        # Success path — optimistic lock may raise ConditionalCheckFailed
        # (another worker already marked it sent).  Silently ignore.
        try:
            _mark_sent(table, row, now_iso)
        except ClientError as exc:
            if exc.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise

        log.info(json.dumps({
            "event": "row_sent",
            "notification_id": nid,
            "channel": channel,
            "attempt_count": attempt_count + 1,
        }))

    except ServiceUnavailableError as exc:
        # Channel intentionally disabled (e.g. Twilio/SES off). Mark distinct
        # from `dead` so admins can list these for manual follow-up and the
        # dead-row alarm doesn't fire on infrastructure choices.
        _mark_service_unavailable(table, row, str(exc))
        log.info(json.dumps({
            "event": "row_service_unavailable",
            "notification_id": nid,
            "channel": channel,
            "reason": str(exc),
        }))

    except TerminalError as exc:
        _mark_dead(table, row, str(exc))
        log.warning(json.dumps({
            "event": "row_dead_terminal",
            "notification_id": nid,
            "channel": channel,
            "attempt_count": attempt_count,
        }))

    except Exception as exc:
        # Transient / retryable error
        try:
            _mark_retry(table, row, str(exc), now_iso)
        except ClientError as ddb_exc:
            if ddb_exc.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise
        log.warning(json.dumps({
            "event": "row_retry",
            "notification_id": nid,
            "channel": channel,
            "attempt_count": attempt_count,
            "error": type(exc).__name__,
        }))


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    EventBridge schedule entry point.  Runs every 60 s.

    Two separate queries (DDB can't OR on PK in a single query):
      1. status=pending, next_retry_at <= now
      2. status=retry,   next_retry_at <= now
    """
    table = _ddb.Table(OUTBOX_TABLE)
    now_iso = _now_iso()
    rows: List[Dict[str, Any]] = []

    for status in ("pending", "retry"):
        rows.extend(_query_pending(table, status, now_iso))

    log.info(json.dumps({"event": "scan_complete", "rows_found": len(rows), "at": now_iso}))

    for row in rows:
        # Belt-and-suspenders: any unhandled exception from _process_row
        # (including failures inside _mark_dead/_mark_retry) must never
        # propagate out of the loop and abort the remaining batch.
        try:
            _process_row(table, row, now_iso)
        except Exception as exc:
            # Log only safe identifiers — NO PHI, no full exception message.
            log.error(json.dumps({
                "event": "row_processing_unhandled",
                "notification_id": row.get("notification_id", "?"),
                "channel": row.get("channel", "?"),
                "error": type(exc).__name__,
            }))
            # Continue draining the rest of the batch.

    return {"statusCode": 200, "processed": len(rows)}

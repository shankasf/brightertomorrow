"""
jane_ical_sync — pulls iCal feeds from Jane and upserts into bt-jane-events.

Triggered by EventBridge every 15 minutes.

HIPAA note: description fields from iCal may contain PHI.  We upsert them
into DDB (CMK-encrypted at rest) but NEVER log their content.  The only
per-event log line is the structured summary at the end of each staffId run.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Set, Tuple

import boto3
from icalendar import Calendar, Event as VEvent

# ── Module-level clients (reused across warm invocations) ────────────────────
_sm = boto3.client("secretsmanager")
_ddb = boto3.resource("dynamodb")

# Cache secrets in module scope for warm-start efficiency.
# Key: staff_id (int), Value: {"apptsUrl": str, "shiftsUrl": str}
_secret_cache: Dict[int, Dict[str, str]] = {}

LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=LOG_LEVEL,
    format="%(message)s",  # structured JSON lines below; no extra prefix
)
log = logging.getLogger("jane_ical_sync")

JANE_EVENTS_TABLE = os.environ["JANE_EVENTS_TABLE"]
STAFF_IDS: List[int] = [int(s) for s in os.environ["STAFF_IDS"].split(",")]

# 90-day TTL extension past event end
TTL_EXTENSION_SECONDS = 90 * 24 * 3600

# HTTP timeout for fetching iCal feeds (seconds)
FETCH_TIMEOUT_S = 20


# ── Helpers ──────────────────────────────────────────────────────────────────

def _get_secret(staff_id: int) -> Dict[str, str]:
    """Return cached or freshly-fetched secret for a staff ID."""
    if staff_id not in _secret_cache:
        secret_id = f"bt/jane-ical/staff-{staff_id}"
        resp = _sm.get_secret_value(SecretId=secret_id)
        _secret_cache[staff_id] = json.loads(resp["SecretString"])
    return _secret_cache[staff_id]


def _fetch_ical(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "bt-jane-sync/1.0"})
    with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_S) as resp:
        return resp.read()


def _dt_to_utc_iso(dt_val: Any) -> Optional[str]:
    """Convert icalendar dt/date value to UTC ISO 8601 string, or None."""
    if dt_val is None:
        return None
    # icalendar may return a vDatetime or date/datetime
    if hasattr(dt_val, "dt"):
        dt_val = dt_val.dt
    if isinstance(dt_val, datetime):
        if dt_val.tzinfo is None:
            # Assume UTC if no tz — Jane usually provides tz-aware
            dt_val = dt_val.replace(tzinfo=timezone.utc)
        return dt_val.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    # date (all-day event) — treat as midnight UTC
    from datetime import date as date_type
    if isinstance(dt_val, date_type):
        return datetime(dt_val.year, dt_val.month, dt_val.day, tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return None


def _parse_events(raw: bytes, event_type: str) -> List[Dict[str, Any]]:
    """Parse raw iCal bytes; return list of event dicts."""
    cal = Calendar.from_ical(raw)
    events = []
    for component in cal.walk():
        if component.name != "VEVENT":
            continue
        uid = str(component.get("UID", ""))
        start_iso = _dt_to_utc_iso(component.get("DTSTART"))
        end_iso = _dt_to_utc_iso(component.get("DTEND"))
        if not uid or not start_iso:
            continue
        events.append({
            "uid": uid,
            "startISO": start_iso,
            "endISO": end_iso or start_iso,
            "summary": str(component.get("SUMMARY", "")),
            "description": str(component.get("DESCRIPTION", "")),  # PHI — DDB CMK encrypts at rest
            "location": str(component.get("LOCATION", "")),
            "status": str(component.get("STATUS", "")),
            "type": event_type,
        })
    return events


def _content_hash(ev: Dict[str, Any]) -> str:
    """Stable hash over the fields a re-poll might change.

    fetchedAt and ttl are excluded — they drift every run by design.
    """
    payload = json.dumps(
        {
            "startISO": ev["startISO"],
            "endISO": ev["endISO"],
            "summary": ev["summary"],
            "description": ev["description"],
            "location": ev["location"],
            "status": ev["status"],
            "type": ev["type"],
        },
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _ttl_from_end_iso(end_iso: str) -> int:
    """epoch seconds = endISO + 90 days."""
    try:
        dt = datetime.strptime(end_iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        dt = datetime.now(timezone.utc)
    return int((dt + timedelta(seconds=TTL_EXTENSION_SECONDS)).timestamp())


def _sync_staff(staff_id: int, table: Any) -> Tuple[int, int, int, int]:
    """Sync one staff member.

    Returns (appts_fetched, shifts_fetched, written, deleted). Rows whose
    contentHash already matches Jane are skipped — the dominant cost driver
    when the schedule re-polls unchanged calendars.
    """
    secret = _get_secret(staff_id)
    appts_url: str = secret["apptsUrl"]
    shifts_url: str = secret["shiftsUrl"]

    # Fetch both feeds in parallel
    with ThreadPoolExecutor(max_workers=2) as ex:
        fut_appts = ex.submit(_fetch_ical, appts_url)
        fut_shifts = ex.submit(_fetch_ical, shifts_url)
        raw_appts = fut_appts.result()
        raw_shifts = fut_shifts.result()

    appts = _parse_events(raw_appts, "appointment")
    shifts = _parse_events(raw_shifts, "shift")
    all_events = appts + shifts

    pk = f"staff#{staff_id}"
    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    seen_uids: Set[str] = set()

    # Single pass over existing rows for this staff member. We need this scan
    # anyway for orphan deletion below — adding contentHash to the projection
    # lets the upsert loop skip no-op puts at zero extra read cost.
    existing_hash: Dict[str, str] = {}  # sk -> contentHash
    existing_rows: List[Dict[str, Any]] = []
    paginator_kwargs: Dict[str, Any] = {
        "KeyConditionExpression": "pk = :pk",
        "ExpressionAttributeValues": {":pk": pk},
        "ProjectionExpression": "pk, sk, uid, endISO, contentHash",
    }
    last_key = None
    while True:
        if last_key:
            paginator_kwargs["ExclusiveStartKey"] = last_key
        resp = table.query(**paginator_kwargs)
        for row in resp.get("Items", []):
            existing_rows.append(row)
            sk_val = row.get("sk")
            h = row.get("contentHash")
            if sk_val and h:
                existing_hash[sk_val] = h
        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break

    # Upsert only changed events.
    written = 0
    with table.batch_writer() as batch:
        for ev in all_events:
            uid = ev["uid"]
            seen_uids.add(uid)
            sk = f"{ev['type']}#{ev['startISO']}#{uid}"
            content_hash = _content_hash(ev)
            if existing_hash.get(sk) == content_hash:
                continue
            item: Dict[str, Any] = {
                "pk": pk,
                "sk": sk,
                "staffId": staff_id,
                "type": ev["type"],
                "startISO": ev["startISO"],
                "endISO": ev["endISO"],
                "summary": ev["summary"],
                "description": ev["description"],  # PHI — stored encrypted
                "location": ev["location"],
                "status": ev["status"],
                "uid": uid,
                "contentHash": content_hash,
                "fetchedAt": fetched_at,
                "ttl": _ttl_from_end_iso(ev["endISO"]),
            }
            batch.put_item(Item=item)
            written += 1

    # Delete orphaned future events (Jane removed/moved them).
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    deleted = 0
    for row in existing_rows:
        row_uid = row.get("uid", "")
        row_end = row.get("endISO", "")
        if row_uid not in seen_uids and row_end > now_iso:
            table.delete_item(Key={"pk": row["pk"], "sk": row["sk"]})
            deleted += 1

    return len(appts), len(shifts), written, deleted


# ── Lambda entry point ───────────────────────────────────────────────────────

def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    table = _ddb.Table(JANE_EVENTS_TABLE)
    overall_start = time.monotonic()
    results = []

    for staff_id in STAFF_IDS:
        t0 = time.monotonic()
        try:
            appts, shifts, written, deleted = _sync_staff(staff_id, table)
            duration_ms = int((time.monotonic() - t0) * 1000)
            # Structured log — no PHI content
            log.info(json.dumps({
                "staffId": staff_id,
                "appts": appts,
                "shifts": shifts,
                "written": written,
                "skipped": (appts + shifts) - written,
                "deleted": deleted,
                "durationMs": duration_ms,
                "status": "ok",
            }))
            results.append({
                "staffId": staff_id,
                "ok": True,
                "appts": appts,
                "shifts": shifts,
                "written": written,
                "deleted": deleted,
            })
        except Exception as exc:
            duration_ms = int((time.monotonic() - t0) * 1000)
            # Log error without PHI — exc may contain URL fragment but not patient data
            log.error(json.dumps({
                "staffId": staff_id,
                "status": "error",
                "error": type(exc).__name__,
                "durationMs": duration_ms,
            }))
            results.append({"staffId": staff_id, "ok": False, "error": type(exc).__name__})

    total_ms = int((time.monotonic() - overall_start) * 1000)
    log.info(json.dumps({"event": "sync_complete", "totalMs": total_ms, "staffCount": len(STAFF_IDS)}))
    return {"statusCode": 200, "results": results}

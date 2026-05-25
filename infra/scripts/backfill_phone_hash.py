#!/usr/bin/env python3
"""
Backfill phoneHash onto existing bt-main booking records.

Scans the bt-main table (or --table override) and for every item that has:
  - appointmentTime  (present + non-empty)
  - phone            (present + non-empty string)
  - phoneHash        (ABSENT — idempotent, skip if already set)

...it computes phoneHash and writes it via UpdateItem.

PHONE HASH ALGORITHM (must match the Go implementation exactly):
  normalize = re.sub(r"\\D", "", phone)
  if len(normalize) > 10:
      normalize = normalize[-10:]          # keep last 10 digits (US numbers)
  phoneHash = hashlib.sha256(normalize.encode()).hexdigest()  # lowercase hex

HIPAA notes:
  - Raw phone numbers are never printed.
  - PK is PATIENT#<emailHash> — already a hash, safe to log for debugging.
  - SK is logged only when --debug is passed (it's a record-type prefix + timestamp,
    no raw PHI, but omitted by default to minimise log surface).

Usage:
  # Dry run — reports counts only, no writes:
  python3 backfill_phone_hash.py --dry-run

  # Real run:
  python3 backfill_phone_hash.py

  # Override table (e.g. staging):
  python3 backfill_phone_hash.py --table bt-main-staging

  # Enable PK/SK debug logging:
  python3 backfill_phone_hash.py --dry-run --debug

Requires:
  AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (or an IAM role with
  dynamodb:Scan + dynamodb:UpdateItem on the target table).
"""
from __future__ import annotations

import argparse
import hashlib
import re
import sys

import boto3
from boto3.dynamodb.conditions import Attr

# ── Table name from infra/lib/constants.ts DDB_TABLE constant ─────────────────
DEFAULT_TABLE = "bt-main"
REGION = "us-east-1"

print(f"[info] default table name from constants.ts: {DEFAULT_TABLE!r}")


def compute_phone_hash(phone: str) -> str:
    """
    Normalise phone to last 10 digits then SHA-256 hex.
    Must stay in sync with the Go implementation in gateway/.
    """
    digits = re.sub(r"\D", "", phone)
    if len(digits) > 10:
        digits = digits[-10:]
    return hashlib.sha256(digits.encode()).hexdigest()


def backfill(table_name: str, dry: bool, debug: bool) -> None:
    ddb = boto3.resource("dynamodb", region_name=REGION)
    table = ddb.Table(table_name)

    scanned = 0
    skipped_no_phone = 0
    skipped_already_hashed = 0
    updated = 0
    errors = 0

    scan_kwargs: dict = {
        # Only pull items that have appointmentTime; phone/phoneHash filtering
        # happens in Python so we don't need a complex FilterExpression that
        # would burn extra RCUs on items we'd discard anyway.
        "FilterExpression": Attr("appointmentTime").exists(),
    }

    last_key = None
    while True:
        if last_key:
            scan_kwargs["ExclusiveStartKey"] = last_key

        resp = table.scan(**scan_kwargs)
        items = resp.get("Items", [])
        scanned += len(items)

        for item in items:
            phone = item.get("phone", "")
            if not isinstance(phone, str) or not phone.strip():
                skipped_no_phone += 1
                continue

            if "phoneHash" in item:
                skipped_already_hashed += 1
                continue

            pk = item["PK"]
            sk = item["SK"]
            ph = compute_phone_hash(phone.strip())

            if debug:
                print(f"  {'DRY ' if dry else ''}update PK={pk!r} SK={sk!r} phoneHash={ph[:8]}...")

            if not dry:
                try:
                    table.update_item(
                        Key={"PK": pk, "SK": sk},
                        UpdateExpression="SET phoneHash = :h",
                        ExpressionAttributeValues={":h": ph},
                        # Guard: only write if phoneHash still absent (race-safe)
                        ConditionExpression=Attr("phoneHash").not_exists(),
                    )
                    updated += 1
                except ddb.meta.client.exceptions.ConditionalCheckFailedException:
                    # Another process already wrote it between our scan and update
                    skipped_already_hashed += 1
                except Exception as exc:  # noqa: BLE001
                    print(f"[error] failed to update PK={pk!r}: {exc}", file=sys.stderr)
                    errors += 1
            else:
                updated += 1  # count as "would update"

        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break

    mode = "DRY RUN" if dry else "REAL RUN"
    print(
        f"\n[{mode}] table={table_name!r}\n"
        f"  scanned (with appointmentTime):  {scanned}\n"
        f"  skipped (phone absent/empty):    {skipped_no_phone}\n"
        f"  skipped (phoneHash already set): {skipped_already_hashed}\n"
        f"  {'would update' if dry else 'updated'}:                    {updated}\n"
        f"  errors:                          {errors}"
    )
    if errors:
        sys.exit(1)


def main() -> None:
    ap = argparse.ArgumentParser(description="Backfill phoneHash on bt-main booking records.")
    ap.add_argument(
        "--table",
        default=DEFAULT_TABLE,
        help=f"DynamoDB table name (default: {DEFAULT_TABLE!r})",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Scan and count only; do not write anything.",
    )
    ap.add_argument(
        "--debug",
        action="store_true",
        help="Print PK/SK for each item that would be updated (no raw PHI printed).",
    )
    args = ap.parse_args()
    backfill(args.table, dry=args.dry_run, debug=args.debug)


if __name__ == "__main__":
    main()

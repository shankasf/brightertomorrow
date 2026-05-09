#!/usr/bin/env python3
"""
One-off migration: copies PHI rows from Postgres (k3d) into DynamoDB bt-main.

Reads from the bt namespace via a port-forward to the Postgres service, and
writes to DynamoDB using the AWS credentials in the environment.

Tables migrated:
  bt.chat_sessions + bt.chat_messages  →  PATIENT#anon-{session_uuid} / CHAT#{ts}
  bt.contact_submissions               →  PATIENT#contact-{id} / PROFILE + CHAT#{ts}

Patient/appointment/provider/insurance/metrics tables did not exist in
Postgres — they start fresh in DynamoDB.

Usage:
  export AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION=us-east-1
  export PG_URL='postgres://app:...@localhost:5432/app'  # via port-forward
  python3 migrate_phi_to_ddb.py --dry-run
  python3 migrate_phi_to_ddb.py
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import timezone

import boto3
import psycopg

TABLE = os.environ.get("DDB_TABLE", "bt-main")
PG_URL = os.environ["PG_URL"]


def iso(ts) -> str:
    return ts.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def migrate_chats(cur, table, dry: bool) -> int:
    cur.execute("""
        SELECT cm.id, cm.session_id, cm.role, cm.content, cm.created_at, cs.visitor_id
        FROM bt.chat_messages cm
        JOIN bt.chat_sessions cs ON cs.id = cm.session_id
        WHERE cs.purged_at IS NULL
        ORDER BY cm.created_at
    """)
    count = 0
    for _mid, sess, role, content, ts, _visitor in cur.fetchall():
        item = {
            "PK": f"PATIENT#anon-{sess}",
            "SK": f"CHAT#{iso(ts)}",
            "GSI1PK": "ENTITY#CHAT",
            "GSI1SK": iso(ts),
            "session_id": str(sess),
            "role": role,
            "text": content,
        }
        if dry:
            print(f"DRY chat: {item['PK']} / {item['SK']} role={role}")
        else:
            table.put_item(Item=item)
        count += 1
    return count


def migrate_contacts(cur, table, dry: bool) -> int:
    cur.execute("""
        SELECT id, full_name, email, phone, subject, message, created_at
        FROM bt.contact_submissions WHERE purged_at IS NULL
    """)
    count = 0
    for cid, full_name, email, phone, subject, message, ts in cur.fetchall():
        profile = {
            "PK": f"PATIENT#contact-{cid}",
            "SK": "PROFILE",
            "GSI1PK": "ENTITY#PATIENT",
            "GSI1SK": iso(ts),
            "source": "contact_submission",
            "full_name": full_name,
            "email": email,
            "phone": phone,
        }
        msg = {
            "PK": f"PATIENT#contact-{cid}",
            "SK": f"CHAT#{iso(ts)}",
            "GSI1PK": "ENTITY#CHAT",
            "GSI1SK": iso(ts),
            "role": "user",
            "text": f"{subject or ''}\n\n{message or ''}",
        }
        if dry:
            print(f"DRY contact: id={cid}")
        else:
            table.put_item(Item=profile)
            table.put_item(Item=msg)
        count += 1
    return count


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    ddb = boto3.resource("dynamodb").Table(TABLE)

    with psycopg.connect(PG_URL) as pg, pg.cursor() as cur:
        chats = migrate_chats(cur, ddb, args.dry_run)
        contacts = migrate_contacts(cur, ddb, args.dry_run)

    print(f"\nDone. chats={chats} contacts={contacts} dry={args.dry_run}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

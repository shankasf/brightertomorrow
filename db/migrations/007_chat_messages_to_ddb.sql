-- 007_chat_messages_to_ddb.sql
--
-- HIPAA: chat transcripts contain PHI (patients can volunteer name/DOB/insurance
-- in free chat). Postgres on Hostinger has no BAA — so chat content moves to
-- DynamoDB (AWS, BAA, KMS-encrypted) under PK=CHAT#<session_id>.
--
-- Postgres keeps only non-PHI counters on bt.chat_sessions so the dashboard
-- and the idle sweeper can run without joining the (now-removed) message
-- table.
--
-- Performed in two phases:
--   Phase A (this migration) — add counter columns; backfill from chat_messages;
--                              drop the audit trigger that prevented deletes.
--   Phase B (`scripts/migrate_chat_messages_to_ddb.go`) — copy rows to DDB,
--                              then a follow-up DROP TABLE migration runs.
--
-- This migration is safe to apply with the gateway running: the new columns
-- have NULL/zero defaults so the old write path keeps working until the
-- gateway code is updated to populate them.

BEGIN;

ALTER TABLE bt.chat_sessions
    ADD COLUMN IF NOT EXISTS message_count   INTEGER     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ;

-- Backfill from existing rows so the dashboard and the idle sweeper continue
-- to show accurate numbers during the cutover window.
UPDATE bt.chat_sessions s
SET message_count   = COALESCE(c.cnt, 0),
    last_message_at = c.last_at
FROM (
    SELECT session_id, count(*)::int AS cnt, max(created_at) AS last_at
    FROM bt.chat_messages
    GROUP BY session_id
) c
WHERE c.session_id = s.id
  AND (s.message_count = 0 AND s.last_message_at IS NULL);

CREATE INDEX IF NOT EXISTS chat_sessions_last_message_idx
    ON bt.chat_sessions (last_message_at DESC NULLS LAST)
    WHERE purged_at IS NULL;

COMMIT;

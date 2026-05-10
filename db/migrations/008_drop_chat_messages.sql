-- 008_drop_chat_messages.sql
--
-- Final phase of the chat-PHI migration. By the time this runs:
--   * gateway writes new turns straight to DynamoDB
--   * 007 added bt.chat_sessions.{message_count,last_message_at} counters
--   * scripts/migrate_chat_messages_to_ddb (or equivalent) backfilled DDB
--   * admin transcript view + AI history endpoint both read from DDB
-- so the Postgres table holds nothing the system relies on.
--
-- This migration drops the table along with its retention/audit machinery.

BEGIN;

-- The phi_audit trigger on bt.chat_messages would fail when the table
-- disappears; remove it first.
DROP TRIGGER IF EXISTS phi_audit_chat_msg ON bt.chat_messages;

-- Retention helpers (added in 002a) referenced bt.chat_messages directly;
-- the equivalent on DDB is the 10-year retainUntil attribute we set on
-- every ChatTurn item, swept by an external job (TODO: add lambda).
DROP TABLE IF EXISTS bt.chat_messages CASCADE;

-- The bt.phi_due_for_purge view also referenced chat_messages; rebuild it
-- without that branch. Surviving members are contact_submissions and
-- intake_pointers (chat sessions are still listed because the session
-- shell remains in Postgres even though messages don't).
DROP VIEW IF EXISTS bt.phi_due_for_purge;

CREATE OR REPLACE VIEW bt.phi_due_for_purge AS
    SELECT 'contact_submissions'::text AS source, id::text AS row_id, retain_until
    FROM bt.contact_submissions
    WHERE purged_at IS NULL AND retain_until <= now()
    UNION ALL
    SELECT 'chat_sessions'::text, id::text, retain_until
    FROM bt.chat_sessions
    WHERE purged_at IS NULL AND retain_until <= now()
    UNION ALL
    SELECT 'intake_pointers'::text, id::text, retain_until
    FROM bt.intake_pointers
    WHERE purged_at IS NULL AND retain_until <= now();

COMMIT;

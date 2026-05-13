-- 013_twilio_chat_source.sql
--
-- Adds Twilio PSTN as a first-class chat-session source so phone calls show
-- up in the admin /admin/chat dashboard alongside the website chatbot and
-- browser voice widget.
--
-- HIPAA notes:
--   * No PHI is added by this migration. external_ref stores a Twilio CallSid
--     (e.g. "CA…32 hex chars"), which is a routing identifier, not PHI.
--     Voice transcripts continue to live in DynamoDB (KMS-encrypted, AWS BAA);
--     this Postgres row stays a non-PHI pointer.
--   * The existing chat_sessions.purged_at + retain_until columns already
--     cover §164.530(j) retention (10-year clock); CallSid is metadata that
--     follows the same lifecycle.
--
-- Migration is idempotent: dropping the CHECK constraint by name and
-- re-creating it with the wider set works on a fresh apply OR an environment
-- that already has the older 2-value version from 006_voice_source_and_insurance_checks.sql.

BEGIN;

-- 1. Relax the source check to recognize Twilio PSTN.
--
--   chat         — website text chatbot (existing default)
--   voice        — browser WebRTC voice widget (existing)
--   voice-phone  — Twilio Media Streams PSTN call (NEW)
ALTER TABLE bt.chat_sessions
    DROP CONSTRAINT IF EXISTS chat_sessions_source_check;

ALTER TABLE bt.chat_sessions
    ADD CONSTRAINT chat_sessions_source_check
        CHECK (source IN ('chat', 'voice', 'voice-phone'));

-- 2. Twilio CallSid cross-reference. Lets admin correlate a chat-sessions
--    row to a specific call in Twilio Console (logs, recordings if ever
--    enabled, billing). Nullable so non-Twilio rows aren't affected.
ALTER TABLE bt.chat_sessions
    ADD COLUMN IF NOT EXISTS external_ref TEXT;

CREATE INDEX IF NOT EXISTS chat_sessions_external_ref_idx
    ON bt.chat_sessions (external_ref)
    WHERE external_ref IS NOT NULL;

COMMIT;

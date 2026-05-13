-- 014_chat_session_source_unify.sql
--
-- Unify the source enum across every admin-facing table.
--
-- Before this migration, bt.chat_sessions.source used a short alias enum
-- {chat, voice, voice-phone}, while bt.intake_pointers, bt.callback_requests,
-- and bt.insurance_checks all stored the canonical agent identifiers
-- {chat-agent, voice-agent, voice-phone, website-*}. The same logical
-- conversation therefore produced two different source strings depending on
-- which table you queried, and the admin UI had two parallel filter
-- vocabularies.
--
-- After this migration, every table speaks the canonical enum:
--
--   chat        ──▶ chat-agent       (website text chatbot)
--   voice       ──▶ voice-agent      (browser WebRTC voice widget)
--   voice-phone ──▶ voice-phone      (Twilio Media Streams PSTN — unchanged)
--
-- HIPAA / audit notes:
--   • No PHI touched. source is a routing/origin label, not patient data.
--   • Existing chat_sessions rows are renamed in-place; the trigger-managed
--     created_at / retain_until / purged_at lifecycle is unaffected.
--   • Sweep is idempotent: rerunning on a fresh DB or one that already has
--     the canonical values is a no-op.
--
-- Roll-forward strategy:
--   The migration runs in a single transaction. The gateway code change
--   that writes the canonical values lands together with this file in the
--   same commit. Order on apply:
--     1. Deploy gateway code (Tilt rebuilds bt-gateway image).
--     2. Apply this migration — any in-flight INSERTs during the brief
--        cutover use the column DEFAULT (which we set to the canonical
--        value first), so chat_stream.go inserts never see a constraint
--        miss. voice.go INSERTs that hardcoded 'voice' now write
--        'voice-agent' as soon as the new pod is serving.

BEGIN;

-- 1. Drop the old constraint so we can mutate freely. Use IF EXISTS so the
--    migration is idempotent against an already-migrated DB.
ALTER TABLE bt.chat_sessions
    DROP CONSTRAINT IF EXISTS chat_sessions_source_check;

-- 2. Change the default first. New INSERTs from older gateway pods that
--    omit `source` then land with the canonical value automatically — no
--    constraint miss during the rolling cutover.
ALTER TABLE bt.chat_sessions
    ALTER COLUMN source SET DEFAULT 'chat-agent';

-- 3. Rename existing rows to the canonical enum. voice-phone already
--    matches; the two-row UPDATE covers chat and voice only.
UPDATE bt.chat_sessions
   SET source = CASE source
                  WHEN 'chat'  THEN 'chat-agent'
                  WHEN 'voice' THEN 'voice-agent'
                  ELSE source
                END
 WHERE source IN ('chat', 'voice');

-- 4. Re-add the constraint with the canonical enum. Anyone trying to
--    INSERT one of the legacy aliases from this point on gets a clean
--    constraint error rather than silently splitting the vocabulary again.
ALTER TABLE bt.chat_sessions
    ADD CONSTRAINT chat_sessions_source_check
        CHECK (source IN ('chat-agent', 'voice-agent', 'voice-phone'));

-- 5. Sanity-check the rename: zero rows should remain on the legacy enum.
--    The DO block raises if any did (would indicate a concurrent INSERT
--    racing the UPDATE — unlikely but worth catching).
DO $$
DECLARE
    legacy_count INTEGER;
BEGIN
    SELECT count(*) INTO legacy_count
      FROM bt.chat_sessions
     WHERE source IN ('chat', 'voice');
    IF legacy_count > 0 THEN
        RAISE EXCEPTION
            '014_chat_session_source_unify: % rows still on legacy enum after rename',
            legacy_count;
    END IF;
END $$;

COMMIT;

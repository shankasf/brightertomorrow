-- 006_voice_source_and_insurance_checks.sql
--
-- Adds:
--   1. bt.chat_sessions.source             — distinguishes 'chat' vs 'voice'.
--   2. bt.insurance_checks                 — append-only history of every
--                                            real-time eligibility check (CLAIM.MD).
--                                            Non-PHI metadata only; the full
--                                            patient record lives in DynamoDB
--                                            via intake_pointers.ddb_pk/sk.
--   3. RLS-safe defaults so existing rows are backfilled to 'chat'.
--
-- HIPAA: every coverage-check attempt is now recorded with WHO (admin_user_id
-- when initiated by an admin, else NULL for self-service flows), WHEN, and
-- SOURCE — satisfying §164.312(b) audit-trail expectations even for the
-- pre-intake "are you covered?" funnel where no intake row gets written.

BEGIN;

-- 1. Source column on chat_sessions (chat | voice).
ALTER TABLE bt.chat_sessions
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'chat'
        CHECK (source IN ('chat', 'voice'));

-- Existing rows are all chat (the only source before this migration).
-- The DEFAULT clause already takes care of new inserts.

CREATE INDEX IF NOT EXISTS chat_sessions_source_idx
    ON bt.chat_sessions (source, started_at DESC);

-- 2. Insurance check history.
-- One row per CLAIM.MD eligibility call, regardless of whether an intake
-- form was eventually submitted. Joins to intake_pointers via
-- submission_uuid when the same submission proceeded to a full intake.
CREATE TABLE IF NOT EXISTS bt.insurance_checks (
    id              BIGSERIAL PRIMARY KEY,
    check_uuid      UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    submission_uuid UUID,                                                       -- FK to intake_pointers.submission_uuid (nullable)
    chat_session_id UUID REFERENCES bt.chat_sessions(id) ON DELETE SET NULL,    -- when source='chat-agent' or 'voice-agent'
    source          TEXT NOT NULL CHECK (source IN (
                        'chat-agent',
                        'voice-agent',
                        'website-coverage-flow',
                        'website-booking-flow',
                        'admin'
                    )),
    payer_name      TEXT,                                                       -- canonical payer (e.g. 'Aetna')
    payer_id        TEXT,                                                       -- CLAIM.MD payer code
    coverage_status TEXT NOT NULL,                                              -- 'eligible' | 'ineligible' | 'needs_review' | 'verification_error'
    eligible        BOOLEAN NOT NULL DEFAULT FALSE,
    email_hash      CHAR(64) NOT NULL,                                          -- joins to PHI in DDB; never email plaintext here
    -- WHO initiated the check.
    -- For self-service flows (website / chat / voice) this is the visitor; we
    -- track them via visitor_id / chat_session_id, not admin_user_id.
    -- For admin-initiated checks (manual eligibility re-run from admin UI,
    -- if added later), admin_user_id is populated.
    admin_user_id   BIGINT REFERENCES bt.admin_users(id) ON DELETE SET NULL,
    visitor_id      TEXT,                                                       -- chat/voice visitor cookie value (non-PHI)
    ip_address      INET,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    purged_at       TIMESTAMPTZ                                                 -- HIPAA 10-year retention; purge job sets this
);

CREATE INDEX IF NOT EXISTS insurance_checks_created_idx
    ON bt.insurance_checks (created_at DESC);
CREATE INDEX IF NOT EXISTS insurance_checks_source_idx
    ON bt.insurance_checks (source, created_at DESC);
CREATE INDEX IF NOT EXISTS insurance_checks_status_idx
    ON bt.insurance_checks (coverage_status, created_at DESC);
CREATE INDEX IF NOT EXISTS insurance_checks_email_hash_idx
    ON bt.insurance_checks (email_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS insurance_checks_submission_uuid_idx
    ON bt.insurance_checks (submission_uuid)
    WHERE submission_uuid IS NOT NULL;

-- 10-year retention column maintained by the same trigger that handles
-- intake_pointers and chat_sessions.
ALTER TABLE bt.insurance_checks
    ADD COLUMN IF NOT EXISTS retain_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS insurance_checks_retain_idx
    ON bt.insurance_checks (retain_until)
    WHERE purged_at IS NULL;

-- Reuse the existing set_retain_until() trigger if it exists.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = 'set_retain_until' AND n.nspname = 'bt'
    ) THEN
        EXECUTE 'DROP TRIGGER IF EXISTS set_retain_insurance_checks ON bt.insurance_checks';
        EXECUTE 'CREATE TRIGGER set_retain_insurance_checks
                 BEFORE INSERT ON bt.insurance_checks
                 FOR EACH ROW EXECUTE FUNCTION bt.set_retain_until()';
    END IF;
END$$;

COMMIT;

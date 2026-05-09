-- =============================================================================
-- 005 — Intake pointer table (PHI-of-record moves to DynamoDB bt-main)
--
-- All identifying intake fields (name, DOB, phone, email, address, sex,
-- insurance) live in CMK-encrypted DynamoDB. Postgres only holds a non-PHI
-- pointer row that admin lists/dashboards can query without ever loading PHI.
--
-- Why a separate table (not reshaping contact_submissions):
--   /v1/contact (generic website form) still writes to contact_submissions
--   and is out of scope for this migration. Isolating intake into its own
--   pointer table keeps that flow untouched.
-- =============================================================================

BEGIN;
SET search_path = bt, public;

-- ---------------------------------------------------------------------------
-- 1. POINTER TABLE — no PHI ever lands here
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bt.intake_pointers (
  id                BIGSERIAL PRIMARY KEY,
  submission_uuid   UUID         NOT NULL UNIQUE,
  email_hash        CHAR(64)     NOT NULL,           -- sha256(lower(trim(email)))
  flow              TEXT         NOT NULL CHECK (flow IN ('booking','coverage')),
  payment_method    TEXT         NOT NULL CHECK (payment_method IN ('insurance','self_pay')),
  status            TEXT         NOT NULL,            -- eligible | self_pay | needs_review | verification_error
  source            TEXT         NOT NULL,            -- website-booking-flow | website-coverage-flow | chat-agent | voice-agent
  ddb_table         TEXT         NOT NULL DEFAULT 'bt-main',
  ddb_pk            TEXT         NOT NULL,            -- PATIENT#<email_hash>
  ddb_sk            TEXT         NOT NULL,            -- INTAKE#<submission_uuid>
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  retain_until      TIMESTAMPTZ,                       -- set by trigger
  purged_at         TIMESTAMPTZ                        -- set when DDB record deleted
);

COMMENT ON TABLE  bt.intake_pointers IS
  'Non-PHI pointer rows for intake submissions. PHI lives in DynamoDB bt-main (CMK-encrypted).';
COMMENT ON COLUMN bt.intake_pointers.email_hash IS
  'sha256 of normalised email; lets admin link multiple submissions per patient without storing the email itself.';
COMMENT ON COLUMN bt.intake_pointers.ddb_pk IS
  'DynamoDB partition key for the corresponding PHI record.';

CREATE INDEX IF NOT EXISTS intake_pointers_created_idx
  ON bt.intake_pointers (created_at DESC);

CREATE INDEX IF NOT EXISTS intake_pointers_status_idx
  ON bt.intake_pointers (status, created_at DESC);

CREATE INDEX IF NOT EXISTS intake_pointers_email_hash_idx
  ON bt.intake_pointers (email_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS intake_pointers_retain_idx
  ON bt.intake_pointers (retain_until) WHERE purged_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. RETENTION TRIGGER — Nevada NRS 629.051 (10 years)
--    Reuses bt.set_retain_until() from migration 002.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bt.set_retain_until() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'contact_submissions' THEN
    NEW.retain_until := NEW.created_at + INTERVAL '10 years';
  ELSIF TG_TABLE_NAME = 'chat_sessions' THEN
    NEW.retain_until := NEW.started_at + INTERVAL '10 years';
  ELSIF TG_TABLE_NAME = 'intake_pointers' THEN
    NEW.retain_until := NEW.created_at + INTERVAL '10 years';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_retain_intake_pointers ON bt.intake_pointers;
CREATE TRIGGER set_retain_intake_pointers
  BEFORE INSERT ON bt.intake_pointers
  FOR EACH ROW EXECUTE FUNCTION bt.set_retain_until();

-- ---------------------------------------------------------------------------
-- 3. AUDIT TRIGGER — §164.312(b)
--    The pointer row itself is non-PHI, but inserts/updates/deletes still
--    need an immutable audit trail (who created/purged which submission).
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS phi_audit_intake_pointers ON bt.intake_pointers;
CREATE TRIGGER phi_audit_intake_pointers
  AFTER INSERT OR UPDATE OR DELETE ON bt.intake_pointers
  FOR EACH ROW EXECUTE FUNCTION bt.phi_audit_trigger();

-- ---------------------------------------------------------------------------
-- 4. PURGE-DUE VIEW — extend the existing view used by the cleanup CronJob
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW bt.phi_due_for_purge AS
  SELECT 'contact_submissions' AS source,
         id::TEXT              AS row_id,
         retain_until
  FROM bt.contact_submissions
  WHERE retain_until < now() AND purged_at IS NULL
UNION ALL
  SELECT 'chat_sessions',
         id::TEXT,
         retain_until
  FROM bt.chat_sessions
  WHERE retain_until < now() AND purged_at IS NULL
UNION ALL
  SELECT 'intake_pointers',
         id::TEXT,
         retain_until
  FROM bt.intake_pointers
  WHERE retain_until < now() AND purged_at IS NULL;

-- ---------------------------------------------------------------------------
-- 5. ANONYMISATION PROCEDURE
--    For an intake pointer the gateway also has to delete the DynamoDB item.
--    This proc only marks the pointer purged; the gateway/cleanup job is
--    responsible for the DDB DeleteItem and must be called first.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE PROCEDURE bt.mark_intake_pointer_purged(p_id BIGINT)
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE bt.intake_pointers SET purged_at = now()
  WHERE id = p_id AND purged_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'intake_pointer % not found or already purged', p_id;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. GRANTS
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON bt.intake_pointers TO app;
GRANT USAGE, SELECT ON SEQUENCE bt.intake_pointers_id_seq TO app;
GRANT SELECT ON bt.intake_pointers TO bt_readonly;

COMMIT;

-- =============================================================================
-- HIPAA Technical Safeguards Migration
-- 45 CFR Part 164 — Security Rule
-- Nevada NRS 629.051 (10-year medical records retention)
-- =============================================================================

BEGIN;
SET search_path = bt, public;

-- ---------------------------------------------------------------------------
-- 1. AUDIT LOG — §164.312(b)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bt.phi_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  event_time  TIMESTAMPTZ NOT NULL DEFAULT now(),
  table_name  TEXT        NOT NULL,
  operation   TEXT        NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
  row_id      TEXT        NOT NULL,
  actor       TEXT        NOT NULL DEFAULT current_user,
  app_user    TEXT,
  old_values  JSONB,
  new_values  JSONB
);

CREATE INDEX IF NOT EXISTS phi_audit_log_time_idx  ON bt.phi_audit_log (event_time DESC);
CREATE INDEX IF NOT EXISTS phi_audit_log_table_idx ON bt.phi_audit_log (table_name, event_time DESC);
CREATE INDEX IF NOT EXISTS phi_audit_log_row_idx   ON bt.phi_audit_log (table_name, row_id);

REVOKE UPDATE, DELETE, TRUNCATE ON bt.phi_audit_log FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. AUDIT TRIGGER FUNCTION
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bt.phi_audit_trigger() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_row_id TEXT;
  v_old    JSONB;
  v_new    JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row_id := OLD.id::TEXT;
    v_old    := to_jsonb(OLD);
    v_new    := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    v_row_id := NEW.id::TEXT;
    v_old    := NULL;
    -- Redact high-sensitivity fields from the audit record itself
    v_new    := to_jsonb(NEW) - 'content' - 'message';
  ELSE
    v_row_id := NEW.id::TEXT;
    v_old    := to_jsonb(OLD) - 'content' - 'message';
    v_new    := to_jsonb(NEW) - 'content' - 'message';
  END IF;

  INSERT INTO bt.phi_audit_log (
    table_name, operation, row_id, actor,
    app_user, old_values, new_values
  ) VALUES (
    TG_TABLE_NAME, TG_OP, v_row_id, current_user,
    current_setting('app.user', true),
    v_old, v_new
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach triggers to all PHI tables
DROP TRIGGER IF EXISTS phi_audit_contact    ON bt.contact_submissions;
CREATE TRIGGER phi_audit_contact
  AFTER INSERT OR UPDATE OR DELETE ON bt.contact_submissions
  FOR EACH ROW EXECUTE FUNCTION bt.phi_audit_trigger();

DROP TRIGGER IF EXISTS phi_audit_chat_msg   ON bt.chat_messages;
CREATE TRIGGER phi_audit_chat_msg
  AFTER INSERT OR UPDATE OR DELETE ON bt.chat_messages
  FOR EACH ROW EXECUTE FUNCTION bt.phi_audit_trigger();

DROP TRIGGER IF EXISTS phi_audit_chat_sess  ON bt.chat_sessions;
CREATE TRIGGER phi_audit_chat_sess
  AFTER INSERT OR UPDATE OR DELETE ON bt.chat_sessions
  FOR EACH ROW EXECUTE FUNCTION bt.phi_audit_trigger();

DROP TRIGGER IF EXISTS phi_audit_newsletter ON bt.newsletter_subscribers;
CREATE TRIGGER phi_audit_newsletter
  AFTER INSERT OR UPDATE OR DELETE ON bt.newsletter_subscribers
  FOR EACH ROW EXECUTE FUNCTION bt.phi_audit_trigger();

-- ---------------------------------------------------------------------------
-- 3. DATA RETENTION — §164.530(j) + Nevada NRS 629.051 (10 years)
--    Can't use GENERATED ALWAYS AS for timestamptz arithmetic (not immutable).
--    Use a trigger to set retain_until on INSERT instead.
-- ---------------------------------------------------------------------------

ALTER TABLE bt.contact_submissions
  ADD COLUMN IF NOT EXISTS retain_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS purged_at    TIMESTAMPTZ;

ALTER TABLE bt.chat_sessions
  ADD COLUMN IF NOT EXISTS retain_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS purged_at    TIMESTAMPTZ;

ALTER TABLE bt.newsletter_subscribers
  ADD COLUMN IF NOT EXISTS unsubscribed_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;

-- Backfill existing rows
UPDATE bt.contact_submissions SET retain_until = created_at + INTERVAL '10 years'
  WHERE retain_until IS NULL;

UPDATE bt.chat_sessions SET retain_until = started_at + INTERVAL '10 years'
  WHERE retain_until IS NULL;

-- Retention trigger function
CREATE OR REPLACE FUNCTION bt.set_retain_until() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'contact_submissions' THEN
    NEW.retain_until := NEW.created_at + INTERVAL '10 years';
  ELSIF TG_TABLE_NAME = 'chat_sessions' THEN
    NEW.retain_until := NEW.started_at + INTERVAL '10 years';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_retain_contact ON bt.contact_submissions;
CREATE TRIGGER set_retain_contact
  BEFORE INSERT ON bt.contact_submissions
  FOR EACH ROW EXECUTE FUNCTION bt.set_retain_until();

DROP TRIGGER IF EXISTS set_retain_chat ON bt.chat_sessions;
CREATE TRIGGER set_retain_chat
  BEFORE INSERT ON bt.chat_sessions
  FOR EACH ROW EXECUTE FUNCTION bt.set_retain_until();

CREATE INDEX IF NOT EXISTS contact_retain_idx
  ON bt.contact_submissions (retain_until) WHERE purged_at IS NULL;

CREATE INDEX IF NOT EXISTS chat_retain_idx
  ON bt.chat_sessions (retain_until) WHERE purged_at IS NULL;

CREATE INDEX IF NOT EXISTS newsletter_active_idx
  ON bt.newsletter_subscribers (created_at) WHERE unsubscribed_at IS NULL;

-- ---------------------------------------------------------------------------
-- 4. MINIMUM NECESSARY — §164.502(b)
--    Remove IP + user_agent from contact_submissions.
--    No documented clinical need. IP + name + health-context = linkable PHI.
-- ---------------------------------------------------------------------------

ALTER TABLE bt.contact_submissions
  DROP COLUMN IF EXISTS ip,
  DROP COLUMN IF EXISTS user_agent;

-- ---------------------------------------------------------------------------
-- 5. DATABASE ROLES — §164.312(a)(1) Unique User Identification
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bt_readonly') THEN
    CREATE ROLE bt_readonly;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bt_auditor') THEN
    CREATE ROLE bt_auditor;
  END IF;
END $$;

GRANT USAGE ON SCHEMA bt TO bt_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA bt TO bt_readonly;

GRANT USAGE ON SCHEMA bt TO bt_auditor;
GRANT SELECT ON bt.phi_audit_log TO bt_auditor;

-- App user cannot read its own audit log (append-only via trigger only)
REVOKE SELECT ON bt.phi_audit_log FROM app;

-- ---------------------------------------------------------------------------
-- 6. ANONYMISATION PROCEDURES — Nevada NRS 603A right-to-erasure
-- ---------------------------------------------------------------------------

CREATE OR REPLACE PROCEDURE bt.anonymise_contact(p_id BIGINT)
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE bt.contact_submissions SET
    full_name = '[REDACTED]',
    email     = 'redacted-' || p_id || '@redacted.invalid',
    phone     = NULL,
    subject   = NULL,
    message   = '[REDACTED PER DELETION REQUEST]',
    purged_at = now()
  WHERE id = p_id AND purged_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'contact_submission % not found or already purged', p_id;
  END IF;
END;
$$;

CREATE OR REPLACE PROCEDURE bt.anonymise_chat_session(p_session_id UUID)
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE bt.chat_messages
    SET content = '[REDACTED PER DELETION REQUEST]'
  WHERE session_id = p_session_id;

  UPDATE bt.chat_sessions SET
    visitor_id = NULL,
    purged_at  = now()
  WHERE id = p_session_id AND purged_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'chat_session % not found or already purged', p_session_id;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. EXPIRY VIEW — used by the weekly CronJob to find rows due for purging
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
  WHERE retain_until < now() AND purged_at IS NULL;

COMMIT;

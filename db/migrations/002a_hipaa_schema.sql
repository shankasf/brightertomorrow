-- HIPAA schema changes (run as app user)
BEGIN;
SET search_path = bt, public;

-- 1. AUDIT LOG
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

-- 2. AUDIT TRIGGER FUNCTION
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
    v_new    := to_jsonb(NEW) - 'content' - 'message';
  ELSE
    v_row_id := NEW.id::TEXT;
    v_old    := to_jsonb(OLD) - 'content' - 'message';
    v_new    := to_jsonb(NEW) - 'content' - 'message';
  END IF;

  INSERT INTO bt.phi_audit_log (
    table_name, operation, row_id, actor, app_user, old_values, new_values
  ) VALUES (
    TG_TABLE_NAME, TG_OP, v_row_id, current_user,
    current_setting('app.user', true), v_old, v_new
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

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

-- 3. RETENTION COLUMNS + TRIGGERS
ALTER TABLE bt.contact_submissions
  ADD COLUMN IF NOT EXISTS retain_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS purged_at    TIMESTAMPTZ;

ALTER TABLE bt.chat_sessions
  ADD COLUMN IF NOT EXISTS retain_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS purged_at    TIMESTAMPTZ;

ALTER TABLE bt.newsletter_subscribers
  ADD COLUMN IF NOT EXISTS unsubscribed_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;

UPDATE bt.contact_submissions
  SET retain_until = created_at + INTERVAL '10 years' WHERE retain_until IS NULL;

UPDATE bt.chat_sessions
  SET retain_until = started_at + INTERVAL '10 years' WHERE retain_until IS NULL;

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

-- 4. MINIMUM NECESSARY — remove IP + user_agent (linkable PHI, no clinical need)
ALTER TABLE bt.contact_submissions
  DROP COLUMN IF EXISTS ip,
  DROP COLUMN IF EXISTS user_agent;

-- 5. ANONYMISATION PROCEDURES
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

-- 6. EXPIRY VIEW for CronJob
CREATE OR REPLACE VIEW bt.phi_due_for_purge AS
  SELECT 'contact_submissions' AS source, id::TEXT AS row_id, retain_until
  FROM bt.contact_submissions WHERE retain_until < now() AND purged_at IS NULL
UNION ALL
  SELECT 'chat_sessions', id::TEXT, retain_until
  FROM bt.chat_sessions WHERE retain_until < now() AND purged_at IS NULL;

COMMIT;

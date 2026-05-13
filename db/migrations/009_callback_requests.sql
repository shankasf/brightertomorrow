-- =============================================================================
-- 009 — Callback requests table
--
-- A callback request is a much lighter-weight thing than an intake / booking:
-- the visitor just wants someone from the practice to phone them back. We
-- collect ONLY first name, last name, phone, and a one-line reason — no DOB,
-- no email, no home address, no insurance details. None of those fields are
-- needed to phone someone back, so we don't ask, don't store, don't pretend.
--
-- Why a separate table (not contact_submissions, not intake_pointers):
--   * contact_submissions requires email (NOT NULL) — we don't collect it.
--   * intake_pointers has CHECK (flow IN ('booking','coverage')) and requires
--     payment_method, both of which don't apply to callbacks.
--   * Keeping callbacks isolated means the appointment-booking admin view
--     stays clean (only real bookings / coverage checks).
-- =============================================================================

BEGIN;
SET search_path = bt, public;

CREATE TABLE IF NOT EXISTS bt.callback_requests (
  id           BIGSERIAL    PRIMARY KEY,
  first_name   TEXT         NOT NULL,
  last_name    TEXT         NOT NULL,
  phone        TEXT         NOT NULL,
  reason       TEXT         NOT NULL,
  source       TEXT         NOT NULL,            -- chat-agent | voice-agent | website
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  retain_until TIMESTAMPTZ,                       -- set by trigger
  purged_at    TIMESTAMPTZ
);

COMMENT ON TABLE bt.callback_requests IS
  'Lightweight "please phone me back" requests. Only the four fields needed to call someone back: name, phone, and a one-line reason.';

CREATE INDEX IF NOT EXISTS callback_requests_created_idx
  ON bt.callback_requests (created_at DESC);

CREATE INDEX IF NOT EXISTS callback_requests_retain_idx
  ON bt.callback_requests (retain_until) WHERE purged_at IS NULL;

-- Retention trigger — Nevada NRS 629.051 (10 years), same as other intake.
CREATE OR REPLACE FUNCTION bt.set_retain_until() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'contact_submissions' THEN
    NEW.retain_until := NEW.created_at + INTERVAL '10 years';
  ELSIF TG_TABLE_NAME = 'chat_sessions' THEN
    NEW.retain_until := NEW.started_at + INTERVAL '10 years';
  ELSIF TG_TABLE_NAME = 'intake_pointers' THEN
    NEW.retain_until := NEW.created_at + INTERVAL '10 years';
  ELSIF TG_TABLE_NAME = 'callback_requests' THEN
    NEW.retain_until := NEW.created_at + INTERVAL '10 years';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_retain_callback_requests ON bt.callback_requests;
CREATE TRIGGER set_retain_callback_requests
  BEFORE INSERT ON bt.callback_requests
  FOR EACH ROW EXECUTE FUNCTION bt.set_retain_until();

-- HIPAA §164.312(b) — append-only audit on insert/update/delete.
DROP TRIGGER IF EXISTS phi_audit_callback_requests ON bt.callback_requests;
CREATE TRIGGER phi_audit_callback_requests
  AFTER INSERT OR UPDATE OR DELETE ON bt.callback_requests
  FOR EACH ROW EXECUTE FUNCTION bt.phi_audit_trigger();

-- Add to the purge-due view so the existing retention CronJob purges these
-- alongside the other tables.
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
  WHERE retain_until < now() AND purged_at IS NULL
UNION ALL
  SELECT 'callback_requests',
         id::TEXT,
         retain_until
  FROM bt.callback_requests
  WHERE retain_until < now() AND purged_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON bt.callback_requests TO app;
GRANT USAGE, SELECT ON SEQUENCE bt.callback_requests_id_seq TO app;
GRANT SELECT ON bt.callback_requests TO bt_readonly;

COMMIT;

-- =============================================================================
-- 025 — Structured contact-form fields
--
-- The public website contact form (/v1/contact → bt.contact_submissions)
-- historically flattened most of its fields into a single free-text `message`
-- blob (preferred contact method, best time, therapist requested, etc.).
-- Admins could not see those values as discrete fields.
--
-- This migration adds one nullable column per remaining form field so every
-- value the visitor types is stored discretely — NULL when left blank — and
-- can be rendered field-by-field in the admin portal.
--
-- HIPAA note: these are logistics/contact fields, not clinical content. The
-- free-text body the visitor types ("Other, please describe below") continues
-- to live in `message` and stays gated behind the logged detail endpoint
-- (§164.502(b) minimum necessary). No new audit triggers are required — the
-- table-level retention/anonymization machinery already covers these columns.
-- New columns inherit the existing table grants for the `app` role.
-- =============================================================================

BEGIN;
SET search_path = bt, public;

ALTER TABLE bt.contact_submissions
  ADD COLUMN IF NOT EXISTS first_name               TEXT,
  ADD COLUMN IF NOT EXISTS last_name                TEXT,
  ADD COLUMN IF NOT EXISTS help_topic               TEXT,
  ADD COLUMN IF NOT EXISTS other_describe           TEXT,
  ADD COLUMN IF NOT EXISTS preferred_contact_method TEXT,
  ADD COLUMN IF NOT EXISTS best_time                TEXT,
  ADD COLUMN IF NOT EXISTS therapist_requested      TEXT;

COMMENT ON COLUMN bt.contact_submissions.first_name IS 'Given name from the contact form; NULL if blank.';
COMMENT ON COLUMN bt.contact_submissions.last_name IS 'Family name from the contact form; NULL if blank.';
COMMENT ON COLUMN bt.contact_submissions.help_topic IS 'Selected "How can we help you today?" option; NULL if not chosen.';
COMMENT ON COLUMN bt.contact_submissions.other_describe IS 'Free-text "Other, please describe below" field; NULL if blank.';
COMMENT ON COLUMN bt.contact_submissions.preferred_contact_method IS 'Email | Phone Call | Text; NULL if not chosen.';
COMMENT ON COLUMN bt.contact_submissions.best_time IS 'Visitor-supplied best time to reach them; NULL if blank.';
COMMENT ON COLUMN bt.contact_submissions.therapist_requested IS 'Therapist the visitor wishes to contact; NULL if blank.';

COMMIT;

-- ---------------------------------------------------------------------------
-- Down (apply manually — do NOT pipe this whole file to psql):
--   BEGIN;
--   SET search_path = bt, public;
--   ALTER TABLE bt.contact_submissions
--     DROP COLUMN IF EXISTS first_name,
--     DROP COLUMN IF EXISTS last_name,
--     DROP COLUMN IF EXISTS help_topic,
--     DROP COLUMN IF EXISTS other_describe,
--     DROP COLUMN IF EXISTS preferred_contact_method,
--     DROP COLUMN IF EXISTS best_time,
--     DROP COLUMN IF EXISTS therapist_requested;
--   COMMIT;
-- ---------------------------------------------------------------------------

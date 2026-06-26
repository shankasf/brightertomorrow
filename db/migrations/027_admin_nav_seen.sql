-- =============================================================================
-- 027 — Per-admin "last seen" markers for nav notification badges
--
-- The admin console sidebar now shows an unread-count badge on each inbound-data
-- section (appointment requests, callbacks, insurance checks, website
-- enquiries, chat sessions, newsletter). "Unread" = rows that arrived after the
-- admin last opened that section. This table stores, per admin user + section,
-- the timestamp the admin last viewed it. Opening a section upserts seen_at =
-- now() which clears its badge.
--
-- HIPAA note: this is operational admin-UI state only — it records WHICH staff
-- account looked at WHICH section and WHEN. It contains no patient PHI and no
-- patient-linkable data (no names, no record ids — just a section enum + a
-- timestamp), so it is safe to live on the local Postgres alongside the
-- existing bt.admin_users / bt.admin_sessions tables. The aggregate unread
-- COUNTS computed from it are likewise non-PHI (same basis as bt.admin stats).
-- =============================================================================

BEGIN;
SET search_path = bt, public;

CREATE TABLE IF NOT EXISTS bt.admin_nav_seen (
  admin_user_id BIGINT      NOT NULL REFERENCES bt.admin_users(id) ON DELETE CASCADE,
  section       TEXT        NOT NULL,
  seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_user_id, section)
);

COMMENT ON TABLE bt.admin_nav_seen IS
  'Per-admin last-viewed timestamp per console nav section; drives unread-count badges. Non-PHI admin-UI state.';
COMMENT ON COLUMN bt.admin_nav_seen.section IS
  'Nav section key: appointments | callbacks | insurance_checks | contacts | chat | newsletter.';
COMMENT ON COLUMN bt.admin_nav_seen.seen_at IS
  'When this admin last opened the section. Rows newer than this count as unread.';

GRANT SELECT, INSERT, UPDATE, DELETE ON bt.admin_nav_seen TO app;
GRANT SELECT ON bt.admin_nav_seen TO bt_auditor;

COMMIT;

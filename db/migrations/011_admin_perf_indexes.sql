-- Admin console perf — partial indexes on `purged_at IS NULL` for every
-- list view that filters active rows, plus an ORDER BY-covering composite
-- so the planner can read-then-stop without sorting.
--
-- HIPAA notes:
--   • These indexes contain only non-PHI columns (created_at, source,
--     coverage_status, id, started_at). No patient data is materialized
--     into the index payload.
--   • CONCURRENTLY = no table lock; safe to run against production while
--     traffic is live. Idempotent (IF NOT EXISTS).
--   • The audit log is unchanged — admin reads still write one row per PHI
--     record per request via bt.admin_access_log.

SET search_path = bt, public;

-- intake_pointers: appointments list filters `purged_at IS NULL` ORDER BY created_at DESC,
-- sometimes adding `source = ?` or `source = ANY(...)`. Partial indexes
-- skip purged rows and back the sort order index-only.
CREATE INDEX CONCURRENTLY IF NOT EXISTS intake_pointers_active_created_idx
  ON bt.intake_pointers (created_at DESC)
  WHERE purged_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS intake_pointers_active_source_created_idx
  ON bt.intake_pointers (source, created_at DESC)
  WHERE purged_at IS NULL;

-- insurance_checks: same access pattern as intake_pointers but also filters
-- by coverage_status.
CREATE INDEX CONCURRENTLY IF NOT EXISTS insurance_checks_active_created_idx
  ON bt.insurance_checks (created_at DESC)
  WHERE purged_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS insurance_checks_active_source_created_idx
  ON bt.insurance_checks (source, created_at DESC)
  WHERE purged_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS insurance_checks_active_status_created_idx
  ON bt.insurance_checks (coverage_status, created_at DESC)
  WHERE purged_at IS NULL;

-- contact_submissions: admin list ORDER BY created_at DESC, active rows only.
-- The existing contact_retain_idx is for the retention sweeper, not the list.
CREATE INDEX CONCURRENTLY IF NOT EXISTS contact_submissions_active_created_idx
  ON bt.contact_submissions (created_at DESC)
  WHERE purged_at IS NULL;

-- callback_requests: admin list ORDER BY created_at DESC, optional `source` filter.
CREATE INDEX CONCURRENTLY IF NOT EXISTS callback_requests_active_created_idx
  ON bt.callback_requests (created_at DESC)
  WHERE purged_at IS NULL;

-- chat_sessions: admin list ORDER BY started_at DESC.
CREATE INDEX CONCURRENTLY IF NOT EXISTS chat_sessions_active_started_idx
  ON bt.chat_sessions (started_at DESC)
  WHERE purged_at IS NULL;

-- admin_access_log: future user-scoped audit reads ("everything user X accessed").
-- Add now while the table is small — append-heavy, would block later.
CREATE INDEX CONCURRENTLY IF NOT EXISTS admin_access_log_email_time_idx
  ON bt.admin_access_log (admin_email, event_time DESC);

-- Refresh planner stats so the new indexes are immediately useful.
-- ANALYZE is non-blocking.
ANALYZE bt.intake_pointers;
ANALYZE bt.insurance_checks;
ANALYZE bt.contact_submissions;
ANALYZE bt.callback_requests;
ANALYZE bt.chat_sessions;
ANALYZE bt.admin_access_log;
ANALYZE bt.phi_audit_log;

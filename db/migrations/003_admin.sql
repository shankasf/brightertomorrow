-- =============================================================================
-- Admin Dashboard — HIPAA §164.312 Access Controls & Audit
-- Nevada NRS 603A (Security of Personal Information)
-- =============================================================================

BEGIN;
SET search_path = bt, public;

-- ---------------------------------------------------------------------------
-- 1. ADMIN USERS — §164.312(a)(1) Unique User Identification
--    Each admin must have a unique account; shared credentials are prohibited.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bt.admin_users (
  id               BIGSERIAL   PRIMARY KEY,
  email            TEXT        NOT NULL UNIQUE,
  password_hash    TEXT        NOT NULL,      -- bcrypt, cost ≥ 12
  role             TEXT        NOT NULL DEFAULT 'superadmin'
                               CHECK (role IN ('superadmin', 'auditor')),
  is_active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at    TIMESTAMPTZ,
  failed_attempts  SMALLINT    NOT NULL DEFAULT 0,
  locked_until     TIMESTAMPTZ            -- §164.312(d): automatic lockout after N failures
);

-- ---------------------------------------------------------------------------
-- 2. ADMIN SESSIONS — §164.312(a)(2)(iii) Automatic Logoff
--    Sessions expire after 8 hours of creation (hard TTL).
--    The bearer token itself is never stored — only its SHA-256 hash.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bt.admin_sessions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id  BIGINT      NOT NULL REFERENCES bt.admin_users(id) ON DELETE CASCADE,
  token_hash     TEXT        NOT NULL UNIQUE, -- SHA-256(bearer_token) hex
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,        -- created_at + 8 h
  last_used_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at     TIMESTAMPTZ,
  ip_address     INET,
  user_agent     TEXT
);

CREATE INDEX IF NOT EXISTS admin_sessions_token_hash_idx
  ON bt.admin_sessions (token_hash);
CREATE INDEX IF NOT EXISTS admin_sessions_user_idx
  ON bt.admin_sessions (admin_user_id);
CREATE INDEX IF NOT EXISTS admin_sessions_expires_idx
  ON bt.admin_sessions (expires_at) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. ADMIN ACCESS LOG — §164.312(b) Audit Controls
--    Every admin read of PHI (contacts, chat messages) is recorded.
--    Append-only: UPDATE/DELETE/TRUNCATE revoked from all roles.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bt.admin_access_log (
  id             BIGSERIAL   PRIMARY KEY,
  event_time     TIMESTAMPTZ NOT NULL DEFAULT now(),
  admin_user_id  BIGINT      NOT NULL REFERENCES bt.admin_users(id),
  admin_email    TEXT        NOT NULL,
  action         TEXT        NOT NULL,  -- e.g. 'view_contact', 'view_chat_session', 'purge_contact'
  resource_type  TEXT        NOT NULL,  -- 'contact_submission', 'chat_session', 'phi_audit_log'
  resource_id    TEXT,
  ip_address     INET,
  user_agent     TEXT,
  details        JSONB
);

CREATE INDEX IF NOT EXISTS admin_access_log_time_idx
  ON bt.admin_access_log (event_time DESC);
CREATE INDEX IF NOT EXISTS admin_access_log_user_idx
  ON bt.admin_access_log (admin_user_id, event_time DESC);
CREATE INDEX IF NOT EXISTS admin_access_log_res_idx
  ON bt.admin_access_log (resource_type, resource_id);

-- Append-only
REVOKE UPDATE, DELETE, TRUNCATE ON bt.admin_access_log FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4. GRANT bt_auditor read access to admin tables
-- ---------------------------------------------------------------------------

GRANT SELECT ON bt.admin_access_log TO bt_auditor;
GRANT SELECT ON bt.admin_users      TO bt_auditor;
GRANT SELECT ON bt.admin_sessions   TO bt_auditor;

-- Grant app role access to admin tables (it doesn't have blanket schema access for new tables)
GRANT SELECT, INSERT, UPDATE, DELETE ON bt.admin_users    TO app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bt.admin_sessions TO app;
GRANT SELECT, INSERT                 ON bt.admin_access_log TO app;
GRANT USAGE ON SEQUENCE bt.admin_users_id_seq            TO app;
GRANT USAGE ON SEQUENCE bt.admin_access_log_id_seq       TO app;

-- Allow app to READ phi_audit_log for the admin dashboard.
-- Write access (UPDATE/DELETE/TRUNCATE) remains revoked — append-only invariant preserved.
-- The superadmin middleware gate at the application layer prevents unauthorized reads.
GRANT SELECT ON bt.phi_audit_log TO app;

COMMIT;

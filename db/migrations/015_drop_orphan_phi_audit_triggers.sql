-- 015_drop_orphan_phi_audit_triggers.sql
--
-- Commit dc1dab1 dropped bt.phi_audit_log (CASCADE), but CASCADE only removes
-- FK references and dependent views — it does NOT drop triggers on other
-- tables whose trigger bodies INSERT into the dropped table. The three
-- phi_audit_* triggers + their shared bt.phi_audit_trigger() function
-- survived and now break every INSERT/UPDATE/DELETE on chat_sessions,
-- contact_submissions, and newsletter_subscribers with
--
--   ERROR: relation "bt.phi_audit_log" does not exist (SQLSTATE 42P01)
--
-- The chatbot has been returning 500 on POST /v1/chat/stream as a result.
--
-- Audit trails are now written by the Go gateway directly to DynamoDB
-- (phi.Store.PutAccessAudit + recordTurn), so the Postgres triggers have no
-- writable destination and no remaining purpose. Drop them.

DROP TRIGGER IF EXISTS phi_audit_chat_sess  ON bt.chat_sessions;
DROP TRIGGER IF EXISTS phi_audit_contact    ON bt.contact_submissions;
DROP TRIGGER IF EXISTS phi_audit_newsletter ON bt.newsletter_subscribers;

DROP FUNCTION IF EXISTS bt.phi_audit_trigger();

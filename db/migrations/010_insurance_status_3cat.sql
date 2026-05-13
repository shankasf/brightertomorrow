-- 010_insurance_status_3cat.sql
--
-- Collapse bt.insurance_checks.coverage_status to three admin-facing values:
--   verified   — eligible = true (any upstream label: 'eligible', 'active', etc.)
--   error      — coverage_status = 'verification_error' (CLAIM.MD failure)
--   unverified — everything else (ineligible, needs_review, unknown, etc.)
--
-- Future writes are canonicalized in the gateway handlers via
-- CanonicalCoverageStatus(), so this is a one-time remap of historical rows.

BEGIN;

UPDATE bt.insurance_checks
SET coverage_status = CASE
    WHEN eligible THEN 'verified'
    WHEN coverage_status = 'verification_error' THEN 'error'
    ELSE 'unverified'
END
WHERE coverage_status NOT IN ('verified', 'unverified', 'error');

COMMIT;

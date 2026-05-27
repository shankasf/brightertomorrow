-- migrate:up

-- Christie Johnson (staffId 34) left the practice on 2026-05-27. Remove her
-- from bt.team_members so she no longer appears on the website /team listing,
-- the admin team UI, or any team-derived surface. Earlier migrations seed +
-- update her row, so this append-only DELETE ensures a fresh rebuild ends with
-- her gone too. Patient appointment history (DynamoDB) is intentionally NOT
-- touched. Idempotent — re-running matches 0 rows once she's removed.

BEGIN;

DELETE FROM bt.team_members WHERE full_name ILIKE '%Christie Johnson%';

COMMIT;

-- migrate:down

BEGIN;

-- No-op: re-adding a departed clinician is a manual roster decision, not an
-- automatic rollback.

COMMIT;

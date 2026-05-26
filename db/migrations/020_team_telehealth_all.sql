-- 020_team_telehealth_all.sql
-- Every clinician offers telehealth in addition to any physical office, so the
-- /team "Telehealth" filter (Office + Modality) and the location chips should
-- cover the whole roster — not just the few who were originally tagged.
-- Idempotent: appends 'telehealth' only where it isn't already present.
UPDATE bt.team_members
SET office_locations = office_locations || ARRAY['telehealth']
WHERE NOT ('telehealth' = ANY(office_locations));

-- migrate:up

BEGIN;

-- Add columns idempotently
ALTER TABLE bt.team_members
  ADD COLUMN IF NOT EXISTS office_locations text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pricing_tier     text,
  ADD COLUMN IF NOT EXISTS network_status   text,
  ADD COLUMN IF NOT EXISTS specialties      text[] NOT NULL DEFAULT '{}';

-- GIN index for array filtering on office_locations
CREATE INDEX IF NOT EXISTS team_members_office_locations_gin
  ON bt.team_members USING GIN (office_locations);

-- Backfill per therapist (ILIKE match, idempotent on re-run)
UPDATE bt.team_members SET
  office_locations = ARRAY['e-russell'],
  pricing_tier     = '$125–$150 / session',
  network_status   = 'In-Network: Aetna, Cigna, BCBS, UHC',
  specialties      = ARRAY['Young Adults','Anxiety','Life Transitions']
WHERE full_name ILIKE '%Joanne Tran%';

UPDATE bt.team_members SET
  office_locations = ARRAY['e-russell'],
  pricing_tier     = '$25–$60 / session',
  network_status   = 'Sliding Scale Available',
  specialties      = ARRAY['Emotion Processing','Grief','Resilience']
WHERE full_name ILIKE '%Lorenthia Clayton%';

UPDATE bt.team_members SET
  office_locations = ARRAY['n-durango'],
  pricing_tier     = '$25–$60 / session',
  network_status   = 'Sliding Scale Available',
  specialties      = ARRAY['Couples','Communication']
WHERE full_name ILIKE '%Sherrita Williams%';

UPDATE bt.team_members SET
  office_locations = ARRAY['n-durango','telehealth'],
  pricing_tier     = '$25–$60 / session',
  network_status   = 'Sliding Scale Available',
  specialties      = ARRAY['Trauma','Couples','Family','BIPOC','Identity']
WHERE full_name ILIKE '%Miranda Pulido%';

UPDATE bt.team_members SET
  office_locations = ARRAY['telehealth'],
  pricing_tier     = '$125–$150 / session',
  network_status   = 'In-Network: Aetna, Cigna, BCBS, UHC',
  specialties      = ARRAY['Trauma','Anxiety','Depression']
WHERE full_name ILIKE '%Tony Martinez%';

UPDATE bt.team_members SET
  office_locations = ARRAY['e-russell'],
  pricing_tier     = '$25–$60 / session',
  network_status   = 'Sliding Scale Available',
  specialties      = ARRAY['Anxiety','Depression','LGBTQIA+','BIPOC']
WHERE full_name ILIKE '%Alayna Hammond%';

UPDATE bt.team_members SET
  office_locations = ARRAY['e-russell','n-durango'],
  pricing_tier     = '$25–$60 / session',
  network_status   = 'Sliding Scale Available',
  specialties      = ARRAY['Children','Adolescents','Young Adults']
WHERE full_name ILIKE '%Elisia Danley%';

UPDATE bt.team_members SET
  office_locations = ARRAY['e-russell'],
  pricing_tier     = '$25–$60 / session',
  network_status   = 'Sliding Scale Available',
  specialties      = ARRAY['Children','Teens','Grief','Trauma']
WHERE full_name ILIKE '%Janelle Thompson%';

UPDATE bt.team_members SET
  office_locations = ARRAY['n-durango'],
  pricing_tier     = '$25–$60 / session',
  network_status   = 'Sliding Scale Available',
  specialties      = ARRAY['Complex Trauma','Children','Adolescents']
WHERE full_name ILIKE '%Nicole Pangelinan%';

UPDATE bt.team_members SET
  office_locations = ARRAY['n-durango','telehealth'],
  pricing_tier     = '$25–$60 / session',
  network_status   = 'Sliding Scale Available',
  specialties      = ARRAY['Foster Care','Hospice','Grief','Life Transitions']
WHERE full_name ILIKE '%Alexzandria Summers%';

UPDATE bt.team_members SET
  office_locations = ARRAY['e-russell'],
  pricing_tier     = '$25–$60 / session',
  network_status   = 'Sliding Scale Available',
  specialties      = ARRAY['Children','Teens','Women','CBT','Trauma-Informed']
WHERE full_name ILIKE '%Christie Johnson%';

UPDATE bt.team_members SET
  office_locations = ARRAY['telehealth'],
  pricing_tier     = '$150 / session',
  network_status   = 'In-Network: Aetna, Cigna, BCBS, UHC',
  specialties      = ARRAY['Inner Critic','Confidence','Personal Growth']
WHERE full_name ILIKE '%Yvette Howard%';

UPDATE bt.team_members SET
  office_locations = ARRAY['e-russell'],
  pricing_tier     = '$25–$60 / session',
  network_status   = 'Sliding Scale Available',
  specialties      = ARRAY['Child Welfare','Community Services']
WHERE full_name ILIKE '%Samara Cobb%';

COMMIT;

-- migrate:down

BEGIN;

DROP INDEX IF EXISTS bt.team_members_office_locations_gin;

ALTER TABLE bt.team_members
  DROP COLUMN IF EXISTS office_locations,
  DROP COLUMN IF EXISTS pricing_tier,
  DROP COLUMN IF EXISTS network_status,
  DROP COLUMN IF EXISTS specialties;

COMMIT;

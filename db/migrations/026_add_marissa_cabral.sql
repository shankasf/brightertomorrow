-- migrate:up

-- Add new clinician Marissa Cabral, LCSW to bt.team_members so she appears on
-- the /team listing (E Russell + Telehealth, per the bio doc). Her full bio
-- page lives in web/src/content/team/marissa-cabral.json and her headshot at
-- web/public/team/marissa-cabral.jpg.
-- pricing + network match the other LCSW (Joanne Tran).
-- Idempotent: inserts only when a matching name is absent.

BEGIN;

INSERT INTO bt.team_members
  (group_id, full_name, credentials, role, photo_url, accepts_new, "position",
   published, office_locations, pricing_tier, network_status, specialties, specialties_text)
SELECT 2, 'Marissa Cabral', 'LCSW', 'Licensed Clinical Social Worker',
   '/team/marissa-cabral.jpg', true, 15, true,
   ARRAY['e-russell','telehealth'],
   '$150 per 50-minute session', 'In network with most insurance plans',
   ARRAY['Anxiety','OCD','Trauma','BFRBs','Phobias'],
   'Anxiety disorders, OCD & intrusive thoughts, body-focused repetitive behaviors (skin picking & hair pulling), trauma & secondary trauma, phobias & agoraphobia, chronic suicidality; evidence-based care for adults 18+ including ERP, Cognitive Processing Therapy, and the Comprehensive Behavioral (ComB) model.'
WHERE NOT EXISTS (SELECT 1 FROM bt.team_members WHERE full_name ILIKE '%Marissa Cabral%');

COMMIT;

-- migrate:down

BEGIN;
DELETE FROM bt.team_members WHERE full_name ILIKE '%Marissa Cabral%';
COMMIT;

-- migrate:up

-- Sync bt.team_members with the canonical roster + card content on
-- brightertomorrowtherapy.com/telehealth-team/ : verbatim credentials, role,
-- full specialties sentence, rate, network status, office locations, and the
-- 15-card display order. Adds 4 interns who were missing from the DB
-- (Pascha Broadie, Keunshea Fleming, Monica Gonzalez, Jordan Fuller).
-- Idempotent: re-running matches existing rows by name and inserts only when absent.

BEGIN;

-- specialties_text = full verbatim specialties sentence shown on the card.
-- (The existing specialties text[] is kept for the /team Focus filter only.)
ALTER TABLE bt.team_members
  ADD COLUMN IF NOT EXISTS specialties_text text;

-- ── Existing members: update card content + display order ───────────────────

UPDATE bt.team_members SET
  credentials      = 'LCSW',
  role             = 'Licensed Clinical Social Worker, Team Lead, Reiki and Trauma Yoga specialist',
  specialties_text = 'Young adult mental health, anxiety & depression, trauma & grief support, life transitions, relationship stress, chronic illness & medical trauma, intergenerational and cultural identity challenges, holistic mind-body wellness.',
  pricing_tier     = '$150 per 50-minute session',
  network_status   = 'In network with most insurance plans',
  office_locations = ARRAY['e-russell','telehealth'],
  accepts_new      = true,
  "position"       = 1
WHERE full_name ILIKE '%Joanne Tran%';

UPDATE bt.team_members SET
  credentials      = 'CPC-I',
  role             = 'Clinical Professional Counselor, Intern',
  specialties_text = 'Anxiety, depression, emotional regulation, BPD support, suicidal ideation, youth (ages 7+), queer & BIPOC-affirming care, strengths-based growth.',
  pricing_tier     = '$125 per 50-minute session',
  network_status   = 'In network with most insurance plans',
  office_locations = ARRAY['e-russell','telehealth'],
  accepts_new      = true,
  "position"       = 2
WHERE full_name ILIKE '%Alayna Hammond%';

UPDATE bt.team_members SET
  credentials      = 'CSW-I',
  role             = 'Clinical Social Worker, Intern',
  specialties_text = 'Child & adolescent therapy (ages 3+), anxiety, depression, emotional regulation, neurodivergence-affirming support, creative & expressive therapy (art/play-based), trauma-informed care, strengths-based support.',
  pricing_tier     = '$125 per 50-minute session',
  network_status   = 'In network with most insurance plans',
  office_locations = ARRAY['e-russell','n-durango','telehealth'],
  accepts_new      = true,
  "position"       = 3
WHERE full_name ILIKE '%Elisia Danley%';

UPDATE bt.team_members SET
  credentials      = 'CSW-I',
  role             = 'Clinical Social Worker, Intern',
  specialties_text = 'Child & adolescent therapy (ages 4–15), anxiety, depression, emotional regulation, trauma-informed support, grief & loss, school stress & peer challenges, identity development, affirming care for diverse & LGBTQ+ youth.',
  pricing_tier     = '$125 per 50-minute session',
  network_status   = 'In network with most insurance plans',
  office_locations = ARRAY['e-russell','telehealth'],
  accepts_new      = true,
  "position"       = 5
WHERE full_name ILIKE '%Janelle Thompson%';

UPDATE bt.team_members SET
  credentials      = 'CPC-I',
  role             = 'Clinical Professional Counselor, Intern',
  specialties_text = 'Behavioral health & emotional challenges, trauma-informed support, substance use support, family transitions & foster care issues, adoption-related concerns, resilience & personal growth, support for women, youth, and young adults.',
  pricing_tier     = '$125 per 50-minute session',
  network_status   = 'In network with most insurance plans',
  office_locations = ARRAY['n-durango'],
  accepts_new      = true,
  "position"       = 7
WHERE full_name ILIKE '%Christie Johnson%';

UPDATE bt.team_members SET
  full_name        = 'Dr. Tony Martinez',
  credentials      = 'LMFT',
  role             = 'Licensed Marriage and Family Therapist',
  specialties_text = 'Couples & relationship therapy, trauma & PTSD support, anxiety & depression, identity & self-exploration, life transitions, multicultural & diversity-affirming care, veteran & first responder support, family systems therapy.',
  pricing_tier     = '$150 per 50-minute session',
  network_status   = 'In network with most insurance plans',
  office_locations = ARRAY['telehealth'],
  accepts_new      = true,
  "position"       = 8
WHERE full_name ILIKE '%Tony Martinez%';

UPDATE bt.team_members SET
  credentials      = 'LCSW',
  role             = 'Licensed Clinical Social Worker',
  specialties_text = 'Grief & bereavement support, anxiety, depression, life transitions, family dynamics & conflict, loss & emotional healing, self-awareness & resilience building, teen & young adult support.',
  pricing_tier     = '$150 per 50-minute session',
  network_status   = 'In network with most insurance plans',
  office_locations = ARRAY['e-russell','telehealth'],
  accepts_new      = true,
  "position"       = 9
WHERE full_name ILIKE '%Lorenthia Clayton%';

UPDATE bt.team_members SET
  credentials      = 'CSW-I',
  role             = 'Clinical Social Worker, Intern',
  specialties_text = 'Relationship challenges, communication barriers, emotional regulation, personal growth & transitions, marriage & couples counseling, solution-focused support, behavioral health co-morbidity.',
  pricing_tier     = '$125 per 50-minute session',
  network_status   = 'In network with most insurance plans',
  office_locations = ARRAY['n-durango','telehealth'],
  accepts_new      = true,
  "position"       = 10
WHERE full_name ILIKE '%Sherrita Williams%';

UPDATE bt.team_members SET
  credentials      = 'CSW-I',
  role             = 'Clinical Social Worker, Intern',
  specialties_text = 'Complex trauma support, anxiety, mood disorders, behavioral dysregulation, attachment concerns, trauma-informed care for children, adolescents & young adults, culturally aware & validating support for minority youth, foster care & family instability challenges.',
  pricing_tier     = '$125 per 50-minute session',
  network_status   = 'In network with most insurance plans',
  office_locations = ARRAY['n-durango','telehealth'],
  accepts_new      = true,
  "position"       = 11
WHERE full_name ILIKE '%Nicole Pangelinan%';

UPDATE bt.team_members SET
  credentials      = 'CSW-I',
  role             = 'Clinical Social Worker, Intern',
  specialties_text = 'Re-entry and reintegration support, trauma-informed care, children in foster or state systems, hospice and end-of-life support, grief and loss, system navigation & advocacy, life transitions, emotional regulation, strengths-based growth.',
  pricing_tier     = '$125 per 50-minute session',
  network_status   = 'In network with most insurance plans',
  office_locations = ARRAY['n-durango','telehealth'],
  accepts_new      = true,
  "position"       = 12
WHERE full_name ILIKE '%Alexzandria Summers%';

UPDATE bt.team_members SET
  credentials      = 'MFT-I',
  role             = 'Marriage and Family Therapist-Intern',
  specialties_text = 'Individual therapy, couples therapy, family support & communication, trauma-informed care, women''s issues, BIPOC mental health, relationship challenges, emotional regulation, life transitions, identity development, strengths-based growth.',
  pricing_tier     = NULL,
  network_status   = NULL,
  office_locations = ARRAY['telehealth'],
  accepts_new      = true,
  "position"       = 15
WHERE full_name ILIKE '%Miranda Pulido%';

-- Samara Cobb stays on the roster (Excel) but is not on the .com telehealth
-- page; client-provided card content, moved after the 15. MSW student =
-- self-pay only, so explicitly NOT in-network.
UPDATE bt.team_members SET
  credentials      = NULL,
  role             = 'Master of Social Work (MSW) Student',
  specialties_text = 'Anxiety & stress management, emotional regulation, life transitions, trauma-informed support, strengths-based growth, reflective & collaborative exploration, supportive care for young adults & adults.',
  specialties      = ARRAY['Anxiety','Emotional Regulation','Life Transitions','Trauma-Informed','Young Adults'],
  pricing_tier     = '$25-$60 per 50-minute session',
  network_status   = 'Not in network with insurance plans',
  accepts_new      = true,
  "position"       = 16
WHERE full_name ILIKE '%Samara Cobb%';

-- ── New members (insert only if missing) ────────────────────────────────────

INSERT INTO bt.team_members
  (group_id, full_name, credentials, role, photo_url, accepts_new, "position",
   published, office_locations, pricing_tier, network_status, specialties, specialties_text)
SELECT 3, 'Pascha Broadie', 'CPC-I', 'Clinical Professional Counselor, Intern',
   '/team/pascha-broadie.webp', true, 4, true,
   ARRAY['n-durango','telehealth'],
   '$125 per 50-minute session', 'In network with most insurance plans',
   ARRAY['Anxiety','Depression','Trauma','Couples','LGBTQIA+','BIPOC'],
   'Anxiety, depression, trauma, emotional abuse, personality disorders, substance use concerns, adolescent & young adult issues, family & couples therapy, telehealth services, CBT, DBT, psychodynamic therapy, strengths-based and talk therapy approaches.'
WHERE NOT EXISTS (SELECT 1 FROM bt.team_members WHERE full_name ILIKE '%Pascha Broadie%');

INSERT INTO bt.team_members
  (group_id, full_name, credentials, role, photo_url, accepts_new, "position",
   published, office_locations, pricing_tier, network_status, specialties, specialties_text)
SELECT 2, 'Keunshea Fleming', 'CSW-I', 'Clinical Social Worker, Intern',
   '/team/keunshea-fleming.jpg', true, 6, true,
   ARRAY['e-russell','telehealth'],
   NULL, NULL,
   ARRAY['Trauma','PTSD','Grief','Anxiety','Substance Use'],
   'Adult therapy (ages 20–50), trauma and PTSD, substance use & addiction, chronic illness (including HIV/AIDS), grief & loss, peripartum depression, anxiety disorders, emotional regulation, culturally responsive care (African descent & diverse communities), caregiver support, holistic & somatic healing.'
WHERE NOT EXISTS (SELECT 1 FROM bt.team_members WHERE full_name ILIKE '%Keunshea Fleming%');

INSERT INTO bt.team_members
  (group_id, full_name, credentials, role, photo_url, accepts_new, "position",
   published, office_locations, pricing_tier, network_status, specialties, specialties_text)
SELECT 1, 'Monica Gonzalez', 'CSW-I', 'Clinical Social Worker, Intern',
   '/team/monica-gonzalez.jpg', true, 13, true,
   ARRAY['telehealth'],
   '$125 per 50-minute session', 'In network with most insurance plans',
   ARRAY['Anxiety','Depression','Grief','ADHD','Substance Use'],
   'Anxiety, depression, grief, trauma-informed care, emotional regulation, ADHD, substance use, psychotic disorders, life transitions, relationship challenges, culturally responsive care (Spanish-speaking/Hispanic/Latino communities), neurodiversity, strengths-based growth.'
WHERE NOT EXISTS (SELECT 1 FROM bt.team_members WHERE full_name ILIKE '%Monica Gonzalez%');

INSERT INTO bt.team_members
  (group_id, full_name, credentials, role, photo_url, accepts_new, "position",
   published, office_locations, pricing_tier, network_status, specialties, specialties_text)
SELECT 1, 'Jordan Fuller', 'CSW-I', 'Clinical Social Worker, Intern',
   '/team/jordan-fuller.jpg', true, 14, true,
   ARRAY['telehealth'],
   '$125 per 50-minute session', 'In network with most insurance plans',
   ARRAY['Anxiety','Depression','Trauma','Youth','Life Transitions'],
   'Anxiety, depression, trauma-informed care, life transitions, emotional regulation, identity development, relationship challenges, strengths-based growth, resilience building, and adult mental health support.'
WHERE NOT EXISTS (SELECT 1 FROM bt.team_members WHERE full_name ILIKE '%Jordan Fuller%');

COMMIT;

-- migrate:down

BEGIN;

DELETE FROM bt.team_members
  WHERE full_name IN ('Pascha Broadie','Keunshea Fleming','Monica Gonzalez','Jordan Fuller');

ALTER TABLE bt.team_members DROP COLUMN IF EXISTS specialties_text;

COMMIT;

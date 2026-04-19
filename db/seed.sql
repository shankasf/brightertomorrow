-- Seed for Brighter Tomorrow Therapy clone
SET search_path = bt, public;

BEGIN;

-- Site settings
INSERT INTO site_settings (id, brand_name, tagline, primary_phone, primary_email,
  primary_color, text_color, muted_color, surface_color,
  logo_url, hero_image_url, business_hours, social)
VALUES (1,
  'Brighter Tomorrow Therapy Collective',
  'You Are Ready. The Right Therapist Is Here.',
  '725-238-6990',
  'admin@brightertomorrowtherapy.com',
  '#0170B9', '#3a3a3a', '#4B4F58', '#F5F5F5',
  'https://brightertomorrowtherapy.com/wp-content/uploads/2023/05/Brighter-Tomorrow-logo.png',
  'https://brightertomorrowtherapy.com/wp-content/uploads/2025/02/Horizone.jpg',
  '{"Mon-Fri":"9am - 8pm","Sat-Sun":"10am - 4pm","Customer Service":"Mon-Fri 9am - 5pm"}'::jsonb,
  '{"facebook":"https://facebook.com/Forabettertomorrowlv","instagram":"https://instagram.com/brightertomorrowlv/"}'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  brand_name = EXCLUDED.brand_name,
  tagline = EXCLUDED.tagline,
  primary_phone = EXCLUDED.primary_phone,
  primary_email = EXCLUDED.primary_email,
  logo_url = EXCLUDED.logo_url,
  hero_image_url = EXCLUDED.hero_image_url,
  business_hours = EXCLUDED.business_hours,
  social = EXCLUDED.social,
  updated_at = now();

-- Locations
TRUNCATE locations RESTART IDENTITY CASCADE;
INSERT INTO locations (name, address1, city, state, postal_code, phone, is_telehealth, position) VALUES
  ('E Russell Office', '3430 E Russell Rd Ste 315', 'Las Vegas', 'NV', '89120', '725-238-6990', FALSE, 1),
  ('N Durango Office', '6955 N Durango Dr Unit 1004', 'Las Vegas', 'NV', '89149', '725-238-6990', FALSE, 2),
  ('Telehealth (All Nevada)', NULL, NULL, 'NV', NULL, '725-238-6990', TRUE, 3);

-- Navigation (header) — mirrors the menu on brightertomorrowtherapy.com
TRUNCATE nav_items RESTART IDENTITY CASCADE;
WITH parents AS (
  INSERT INTO nav_items (label, href, position, location) VALUES
    ('About Us', '/about', 1, 'header'),
    ('Our Team', '/team', 2, 'header'),
    ('Services', '/services', 3, 'header'),
    ('Specialties', '/specialties', 4, 'header'),
    ('Blog', '/blog', 5, 'header'),
    ('Rates', '/rates', 6, 'header'),
    ('FAQs', '/faqs', 7, 'header'),
    ('Contact', '/contact', 8, 'header')
  RETURNING id, label
)
INSERT INTO nav_items (parent_id, label, href, position, location)
SELECT p.id, c.label, c.href, c.position, 'header' FROM parents p
JOIN (VALUES
  ('About Us','Story','/about/story',1),
  ('About Us','Approach','/about/approach',2),
  ('Our Team','Telehealth Team','/team/telehealth',1),
  ('Our Team','E Russell Team','/team/e-russell',2),
  ('Our Team','N Durango Team','/team/n-durango',3),
  ('Our Team','Student Therapists Team','/team/students',4),
  ('Services','Individual Therapy','/services/individual-therapy',1),
  ('Services','Reiki Energy Healing','/services/reiki',2),
  ('Services','Teletherapy','/services/teletherapy',3),
  ('Services','Emotional Support Animal (ESA) Letters','/services/esa-letters',4),
  ('Services','Journal','/services/journal',5),
  ('Specialties','Anxiety Therapy','/specialties/anxiety',1),
  ('Specialties','Child Therapy','/specialties/child',2),
  ('Specialties','Couples Counseling','/specialties/couples',3),
  ('Specialties','Depression Therapy','/specialties/depression',4),
  ('Specialties','Geriatric Counseling','/specialties/geriatric',5),
  ('Specialties','Grief Counseling','/specialties/grief',6),
  ('Specialties','LGBTQIA+ Affirming Therapy','/specialties/lgbtqia',7),
  ('Specialties','Life Transitions Counseling','/specialties/life-transitions',8),
  ('Specialties','Teen Counseling','/specialties/teen',9),
  ('Specialties','Trauma & PTSD Therapy','/specialties/trauma-ptsd',10),
  ('Specialties','Relationship Counseling','/specialties/relationship',11),
  ('Rates','Affordable Therapy','/rates',1),
  ('Contact','Contact Us','/contact',1),
  ('Contact','Careers','/contact/careers',2)
) AS c(parent_label, label, href, position) ON c.parent_label = p.label;

-- Footer nav (grouped to match the live site: Services / Specialties / Important Links / Information)
WITH fparents AS (
  INSERT INTO nav_items (label, href, position, location) VALUES
    ('Services','#',1,'footer'),
    ('Specialties','#',2,'footer'),
    ('Important Links','#',3,'footer'),
    ('Information','#',4,'footer')
  RETURNING id, label
)
INSERT INTO nav_items (parent_id, label, href, position, location)
SELECT p.id, c.label, c.href, c.position, 'footer' FROM fparents p
JOIN (VALUES
  ('Services','Affordable Therapy','/rates',1),
  ('Services','Couples Counseling','/specialties/couples',2),
  ('Services','Individual Therapy','/services/individual-therapy',3),
  ('Services','Emotional Support Animal (ESA) Letters','/services/esa-letters',4),
  ('Services','Reiki Energy Healing','/services/reiki',5),
  ('Services','Teletherapy','/services/teletherapy',6),
  ('Services','Journals','/services/journal',7),
  ('Specialties','Anxiety Therapy','/specialties/anxiety',1),
  ('Specialties','Child Therapy','/specialties/child',2),
  ('Specialties','Couples Therapy','/specialties/couples',3),
  ('Specialties','Depression Therapy','/specialties/depression',4),
  ('Specialties','Geriatric Counseling','/specialties/geriatric',5),
  ('Specialties','Grief Counseling','/specialties/grief',6),
  ('Specialties','LGBTQIA+ Affirming Therapy','/specialties/lgbtqia',7),
  ('Specialties','Life Transitions Counseling','/specialties/life-transitions',8),
  ('Specialties','Teen Counseling','/specialties/teen',9),
  ('Specialties','Trauma & PTSD Therapy','/specialties/trauma-ptsd',10),
  ('Specialties','Relationship Counseling','/specialties/relationship',11),
  ('Important Links','Privacy Policy','/privacy',1)
) AS c(parent_label, label, href, position) ON c.parent_label = p.label;

-- Press mentions
TRUNCATE press_mentions RESTART IDENTITY;
INSERT INTO press_mentions (outlet, title, url, logo_url, position) VALUES
  ('KTNV Las Vegas','Fighting the stigma: Getting more Black Americans to seek mental health treatment',
   'https://www.ktnv.com/news/fighting-the-stigma-importance-of-getting-more-black-americans-to-seek-mental-health-treatment',
   'https://brightertomorrowtherapy.com/wp-content/uploads/2025/03/descarga.png', 1);

-- Podcast (A Healthier Tomorrow with Yvette Howard)
INSERT INTO podcast (id, show_name, host, tagline, listen_url, cover_url) VALUES
  (1,'A Healthier Tomorrow','Yvette Howard','Conversations on mental health, healing, and building a healthier life.',
   'https://compassion.mykajabi.com/podcasts/a-healthier-tomorrow/episodes/2148965535',
   'https://brightertomorrowtherapy.com/wp-content/uploads/2025/02/Brighter-Tomorrow-2.webp')
ON CONFLICT (id) DO UPDATE SET show_name = EXCLUDED.show_name, host = EXCLUDED.host,
  tagline = EXCLUDED.tagline, listen_url = EXCLUDED.listen_url, cover_url = EXCLUDED.cover_url;

-- Free resources (Journal of the Month)
TRUNCATE free_resources RESTART IDENTITY;
INSERT INTO free_resources (kind, title, description, image_url, cta_label, cta_url, position) VALUES
  ('journal','Journal of the Month',
   'A free monthly journal with prompts and exercises to support your wellbeing.',
   'https://brightertomorrowtherapy.com/wp-content/uploads/2025/02/Brighter-Tomorrow-2.webp',
   'Click Here','/services/journal',1);

-- Services
TRUNCATE services RESTART IDENTITY CASCADE;
INSERT INTO services (slug, title, short_desc, long_desc, image_url, position) VALUES
  ('individual-therapy','Individual Therapy',
   'One-on-one support tailored to where you are right now.',
   'Confidential, personalized sessions to help you work through anxiety, depression, trauma, life transitions, and more — with a therapist matched to your needs.',
   'https://brightertomorrowtherapy.com/wp-content/uploads/2025/02/Individual-therapy.webp',1),
  ('couples-counseling','Couples Counseling',
   'Rebuild trust, deepen communication, and move forward together.',
   'A safe space for partners to be heard, learn healthier patterns, and grow stronger as a team — whether you are in crisis or simply want to thrive.',
   'https://brightertomorrowtherapy.com/wp-content/uploads/2025/02/Couple-therapy.webp',2),
  ('child-teen-therapy','Child & Teen Therapy',
   'Compassionate care for younger clients and their families.',
   'Play-based and talk-based therapy designed for kids and teens navigating school stress, anxiety, family changes, and identity questions.',
   'https://brightertomorrowtherapy.com/wp-content/uploads/2025/02/Group-Therapy.webp',3),
  ('teletherapy','Teletherapy',
   'Therapy from anywhere in Nevada — secure and HIPAA-compliant.',
   'Connect with your therapist from the comfort of home through encrypted video. Same care, more flexibility.',
   'https://brightertomorrowtherapy.com/wp-content/uploads/2025/02/Telehealth-services.webp',4),
  ('reiki','Reiki Energy Healing',
   'A gentle complement to talk therapy.',
   'A relaxing, non-invasive practice to support emotional release, stress reduction, and overall wellbeing.',
   'https://brightertomorrowtherapy.com/wp-content/uploads/2025/02/Memories.webp',5),
  ('esa-letters','ESA Letters',
   'Licensed evaluations for Emotional Support Animal documentation.',
   'A short evaluation with a licensed clinician to determine eligibility and issue a compliant ESA letter.',
   'https://brightertomorrowtherapy.com/wp-content/uploads/2025/02/Couple.jpg',6),
  ('grief-counseling','Grief Counseling',
   'Walk through loss with someone beside you.',
   'Support for the unique, non-linear journey of grief — at your pace.',
   'https://brightertomorrowtherapy.com/wp-content/uploads/2025/02/A-healthier-Tomorrow-1024x1024.jpg',7),
  ('geriatric-counseling','Geriatric Counseling',
   'Tailored mental health support for older adults.',
   'Compassionate care for life transitions, isolation, caregiving stress, and chronic illness.',
   'https://brightertomorrowtherapy.com/wp-content/uploads/2023/05/support-prayer-and-trust-with-people-holding-hands-BRKJAD3.jpg',8);

-- Specialties
TRUNCATE specialties RESTART IDENTITY CASCADE;
INSERT INTO specialties (slug, title, short_desc, position) VALUES
  ('anxiety','Anxiety','Tools and support to quiet the noise.',1),
  ('depression','Depression','Find your way back to feeling like yourself.',2),
  ('trauma-ptsd','Trauma & PTSD','Evidence-based trauma care, at your pace.',3),
  ('lgbtqia','LGBTQIA+','Affirming, identity-respecting care.',4),
  ('couples','Couples','Reconnect, rebuild, grow.',5),
  ('teen','Teen','A space made for the teen years.',6),
  ('child','Child','Play and talk therapy for younger clients.',7),
  ('grief','Grief','Walk through loss with support.',8),
  ('life-transitions','Life Transitions','Navigate change with steadiness.',9),
  ('relationship','Relationship','Healthier patterns in every relationship.',10),
  ('geriatric','Geriatric','Mental health for older adults.',11);

-- Team groups
TRUNCATE team_groups RESTART IDENTITY CASCADE;
INSERT INTO team_groups (slug, title, description, position) VALUES
  ('telehealth','Telehealth Team','Therapists serving clients across Nevada via secure video.',1),
  ('e-russell','E Russell Office','In-person therapists at our E Russell location.',2),
  ('n-durango','N Durango Office','In-person therapists at our N Durango location.',3),
  ('students','Student Therapists','Supervised graduate therapists offering reduced-fee sessions.',4);

-- A small representative team set (placeholder — real names live on the live site)
TRUNCATE team_members RESTART IDENTITY CASCADE;
INSERT INTO team_members (group_id, full_name, credentials, role, bio, photo_url, accepts_new, position)
SELECT g.id, m.full_name, m.credentials, m.role, m.bio, m.photo_url, TRUE, m.position
FROM team_groups g
JOIN (VALUES
  ('telehealth','Telehealth Therapist','LCSW','Lead Telehealth Clinician','Specializes in anxiety, life transitions, and trauma — virtual sessions across Nevada.',
    'https://brightertomorrowtherapy.com/wp-content/uploads/2026/04/istockphoto-2197384352-612x612-1.jpg',1),
  ('e-russell','E Russell Clinician','LMFT','Couples & Family Therapist','Couples counseling and family systems work, in-person at E Russell.',
    'https://brightertomorrowtherapy.com/wp-content/uploads/2026/04/130420261776038595-1024x683.jpeg',1),
  ('n-durango','N Durango Clinician','LCPC','Child & Teen Specialist','Play-based therapy for kids and CBT for teens at N Durango.',
    'https://brightertomorrowtherapy.com/wp-content/uploads/2026/04/160420261776380246-1024x669.jpeg',1),
  ('students','Student Therapist','MSW Intern','Supervised Graduate Therapist','Reduced-fee sessions under supervision — a great fit for clients seeking accessible care.',
    'https://brightertomorrowtherapy.com/wp-content/uploads/2025/02/Brighter-Tomorrow-Counseling.jpg',1)
) AS m(group_slug, full_name, credentials, role, bio, photo_url, position) ON m.group_slug = g.slug;

-- Testimonials
TRUNCATE testimonials RESTART IDENTITY CASCADE;
INSERT INTO testimonials (author, quote, rating, position) VALUES
  ('Client, Las Vegas','My therapist truly listened. I felt supported from the very first session.',5,1),
  ('Client, North Las Vegas','The office is welcoming and the team made me feel safe to open up.',5,2),
  ('Client, Telehealth','Being able to meet from home made a huge difference for me.',5,3),
  ('Client, Henderson','I finally have tools to manage my anxiety. So grateful.',5,4);

-- FAQs
TRUNCATE faqs RESTART IDENTITY CASCADE;
INSERT INTO faqs (question, answer, category, position) VALUES
  ('Do you accept insurance?','We accept several major plans and offer affordable self-pay rates. Contact us to confirm coverage for your provider.','Billing',1),
  ('How do I get started?','Click "Find My Therapist" or call 725-238-6990. Our intake team will match you with a clinician who fits your needs.','Getting Started',2),
  ('Do you offer evening or weekend appointments?','Yes — we have appointments Mon–Fri until 8pm and Sat–Sun 10am–4pm.','Scheduling',3),
  ('Is telehealth secure?','Yes. All telehealth sessions use HIPAA-compliant encrypted video.','Telehealth',4),
  ('What ages do you serve?','We work with children, teens, adults, couples, families, and older adults.','General',5);

-- Stats
TRUNCATE stats RESTART IDENTITY CASCADE;
INSERT INTO stats (label, value, suffix, position) VALUES
  ('Years of Experience',15,'+',1),
  ('Happy Clients',1200,'+',2),
  ('Mental Healing',98,'%',3),
  ('Therapists',20,'+',4);

-- Blog posts
TRUNCATE blog_posts RESTART IDENTITY CASCADE;
INSERT INTO blog_posts (slug, title, excerpt, body_md, cover_url, author, published_at) VALUES
  ('finding-the-right-therapist','Finding the Right Therapist',
   'A short guide to matching with a therapist who actually fits.',
   '## Why fit matters\nResearch consistently shows that the *therapeutic alliance* is one of the strongest predictors of outcomes.\n\n## What to look for\n- Specialty in your concern\n- Style that matches how you process\n- Logistics that work for your life',
   'https://brightertomorrowtherapy.com/wp-content/uploads/2026/04/160420261776380246-1024x669.jpeg',
   'Brighter Tomorrow Team', now() - interval '7 days'),
  ('managing-anxiety-day-to-day','Managing Anxiety Day to Day',
   'Small habits that meaningfully reduce anxiety over time.',
   '## Start small\nFive minutes of slow breathing in the morning beats an ambitious plan you abandon.\n\n## Notice and name\nLabeling an emotion reduces its grip on you.',
   'https://brightertomorrowtherapy.com/wp-content/uploads/2026/04/130420261776038595-1024x683.jpeg',
   'Brighter Tomorrow Team', now() - interval '14 days'),
  ('what-to-expect-first-session','What to Expect in Your First Session',
   'Demystifying that first appointment.',
   '## Mostly listening\nYour first session is mostly your therapist getting to know you. There is no script you need to follow.',
   'https://brightertomorrowtherapy.com/wp-content/uploads/2026/04/istockphoto-2197384352-612x612-1.jpg',
   'Brighter Tomorrow Team', now() - interval '21 days');

COMMIT;

-- 021_free_resources_workbooks.sql
-- Populate the free, downloadable workbooks shown on /services/journal.
-- Files live in web/public/downloads/ (public marketing freebies, NOT PHI);
-- cta_url points at the static download path. Idempotent: clears existing
-- kind='workbook' rows, then re-inserts.
DELETE FROM bt.free_resources WHERE kind = 'workbook';

INSERT INTO bt.free_resources (kind, title, description, image_url, cta_label, cta_url, position, published) VALUES
  ('workbook', 'Comfort Zone Workbook',
   'Ready to Break Free from Your Comfort Zone? Download this FREE guide of evidence-based techniques.',
   '/images/services/journal/comfort-zone.webp',
   'Download', '/downloads/comfort-zone-workbook.pdf', 1, TRUE),
  ('workbook', 'Healing Wounds of People-Pleasing',
   'Ready to Break Free from People-Pleasing? Download this FREE guide and reconnect with what you actually want.',
   '/images/services/journal/healing-wounds.webp',
   'Download', '/downloads/healing-wounds-of-people-pleasing.pdf', 2, TRUE),
  ('workbook', '7 Ways for Moving On After a Breakup',
   'Want to Move On After a Breakup? Download this FREE guide of seven proven strategies.',
   '/images/services/journal/moving-on.webp',
   'Download', '/downloads/moving-on-after-a-breakup.pdf', 3, TRUE),
  ('workbook', 'Real Reflections Journal (Fillable)',
   'Ditch the Negative Self-Talk and Focus on Positivity — a fillable journal with prompts to spark honest reflection.',
   '/images/services/journal/real-reflections.webp',
   'Download', '/downloads/real-reflections-journal-fillable.pdf', 4, TRUE),
  ('workbook', '5-Minute Grounding Techniques',
   'Feeling overwhelmed? Download these FREE 5-minute grounding techniques to come back to calm anywhere.',
   '/images/services/journal/book-cover.jpg',
   'Download', '/downloads/5-minute-grounding-techniques.docx', 5, TRUE);

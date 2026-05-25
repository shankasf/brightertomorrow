-- 019_contact_dropdown_pages.sql
-- Restructure the header "Contact" dropdown to hold the three contact-area pages:
--   Contact                    -> /contact                    (full contact page, mirrors .com)
--   Careers                    -> /careers                    (mirrors .com careers page)
--   Quick Appointment request  -> /contact/quick-appointment  (former /contact booking flow)
-- Idempotent: clears existing children of the Contact parent, then re-inserts.
DO $$
DECLARE
  contact_id integer;
BEGIN
  SELECT id INTO contact_id
  FROM bt.nav_items
  WHERE location = 'header' AND parent_id IS NULL AND label = 'Contact'
  LIMIT 1;

  IF contact_id IS NULL THEN
    INSERT INTO bt.nav_items (label, href, position, location)
    VALUES ('Contact', '/contact', 8, 'header')
    RETURNING id INTO contact_id;
  ELSE
    -- keep the parent pointing at the full contact page
    UPDATE bt.nav_items SET href = '/contact' WHERE id = contact_id;
    DELETE FROM bt.nav_items WHERE parent_id = contact_id;
  END IF;

  INSERT INTO bt.nav_items (parent_id, label, href, position, location) VALUES
    (contact_id, 'Contact',                   '/contact',                   1, 'header'),
    (contact_id, 'Careers',                   '/careers',                   2, 'header'),
    (contact_id, 'Quick Appointment request', '/contact/quick-appointment', 3, 'header');
END $$;

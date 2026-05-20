-- 018_nav_href_fixes.sql
-- Fix stale nav hrefs that 404 in production:
--   /about/approach  -> /our-approach
--   /about/story     -> /our-story
--   /contact/careers -> removed entirely (no careers page exists)
UPDATE bt.nav_items SET href = '/our-approach' WHERE href = '/about/approach';
UPDATE bt.nav_items SET href = '/our-story'    WHERE href = '/about/story';
DELETE FROM bt.nav_items WHERE href = '/contact/careers';

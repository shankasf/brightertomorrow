-- migrate:up

-- Link each blog post to an authoring therapist and record the specialty used
-- to pick that author. `specialty` is the derived topic bucket (mapped from the
-- post title against the team specialties taxonomy); `author_member_id` is the
-- assigned therapist, which drives the author name, credentials, and headshot
-- shown on the public post. Marketing content only (no PHI). Idempotent.

BEGIN;
SET search_path = bt, public;

ALTER TABLE bt.blog_posts
  ADD COLUMN IF NOT EXISTS specialty        text,
  ADD COLUMN IF NOT EXISTS author_member_id bigint
    REFERENCES bt.team_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS blog_posts_author_member_idx
  ON bt.blog_posts (author_member_id);

COMMIT;

-- migrate:down

BEGIN;
SET search_path = bt, public;
DROP INDEX IF EXISTS bt.blog_posts_author_member_idx;
ALTER TABLE bt.blog_posts
  DROP COLUMN IF EXISTS author_member_id,
  DROP COLUMN IF EXISTS specialty;
COMMIT;

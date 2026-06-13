-- migrate:up

-- Blog category taxonomy to mirror the WordPress (.com) /category/<slug> archive
-- pages during the .com→.cloud URL parity migration. Categories are many-to-many
-- with posts. Marketing content only (no PHI). Idempotent via IF NOT EXISTS.

BEGIN;

CREATE TABLE IF NOT EXISTS bt.blog_categories (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug     text NOT NULL UNIQUE,
  name     text NOT NULL,
  position int  NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bt.blog_post_categories (
  post_id     bigint NOT NULL REFERENCES bt.blog_posts(id)      ON DELETE CASCADE,
  category_id bigint NOT NULL REFERENCES bt.blog_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, category_id)
);

CREATE INDEX IF NOT EXISTS blog_post_categories_category_idx
  ON bt.blog_post_categories (category_id);

COMMIT;

-- migrate:down

BEGIN;
DROP TABLE IF EXISTS bt.blog_post_categories;
DROP TABLE IF EXISTS bt.blog_categories;
COMMIT;

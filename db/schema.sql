-- Brighter Tomorrow Therapy — application schema
-- Target: PostgreSQL 17, role: app, database: app

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS bt;
SET search_path = bt, public;

-- ---------- Site-wide settings & navigation ----------
CREATE TABLE IF NOT EXISTS site_settings (
  id              SMALLINT PRIMARY KEY DEFAULT 1,
  brand_name      TEXT NOT NULL,
  tagline         TEXT,
  primary_phone   TEXT,
  primary_email   TEXT,
  primary_color   TEXT NOT NULL DEFAULT '#0170B9',
  text_color      TEXT NOT NULL DEFAULT '#3a3a3a',
  muted_color     TEXT NOT NULL DEFAULT '#4B4F58',
  surface_color   TEXT NOT NULL DEFAULT '#F5F5F5',
  logo_url        TEXT,
  hero_image_url  TEXT,
  business_hours  JSONB NOT NULL DEFAULT '{}'::jsonb,
  social          JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT site_settings_singleton CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS nav_items (
  id          BIGSERIAL PRIMARY KEY,
  parent_id   BIGINT REFERENCES nav_items(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  href        TEXT NOT NULL,
  position    INT  NOT NULL DEFAULT 0,
  location    TEXT NOT NULL DEFAULT 'header' CHECK (location IN ('header','footer'))
);
CREATE INDEX IF NOT EXISTS nav_items_parent_idx ON nav_items(parent_id);
CREATE INDEX IF NOT EXISTS nav_items_loc_pos_idx ON nav_items(location, position);

-- ---------- Locations ----------
CREATE TABLE IF NOT EXISTS locations (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  address1    TEXT,
  address2    TEXT,
  city        TEXT,
  state       TEXT,
  postal_code TEXT,
  phone       TEXT,
  is_telehealth BOOLEAN NOT NULL DEFAULT FALSE,
  position    INT NOT NULL DEFAULT 0
);

-- ---------- Services & specialties ----------
CREATE TABLE IF NOT EXISTS services (
  id          BIGSERIAL PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,
  title       TEXT NOT NULL,
  short_desc  TEXT,
  long_desc   TEXT,
  image_url   TEXT,
  icon        TEXT,
  position    INT NOT NULL DEFAULT 0,
  published   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS services_pub_pos_idx ON services(published, position);

CREATE TABLE IF NOT EXISTS specialties (
  id          BIGSERIAL PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,
  title       TEXT NOT NULL,
  short_desc  TEXT,
  image_url   TEXT,
  position    INT NOT NULL DEFAULT 0,
  published   BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------- Team ----------
CREATE TABLE IF NOT EXISTS team_groups (
  id          BIGSERIAL PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  position    INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS team_members (
  id          BIGSERIAL PRIMARY KEY,
  group_id    BIGINT REFERENCES team_groups(id) ON DELETE SET NULL,
  full_name   TEXT NOT NULL,
  credentials TEXT,
  role        TEXT,
  bio         TEXT,
  photo_url   TEXT,
  email       TEXT,
  accepts_new BOOLEAN NOT NULL DEFAULT TRUE,
  position    INT NOT NULL DEFAULT 0,
  published   BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS team_members_group_idx ON team_members(group_id, position);

-- ---------- Testimonials ----------
CREATE TABLE IF NOT EXISTS testimonials (
  id          BIGSERIAL PRIMARY KEY,
  author      TEXT NOT NULL,
  quote       TEXT NOT NULL,
  rating      SMALLINT CHECK (rating BETWEEN 1 AND 5),
  position    INT NOT NULL DEFAULT 0,
  published   BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------- Blog ----------
CREATE TABLE IF NOT EXISTS blog_posts (
  id          BIGSERIAL PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,
  title       TEXT NOT NULL,
  excerpt     TEXT,
  body_md     TEXT,
  cover_url   TEXT,
  author      TEXT,
  published   BOOLEAN NOT NULL DEFAULT TRUE,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blog_posts_pub_idx ON blog_posts(published, published_at DESC);

-- ---------- FAQs ----------
CREATE TABLE IF NOT EXISTS faqs (
  id          BIGSERIAL PRIMARY KEY,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  category    TEXT,
  position    INT NOT NULL DEFAULT 0,
  published   BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------- Stats (homepage counters) ----------
CREATE TABLE IF NOT EXISTS stats (
  id          BIGSERIAL PRIMARY KEY,
  label       TEXT NOT NULL,
  value       NUMERIC NOT NULL,
  suffix      TEXT,
  position    INT NOT NULL DEFAULT 0
);

-- ---------- Contact form submissions ----------
CREATE TABLE IF NOT EXISTS contact_submissions (
  id          BIGSERIAL PRIMARY KEY,
  full_name   TEXT NOT NULL,
  email       TEXT NOT NULL,
  phone       TEXT,
  subject     TEXT,
  message     TEXT NOT NULL,
  source      TEXT,
  ip          INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_submissions_created_idx ON contact_submissions(created_at DESC);

-- ---------- Newsletter ----------
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id          BIGSERIAL PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Press mentions ----------
CREATE TABLE IF NOT EXISTS press_mentions (
  id          BIGSERIAL PRIMARY KEY,
  outlet      TEXT NOT NULL,
  title       TEXT,
  url         TEXT NOT NULL,
  logo_url    TEXT,
  position    INT NOT NULL DEFAULT 0,
  published   BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------- Podcast (single row) ----------
CREATE TABLE IF NOT EXISTS podcast (
  id          SMALLINT PRIMARY KEY DEFAULT 1,
  show_name   TEXT NOT NULL,
  host        TEXT,
  tagline     TEXT,
  listen_url  TEXT,
  cover_url   TEXT,
  CONSTRAINT podcast_singleton CHECK (id = 1)
);

-- ---------- Free resources (e.g. Journal of the Month) ----------
CREATE TABLE IF NOT EXISTS free_resources (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  image_url   TEXT,
  cta_label   TEXT,
  cta_url     TEXT,
  position    INT NOT NULL DEFAULT 0,
  published   BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------- Chat sessions for AI agent ----------
CREATE TABLE IF NOT EXISTS chat_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id  TEXT,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id          BIGSERIAL PRIMARY KEY,
  session_id  UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content     TEXT NOT NULL,
  tool_name   TEXT,
  meta        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_session_idx ON chat_messages(session_id, created_at);

COMMIT;

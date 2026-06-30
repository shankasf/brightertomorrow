-- migrate:up

-- Blog semantic search — pgvector embeddings on bt.blog_posts.
-- Mirrors the FAQ pattern (004_faq_embeddings.sql): text-embedding-3-small,
-- 1536 dims, HNSW cosine index. Marketing content only (no PHI).
-- Column only for now — embedding generation/retrieval wired separately.
-- Idempotent via IF NOT EXISTS.

BEGIN;
SET search_path = bt, public;

-- Enable pgvector if not already present (idempotent).
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column. NULL until an embed job backfills it.
ALTER TABLE bt.blog_posts
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- HNSW index: better than IVFFlat for small, frequently-updated tables.
-- m=16, ef_construction=64 are the pgvector defaults — same as bt.faqs.
CREATE INDEX IF NOT EXISTS blog_posts_embedding_hnsw_idx
  ON bt.blog_posts
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

COMMIT;

-- migrate:down

BEGIN;
SET search_path = bt, public;
DROP INDEX IF EXISTS bt.blog_posts_embedding_hnsw_idx;
ALTER TABLE bt.blog_posts DROP COLUMN IF EXISTS embedding;
COMMIT;

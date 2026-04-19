-- =============================================================================
-- FAQ semantic search — pgvector embeddings
-- Replaces ILIKE substring match with cosine similarity (text-embedding-3-small,
-- 1536 dims — same model used by kb_documents).
-- =============================================================================

BEGIN;
SET search_path = bt, public;

-- Enable pgvector if not already present (idempotent).
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column.  NULL until the embed_faqs job backfills.
-- The search_faqs tool falls back to ILIKE while any row has embedding IS NULL.
ALTER TABLE bt.faqs
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- HNSW index: better than IVFFlat for small, frequently-updated tables.
-- m=16, ef_construction=64 are the pgvector defaults — fine for <1000 rows.
CREATE INDEX IF NOT EXISTS faqs_embedding_hnsw_idx
  ON bt.faqs
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Grant the app role access to the new column and index (schema already granted).
-- No explicit column-level grant needed — app already has SELECT/UPDATE on bt.faqs
-- from schema grants in the base schema / migration 003.

COMMIT;

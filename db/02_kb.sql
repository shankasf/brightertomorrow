-- Knowledge base for the chatbot — pgvector-backed
SET search_path = bt, public;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS kb_documents (
  id           BIGSERIAL PRIMARY KEY,
  url          TEXT NOT NULL,
  title        TEXT,
  section      TEXT,
  chunk_idx    INT  NOT NULL DEFAULT 0,
  content      TEXT NOT NULL,
  token_count  INT,
  embedding    vector(1536),                       -- text-embedding-3-small
  source_hash  TEXT NOT NULL,                      -- sha256 of url+chunk_idx+content
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_hash)
);

CREATE INDEX IF NOT EXISTS kb_documents_url_idx ON kb_documents(url);

-- Cosine-distance ANN index. Lists ~ sqrt(rows); we recreate after bulk insert.
CREATE INDEX IF NOT EXISTS kb_documents_embedding_idx
  ON kb_documents USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

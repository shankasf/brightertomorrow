"""Embed all blog posts and store vectors in bt.blog_posts.embedding.

Run as a one-shot k8s Job or manually:
    python -m app.ingestion.embed_blogs

Embeds: title only. Duplicate detection compares a candidate title against the
corpus, so storing title-only vectors keeps the comparison symmetric (title vs
title) — mixing body text in would skew similarity against short title queries.
Covers BOTH published posts and drafts in review — duplicate detection must see
the full corpus, including unpublished drafts awaiting approval.

Safe to re-run — updates every blog post regardless of whether embedding is
already set, so it picks up edits made after the initial backfill. Marketing
content only (no PHI).
"""
from __future__ import annotations

import logging
import os
import sys

from openai import OpenAI

from ..core.db import conn

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

EMBED_MODEL = os.environ.get("OPENAI_EMBED_MODEL", "text-embedding-3-small")
BATCH_SIZE = 64  # OpenAI embeddings endpoint accepts up to 2048 inputs


def _vec_literal(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.7f}" for x in v) + "]"


def embed_all_blogs() -> int:
    """Embed every blog post and persist to DB. Returns the number embedded."""
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        # Raise (not sys.exit) — also callable from a thread executor where
        # SystemExit (a BaseException) would escape `except Exception`.
        raise RuntimeError("OPENAI_API_KEY not set")

    client = OpenAI(api_key=api_key)

    with conn() as c, c.cursor() as cur:
        cur.execute("SELECT id, title FROM bt.blog_posts ORDER BY id")
        rows = cur.fetchall()

    if not rows:
        logger.info("No blog posts found — nothing to embed")
        return 0

    logger.info("Embedding %d blog posts using %s", len(rows), EMBED_MODEL)

    embedded = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        texts = [(t or "").strip() or "(untitled)" for _, t in batch]

        resp = client.embeddings.create(model=EMBED_MODEL, input=texts)
        embeddings = [item.embedding for item in resp.data]

        with conn() as c, c.cursor() as cur:
            for (post_id, _), vec in zip(batch, embeddings):
                cur.execute(
                    "UPDATE bt.blog_posts SET embedding = %s::vector WHERE id = %s",
                    (_vec_literal(vec), post_id),
                )

        embedded += len(batch)
        logger.info("  embedded %d/%d", embedded, len(rows))

    logger.info("Done — %d blog posts embedded", embedded)
    return embedded


def embed_blog(post_id: int) -> bool:
    """Embed a single blog post by id (title only). Returns True if a row was
    updated. Called by the gateway after an admin blog create/update so the new
    or edited post joins the dedup corpus immediately."""
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")

    with conn() as c, c.cursor() as cur:
        cur.execute("SELECT id, title FROM bt.blog_posts WHERE id = %s", (post_id,))
        row = cur.fetchone()
    if not row:
        logger.warning("embed_blog: post %s not found", post_id)
        return False

    title = (row[1] or "").strip() or "(untitled)"
    resp = OpenAI(api_key=api_key).embeddings.create(model=EMBED_MODEL, input=[title])
    vec = resp.data[0].embedding

    with conn() as c, c.cursor() as cur:
        cur.execute(
            "UPDATE bt.blog_posts SET embedding = %s::vector WHERE id = %s",
            (_vec_literal(vec), post_id),
        )
    logger.info("embed_blog: embedded post %s", post_id)
    return True


if __name__ == "__main__":
    count = embed_all_blogs()
    sys.exit(0 if count >= 0 else 1)

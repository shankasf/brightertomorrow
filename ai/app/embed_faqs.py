"""Embed all published FAQs and store vectors in bt.faqs.embedding.

Run as a one-shot k8s Job or manually:
    python -m app.embed_faqs

Embeds: question + ' ' + answer  (gives the model both halves for retrieval).
Safe to re-run — updates every published FAQ regardless of whether embedding
is already set, so it picks up edits made after the initial backfill.
"""
from __future__ import annotations

import logging
import os
import sys

from openai import OpenAI

from .db import conn

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

EMBED_MODEL = os.environ.get("OPENAI_EMBED_MODEL", "text-embedding-3-small")
BATCH_SIZE = 64  # OpenAI embeddings endpoint accepts up to 2048 inputs


def _vec_literal(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.7f}" for x in v) + "]"


def embed_all_faqs() -> int:
    """Embed every published FAQ and persist to DB. Returns the number embedded."""
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        logger.error("OPENAI_API_KEY not set")
        sys.exit(1)

    client = OpenAI(api_key=api_key)

    with conn() as c, c.cursor() as cur:
        cur.execute(
            "SELECT id, question, answer FROM bt.faqs WHERE published ORDER BY position"
        )
        rows = cur.fetchall()

    if not rows:
        logger.info("No published FAQs found — nothing to embed")
        return 0

    logger.info("Embedding %d FAQs using %s", len(rows), EMBED_MODEL)

    # Batch to stay under API limits (overkill for 5 FAQs, future-proof for 100+).
    embedded = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        # Combine question + answer so retrieval captures both halves.
        texts = [f"{q} {a}" for _, q, a in batch]

        resp = client.embeddings.create(model=EMBED_MODEL, input=texts)
        embeddings = [item.embedding for item in resp.data]

        with conn() as c, c.cursor() as cur:
            for (faq_id, _, _), vec in zip(batch, embeddings):
                cur.execute(
                    "UPDATE bt.faqs SET embedding = %s::vector WHERE id = %s",
                    (_vec_literal(vec), faq_id),
                )

        embedded += len(batch)
        logger.info("  embedded %d/%d", embedded, len(rows))

    logger.info("Done — %d FAQs embedded", embedded)
    return embedded


if __name__ == "__main__":
    count = embed_all_faqs()
    sys.exit(0 if count >= 0 else 1)

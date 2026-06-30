"""Semantic duplicate check for proposed blog topics.

Given a candidate blog topic/title (and optional excerpt), embed it and return
the nearest existing blog posts by cosine similarity. Used before creating new
blogs so we only write genuinely novel posts instead of near-duplicates of the
existing corpus (published posts + drafts in review).

Usage:
    python -m app.ingestion.blog_dupecheck "Managing anxiety in Summerlin"
    python -m app.ingestion.blog_dupecheck --threshold 0.82 --top 5 "<topic>"
    echo '["topic one","topic two"]' | python -m app.ingestion.blog_dupecheck --stdin

Output is JSON on stdout: for each query, the top matches with a `score`
(1 = identical, higher = more similar) and a `duplicate` flag when the best
match meets/exceeds the threshold. Marketing content only (no PHI).
"""
from __future__ import annotations

import argparse
import json
import os
import sys

from openai import OpenAI

from ..core.db import conn

EMBED_MODEL = os.environ.get("OPENAI_EMBED_MODEL", "text-embedding-3-small")
# Cosine similarity at/above which a candidate is flagged as a near-duplicate.
# Empirically (title-only, text-embedding-3-small) genuinely same-topic posts
# land ~0.78-0.85, clearly-distinct topics <0.5. 0.78 catches paraphrased dupes;
# treat the flag as TRIAGE — always eyeball the top matches, the score is a hint.
DEFAULT_THRESHOLD = 0.78
DEFAULT_TOP = 5


def _vec_literal(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.7f}" for x in v) + "]"


def check(queries: list[str], top: int, threshold: float) -> list[dict]:
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")
    client = OpenAI(api_key=api_key)

    resp = client.embeddings.create(model=EMBED_MODEL, input=queries)
    qvecs = [_vec_literal(item.embedding) for item in resp.data]

    results: list[dict] = []
    with conn() as c, c.cursor() as cur:
        for query, qvec in zip(queries, qvecs):
            cur.execute(
                """
                SELECT id, slug, title, published,
                       1 - (embedding <=> %s::vector) AS score
                FROM bt.blog_posts
                WHERE embedding IS NOT NULL
                ORDER BY embedding <=> %s::vector
                LIMIT %s
                """,
                (qvec, qvec, top),
            )
            matches = [
                {
                    "id": r[0],
                    "slug": r[1],
                    "title": r[2],
                    "published": r[3],
                    "score": round(float(r[4]), 4),
                }
                for r in cur.fetchall()
            ]
            best = matches[0]["score"] if matches else 0.0
            results.append(
                {
                    "query": query,
                    "duplicate": best >= threshold,
                    "best_score": best,
                    "matches": matches,
                }
            )
    return results


def main() -> int:
    ap = argparse.ArgumentParser(description="Semantic duplicate check for blog topics")
    ap.add_argument("topics", nargs="*", help="One or more candidate topics/titles")
    ap.add_argument("--stdin", action="store_true", help="Read a JSON array of topics from stdin")
    ap.add_argument("--top", type=int, default=DEFAULT_TOP, help="Nearest matches to return")
    ap.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD, help="Duplicate cutoff")
    args = ap.parse_args()

    queries = list(args.topics)
    if args.stdin:
        queries += json.loads(sys.stdin.read())
    queries = [q for q in (s.strip() for s in queries) if q]
    if not queries:
        ap.error("no topics provided")

    print(json.dumps(check(queries, args.top, args.threshold), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

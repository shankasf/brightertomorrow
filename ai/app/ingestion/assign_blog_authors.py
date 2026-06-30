"""Classify each blog post to a therapist specialty and assign an author.

For every row in bt.blog_posts:
  1. classify the title into ONE specialty drawn from the live team roster
     (bt.team_members.specialties) plus a "General" catch-all, via OpenAI;
  2. store it in bt.blog_posts.specialty;
  3. set author_member_id to a therapist whose specialties include that value,
     rotating round-robin so authorship is evenly spread; "General" (or any
     specialty with no matching therapist) rotates across the whole roster;
  4. sync the legacy free-text author column to "Full Name, Credentials" so the
     public site + SEO keep working.

Run:  python -m app.ingestion.assign_blog_authors           (assign only NULL author_member_id)
      python -m app.ingestion.assign_blog_authors --all     (reassign everything)

Marketing content only (no PHI). Safe to re-run.
"""
from __future__ import annotations

import json
import logging
import os
import sys

from openai import OpenAI

from ..core.db import conn

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
BATCH = 40
GENERAL = "General"


def _load_roster() -> tuple[list[str], dict[str, list[int]]]:
    """Return (allowed_specialties, specialty -> [member_id...]) for published staff."""
    with conn() as c, c.cursor() as cur:
        cur.execute(
            "SELECT id, specialties FROM bt.team_members WHERE published ORDER BY id"
        )
        rows = cur.fetchall()
    by_spec: dict[str, list[int]] = {}
    all_ids: list[int] = []
    for mid, specs in rows:
        all_ids.append(mid)
        for s in specs or []:
            by_spec.setdefault(s, []).append(mid)
    by_spec[GENERAL] = all_ids
    allowed = sorted(s for s in by_spec if s != GENERAL) + [GENERAL]
    return allowed, by_spec


def _classify(client: OpenAI, titles: list[str], allowed: list[str]) -> list[str]:
    """Return one specialty per title (same order). Falls back to General on error."""
    listing = "\n".join(f"{i}. {t}" for i, t in enumerate(titles))
    prompt = (
        "You label therapy-practice blog posts with the single best-matching "
        "clinical specialty for choosing an author.\n\n"
        f"Allowed specialties (choose EXACTLY one per post, verbatim): {allowed}\n"
        "Rules: pick the most topically relevant specialty. Children/Teens/"
        "Adolescents/Youth for kid/teen/parenting topics; Couples for "
        "relationship/marriage topics; Reiki for reiki/energy-healing topics. "
        f"Use \"{GENERAL}\" ONLY when no listed specialty clearly fits.\n\n"
        f"Posts:\n{listing}\n\n"
        'Respond with JSON only: {"labels": ["<specialty for post 0>", ...]} '
        "with one entry per post in order."
    )
    try:
        resp = client.chat.completions.create(
            model=MODEL,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
        )
        labels = json.loads(resp.choices[0].message.content)["labels"]
    except Exception as exc:  # noqa: BLE001 — degrade gracefully, never abort the batch
        logger.warning("classify batch failed (%s) — defaulting to %s", exc, GENERAL)
        return [GENERAL] * len(titles)
    out = []
    for i in range(len(titles)):
        lab = labels[i] if i < len(labels) else GENERAL
        out.append(lab if lab in allowed else GENERAL)
    return out


def assign(reassign_all: bool) -> int:
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")
    client = OpenAI(api_key=api_key)

    allowed, by_spec = _load_roster()
    # member_id -> "Full Name, CRED" for the legacy author text column
    with conn() as c, c.cursor() as cur:
        cur.execute("SELECT id, full_name, credentials FROM bt.team_members")
        label_by_id = {
            mid: (f"{name}, {cred}" if cred else name) for mid, name, cred in cur.fetchall()
        }
        where = "" if reassign_all else " WHERE author_member_id IS NULL"
        cur.execute(f"SELECT id, title FROM bt.blog_posts{where} ORDER BY id")
        posts = cur.fetchall()

    if not posts:
        logger.info("No posts to assign")
        return 0

    logger.info("Classifying %d posts with %s", len(posts), MODEL)
    rr: dict[str, int] = {}  # round-robin cursor per specialty
    updates: list[tuple[str, int, str, int]] = []  # (specialty, member_id, author_text, post_id)

    for i in range(0, len(posts), BATCH):
        chunk = posts[i : i + BATCH]
        labels = _classify(client, [t or "(untitled)" for _, t in chunk], allowed)
        for (post_id, _), spec in zip(chunk, labels):
            members = by_spec.get(spec) or by_spec[GENERAL]
            idx = rr.get(spec, 0)
            member_id = members[idx % len(members)]
            rr[spec] = idx + 1
            updates.append((spec, member_id, label_by_id.get(member_id, ""), post_id))
        logger.info("  classified %d/%d", min(i + BATCH, len(posts)), len(posts))

    with conn() as c, c.cursor() as cur:
        for spec, member_id, author_text, post_id in updates:
            cur.execute(
                "UPDATE bt.blog_posts SET specialty=%s, author_member_id=%s, author=%s WHERE id=%s",
                (spec, member_id, author_text, post_id),
            )
    logger.info("Assigned authors for %d posts", len(updates))
    return len(updates)


if __name__ == "__main__":
    count = assign(reassign_all="--all" in sys.argv)
    sys.exit(0 if count >= 0 else 1)

"""Seed bt.kb_documents with therapist profile content from the Brighter Tomorrow team.

WHY: Chat/voice KB queries like "who specializes in trauma?" or "tell me about
Christie Johnson" need therapist bios in the vector store. This module builds one
KB doc per therapist and upserts it with a fresh embedding.

Source of truth (single, no drift):
  web/src/content/team/*.json  — therapist profile bios (public marketing copy)
  bt.team_members.specialties_text — the current verbatim specialties sentence
                                     shown on the /team card (joined by full_name)

PHI: none. These are public-facing marketing bios — safe to embed and store as
plaintext on the local Postgres instance.

Runtime: run from the repo (the JSON dir is resolved relative to this file, or set
TEAM_JSON_DIR). Not wired into a k8s Job — invoke manually after the team roster
changes:  python -m app.ingestion.seed_team_kb

Re-runnable: every therapist doc under URL_PREFIX is deleted and re-inserted on each
run, so renamed/removed/edited entries never leave stale rows behind.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path

from openai import OpenAI

from ..core.db import conn

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

EMBED_MODEL = os.environ.get("OPENAI_EMBED_MODEL", "text-embedding-3-small")
URL_PREFIX = "curated://bt/team"

# Therapist profile JSON lives in the web tree. Resolve relative to this file
# (ai/app/ingestion/seed_team_kb.py -> repo root is parents[3]) or override.
TEAM_JSON_DIR = os.environ.get("TEAM_JSON_DIR") or str(
    Path(__file__).resolve().parents[3] / "web" / "src" / "content" / "team"
)


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------


def _load_therapists() -> list[dict]:
    """Load every therapist profile JSON from TEAM_JSON_DIR (sorted by slug)."""
    d = Path(TEAM_JSON_DIR)
    files = sorted(d.glob("*.json"))
    if not files:
        logger.error("No therapist JSON found in %s", d)
        sys.exit(1)
    out: list[dict] = []
    for f in files:
        out.append(json.loads(f.read_text(encoding="utf-8")))
    logger.info("Loaded %d therapist profiles from %s", len(out), d)
    return out


def _specialties_by_name() -> dict[str, str]:
    """Current specialties sentence per therapist, keyed by full_name.

    Best-effort: if the DB is unreachable the docs are still built from the JSON
    (just without the explicit specialties line).
    """
    try:
        with conn() as c, c.cursor() as cur:
            cur.execute(
                "SELECT full_name, specialties_text FROM bt.team_members "
                "WHERE specialties_text IS NOT NULL AND specialties_text <> ''"
            )
            return {row[0]: row[1] for row in cur.fetchall()}
    except Exception as e:  # noqa: BLE001 — DB is optional for content assembly
        logger.warning("Could not load specialties_text from bt.team_members: %s", e)
        return {}


# ---------------------------------------------------------------------------
# Doc model
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Doc:
    slug: str
    title: str
    section: str
    content: str

    @property
    def url(self) -> str:
        return f"{URL_PREFIX}/{self.slug}"

    @property
    def source_hash(self) -> str:
        return hashlib.sha256(
            f"{self.url}\n{self.title}\n{self.section}\n{self.content}".encode("utf-8")
        ).hexdigest()


# ---------------------------------------------------------------------------
# Content assembly
# ---------------------------------------------------------------------------

_MAX_CONTENT_CHARS = 1500


def _build_title(t: dict) -> str:
    """Assemble the retrieval-friendly title for a therapist dict."""
    name = t["full_name"]
    creds = t.get("credentials_suffix") or ""
    role = t.get("role") or ""
    title = f"Therapist: {name}"
    if creds:
        title += f", {creds}"
    if role:
        title += f" — {role}"
    return title


def _build_content(t: dict) -> str:
    """
    Assemble a clean, readable plaintext blob from a therapist profile.
    Stays under _MAX_CONTENT_CHARS by progressively dropping the least-informative
    content: second bio paragraph first, then extra modality lines, then extra
    qualifications, until under budget. The header + specialties line are always kept.
    """
    name = t["full_name"]
    creds = t.get("credentials_suffix") or ""
    role = t.get("role") or ""

    # Header line
    header = name
    if creds:
        header += f", {creds}"
    if role:
        header += f" — {role}"
    header += " at Brighter Tomorrow Therapy."

    spec_text = (t.get("specialties_text") or "").strip()
    who = t.get("who_i_help") or []
    modalities = t.get("modalities") or []
    bios = t.get("bio_paragraphs") or []
    quals = t.get("qualifications") or []
    edu = t.get("education") or []
    edu_set = set(edu)
    extra_quals = [q for q in quals if q not in edu_set]

    def _assemble(
        who_items: list,
        mod_items: list,
        bio_items: list,
        edu_items: list,
        qual_items: list,
    ) -> str:
        parts: list[str] = [header]
        if spec_text:
            parts.append(f"\nSpecialties: {spec_text}")
        if who_items:
            parts.append("\nWho they help:")
            parts.extend(f"  - {item}" for item in who_items)
        if mod_items:
            parts.append("\nApproach & modalities:")
            parts.extend(f"  - {m['name']}: {m['description']}" for m in mod_items)
        if bio_items:
            parts.append("\n" + "\n\n".join(bio_items))
        if edu_items or qual_items:
            parts.append("\nBackground:")
            parts.extend(f"  - {e}" for e in edu_items)
            parts.extend(f"  - {q}" for q in qual_items)
        return "\n".join(parts)

    # Start with full content, then progressively shed to meet the budget.
    # Trim order (least-informative last):
    #   1. Drop second bio paragraph
    #   2. Drop extra qualifications (already covered by education)
    #   3. Drop modalities beyond the first 3
    #   4. Drop modalities beyond the first 2
    #   5. Drop who_i_help beyond the first 3 lines
    candidates = [
        (bios[:2], modalities, edu, extra_quals),
        (bios[:1], modalities, edu, extra_quals),
        (bios[:1], modalities, edu, []),
        (bios[:1], modalities[:3], edu, []),
        (bios[:1], modalities[:2], edu, []),
        (bios[:1], modalities[:2], edu[:2], []),
    ]

    for bio_sel, mod_sel, edu_sel, qual_sel in candidates:
        content = _assemble(who, mod_sel, bio_sel, edu_sel, qual_sel)
        if len(content) <= _MAX_CONTENT_CHARS:
            return content

    # Absolute fallback: header + specialties + first bio only
    return _assemble([], [], bios[:1], [], [])


def _build_docs() -> tuple[Doc, ...]:
    therapists = _load_therapists()
    specs = _specialties_by_name()
    docs = []
    for raw in therapists:
        t = {**raw, "specialties_text": specs.get(raw["full_name"])}
        docs.append(
            Doc(
                slug=f"team-{t['slug']}",
                title=_build_title(t),
                section="therapists",
                content=_build_content(t),
            )
        )
    return tuple(docs)


# ---------------------------------------------------------------------------
# Embedding helpers — mirrors seed_curated_kb.py
# ---------------------------------------------------------------------------


def _vec_literal(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.7f}" for x in v) + "]"


# ---------------------------------------------------------------------------
# Seed entrypoint
# ---------------------------------------------------------------------------


def seed_team_kb() -> int:
    """Embed all therapist docs and upsert into bt.kb_documents. Returns count."""
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        logger.error("OPENAI_API_KEY not set")
        sys.exit(1)

    client = OpenAI(api_key=api_key)

    docs = _build_docs()
    texts = [f"{d.title}\n{d.section}\n{d.content}" for d in docs]
    logger.info(
        "Embedding %d therapist KB documents using %s", len(docs), EMBED_MODEL
    )
    resp = client.embeddings.create(model=EMBED_MODEL, input=texts)
    vecs = [item.embedding for item in resp.data]

    with conn() as c, c.cursor() as cur:
        # Clear prior therapist docs so renamed/removed/edited entries (which get a
        # new content hash) don't linger as duplicates.
        cur.execute(
            "DELETE FROM bt.kb_documents WHERE url LIKE %s", (f"{URL_PREFIX}/%",)
        )
        for doc, vec in zip(docs, vecs):
            cur.execute(
                """
                INSERT INTO bt.kb_documents
                    (url, title, section, chunk_idx, content, token_count, embedding, source_hash)
                VALUES
                    (%s, %s, %s, 0, %s, %s, %s::vector, %s)
                ON CONFLICT (source_hash) DO UPDATE SET
                    url = EXCLUDED.url,
                    title = EXCLUDED.title,
                    section = EXCLUDED.section,
                    content = EXCLUDED.content,
                    token_count = EXCLUDED.token_count,
                    embedding = EXCLUDED.embedding
                """,
                (
                    doc.url,
                    doc.title,
                    doc.section,
                    doc.content,
                    len(doc.content) // 4,  # rough token estimate
                    _vec_literal(vec),
                    doc.source_hash,
                ),
            )
    logger.info("Seeded %d therapist KB documents", len(docs))
    return len(docs)


if __name__ == "__main__":
    n = seed_team_kb()
    sys.exit(0 if n > 0 else 1)

"""Function tools for the agent.

Each tool reads from the Brighter Tomorrow Postgres so the assistant can
answer with real, current site data instead of hallucinating.
"""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Any

from agents import function_tool
from openai import OpenAI

from .db import conn

EMBED_MODEL = os.environ.get("OPENAI_EMBED_MODEL", "text-embedding-3-small")


@lru_cache(maxsize=1)
def _openai() -> OpenAI:
    return OpenAI()


def _vec_literal(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.7f}" for x in v) + "]"


@function_tool
def list_services() -> list[dict[str, Any]]:
    """Return the list of therapy services offered, with slug, title, and short description."""
    with conn() as c, c.cursor() as cur:
        cur.execute(
            "SELECT slug, title, short_desc FROM services WHERE published ORDER BY position"
        )
        return [{"slug": s, "title": t, "short_desc": d} for s, t, d in cur.fetchall()]


@function_tool
def get_service(slug: str) -> dict[str, Any] | None:
    """Look up one service by slug. Returns title, short and long descriptions."""
    with conn() as c, c.cursor() as cur:
        cur.execute(
            "SELECT slug, title, short_desc, long_desc FROM services WHERE slug = %s AND published",
            (slug,),
        )
        row = cur.fetchone()
        if not row:
            return None
        return {"slug": row[0], "title": row[1], "short_desc": row[2], "long_desc": row[3]}


@function_tool
def list_specialties() -> list[dict[str, Any]]:
    """Return the list of clinical specialties (anxiety, trauma, couples, etc.)."""
    with conn() as c, c.cursor() as cur:
        cur.execute(
            "SELECT slug, title, short_desc FROM specialties WHERE published ORDER BY position"
        )
        return [{"slug": s, "title": t, "short_desc": d} for s, t, d in cur.fetchall()]


@function_tool
def list_locations() -> list[dict[str, Any]]:
    """Return office locations and whether telehealth is available."""
    with conn() as c, c.cursor() as cur:
        cur.execute(
            "SELECT name, address1, city, state, postal_code, phone, is_telehealth "
            "FROM locations ORDER BY position"
        )
        return [
            {
                "name": n, "address1": a, "city": c_, "state": st,
                "postal_code": z, "phone": p, "is_telehealth": tel,
            }
            for n, a, c_, st, z, p, tel in cur.fetchall()
        ]


@function_tool
def get_business_hours_and_contact() -> dict[str, Any]:
    """Return primary phone, email, and weekly business hours."""
    with conn() as c, c.cursor() as cur:
        cur.execute(
            "SELECT primary_phone, primary_email, business_hours FROM site_settings WHERE id = 1"
        )
        phone, email, hours = cur.fetchone()
        return {"phone": phone, "email": email, "hours": hours}


@function_tool
def search_faqs(query: str) -> list[dict[str, str]]:
    """Semantic search over the FAQ database using vector similarity.

    Returns up to 5 question/answer pairs most relevant to the query.
    Falls back to ILIKE keyword search if embeddings have not been generated yet.
    """
    # Check whether any embeddings exist yet.
    with conn() as c, c.cursor() as cur:
        cur.execute("SELECT 1 FROM bt.faqs WHERE published AND embedding IS NOT NULL LIMIT 1")
        has_embeddings = cur.fetchone() is not None

    if not has_embeddings:
        # Graceful degradation while the embed_faqs job is pending.
        with conn() as c, c.cursor() as cur:
            cur.execute(
                """
                SELECT question, answer FROM bt.faqs
                WHERE published AND (question ILIKE %s OR answer ILIKE %s)
                ORDER BY position LIMIT 5
                """,
                (f"%{query}%", f"%{query}%"),
            )
            return [{"question": q, "answer": a} for q, a in cur.fetchall()]

    resp = _openai().embeddings.create(model=EMBED_MODEL, input=query)
    qvec = _vec_literal(resp.data[0].embedding)

    with conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT question, answer,
                   1 - (embedding <=> %s::vector) AS score
            FROM bt.faqs
            WHERE published AND embedding IS NOT NULL
            ORDER BY embedding <=> %s::vector
            LIMIT 5
            """,
            (qvec, qvec),
        )
        rows = cur.fetchall()

    return [{"question": q, "answer": a, "score": round(float(s), 4)} for q, a, s in rows]


@function_tool
def request_intake_callback(full_name: str, email: str, phone: str, message: str) -> dict[str, Any]:
    """Record a callback request from a website visitor.

    Use this when a user wants someone to reach out to schedule an appointment.
    """
    with conn() as c, c.cursor() as cur:
        cur.execute(
            """
            INSERT INTO contact_submissions (full_name, email, phone, subject, message, source)
            VALUES (%s, %s, %s, %s, %s, 'chat-agent')
            RETURNING id
            """,
            (full_name, email, phone, "Intake callback", message),
        )
        new_id = cur.fetchone()[0]
        return {"ok": True, "id": new_id}


@function_tool
def list_team_members() -> list[dict[str, Any]]:
    """Return the canonical roster of therapists and student clinicians, grouped by team
    (Telehealth, E Russell office, N Durango office, Student Therapists)."""
    with conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT g.title AS team, m.full_name, m.credentials, m.role, m.bio,
                   m.accepts_new
            FROM team_members m
            LEFT JOIN team_groups g ON g.id = m.group_id
            WHERE m.published
            ORDER BY g.position, m.position, m.full_name
            """,
        )
        return [
            {
                "team": team, "full_name": name, "credentials": creds,
                "role": role, "bio": bio, "accepts_new_clients": accepts,
            }
            for team, name, creds, role, bio, accepts in cur.fetchall()
        ]


@function_tool
def kb_search(query: str, k: int = 5) -> list[dict[str, Any]]:
    """Semantic search over the scraped brightertomorrowtherapy.com knowledge base.

    Use this for any free-form question about the practice — its philosophy, what to
    expect, services in the visitor's own words, blog content, anything from the live
    site. Returns up to `k` snippets, each with `url`, `title`, and `content`.
    Always cite the source URL when you use a snippet.
    """
    k = max(1, min(int(k or 5), 8))
    resp = _openai().embeddings.create(model=EMBED_MODEL, input=query)
    qvec = _vec_literal(resp.data[0].embedding)
    with conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT url, title, content,
                   1 - (embedding <=> %s::vector) AS score
            FROM kb_documents
            ORDER BY embedding <=> %s::vector
            LIMIT %s
            """,
            (qvec, qvec, k),
        )
        rows = cur.fetchall()
    return [
        {"url": u, "title": t, "content": c, "score": round(float(s), 4)}
        for u, t, c, s in rows
    ]


ALL_TOOLS = [
    kb_search,
    list_services,
    get_service,
    list_specialties,
    list_team_members,
    list_locations,
    get_business_hours_and_contact,
    search_faqs,
    request_intake_callback,
]

# Named groups — agents import these instead of ALL_TOOLS for tighter scoping.
# Note: list_specialties and list_services appear in both INFO_TOOLS and MATCHING_TOOLS
# intentionally; each agent uses them with a different focus.
INFO_TOOLS = [
    kb_search,
    list_services,
    get_service,
    list_specialties,
    list_locations,
    get_business_hours_and_contact,
    search_faqs,
]

MATCHING_TOOLS = [
    list_team_members,
    list_specialties,
    list_services,
]

INTAKE_TOOLS = [
    request_intake_callback,
]

CRISIS_TOOLS: list = []

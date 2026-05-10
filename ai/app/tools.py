"""Function tools for the agent.

Each tool reads from the Brighter Tomorrow Postgres so the assistant can
answer with real, current site data instead of hallucinating.
"""
from __future__ import annotations

import contextlib
import contextvars
import logging
import os
import time
from functools import lru_cache
from typing import Any

from agents import function_tool
from openai import OpenAI

from .db import conn

# Per-request modality marker. Tools that submit intake / book appointments
# stamp this value into the gateway payload so admin-side reports can split
# voice traffic from chat traffic. Defaults to "chat-agent"; the voice
# WebSocket handler overrides it with "voice-agent" before running the agent.
agent_source: contextvars.ContextVar[str] = contextvars.ContextVar(
    "bt_agent_source", default="chat-agent"
)

EMBED_MODEL = os.environ.get("OPENAI_EMBED_MODEL", "text-embedding-3-small")

logger = logging.getLogger(__name__)


@contextlib.contextmanager
def _log_call(tool_name: str, **log_kwargs):
    """Context manager: logs tool entry at DEBUG and exit (ok/error) at INFO/ERROR with latency."""
    logger.debug("tool_call tool=%s %s", tool_name, " ".join(f"{k}={v}" for k, v in log_kwargs.items()))
    t0 = time.perf_counter()
    try:
        yield
        latency_ms = (time.perf_counter() - t0) * 1000
        logger.info("tool_ok tool=%s latency_ms=%.1f", tool_name, latency_ms)
    except Exception as exc:
        latency_ms = (time.perf_counter() - t0) * 1000
        logger.error("tool_error tool=%s latency_ms=%.1f error=%r", tool_name, latency_ms, exc, exc_info=True)
        raise


@lru_cache(maxsize=1)
def _openai() -> OpenAI:
    return OpenAI()


def _vec_literal(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.7f}" for x in v) + "]"


@function_tool
def list_services() -> list[dict[str, Any]]:
    """Return the list of therapy services offered, with slug, title, and short description."""
    with _log_call("list_services"):
        with conn() as c, c.cursor() as cur:
            cur.execute(
                "SELECT slug, title, short_desc FROM services WHERE published ORDER BY position"
            )
            rows = cur.fetchall()
        logger.debug("tool_result tool=list_services count=%d", len(rows))
        return [{"slug": s, "title": t, "short_desc": d} for s, t, d in rows]


@function_tool
def get_service(slug: str) -> dict[str, Any] | None:
    """Look up one service by slug. Returns title, short and long descriptions."""
    with _log_call("get_service", slug=slug):
        with conn() as c, c.cursor() as cur:
            cur.execute(
                "SELECT slug, title, short_desc, long_desc FROM services WHERE slug = %s AND published",
                (slug,),
            )
            row = cur.fetchone()
        if not row:
            logger.debug("tool_result tool=get_service slug=%s found=false", slug)
            return None
        logger.debug("tool_result tool=get_service slug=%s found=true", slug)
        return {"slug": row[0], "title": row[1], "short_desc": row[2], "long_desc": row[3]}


@function_tool
def list_specialties() -> list[dict[str, Any]]:
    """Return the list of clinical specialties (anxiety, trauma, couples, etc.)."""
    with _log_call("list_specialties"):
        with conn() as c, c.cursor() as cur:
            cur.execute(
                "SELECT slug, title, short_desc FROM specialties WHERE published ORDER BY position"
            )
            rows = cur.fetchall()
        logger.debug("tool_result tool=list_specialties count=%d", len(rows))
        return [{"slug": s, "title": t, "short_desc": d} for s, t, d in rows]


@function_tool
def list_locations() -> list[dict[str, Any]]:
    """Return office locations and whether telehealth is available."""
    with _log_call("list_locations"):
        with conn() as c, c.cursor() as cur:
            cur.execute(
                "SELECT name, address1, city, state, postal_code, phone, is_telehealth "
                "FROM locations ORDER BY position"
            )
            rows = cur.fetchall()
        logger.debug("tool_result tool=list_locations count=%d", len(rows))
        return [
            {
                "name": n, "address1": a, "city": c_, "state": st,
                "postal_code": z, "phone": p, "is_telehealth": tel,
            }
            for n, a, c_, st, z, p, tel in rows
        ]


@function_tool
def get_business_hours_and_contact() -> dict[str, Any]:
    """Return primary phone, email, and weekly business hours."""
    with _log_call("get_business_hours_and_contact"):
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
    with _log_call("search_faqs", query_len=len(query)):
        # Check whether any embeddings exist yet.
        with conn() as c, c.cursor() as cur:
            cur.execute("SELECT 1 FROM bt.faqs WHERE published AND embedding IS NOT NULL LIMIT 1")
            has_embeddings = cur.fetchone() is not None

        if not has_embeddings:
            logger.info("search_faqs fallback=keyword_ilike reason=no_embeddings")
            with conn() as c, c.cursor() as cur:
                cur.execute(
                    """
                    SELECT question, answer FROM bt.faqs
                    WHERE published AND (question ILIKE %s OR answer ILIKE %s)
                    ORDER BY position LIMIT 5
                    """,
                    (f"%{query}%", f"%{query}%"),
                )
                rows = cur.fetchall()
            logger.debug("tool_result tool=search_faqs mode=keyword count=%d", len(rows))
            return [{"question": q, "answer": a} for q, a in rows]

        t_embed = time.perf_counter()
        resp = _openai().embeddings.create(model=EMBED_MODEL, input=query)
        logger.debug(
            "search_faqs embed_latency_ms=%.1f model=%s",
            (time.perf_counter() - t_embed) * 1000, EMBED_MODEL,
        )
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

        if rows:
            logger.debug(
                "tool_result tool=search_faqs mode=vector count=%d top_score=%.4f",
                len(rows), float(rows[0][2]),
            )
        else:
            logger.debug("tool_result tool=search_faqs mode=vector count=0")

        return [{"question": q, "answer": a, "score": round(float(s), 4)} for q, a, s in rows]


_PLACEHOLDER_VALUES = frozenset({
    "", "not provided", "not provided yet", "not yet provided", "tbd",
    "n/a", "na", "unknown", "pending", "none given", "none", "null",
    "reason: (not provided yet).", "(not provided yet)",
})


def _is_placeholder(val: str) -> bool:
    """Return True if `val` is empty or exactly a known placeholder phrase."""
    clean = (val or "").strip().lower()
    return clean in _PLACEHOLDER_VALUES


@function_tool
def request_intake_callback(full_name: str, email: str, phone: str, message: str) -> dict[str, Any]:
    """Record a callback request from a website visitor.

    Use this when a user wants someone to reach out to schedule an appointment.
    Only call after you have substantive values for all four fields.
    """
    # Guard: reject premature calls with placeholder-shaped values so the agent
    # keeps gathering instead of submitting incomplete rows.
    for field_name, val in (("full_name", full_name), ("email", email), ("phone", phone), ("message", message)):
        if _is_placeholder(val):
            return {
                "ok": False,
                "error": f"incomplete: {field_name} missing or placeholder — ask the visitor before retrying",
            }

    parts = full_name.strip().split()
    first_name = parts[0] if parts else ""
    last_name = " ".join(parts[1:]) if len(parts) > 1 else first_name

    submit_body = {
        "flow": "coverage",          # treated as a callback request, not a booking
        "service": (message or "Intake callback")[:200],
        "payment_method": "self_pay",  # we don't know yet; staff will follow up
        "first_name": first_name,
        "last_name": last_name,
        # TODO: gateway should accept null DOB on flow=coverage; staff collects DOB on the follow-up call.
        "date_of_birth": "1900-01-01",
        "phone": phone,
        "email": email,
        "home_address": "Not provided",
        "sex": "Not provided",
        "notes": message,
        "source": agent_source.get(),
    }

    try:
        with _log_call("request_intake_callback_submit"):
            resp = gateway_post("/internal/intake/submit", submit_body)
    except Exception as exc:
        logger.exception("request_intake_callback_submit_error")
        return {"ok": False, "error": f"submit_failed: {exc}"}

    if not resp.get("ok"):
        return {"ok": False, "error": resp.get("error", "submit_failed")}

    return {"ok": True, "id": resp.get("submission_id")}


@function_tool
def list_team_members() -> list[dict[str, Any]]:
    """Return the canonical roster of therapists and student clinicians, grouped by team
    (Telehealth, E Russell office, N Durango office, Student Therapists)."""
    with _log_call("list_team_members"):
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
            rows = cur.fetchall()
        accepting = sum(1 for *_, accepts in rows if accepts)
        logger.debug(
            "tool_result tool=list_team_members total=%d accepting_new=%d",
            len(rows), accepting,
        )
        return [
            {
                "team": team, "full_name": name, "credentials": creds,
                "role": role, "bio": bio, "accepts_new_clients": accepts,
            }
            for team, name, creds, role, bio, accepts in rows
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
    with _log_call("kb_search", query_len=len(query), k=k):
        t_embed = time.perf_counter()
        resp = _openai().embeddings.create(model=EMBED_MODEL, input=query)
        logger.debug(
            "kb_search embed_latency_ms=%.1f model=%s",
            (time.perf_counter() - t_embed) * 1000, EMBED_MODEL,
        )
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
        if rows:
            logger.debug(
                "tool_result tool=kb_search count=%d top_score=%.4f",
                len(rows), float(rows[0][3]),
            )
        else:
            logger.debug("tool_result tool=kb_search count=0")
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


# ---------------------------------------------------------------------------
# AWS-backed tools — call API Gateway (SigV4) into DynamoDB / CLAIM.MD.
# ---------------------------------------------------------------------------
from .aws_signer import gateway_post, signed_post  # noqa: E402


@function_tool
def verify_insurance(
    patient_id: str,
    first_name: str,
    last_name: str,
    dob: str,
    payer_id: str,
    member_id: str,
) -> dict[str, Any]:
    """Check real-time eligibility via CLAIM.MD and persist the result.

    `dob` is YYYYMMDD. `payer_id` is the CLAIM.MD payer code. Returns
    {status, copay, plan}.
    """
    with _log_call("verify_insurance", patient_id=patient_id, payer_id=payer_id):
        return signed_post("/internal/insurance/verify", {
            "patient_id": patient_id,
            "first_name": first_name,
            "last_name": last_name,
            "dob": dob,
            "payer_id": payer_id,
            "member_id": member_id,
        })


@function_tool
def save_chat_turn(
    patient_id: str,
    session_id: str,
    role: str,
    text: str,
) -> dict[str, Any]:
    """Persist one chat/voice turn to DynamoDB. `role` is 'user' or 'assistant'."""
    with _log_call("save_chat_turn", patient_id=patient_id, session_id=session_id, role=role):
        return signed_post("/internal/chat/turn", {
            "patient_id": patient_id,
            "session_id": session_id,
            "role": role,
            "text": text,
        })


AWS_TOOLS = [verify_insurance, save_chat_turn]


# ---------------------------------------------------------------------------
# Booking flow — combines eligibility check + intake callback into one call.
# ---------------------------------------------------------------------------
from .data.payers import PAYERS, resolve_payer_id  # noqa: E402


@function_tool
def list_payers() -> list[dict[str, Any]]:
    """Return the canonical list of insurance companies Brighter Tomorrow can
    auto-verify via CLAIM.MD, plus a self-pay option. Voice agents should use
    this to answer "what insurances do you take?" and to confirm a caller's
    plan is supported before collecting their member ID. Each entry has
    `name` (canonical) and `aliases` (short common names)."""
    return [
        {"name": p.name, "aliases": list(p.aliases)}
        for p in PAYERS
    ]


_ELIGIBLE_STATES = {"active", "approved", "eligible", "in force", "in network"}


def _validate_dob(value: str) -> str | None:
    """Strict YYYYMMDD validator. The booking agent is responsible for parsing
    natural-language dates ('August 19, 1998', '8/19/98') into YYYYMMDD before
    calling the tool. This function only confirms the agent's output is a real
    calendar date in 1900..today and returns it unchanged; otherwise returns
    None so the agent can re-ask.
    """
    from datetime import datetime

    s = (value or "").strip()
    if len(s) != 8 or not s.isdigit():
        return None
    try:
        d = datetime.strptime(s, "%Y%m%d")
    except ValueError:
        return None
    if not (1900 <= d.year <= datetime.now().year):
        return None
    return s


@function_tool
def book_with_insurance(
    full_name: str,
    email: str,
    phone: str,
    dob: str,
    payer_name: str,
    member_id: str,
    reason: str,
) -> dict[str, Any]:
    """End-to-end booking: verify insurance eligibility via CLAIM.MD, then
    record an intake callback for staff to follow up.

    Inputs:
      - full_name, email, phone: visitor contact info
      - dob: date of birth in YYYYMMDD format (required by CLAIM.MD)
      - payer_name: insurance company name ("Aetna", "UHC", etc.) —
        the tool resolves it to a CLAIM.MD payer_id internally. Use the
        exact option label the visitor selected from the dropdown.
      - member_id: insurance member / subscriber ID
      - reason: one-line reason for visit

    Returns:
      {
        "ok": bool,
        "eligible": bool,
        "coverage": {"status", "copay", "plan"},
        "callback_id": int,
        "next_step": "<human-readable>"
      }

    Tell the visitor the `next_step` verbatim. If eligible=false, mention that
    we offer out-of-network cash rates and staff will follow up.
    """
    # Validate up-front. member_id is only required when we're actually
    # running an eligibility check (not self-pay).
    always_required = (
        ("full_name", full_name), ("email", email), ("phone", phone),
        ("dob", dob), ("payer_name", payer_name), ("reason", reason),
    )
    for field_name, val in always_required:
        if _is_placeholder(val):
            return {"ok": False, "error": f"incomplete: {field_name} missing or placeholder — ask the visitor"}

    # Validate-only: agent must convert to YYYYMMDD before calling. We just
    # confirm it's a real date so we never send garbage to CLAIM.MD.
    valid_dob = _validate_dob(dob)
    if not valid_dob:
        return {
            "ok": False,
            "error": (
                f"invalid_dob: '{dob}' is not a valid YYYYMMDD date. Convert the "
                "visitor's date of birth to 8 digits (e.g. August 19, 1998 -> "
                "19980819) and call again. If you're unsure whether the visitor "
                "means MM/DD or DD/MM, ask them to clarify before retrying."
            ),
        }
    dob = valid_dob

    # Resolve payer_name -> CLAIM.MD payer_id.
    payer = resolve_payer_id(payer_name)
    if payer is None:
        return {
            "ok": False,
            "error": f"unknown_payer: '{payer_name}' — ask the visitor to pick from the dropdown",
        }

    # member_id required only when we'll actually call CLAIM.MD.
    if payer.id != "SELF" and _is_placeholder(member_id):
        return {"ok": False, "error": "incomplete: member_id missing or placeholder — ask the visitor"}

    # Convert YYYYMMDD -> YYYY-MM-DD for the gateway.
    dob_iso = f"{dob[:4]}-{dob[4:6]}-{dob[6:8]}"

    # Split full_name (gateway requires first + last separately).
    parts = full_name.strip().split()
    first_name = parts[0] if parts else ""
    last_name = " ".join(parts[1:]) if len(parts) > 1 else first_name

    payment_method = "self_pay" if payer.id == "SELF" else "insurance"

    submit_body: dict[str, Any] = {
        "flow": "booking",
        "service": (reason or "General intake")[:200],
        "payment_method": payment_method,
        "first_name": first_name,
        "last_name": last_name,
        "date_of_birth": dob_iso,
        "phone": phone,
        "email": email,
        "home_address": "Not provided",   # chat agent doesn't collect this today
        "sex": "Not provided",
        "notes": f"Reason: {reason}",
        "source": agent_source.get(),
    }
    if payment_method == "insurance":
        submit_body.update({
            "insurance_name": payer.name,
            "insurance_member_id": member_id,
            "subscriber_name": full_name,           # assume self
            "subscriber_relationship": "self",
        })

    try:
        with _log_call("book_with_insurance_submit"):
            resp = gateway_post("/internal/intake/submit", submit_body)
    except Exception as exc:
        logger.exception("book_with_insurance_submit_error")
        return {"ok": False, "error": f"submit_failed: {exc}"}

    if not resp.get("ok"):
        return {"ok": False, "error": resp.get("error", "submit_failed")}

    eligible = bool(resp.get("eligible"))
    coverage = resp.get("coverage") or {}
    callback_id = resp.get("submission_id")  # keep field name for back-compat with the agent's response shape

    if eligible:
        next_step = (
            "🎉 **You're all set!** Your insurance has been **verified** and we've "
            "saved your info. A member of our care team will call you **within one "
            "business day** to lock in an appointment time that works for you. "
            "**We can't wait to meet you** and help you take this first step toward "
            "a brighter tomorrow."
        )
    elif payer.id == "SELF":
        next_step = (
            "✨ **You're all set!** We've got your info and a member of our care team "
            "will call you **within one business day** to walk you through our "
            "**out-of-network cash rates** and find a time that works. "
            "**We're excited to support you** on this next step."
        )
    else:
        next_step = (
            "✅ **You're all set!** We couldn't auto-verify your insurance, but **don't "
            "worry** — we also offer **out-of-network cash rates**. A member of our "
            "care team will call you **within one business day** to go over your "
            "options and schedule a time. **We can't wait to help you get started.**"
        )

    return {
        "ok": True,
        "eligible": eligible,
        "coverage": coverage,
        "callback_id": callback_id,
        "payer": payer.name,
        "next_step": next_step,
    }


BOOKING_TOOLS = [book_with_insurance, list_payers]

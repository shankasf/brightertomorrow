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
    "prefer not to say", "decline to answer", "rather not say",
    "skip", "skipped", "no answer", "x",
})


def _is_placeholder(val: str) -> bool:
    """Return True if `val` is empty or exactly a known placeholder phrase."""
    clean = (val or "").strip().lower()
    return clean in _PLACEHOLDER_VALUES


@function_tool
def request_intake_callback(
    first_name: str,
    last_name: str,
    phone: str,
    reason: str,
) -> dict[str, Any]:
    """Record a "please call me back" request from a visitor who does NOT
    want to book an appointment or check insurance right now — they just
    want someone from the practice to phone them.

    Only four fields are required and accepted:
      - first_name
      - last_name
      - phone (the number to call)
      - reason (one-line description of what they're looking for)

    All four must be real values — no blanks, no 'prefer not to say', no
    'not provided'. If any are missing, ask the visitor for them before
    retrying.

    For real appointment bookings (where we collect DOB, email, address,
    sex, insurance, etc. and run CLAIM.MD), use the Booking Agent's
    `book_with_insurance` tool instead. This tool is callback-only.
    """
    fields = {
        "first_name": first_name,
        "last_name": last_name,
        "phone": phone,
        "reason": reason,
    }
    missing = [k for k, v in fields.items() if _is_placeholder(v)]
    if missing:
        return {
            "ok": False,
            "missing": missing,
            "error": f"incomplete: still need {missing} — ask the visitor before retrying",
        }

    body = {
        "first_name": first_name.strip(),
        "last_name": last_name.strip(),
        "phone": phone.strip(),
        "reason": reason.strip()[:500],
        "source": agent_source.get(),
    }

    try:
        with _log_call("request_intake_callback_submit"):
            resp = gateway_post("/internal/callback/submit", body)
    except Exception as exc:
        logger.exception("request_intake_callback_submit_error")
        return {"ok": False, "error": f"submit_failed: {exc}"}

    if not resp.get("ok"):
        return {"ok": False, "error": resp.get("error", "submit_failed")}

    return {"ok": True, "id": resp.get("id")}


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


@function_tool
def end_call(reason: str = "completed") -> dict[str, str]:
    """Signal that the voice call is over and the WebSocket should close.

    The voice.py session loop watches for this tool call in `RealtimeToolEnd`
    and closes the browser/telephony WebSocket after a short grace period so
    the goodbye audio finishes playing. `reason` is a free-text label for
    logs only — e.g. 'completed', 'declined', 'transferred'.
    """
    with _log_call("end_call", reason=reason):
        return {"status": "ended", "reason": reason}


# Realtime-only end-of-call signal. Adding end_call here (not to the *_TOOLS
# lists above) keeps the text-chat surface unchanged — text agents don't get
# this tool, voice agents do. See feedback_sync_all_agents memory: this is a
# deliberate divergence, not an oversight.
VOICE_TOOLS = [end_call]


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


def _parse_claimmd_response(resp: dict) -> tuple[bool, dict, str]:
    """Normalise the CLAIM.MD lambda response into (eligible, coverage, status).

    The lambda returns flat top-level keys: `status`, `copay`, `plan`, `raw`.
    Earlier code mis-read it as `{eligible, coverage}` (the older shape),
    which made every check look "not eligible" — even when status was
    'active'. Tested against a real Anthem PPO response that contained
    `status='active'`, `copay=null`, `plan='PPO NY'`.

    Returns:
      eligible: True if status is one of _ELIGIBLE_STATES
      coverage: {status, copay, plan} dict (omitting empty values)
      status:   the lowered status string (e.g. 'active'), or '' if missing
    """
    raw_status = str(resp.get("status") or "").strip().lower()
    plan = resp.get("plan") or ""
    copay = resp.get("copay")
    eligible = raw_status in _ELIGIBLE_STATES
    coverage: dict[str, str] = {}
    if raw_status:
        coverage["status"] = raw_status
    if plan:
        coverage["plan"] = str(plan)
    if copay not in (None, ""):
        coverage["copay"] = str(copay)
    return eligible, coverage, raw_status


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
    home_address: str,
    sex: str,
    payer_name: str,
    member_id: str,
    reason: str,
) -> dict[str, Any]:
    """DEPRECATED — use book_appointment for new slot-based bookings.

    End-to-end booking: verify insurance eligibility via CLAIM.MD, then
    record an intake callback for staff to follow up.

    Inputs (ALL required — no placeholders, no 'prefer not to say'):
      - full_name, email, phone: visitor contact info
      - dob: date of birth in YYYYMMDD format (required by CLAIM.MD)
      - home_address: full home address (street, city, state, zip)
      - sex: how the visitor identifies (e.g., 'Female', 'Male', 'Non-binary')
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
        ("dob", dob), ("home_address", home_address), ("sex", sex),
        ("payer_name", payer_name), ("reason", reason),
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

    # Split full_name (gateway requires first + last separately). Refuse
    # single-token inputs — silently aliasing last_name=first_name would
    # corrupt the intake row AND break CLAIM.MD eligibility (which keys on
    # the real last name on the insurance card).
    parts = full_name.strip().split()
    if len(parts) < 2:
        return {
            "ok": False,
            "error": (
                f"incomplete: full_name='{full_name}' has only one word — "
                "ask the visitor for their full first and last name before retrying"
            ),
        }
    first_name = parts[0]
    last_name = " ".join(parts[1:])

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
        "home_address": home_address,
        "sex": sex,
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


@function_tool
def verify_coverage(
    first_name: str,
    last_name: str,
    dob: str,
    payer_name: str,
    member_id: str,
) -> dict[str, Any]:
    """Insurance-only eligibility probe via CLAIM.MD. Does NOT persist a
    booking — use this for visitors who just want to know if they're
    covered, OR as the FIRST step in a booking flow (run the check before
    asking for phone, email, home address, sex, etc.).

    Inputs:
      - first_name, last_name: name on the insurance card
      - dob: date of birth, YYYYMMDD (8 digits)
      - payer_name: insurance company name (Aetna, UHC, Blue Cross, etc.)
      - member_id: member / subscriber ID

    Returns:
      {
        "ok": bool,
        "eligible": bool,
        "payer": <canonical name>,
        "coverage": {"status", "copay", "plan"},
      }

    Tell the visitor the result warmly. If `eligible` is true, mention the
    copay if present. If false, reassure them out-of-network cash rates
    are available.
    """
    required = (
        ("first_name", first_name), ("last_name", last_name),
        ("dob", dob), ("payer_name", payer_name), ("member_id", member_id),
    )
    for fname, val in required:
        if _is_placeholder(val):
            return {"ok": False, "error": f"incomplete: {fname} missing or placeholder — ask the visitor"}

    valid = _validate_dob(dob)
    if not valid:
        return {
            "ok": False,
            "error": (
                f"invalid_dob: '{dob}' is not a valid 8-digit YYYYMMDD. "
                "Convert the DOB (e.g., August 19, 1998 -> 19980819) and call again."
            ),
        }

    payer = resolve_payer_id(payer_name)
    if payer is None:
        return {
            "ok": False,
            "error": f"unknown_payer: '{payer_name}' — ask the visitor to pick from the dropdown",
        }

    if payer.id == "SELF":
        return {
            "ok": True,
            "eligible": False,
            "payer": payer.name,
            "coverage": {"status": "self_pay", "plan": "Self-pay / Out-of-network"},
            # Pre-rendered message the agent MUST echo verbatim to the
            # visitor before any handoff. Composed here (not by the LLM)
            # because models sometimes skip emitting text when chaining
            # tool calls.
            "display_text": (
                "You're set up as **self-pay**. We offer competitive cash "
                "rates, and I'll now collect a few more details to "
                "finish booking your appointment."
            ),
        }

    try:
        with _log_call("verify_coverage", payer_id=payer.id):
            resp = signed_post("/internal/insurance/verify", {
                # Ephemeral patient_id — CLAIM.MD only uses it for request tracing,
                # not as a stored identifier. We compose one from the inputs we
                # already have so we don't need the visitor's email yet.
                "patient_id": f"{first_name.lower()}-{last_name.lower()}-{valid}",
                "first_name": first_name,
                "last_name": last_name,
                "dob": valid,
                "payer_id": payer.id,
                "member_id": member_id,
            })
    except Exception as exc:
        logger.exception("verify_coverage_error")
        return {"ok": False, "error": f"verify_failed: {exc}"}

    eligible, coverage, raw_status = _parse_claimmd_response(resp)
    coverage_status = raw_status or ("eligible" if eligible else "needs_review")

    # Persist this check to bt.insurance_checks so it shows up on the
    # admin /admin/insurance-checks page alongside bookings. Best-effort:
    # a failed audit write must NOT block the visitor's verification.
    # We pass first/last/dob so the gateway can hash a stable patient
    # identifier for the email_hash column — plaintext name/DOB never
    # lands in Postgres here. §164.502(b)
    try:
        with _log_call("coverage_record_audit", payer_id=payer.id):
            gateway_post("/internal/coverage/record", {
                "first_name": first_name,
                "last_name": last_name,
                "date_of_birth": f"{valid[:4]}-{valid[4:6]}-{valid[6:8]}",
                "payer_name": payer.name,
                "payer_id": payer.id,
                "eligible": eligible,
                "coverage_status": coverage_status,
                "source": agent_source.get(),
            })
    except Exception as exc:
        # Non-fatal — CLAIM.MD result still goes back to the visitor.
        logger.warning("coverage_record_audit failed: %s", exc)

    # Build the verbatim message the agent must say to the visitor.
    # Doing this server-side guarantees the wording, makes it hard for
    # the LLM to skip, and lets us include copay/plan details only when
    # present.
    if eligible:
        bits = [f"🎉 Great news — you're covered through **{payer.name}**."]
        copay = (coverage.get("copay") or "").strip() if isinstance(coverage.get("copay"), str) else coverage.get("copay")
        plan = (coverage.get("plan") or "").strip() if isinstance(coverage.get("plan"), str) else coverage.get("plan")
        if copay:
            bits.append(f"Your expected copay is **${copay}**.")
        if plan and str(plan).lower() not in {payer.name.lower(), "in network", "in-network"}:
            bits.append(f"Plan on file: {plan}.")
        bits.append(
            "I'll now collect a few more details to finish booking your "
            "appointment."
        )
        display_text = " ".join(bits)
    else:
        display_text = (
            f"I couldn't auto-verify your plan with **{payer.name}**, but "
            "**don't worry** — we offer **out-of-network cash rates** and "
            "our care team can still help. I'll now collect a few more "
            "details to finish booking your appointment."
        )

    return {
        "ok": True,
        "eligible": eligible,
        "payer": payer.name,
        "coverage": coverage,
        # The agent MUST echo this verbatim before any handoff. See the
        # Insurance Check Agent prompt for the contract.
        "display_text": display_text,
    }


# ---------------------------------------------------------------------------
# Calendar-backed booking tools — slot proposals and hard bookings via the
# internal calendar gateway endpoints. These supersede book_with_insurance
# for the self-service scheduling flow.
# ---------------------------------------------------------------------------
import datetime
from zoneinfo import ZoneInfo  # noqa: E402

_PT = ZoneInfo("America/Los_Angeles")
_SLOT_HOURS: dict[str, tuple[int, int]] = {
    "morning":   (7,  12),
    "afternoon": (12, 17),
    "evening":   (17, 21),
    "any":       (0,  24),
}


def _format_slot_display(start_iso: str) -> str:
    """Convert a UTC ISO string to a human-readable Pacific Time label."""
    dt = datetime.datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
    dt_pt = dt.astimezone(_PT)
    return dt_pt.strftime("%A, %B %-d at %-I:%M %p") + " PT"


def _fetch_free_slots(staff_id: int, days_ahead: int = 7, slot_minutes: int = 50) -> dict:
    """Plain helper: free 50-min slots for `staff_id` over the next `days_ahead` days.

    Split out of the @function_tool wrapper so other tools (e.g. propose_slots)
    can call it directly — invoking a @function_tool decorated function fails
    with `'FunctionTool' object is not callable`.
    """
    now = datetime.datetime.now(tz=datetime.timezone.utc)
    from_iso = now.isoformat(timespec="seconds").replace("+00:00", "Z")
    to_dt = now + datetime.timedelta(days=days_ahead)
    to_iso = to_dt.isoformat(timespec="seconds").replace("+00:00", "Z")

    with _log_call("get_free_slots", staff_id=staff_id, days_ahead=days_ahead):
        resp = gateway_post("/internal/calendar/free-slots", {
            "staffId": staff_id,
            "fromISO": from_iso,
            "toISO": to_iso,
            "slotMinutes": slot_minutes,
        })

    raw_slots: list[dict] = resp.get("slots", [])
    enriched = []
    for s in raw_slots:
        enriched.append({
            "startISO": s["startISO"],
            "endISO": s["endISO"],
            "displayPT": _format_slot_display(s["startISO"]),
        })
    logger.debug("tool_result tool=get_free_slots staff_id=%d count=%d", staff_id, len(enriched))
    return {"slots": enriched}


@function_tool
def get_free_slots(staff_id: int, days_ahead: int = 7, slot_minutes: int = 50) -> dict:
    """Returns free 50-min slots for the given therapist over the next N days (default 7).

    Use this when the visitor has agreed on a therapist and you need raw
    availability.

    Returns:
      {"slots": [{"startISO": "...", "endISO": "...", "displayPT": "Tuesday, May 12 at 2:00 PM PT"}]}
    """
    return _fetch_free_slots(staff_id, days_ahead=days_ahead, slot_minutes=slot_minutes)


@function_tool
def propose_slots(
    staff_id: int,
    time_of_day: str = "any",
    earliest_day_offset: int = 1,
    count: int = 3,
) -> dict:
    """Returns up to `count` best slots filtered by time-of-day preference.

    time_of_day must be one of: "morning", "afternoon", "evening", "any".
    earliest_day_offset = days from today to start considering (0 = today, 1 = tomorrow).
    Calls get_free_slots internally; filters and picks the best `count`.

    Returns same shape as get_free_slots, ready to read aloud to the visitor.
    """
    time_of_day = (time_of_day or "any").strip().lower()
    if time_of_day not in _SLOT_HOURS:
        time_of_day = "any"

    hour_start, hour_end = _SLOT_HOURS[time_of_day]

    # Fetch a wider window so we have enough candidates after filtering.
    # Call the plain helper — get_free_slots is a FunctionTool, not directly callable.
    raw = _fetch_free_slots(staff_id, days_ahead=max(14, earliest_day_offset + 7))
    all_slots: list[dict] = raw.get("slots", [])

    # Anchor the cutoff to local (PT) midnight so "tomorrow" means "any slot on
    # the next PT calendar day" — not "≥24h from now". Without this, a visitor
    # who says "tomorrow" at 4pm PT loses tomorrow's morning slots.
    now_pt = datetime.datetime.now(tz=_PT)
    earliest_pt = now_pt.replace(hour=0, minute=0, second=0, microsecond=0) + datetime.timedelta(days=earliest_day_offset)
    earliest_dt = earliest_pt.astimezone(datetime.timezone.utc)

    filtered = []
    for slot in all_slots:
        start_dt = datetime.datetime.fromisoformat(slot["startISO"].replace("Z", "+00:00"))
        if start_dt < earliest_dt:
            continue
        start_pt = start_dt.astimezone(_PT)
        if hour_start <= start_pt.hour < hour_end:
            filtered.append(slot)
        if len(filtered) >= count:
            break

    logger.debug(
        "tool_result tool=propose_slots staff_id=%d time_of_day=%s picked=%d",
        staff_id, time_of_day, len(filtered),
    )
    return {"slots": filtered[:count]}


@function_tool
def book_appointment(
    staff_id: int,
    start_iso: str,
    end_iso: str,
    first_name: str,
    last_name: str,
    dob_yyyymmdd: str,
    phone: str,
    email: str,
    home_address: str,
    sex: str,
    reason: str,
    payer_name: str,
    member_id: str,
) -> dict:
    """Places a soft-hold on the slot then confirms the booking.

    Single-call replacement for the old book_with_insurance for the slot-
    based flow. Call exactly ONCE after the visitor has agreed to the slot
    AND confirmed the recap.

    Arguments:
      staff_id    — therapist staffId from roster.py
      start_iso   — slot startISO as returned by propose_slots / get_free_slots
      end_iso     — slot endISO
      first_name, last_name, dob_yyyymmdd (YYYYMMDD), phone, email,
      home_address, sex, reason, payer_name, member_id — booking fields

    Returns:
      {"ok": True, "appointment_id": "...", "next_step": "..."}
    On slot conflict:
      {"ok": False, "error": "slot_taken", "alternatives": [{startISO, endISO}, ...]}

    On slot_taken, surface the alternatives to the visitor and loop back to
    slot selection — do NOT call book_appointment again with the same slot.
    """
    # Validate required fields — no PHI logged here.
    required_fields = {
        "first_name": first_name, "last_name": last_name,
        "dob_yyyymmdd": dob_yyyymmdd, "phone": phone,
        "email": email, "home_address": home_address,
        "sex": sex, "reason": reason, "payer_name": payer_name,
    }
    missing = [k for k, v in required_fields.items() if _is_placeholder(v)]
    if missing:
        return {
            "ok": False,
            "error": f"incomplete: {missing} — ask the visitor before retrying",
        }

    valid_dob = _validate_dob(dob_yyyymmdd)
    if not valid_dob:
        return {
            "ok": False,
            "error": (
                f"invalid_dob: '{dob_yyyymmdd}' is not a valid YYYYMMDD date. "
                "Convert the visitor's DOB and call again."
            ),
        }

    payer = resolve_payer_id(payer_name)
    if payer is None:
        return {
            "ok": False,
            "error": f"unknown_payer: '{payer_name}' — ask the visitor to pick from the dropdown",
        }

    if payer.id != "SELF" and _is_placeholder(member_id):
        return {"ok": False, "error": "incomplete: member_id missing — ask the visitor"}

    appointment_draft = {
        "firstName": first_name.strip(),
        "lastName": last_name.strip(),
        # Gateway's appointmentDraftJSON expects raw YYYYMMDD and uses
        # json.DisallowUnknownFields — sending `dateOfBirth` here is
        # rejected as "invalid JSON" before the slot check even runs.
        "dobYYYYMMDD": valid_dob,
        "phone": phone.strip(),
        "email": email.strip(),
        "homeAddress": home_address.strip(),
        "sex": sex.strip(),
        "reason": reason.strip()[:500],
        "payerName": payer.name,
        "memberId": member_id.strip() if payer.id != "SELF" else "",
    }

    # Step 1 — soft-hold via /internal/calendar/book. Log only staffId + slot times.
    with _log_call("book_appointment_hold", staff_id=staff_id, start_iso=start_iso, end_iso=end_iso):
        try:
            hold_resp = gateway_post("/internal/calendar/book", {
                "staffId": staff_id,
                "startISO": start_iso,
                "endISO": end_iso,
                "visitorRef": agent_source.get(),
                "appointmentDraft": appointment_draft,
            })
        except Exception as exc:
            # httpx raises for 4xx/5xx — catch 409 specifically.
            import httpx as _httpx
            if isinstance(exc, _httpx.HTTPStatusError) and exc.response.status_code == 409:
                body = exc.response.json()
                alts = body.get("alternatives", [])
                for a in alts:
                    a["displayPT"] = _format_slot_display(a["startISO"])
                logger.info(
                    "tool_result tool=book_appointment result=slot_taken staff_id=%d start_iso=%s",
                    staff_id, start_iso,
                )
                return {"ok": False, "error": "slot_taken", "alternatives": alts}
            logger.exception("book_appointment_hold_error")
            # Generic error to the LLM — full exception stays in server logs only.
            return {"ok": False, "error": "hold_failed"}

    hold_id = hold_resp.get("holdId")
    if not hold_id:
        return {"ok": False, "error": "hold_failed: no holdId in response"}

    # Step 2 — confirm the hold.
    with _log_call("book_appointment_confirm", staff_id=staff_id, hold_id=hold_id):
        try:
            confirm_resp = gateway_post("/internal/calendar/confirm", {
                "holdId": hold_id,
                "staffId": staff_id,
            })
        except Exception:
            logger.exception("book_appointment_confirm_error")
            return {"ok": False, "error": "confirm_failed"}

    appointment_id = confirm_resp.get("appointmentId", "")
    next_step = confirm_resp.get(
        "nextStep",
        "Your appointment has been booked! Our care team will send you a confirmation shortly.",
    )

    logger.info(
        "tool_result tool=book_appointment result=ok staff_id=%d appointment_id=%s",
        staff_id, appointment_id,
    )
    return {"ok": True, "appointment_id": appointment_id, "next_step": next_step}


BOOKING_TOOLS = [verify_coverage, get_free_slots, propose_slots, book_appointment, list_payers]


@function_tool
def end_call(reason: str) -> dict[str, Any]:
    """End the current voice call after the assistant's closing line.

    Call this ONLY when the conversation is genuinely complete — the caller
    has said goodbye, the booking is confirmed, the question is answered, or
    they have declined further help. Do NOT call this mid-task or when the
    caller might still want something. After invoking this tool, the bridge
    waits ~1.5 seconds for your final spoken sentence to finish before
    disconnecting Twilio.

    Has no effect when called from the text chat path (only the Twilio voice
    bridge listens for it). Logs the reason so admin can see why a call
    ended.
    """
    reason_clean = (reason or "").strip()[:200]
    with _log_call("end_call", reason=reason_clean):
        # Late import — twilio_voice is only meaningful in the AI service.
        try:
            from .twilio_voice import end_call_event
        except ImportError:
            return {"ok": False, "reason": "bridge not available"}

        ev = end_call_event.get()
        if ev is None:
            # Tool fired outside a Twilio call (e.g. from the browser voice
            # widget or the text chat agent). Acknowledge silently — the
            # model already said its goodbye line.
            logger.info("end_call_no_active_bridge reason=%s", reason_clean)
            return {"ok": True, "active": False}
        ev.set()
        logger.info("end_call_signalled reason=%s", reason_clean)
        return {"ok": True, "active": True}

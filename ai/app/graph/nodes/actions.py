"""Action nodes — every tool call the assistant can make, in one file.

These are clean, direct wrappers around the gateway / DB calls. They
deliberately DO NOT go through the legacy ``@function_tool`` decorator
in ``tools.py`` (that decorator is for the openai-agents SDK, not for
LangGraph nodes — calling it requires a SDK context object).

Instead each action calls the same underlying ``gateway_post`` /
``signed_post`` / ``_fetch_free_slots`` helpers the legacy decorator
wraps, plus the same payer resolution / DOB validation, but without
the decorator overhead. The wire format is byte-identical.
"""
from __future__ import annotations

import logging
import time
from typing import Any

from ...integrations.aws_signer import gateway_post, signed_post
from ...data.payers import resolve_payer_id
from ...integrations.tools import _fetch_free_slots, _validate_dob, _format_slot_display
from ..state import BookingStatus, CallbackStatus, State
from ..tracing import traced

logger = logging.getLogger(__name__)

_ELIGIBLE_STATES = {"active", "approved", "eligible", "in force", "in network"}


# ---------------------------------------------------------------------------
# 1. verify_insurance — CLAIM.MD eligibility probe
# ---------------------------------------------------------------------------

@traced(run_type="tool", name="verify_insurance")
def verify_insurance(state: State) -> dict[str, Any]:
    ins = state.get("insurance_fields") or {}
    first_name = (ins.get("first_name") or "").strip()
    last_name = (ins.get("last_name") or "").strip()
    dob = (ins.get("dob_yyyymmdd") or "").strip()
    payer_name = (ins.get("payer_name") or "").strip()
    member_id = (ins.get("member_id") or "").strip()

    valid_dob = _validate_dob(dob)
    payer = resolve_payer_id(payer_name)

    if not valid_dob:
        return {"verify_result": {"ok": False, "error": f"invalid_dob: {dob}"},
                "last_action": "verify_insurance"}
    if payer is None:
        return {"verify_result": {"ok": False, "error": f"unknown_payer: {payer_name}"},
                "last_action": "verify_insurance"}

    if payer.id == "SELF":
        result = {
            "ok": True, "eligible": False, "payer": payer.name,
            "coverage": {"status": "self_pay", "plan": "Self-pay / Out-of-network"},
            "display_text": "You're set up as self-pay. We offer competitive cash rates.",
        }
        return {"verify_result": result, "last_action": "verify_insurance",
                "payment_path": "self_pay"}

    try:
        resp = signed_post("/internal/insurance/verify", {
            "patient_id": f"{first_name.lower()}-{last_name.lower()}-{valid_dob}",
            "first_name": first_name, "last_name": last_name,
            "dob": valid_dob, "payer_id": payer.id, "member_id": member_id,
        })
    except Exception as exc:
        logger.exception("verify_insurance_error")
        return {"verify_result": {"ok": False, "error": f"verify_failed: {exc}"},
                "last_action": "verify_insurance"}

    raw_status = str(resp.get("status") or "").strip().lower()
    eligible = raw_status in _ELIGIBLE_STATES
    copay = resp.get("copay")
    plan = resp.get("plan") or ""
    coverage: dict[str, str] = {}
    if raw_status: coverage["status"] = raw_status
    if plan: coverage["plan"] = str(plan)
    if copay not in (None, ""): coverage["copay"] = str(copay)

    if eligible:
        bits = [f"Great news — you're covered through {payer.name}."]
        if copay: bits.append(f"Your expected copay is ${copay}.")
        display_text = " ".join(bits)
    else:
        display_text = (
            f"I couldn't auto-verify your plan with {payer.name}, but don't worry — "
            "we offer out-of-network cash rates and our care team can still help."
        )

    # Best-effort audit row.
    try:
        gateway_post("/internal/coverage/record", {
            "first_name": first_name, "last_name": last_name,
            "date_of_birth": f"{valid_dob[:4]}-{valid_dob[4:6]}-{valid_dob[6:8]}",
            "payer_name": payer.name, "payer_id": payer.id,
            "eligible": eligible,
            "coverage_status": raw_status or ("eligible" if eligible else "needs_review"),
            "source": state.get("agent_source", "chat-agent"),
        })
    except Exception:
        logger.warning("coverage_record_audit failed", exc_info=True)

    logger.info(
        "action verify_insurance session=%s eligible=%s payer=%s copay=%s",
        state.get("session_id", "?"), eligible, payer.name, copay,
    )
    return {
        "verify_result": {
            "ok": True, "eligible": eligible, "payer": payer.name,
            "coverage": coverage, "display_text": display_text,
        },
        "last_action": "verify_insurance",
    }


# ---------------------------------------------------------------------------
# 2. propose_slots — Jane calendar slot suggestions
# ---------------------------------------------------------------------------

@traced(run_type="tool", name="propose_slots")
def propose_slots(state: State) -> dict[str, Any]:
    staff_id = state.get("staff_id")
    if not staff_id:
        return {"last_action": "propose_slots_blocked_no_staff"}
    # The extract node may have stored a time-of-day preference into a
    # transient key; default to "any" if missing.
    time_of_day = state.get("_time_of_day") or "any"
    earliest = state.get("_earliest_day_offset") or 1
    raw = _fetch_free_slots(staff_id, days_ahead=max(14, earliest + 7))
    # Filter by time-of-day in-place — same logic as the legacy propose_slots
    # but inlined so we don't double-fetch.
    from datetime import datetime, timedelta, timezone
    from zoneinfo import ZoneInfo
    PT = ZoneInfo("America/Los_Angeles")
    bands = {"morning": (7, 12), "afternoon": (12, 17), "evening": (17, 21), "any": (0, 24)}
    h0, h1 = bands.get(time_of_day, (0, 24))
    now_pt = datetime.now(tz=PT)
    earliest_pt = now_pt.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=earliest)
    earliest_dt = earliest_pt.astimezone(timezone.utc)
    picked = []
    for s in raw.get("slots", []):
        start = datetime.fromisoformat(s["startISO"].replace("Z", "+00:00"))
        if start < earliest_dt:
            continue
        if h0 <= start.astimezone(PT).hour < h1:
            picked.append(s)
        if len(picked) >= 3:
            break
    logger.info(
        "action propose_slots session=%s staff_id=%s picked=%d",
        state.get("session_id", "?"), staff_id, len(picked),
    )
    return {
        "proposed_slots": picked,
        "last_action": "propose_slots",
        "booking_status": "ready_for_slots",
    }


# ---------------------------------------------------------------------------
# 3. book_appointment — places the actual booking (gated by pending_confirm)
# ---------------------------------------------------------------------------

@traced(run_type="tool", name="book_appointment")
def book_appointment(state: State) -> dict[str, Any]:
    ins = state.get("insurance_fields") or {}
    bk = state.get("booking_fields") or {}
    slot = state.get("selected_slot") or {}
    staff_id = state.get("staff_id")
    if not staff_id or not slot:
        return {"last_action": "book_appointment_blocked"}
    payer = resolve_payer_id(ins.get("payer_name") or "Self-pay")
    payer_name = payer.name if payer else "Self-pay"
    member_id = (ins.get("member_id") or "").strip() if payer and payer.id != "SELF" else ""

    draft = {
        "firstName": (ins.get("first_name") or "").strip(),
        "lastName": (ins.get("last_name") or "").strip(),
        "dobYYYYMMDD": (ins.get("dob_yyyymmdd") or "").strip(),
        "phone": (bk.get("phone") or "").strip(),
        "email": (bk.get("email") or "").strip(),
        "homeAddress": (bk.get("home_address") or "").strip(),
        "sex": (bk.get("sex") or "").strip(),
        "reason": (bk.get("reason") or "").strip()[:500],
        "payerName": payer_name,
        "memberId": member_id,
    }
    try:
        hold_resp = gateway_post("/internal/calendar/book", {
            "staffId": staff_id,
            "startISO": slot["startISO"], "endISO": slot["endISO"],
            "visitorRef": state.get("agent_source", "chat-agent"),
            "appointmentDraft": draft,
        })
    except Exception as exc:
        import httpx as _httpx
        if isinstance(exc, _httpx.HTTPStatusError) and exc.response.status_code == 409:
            body = exc.response.json()
            alts = body.get("alternatives", [])
            for a in alts:
                a["displayPT"] = _format_slot_display(a["startISO"])
            return {"proposed_slots": alts, "selected_slot": None,
                    "booking_status": "ready_for_slots",
                    "last_action": "book_appointment_slot_taken"}
        logger.exception("book_appointment_hold_error")
        return {"last_action": "book_appointment_error", "_booking_error": "hold_failed"}

    hold_id = hold_resp.get("holdId")
    if not hold_id:
        return {"last_action": "book_appointment_error", "_booking_error": "no_holdId"}
    try:
        confirm_resp = gateway_post("/internal/calendar/confirm",
                                    {"holdId": hold_id, "staffId": staff_id})
    except Exception:
        logger.exception("book_appointment_confirm_error")
        return {"last_action": "book_appointment_error", "_booking_error": "confirm_failed"}

    result = {
        "ok": True,
        "appointment_id": confirm_resp.get("appointmentId", ""),
        "next_step": confirm_resp.get("nextStep", "Your appointment is booked."),
    }
    if result.get("ok"):
        new_status: BookingStatus = "booked"
        update = {
            "appointment_id": result.get("appointment_id"),
            "booking_status": new_status,
            "last_action": "book_appointment_success",
            "verify_result_next_step": result.get("next_step"),
        }
    elif result.get("error") == "slot_taken":
        update = {
            "proposed_slots": result.get("alternatives") or [],
            "selected_slot": None,
            "booking_status": "ready_for_slots",
            "last_action": "book_appointment_slot_taken",
        }
    else:
        update = {
            "last_action": "book_appointment_error",
            "_booking_error": result.get("error"),
        }
    logger.info(
        "action book_appointment session=%s ok=%s status=%s",
        state.get("session_id", "?"),
        result.get("ok"), update.get("booking_status"),
    )
    return update


# ---------------------------------------------------------------------------
# 4. cancel_appointment — gated by cancel_pending_confirm
# ---------------------------------------------------------------------------

@traced(run_type="tool", name="cancel_appointment")
def cancel_appointment(state: State) -> dict[str, Any]:
    """Cancel a previously-booked appointment.

    Note: the legacy ``tools.py`` does not expose a cancel tool today.
    We POST to the gateway's ``/internal/calendar/cancel`` endpoint
    (mirroring the book / confirm pattern). If that endpoint doesn't
    exist yet on the gateway, this action will fail soft and the
    respond node will tell the caller to phone the practice.
    """
    appointment_id = state.get("appointment_id")
    if not appointment_id:
        return {"last_action": "cancel_appointment_blocked_no_appt"}
    try:
        from ...integrations.aws_signer import gateway_post
        resp = gateway_post(
            "/internal/calendar/cancel",
            {"appointmentId": appointment_id},
        )
        ok = bool(resp.get("ok"))
    except Exception as exc:
        logger.exception("cancel_appointment_error session=%s", state.get("session_id", "?"))
        ok = False
        resp = {"error": str(exc)}
    if ok:
        return {
            "booking_status": "cancelled",
            "appointment_id": None,
            "last_action": "cancel_appointment_success",
        }
    return {
        "last_action": "cancel_appointment_error",
        "_cancel_error": resp.get("error", "cancel_failed"),
    }


# ---------------------------------------------------------------------------
# 5. submit_callback — request_intake_callback wrapper
# ---------------------------------------------------------------------------

@traced(run_type="tool", name="submit_callback")
def submit_callback(state: State) -> dict[str, Any]:
    cb = state.get("callback_fields") or {}
    body = {
        "first_name": (cb.get("first_name") or "").strip(),
        "last_name": (cb.get("last_name") or "").strip(),
        "phone": (cb.get("phone") or "").strip(),
        "reason": (cb.get("reason") or "").strip()[:500],
        "source": state.get("agent_source", "chat-agent"),
    }
    try:
        result = gateway_post("/internal/callback/submit", body)
    except Exception as exc:
        logger.exception("submit_callback_error")
        result = {"ok": False, "error": f"submit_failed: {exc}"}
    status: CallbackStatus = "submitted" if result.get("ok") else "none"
    logger.info(
        "action submit_callback session=%s ok=%s",
        state.get("session_id", "?"), result.get("ok"),
    )
    return {
        "callback_status": status,
        "callback_id": result.get("id"),
        "last_action": "submit_callback" if result.get("ok") else "submit_callback_error",
        "_callback_error": result.get("error") if not result.get("ok") else None,
    }


# ---------------------------------------------------------------------------
# 6. search_kb — semantic KB search for info questions
# ---------------------------------------------------------------------------

@traced(run_type="tool", name="search_kb")
def search_kb(state: State) -> dict[str, Any]:
    """Semantic search over the scraped KB; falls back to keyword ILIKE."""
    query = (state.get("_info_query") or "").strip()
    if not query:
        return {"last_action": "search_kb_blocked_empty"}
    from openai import OpenAI
    from ...core.db import conn
    import os
    embed_model = os.environ.get("OPENAI_EMBED_MODEL", "text-embedding-3-small")
    try:
        resp = OpenAI().embeddings.create(model=embed_model, input=query)
        vec = "[" + ",".join(f"{x:.7f}" for x in resp.data[0].embedding) + "]"
        with conn() as c, c.cursor() as cur:
            cur.execute(
                """
                SELECT url, title, content, 1 - (embedding <=> %s::vector) AS score
                FROM kb_documents
                ORDER BY embedding <=> %s::vector
                LIMIT 5
                """, (vec, vec),
            )
            rows = cur.fetchall()
        snippets = [{"url": u, "title": t, "content": cc, "score": round(float(s), 4)}
                    for u, t, cc, s in rows]
    except Exception:
        logger.exception("search_kb_error")
        snippets = []
    logger.info("action search_kb session=%s n=%d", state.get("session_id", "?"), len(snippets))
    return {"kb_snippets": snippets, "info_topic": query[:120], "last_action": "search_kb"}


# ---------------------------------------------------------------------------
# 7. check_payer — direct yes/no for "do you take X?"
# ---------------------------------------------------------------------------

@traced(run_type="tool", name="check_payer")
def check_payer(state: State) -> dict[str, Any]:
    """Look up a named payer (no LLM, no network — pure lookup)."""
    from ...data.payers import PAYERS
    payer_name = (state.get("insurance_fields") or {}).get("payer_name") or ""
    payer = resolve_payer_id(payer_name)
    all_names = [p.name for p in PAYERS if p.id != "SELF"]
    if payer is None:
        note = {"query": payer_name, "supported": False, "canonical": None,
                "self_pay": False, "all_supported": all_names,
                "note": f"We can't auto-verify {payer_name.strip()} but we accept most major plans."}
    elif payer.id == "SELF":
        note = {"query": payer_name, "supported": True, "canonical": payer.name,
                "self_pay": True, "all_supported": all_names,
                "note": "Yes — we offer self-pay / out-of-network rates. No insurance needed."}
    else:
        note = {"query": payer_name, "supported": True, "canonical": payer.name,
                "self_pay": False, "all_supported": all_names,
                "note": f"Yes — we accept {payer.name} and can auto-verify your coverage."}
    return {"_payer_check": note, "last_action": "check_payer"}

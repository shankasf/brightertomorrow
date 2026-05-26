"""Legacy action nodes: propose_slots, book_appointment, cancel_appointment,
submit_callback, search_kb, check_payer.

verify_insurance has been superseded by actions/insurance.py which returns a
discriminated outcome string. Do NOT import verify_insurance from here.
"""
from __future__ import annotations

import logging
import time
from typing import Any

from ....integrations.aws_signer import gateway_post, signed_post
from ....data.payers import resolve_payer_id
from ....integrations.tools import _fetch_free_slots, _validate_dob, _format_slot_display
from ...state import BookingStatus, CallbackStatus, State
from ...tracing import traced

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# propose_slots — Jane calendar slot suggestions
# ---------------------------------------------------------------------------

@traced(run_type="tool", name="propose_slots")
def propose_slots(state: State) -> dict[str, Any]:
    """Propose up to 3 slots for the caller.

    staff_id == 0 or None, OR staff_any set → any-therapist mode: pass 0 to
        the gateway which fans out across the WHOLE roster and returns the
        soonest slots tagged with staffId + staffName. Each returned slot
        already carries the correct staffId, which extract pins onto state
        when the caller picks one (so book_appointment can place the hold).
    staff_id > 0                   → single-therapist mode for that clinician.
    """
    staff_id = state.get("staff_id")
    any_mode = bool(state.get("staff_any")) or not staff_id  # fan-out via gateway

    from datetime import datetime, timedelta, timezone
    from zoneinfo import ZoneInfo

    time_of_day = state.get("_time_of_day") or "any"
    earliest = state.get("_earliest_day_offset") or 1
    PT = ZoneInfo("America/Los_Angeles")
    bands = {"morning": (7, 12), "afternoon": (12, 17), "evening": (17, 21), "any": (0, 24)}
    h0, h1 = bands.get(time_of_day, (0, 24))
    now_pt = datetime.now(tz=PT)
    earliest_pt = now_pt.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=earliest)
    earliest_dt = earliest_pt.astimezone(timezone.utc)

    # Reschedule: never re-offer the slot the caller is already booked into.
    # _appt_time_iso is the located appointment's UTC ISO time (set by
    # lookup_appointment); it's empty for a fresh booking, so this is a no-op
    # outside the reschedule flow. The calendar's free-slots feed can return a
    # patient's own current time as "free", which made the picker propose the
    # exact same date/time as one of the options.
    appt_iso = (state.get("_appt_time_iso") or "").strip()
    appt_instant = None
    if appt_iso:
        try:
            appt_instant = datetime.fromisoformat(appt_iso.replace("Z", "+00:00"))
        except ValueError:
            appt_instant = None

    def _pick_for(sid: int | None) -> list[dict]:
        """Fetch and time-filter slots; sid=0/None means any-therapist."""
        raw = _fetch_free_slots(sid if sid else None, days_ahead=max(14, earliest + 7))
        out: list[dict] = []
        for s in raw.get("slots", []):
            start = datetime.fromisoformat(s["startISO"].replace("Z", "+00:00"))
            if start < earliest_dt:
                continue
            if appt_instant is not None and start == appt_instant:
                continue  # skip the caller's current appointment slot
            if h0 <= start.astimezone(PT).hour < h1:
                out.append(s)
            if len(out) >= 3:
                break
        return out

    if any_mode:
        # Gateway fans out across the whole roster; slots already carry
        # staffId + staffName, sorted soonest-first.
        picked = _pick_for(None)
        final_staff_id = staff_id  # stays None/0 until caller picks a slot
        final_staff_name = state.get("staff_name")
    else:
        picked = _pick_for(staff_id)
        final_staff_id = staff_id
        final_staff_name = state.get("staff_name")

    logger.info(
        "action propose_slots session=%s staff_id=%s any_mode=%s picked=%d",
        state.get("session_id", "?"), final_staff_id, any_mode, len(picked),
    )

    update: dict[str, Any] = {
        "proposed_slots": picked,
        "last_action": "propose_slots",
        "booking_status": "ready_for_slots",
    }
    if final_staff_id != staff_id:
        update["staff_id"] = final_staff_id
        update["staff_name"] = final_staff_name
    # No openings (single therapist, or the whole-roster fan-out came back
    # empty) — surface so respond offers a callback instead of looping.
    if not picked:
        update["last_action"] = "propose_slots_no_availability"
    return update


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
    email_hash = state.get("_appt_email_hash") or ""
    try:
        # gateway_post is imported at module top (....integrations.aws_signer).
        # A previous in-function `from ...integrations...` used the wrong depth
        # (app.graph.integrations) and raised ModuleNotFoundError on EVERY
        # cancel, so the call silently failed and the caller was told to phone
        # the practice. Use the module-level import.
        resp = gateway_post(
            "/internal/calendar/cancel",
            {"appointmentId": appointment_id, "emailHash": email_hash},
        )
        ok = bool(resp.get("ok"))
    except Exception as exc:
        logger.exception("cancel_appointment_error session=%s", state.get("session_id", "?"))
        ok = False
        resp = {"error": str(exc)}
    if ok:
        # If this cancel was the first half of a reschedule, hand a one-turn
        # flag to post_cancel so it offers a new time instead of a flat
        # goodbye, then clear the sticky reschedule flag so it can't leak into
        # an unrelated future cancel.
        was_reschedule = bool(state.get("_wants_reschedule"))
        return {
            "booking_status": "cancelled",
            "appointment_id": None,
            "last_action": "cancel_appointment_success",
            "_was_reschedule": was_reschedule,
            "_wants_reschedule": False,
            # Only set when the gateway actually enqueued the email, so
            # post_cancel can truthfully tell the caller a confirmation is on
            # its way.
            "_cancel_email_sent": bool(resp.get("emailQueued")),
        }
    return {
        "last_action": "cancel_appointment_error",
        "_cancel_error": resp.get("error", "cancel_failed"),
    }


# ---------------------------------------------------------------------------
# lookup_appointment — verify-then-lookup for cancel of a prior-session appt
# ---------------------------------------------------------------------------

@traced(run_type="tool", name="lookup_appointment")
def lookup_appointment(state: State) -> dict[str, Any]:
    """Look up a previously-booked appointment by phone + DOB.

    Calls the gateway's /internal/calendar/lookup_appointment endpoint.
    Phone and DOB are consumed from existing state buckets (no new NL
    parsing — extract is the only NL boundary).

    Results:
      - found + dob_match: sets appointment_id, _appt_email_hash,
        _appt_time_iso, staff_id, staff_name, booking_status="booked".
      - reason=="verification_failed": last_action="lookup_appointment_verify_failed".
      - else: last_action="lookup_appointment_not_found".

    HIPAA: logs only session_id + found/dob_match booleans. Never phone or DOB.
    """
    from ....data.roster import THERAPISTS_WITH_FEEDS

    # Build the staff_id -> name lookup map from the roster.
    _staff_map: dict[int, str] = {t["staffId"]: t["name"] for t in THERAPISTS_WITH_FEEDS}

    session_id = state.get("session_id", "?")

    # Read phone from booking_fields first, then callback_fields fallback.
    bk = state.get("booking_fields") or {}
    cb = state.get("callback_fields") or {}
    phone = (bk.get("phone") or cb.get("phone") or "").strip()

    ins = state.get("insurance_fields") or {}
    dob = (ins.get("dob_yyyymmdd") or "").strip()
    email = (bk.get("email") or "").strip() or None

    body: dict[str, Any] = {"phone": phone, "dob_yyyymmdd": dob}
    if email:
        body["email"] = email

    try:
        resp = gateway_post("/internal/calendar/lookup_appointment", body)
    except Exception:
        logger.exception("lookup_appointment_error session=%s", session_id)
        return {"last_action": "lookup_appointment_not_found"}

    found: bool = bool(resp.get("found"))
    dob_match: bool = bool(resp.get("dob_match"))

    logger.info(
        "action lookup_appointment session=%s found=%s dob_match=%s",
        session_id, found, dob_match,
    )

    if found and dob_match:
        staff_id_raw = resp.get("therapist_staff_id")
        staff_id = int(staff_id_raw) if staff_id_raw is not None else None
        staff_name = _staff_map.get(staff_id, f"therapist #{staff_id}") if staff_id else None
        return {
            "appointment_id": resp.get("appointment_id"),
            "_appt_email_hash": resp.get("email_hash", ""),
            "_appt_time_iso": resp.get("appointment_time_iso", ""),
            "_appt_service": resp.get("service", ""),
            "staff_id": staff_id,
            "staff_name": staff_name,
            "booking_status": "booked",
            "last_action": "lookup_appointment_found",
        }

    reason = resp.get("reason", "")
    if reason == "verification_failed":
        return {"last_action": "lookup_appointment_verify_failed"}
    if reason == "past_appointment":
        # Identity verified but the appointment already passed — can't cancel.
        # Carry the date so respond can name it plainly.
        return {
            "_appt_time_iso": resp.get("appointment_time_iso", ""),
            "last_action": "lookup_appointment_past",
        }

    return {"last_action": "lookup_appointment_not_found"}


# ---------------------------------------------------------------------------
# reschedule_appointment — MOVE a located appointment to a newly-picked slot
# ---------------------------------------------------------------------------

@traced(run_type="tool", name="reschedule_appointment")
def reschedule_appointment(state: State) -> dict[str, Any]:
    """Move a located appointment to the caller's newly-picked slot.

    Reschedule keeps the SAME patient record — no re-intake. The gateway
    /internal/calendar/reschedule endpoint updates the appointment time in
    place by appointmentId + emailHash (both from the verified lookup); the
    new slot + therapist come from the caller's selection (selected_slot).

    Outcomes:
      - ok: booking_status="booked", _appt_time_iso=new time,
        last_action="reschedule_appointment_success" (-> post_reschedule).
      - 409 slot_taken: proposed_slots=alternatives, selected_slot cleared,
        last_action="reschedule_slot_taken" (-> present the alternatives).
      - not_found / failure: last_action="reschedule_appointment_error".

    HIPAA: logs only session_id + ok/reason. Never phone, DOB, or the slot.
    """
    appointment_id = state.get("appointment_id")
    email_hash = state.get("_appt_email_hash") or ""
    slot = state.get("selected_slot") or {}
    staff_id = state.get("staff_id") or slot.get("staffId")
    if not appointment_id or not slot or not staff_id:
        return {"last_action": "reschedule_appointment_blocked", "scene": "booking_failed_retry"}

    body = {
        "appointmentId": appointment_id,
        "emailHash": email_hash,
        "staffId": staff_id,
        "startISO": slot.get("startISO"),
        "endISO": slot.get("endISO"),
    }
    try:
        resp = gateway_post("/internal/calendar/reschedule", body)
    except Exception as exc:
        import httpx as _httpx
        if isinstance(exc, _httpx.HTTPStatusError) and exc.response.status_code == 409:
            # The slot was taken between proposal and move — re-present the
            # gateway's alternatives so the caller can pick another.
            alts = exc.response.json().get("alternatives", []) or []
            for a in alts:
                a["displayPT"] = _format_slot_display(a["startISO"])
            return {
                "proposed_slots": alts,
                "selected_slot": None,
                "booking_status": "ready_for_slots",
                "last_action": "reschedule_slot_taken",
                "scene": "present_slots",
            }
        logger.exception("reschedule_appointment_error session=%s", state.get("session_id", "?"))
        return {
            "last_action": "reschedule_appointment_error",
            "_reschedule_error": "request_failed",
            "scene": "booking_failed_retry",
        }

    if not resp.get("ok"):
        logger.info(
            "action reschedule_appointment session=%s ok=false reason=%s",
            state.get("session_id", "?"), resp.get("error"),
        )
        return {
            "last_action": "reschedule_appointment_error",
            "_reschedule_error": resp.get("error", "failed"),
            "scene": "booking_failed_retry",
        }

    new_iso = resp.get("appointmentTimeISO") or slot.get("startISO") or ""
    email_sent = bool(resp.get("emailQueued"))
    logger.info(
        "action reschedule_appointment session=%s ok=true email_sent=%s",
        state.get("session_id", "?"), email_sent,
    )
    return {
        "booking_status": "booked",
        "appointment_id": resp.get("appointmentId") or appointment_id,
        "_appt_time_iso": new_iso,
        # Only set when the gateway actually enqueued the email, so respond can
        # truthfully tell the caller a confirmation is on its way.
        "_reschedule_email_sent": email_sent,
        "last_action": "reschedule_appointment_success",
        "_was_reschedule": True,
        "_wants_reschedule": False,
        # Intent is reset so a follow-up ("thanks") doesn't re-trigger the
        # cancel branch (intent stayed "cancel" through the locate/move flow).
        "intent": "idle",
        "selected_slot": None,
        "proposed_slots": [],
        # Explicit scene (cleared by respond after one render) — avoids the
        # last_action-persistence loop that the old post_cancel rebook had.
        "scene": "post_reschedule",
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
    from ....core.db import conn
    import os
    embed_model = os.environ.get("OPENAI_EMBED_MODEL", "text-embedding-3-small")
    try:
        resp = OpenAI().embeddings.create(model=embed_model, input=query)
        vec = "[" + ",".join(f"{x:.7f}" for x in resp.data[0].embedding) + "]"
        with conn() as c, c.cursor() as cur:
            # Dedupe by title (DISTINCT ON keeps the best-scoring chunk per
            # doc) before taking the top 5. The legacy blog is heavily
            # chunked — one popular post ("How Childhood Trauma Affects
            # You…") otherwise floods all 5 slots and buries the curated
            # therapist / rates / insurance docs that answer the question.
            cur.execute(
                """
                SELECT title, content, score FROM (
                    SELECT DISTINCT ON (title)
                           title, content, 1 - (embedding <=> %s::vector) AS score
                    FROM kb_documents
                    ORDER BY title, embedding <=> %s::vector
                ) d
                ORDER BY score DESC
                LIMIT 5
                """, (vec, vec),
            )
            rows = cur.fetchall()
        snippets = [{"title": t, "content": cc, "score": round(float(s), 4)}
                    for t, cc, s in rows]
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

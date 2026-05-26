"""Integration tests: cancel + reschedule with full appointment details.

Drives the REAL lookup_appointment / cancel_appointment nodes (the gateway
HTTP call is faked at app.integrations.aws_signer.gateway_post, routed by URL)
so the test exercises the actual node plumbing:

  * lookup maps the gateway `service` field -> state `_appt_service`
    (rendered as "reason for visit" in confirm_cancel).
  * confirm_cancel context carries reason_for_visit + is_reschedule.
  * a reschedule turn sets the sticky `_wants_reschedule`, surfaces
    is_reschedule=True on confirm_cancel, and after the cancel succeeds
    surfaces is_reschedule=True on post_cancel (the pivot-to-rebook turn).
  * cancel_appointment clears `_wants_reschedule` and hands `_was_reschedule`
    to post_cancel for exactly one turn.

Edge cases covered: plain cancel (is_reschedule False), DOB verification
failure, and a past appointment.

Hermetic — all LLM + gateway calls are mocked. Run:
    ./.venv/bin/python -m app.graph.tests.test_cancel_reschedule
"""
from __future__ import annotations

import asyncio
import sys
import types
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage


# ---------------------------------------------------------------------------
# Module stubs (mirror test_lookup_cancel.py) + a path-routing gateway fake
# ---------------------------------------------------------------------------

# Mutable gateway behaviour, swapped per-scenario before each ainvoke.
_GW: dict[str, Any] = {
    "lookup": {
        "found": True,
        "appointment_id": "APT-RESCHED-1",
        "email_hash": "abc123hash",
        "appointment_time_iso": "2026-06-10T15:00:00Z",
        "therapist_staff_id": 47,
        "service": "ADHD evaluation for my teen",
        "dob_match": True,
    }
}


def _future_iso(days: int, hour_utc: int) -> str:
    import datetime as _dt
    base = _dt.datetime.now(tz=_dt.timezone.utc) + _dt.timedelta(days=days)
    return base.replace(hour=hour_utc, minute=0, second=0, microsecond=0).isoformat(
        timespec="seconds"
    ).replace("+00:00", "Z")


def _fake_gateway_post(path: str, body: Any = None, *a: Any, **k: Any) -> dict[str, Any]:
    if "lookup_appointment" in path:
        return _GW["lookup"]
    if "reschedule" in path:
        # Mirror the gateway move endpoint: echo back the new time.
        b = body or {}
        if _GW.get("reschedule_slot_taken"):
            import httpx as _httpx
            raise _httpx.HTTPStatusError(
                "slot taken",
                request=_httpx.Request("POST", "http://gw" + path),
                response=_httpx.Response(409, json={
                    "error": "slot_taken",
                    "alternatives": [
                        {"staffId": 47, "startISO": _future_iso(5, 19),
                         "endISO": _future_iso(5, 20)},
                    ],
                }),
            )
        return {
            "ok": True,
            "appointmentId": b.get("appointmentId"),
            "appointmentTimeISO": b.get("startISO"),
            # Mirrors the gateway: True only when a confirmation email was
            # actually enqueued. Default False so post_reschedule never claims
            # an email that wasn't sent.
            "emailQueued": bool(_GW.get("reschedule_email_queued", False)),
        }
    if "free-slots" in path:
        # Three openings a few days out (within the "any" time band).
        return {"slots": [
            {"staffId": 47, "staffName": "Elisia Danley",
             "startISO": _future_iso(3, 18), "endISO": _future_iso(3, 19)},
            {"staffId": 47, "staffName": "Elisia Danley",
             "startISO": _future_iso(4, 18), "endISO": _future_iso(4, 19)},
            {"staffId": 47, "staffName": "Elisia Danley",
             "startISO": _future_iso(5, 18), "endISO": _future_iso(5, 19)},
        ]}
    if "/cancel" in path:
        # Mirror the gateway: emailQueued is True only when a cancellation
        # confirmation was actually enqueued.
        return {"ok": True, "emailQueued": bool(_GW.get("cancel_email_queued", False))}
    return {"ok": True}


def _stubs() -> None:
    sys.modules.setdefault("agents", types.SimpleNamespace(function_tool=lambda f: f))

    class _C:
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def cursor(self): return self
        def execute(self, *a, **k): pass
        def fetchone(self): return None
        def fetchall(self): return []

    sys.modules["app.db"] = types.SimpleNamespace(conn=lambda: _C())

    _aws = types.SimpleNamespace(
        gateway_post=_fake_gateway_post,
        signed_post=lambda *a, **k: {"status": "active"},
    )
    # Both the legacy alias and the real import path used by the nodes.
    sys.modules["app.aws_signer"] = _aws
    sys.modules["app.integrations.aws_signer"] = _aws

    from dataclasses import dataclass

    @dataclass
    class _P:
        id: str
        name: str
        aliases: tuple = ()

    sys.modules["app.data"] = types.SimpleNamespace()
    sys.modules["app.data.payers"] = types.SimpleNamespace(
        PAYERS=[_P("BCBS", "BCBS")], resolve_payer_id=lambda n: _P("BCBS", "BCBS"),
    )
    sys.modules["app.bt_agents"] = types.SimpleNamespace()
    sys.modules["app.data.roster"] = types.SimpleNamespace(
        ELIGIBLE_FOR_BOOKING=[{"staffId": 47, "name": "Elisia Danley"}],
        THERAPISTS_WITHOUT_FEEDS=[],
        THERAPISTS_WITH_FEEDS=[{"staffId": 47, "name": "Elisia Danley"}],
    )


# ---------------------------------------------------------------------------
# Fakes: extract (intent classification) + a system-prompt-capturing responder
# ---------------------------------------------------------------------------

# Captures the system text the responder saw on the LAST turn, so we can
# assert the scene's context block (reason_for_visit, is_reschedule, ...).
_CAP: dict[str, str] = {"sys": ""}


def _fake_extract_for(user_msg: str):
    from app.graph.prompts.extract import TurnExtraction, FieldDeltas
    low = user_msg.lower().strip()
    if low in {"yes", "yeah", "correct", "yes please", "go ahead"}:
        return TurnExtraction(affirmation="yes")
    if low in {"no", "nope", "keep it", "no keep it"}:
        return TurnExtraction(affirmation="no", intent_delta="keep")
    # Slot pick — maps an ordinal to a 0-based proposed_slots index.
    if low in {"the first one", "first", "first one", "the first", "option 1", "1"}:
        return TurnExtraction(field_deltas=FieldDeltas(selected_slot_index=0))
    if low in {"the second one", "second", "option 2", "2"}:
        return TurnExtraction(field_deltas=FieldDeltas(selected_slot_index=1))
    if "reschedule" in low or "move my" in low or "change my appointment" in low:
        return TurnExtraction(intent_delta="cancel", wants_reschedule=True)
    if "cancel" in low:
        return TurnExtraction(intent_delta="cancel")
    return TurnExtraction()


def _capturing_respond(msgs):
    # The scene lives in the system message ("# Scene: <name>"); the context
    # block (reason_for_visit, is_reschedule, ...) is a separate HumanMessage
    # ("# Context\n..."). Capture EVERYTHING so assertions can see both.
    sys_text = next((m.content for m in msgs if m.type == "system"), "")
    full = "\n".join(m.content for m in msgs)
    _CAP["sys"] = full
    scene = (
        sys_text.split("Scene: ", 1)[1].split("\n", 1)[0].strip()
        if "Scene: " in sys_text
        else "?"
    )
    return AIMessage(content=f"<{scene}>")


def _wire_fakes() -> None:
    import os
    os.environ.setdefault("OPENAI_API_KEY", "test")
    from app.graph.nodes import extract as extract_mod
    from app.graph.nodes import respond as respond_mod
    extract_mod._get_extractor = lambda: types.SimpleNamespace(
        invoke=lambda msgs: _fake_extract_for(
            msgs[-1].content.split("# Last user message", 1)[1]
            if "# Last user message" in msgs[-1].content
            else msgs[-1].content
        )
    )
    respond_mod._get_responder = lambda: types.SimpleNamespace(invoke=_capturing_respond)


def _seed(sid: str):
    from app.graph.state import initial_state
    seed = initial_state("chat", sid, "test")
    seed["booking_status"] = "none"
    seed["appointment_id"] = None
    seed["booking_fields"] = {"phone": "7025550001"}  # type: ignore[typeddict-item]
    seed["insurance_fields"] = {"dob_yyyymmdd": "19980819"}  # type: ignore[typeddict-item]
    seed["gates"] = {"disclosure_done": True}  # type: ignore[typeddict-item]
    return seed


def _assert(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


# ---------------------------------------------------------------------------
# Scenario 1 — RESCHEDULE confirm: T1 confirm_cancel carries reason_for_visit
# + is_reschedule + therapist; T2 "yes" transitions into the new-time picker
# (present_slots) rather than cancelling. (The full move is scenario 2g.)
# ---------------------------------------------------------------------------

async def _run_reschedule() -> None:
    _GW["lookup"] = {
        "found": True, "appointment_id": "APT-RESCHED-1", "email_hash": "h",
        "appointment_time_iso": "2026-06-10T15:00:00Z", "therapist_staff_id": 47,
        "service": "ADHD evaluation for my teen", "dob_match": True,
    }
    from app.graph import graph as graph_mod
    graph_mod.APP = None
    from app.graph.graph import build_graph
    app = build_graph()

    sid = "test-reschedule"
    cfg = {"configurable": {"thread_id": sid}}
    seed = _seed(sid)
    seed["messages"] = [HumanMessage(content="I need to reschedule my appointment")]

    s1 = await app.ainvoke(seed, config=cfg)
    sys1 = _CAP["sys"]
    print(f"[resched T1] scene={s1.get('_scene')} bs={s1.get('booking_status')} "
          f"service={s1.get('_appt_service')!r} wants={s1.get('_wants_reschedule')}")

    _assert(s1.get("_scene") == "confirm_cancel", f"T1 expected confirm_cancel, got {s1.get('_scene')}")
    _assert(s1.get("_appt_service") == "ADHD evaluation for my teen",
            f"service not carried into state: {s1.get('_appt_service')!r}")
    _assert(s1.get("_wants_reschedule") is True, "reschedule flag not sticky on T1")
    _assert("reason_for_visit: ADHD evaluation for my teen" in sys1,
            "reason_for_visit missing from confirm_cancel context")
    _assert("is_reschedule: True" in sys1, "is_reschedule should be True on reschedule confirm")
    _assert("therapist: Elisia Danley" in sys1, "therapist missing from confirm_cancel context")
    _assert(s1.get("booking_status") == "cancel_pending_confirm",
            f"expected cancel_pending_confirm, got {s1.get('booking_status')}")

    s2 = await app.ainvoke({"messages": [HumanMessage(content="yes")]}, config=cfg)
    print(f"[resched T2] scene={s2.get('_scene')} bs={s2.get('booking_status')} "
          f"wants={s2.get('_wants_reschedule')} appt={s2.get('appointment_id')}")

    # "yes" to the reschedule confirm now opens the new-time picker (the
    # appointment is moved in place once a slot is chosen) — it does NOT cancel.
    _assert(s2.get("_scene") == "present_slots", f"T2 expected present_slots, got {s2.get('_scene')}")
    _assert(s2.get("booking_status") != "cancelled", "reschedule must NOT cancel the appointment outright")
    _assert(s2.get("appointment_id") == "APT-RESCHED-1", "located appointment must be retained while picking")
    _assert(s2.get("_wants_reschedule") is True, "still rescheduling until the move completes")
    print("  PASS reschedule confirm -> picker")


# ---------------------------------------------------------------------------
# Scenario 2 — PLAIN CANCEL: full details, is_reschedule False
# ---------------------------------------------------------------------------

async def _run_plain_cancel() -> None:
    _GW["lookup"] = {
        "found": True, "appointment_id": "APT-CANCEL-1", "email_hash": "h",
        "appointment_time_iso": "2026-07-01T18:30:00Z", "therapist_staff_id": 47,
        "service": "Individual therapy", "dob_match": True,
    }
    _GW["cancel_email_queued"] = True  # gateway enqueued the cancellation email
    from app.graph import graph as graph_mod
    graph_mod.APP = None
    from app.graph.graph import build_graph
    app = build_graph()

    sid = "test-plain-cancel"
    cfg = {"configurable": {"thread_id": sid}}
    seed = _seed(sid)
    seed["messages"] = [HumanMessage(content="cancel my appointment")]

    s1 = await app.ainvoke(seed, config=cfg)
    sys1 = _CAP["sys"]
    print(f"[cancel T1] scene={s1.get('_scene')} reason={s1.get('_appt_service')!r}")

    _assert(s1.get("_scene") == "confirm_cancel", f"expected confirm_cancel, got {s1.get('_scene')}")
    _assert("reason_for_visit: Individual therapy" in sys1, "reason_for_visit missing")
    _assert("is_reschedule: False" in sys1, "plain cancel must be is_reschedule False")
    _assert(s1.get("_wants_reschedule") in (False, None), "plain cancel must not set reschedule flag")

    s2 = await app.ainvoke({"messages": [HumanMessage(content="yes")]}, config=cfg)
    _assert(s2.get("_scene") == "post_cancel", f"expected post_cancel, got {s2.get('_scene')}")
    _assert(s2.get("booking_status") == "cancelled", "appointment not cancelled")
    _assert(_CAP["sys"].count("is_reschedule: True") == 0, "plain cancel post_cancel must not claim reschedule")
    # Cancellation email confirmed by the gateway → flag + context must let
    # post_cancel truthfully tell the caller an email is on its way.
    _assert(s2.get("_cancel_email_sent") is True,
            "emailQueued from gateway must set _cancel_email_sent")
    _assert("email_sent: True" in _CAP["sys"], "post_cancel context must carry email_sent: True")
    _GW.pop("cancel_email_queued", None)
    print("  PASS plain cancel")


# ---------------------------------------------------------------------------
# Scenario 2b — NO identifiers yet: must ask for phone + DOB, never freelance
#
# Reproduces the production transcript where the bot fell through to
# open_question and kept asking "what's the date and time?" / "what details
# do you remember?" instead of asking for the phone + DOB it needs to look
# the appointment up. With no phone/DOB in state the planner routes to
# RESPOND(ask_cancel_identifiers); _pick_scene must honour that.
# ---------------------------------------------------------------------------

async def _run_needs_identifiers() -> None:
    from app.graph import graph as graph_mod
    graph_mod.APP = None
    from app.graph.graph import build_graph
    app = build_graph()

    sid = "test-needs-ids"
    cfg = {"configurable": {"thread_id": sid}}
    # Seed WITHOUT phone or DOB — the caller hasn't given identifiers yet.
    from app.graph.state import initial_state
    seed = initial_state("chat", sid, "test")
    seed["booking_status"] = "none"
    seed["gates"] = {"disclosure_done": True}  # type: ignore[typeddict-item]
    seed["messages"] = [HumanMessage(content="I need to cancel or reschedule my appointment")]

    s1 = await app.ainvoke(seed, config=cfg)
    print(f"[needs-ids] scene={s1.get('_scene')} bs={s1.get('booking_status')}")
    _assert(s1.get("_scene") == "ask_cancel_identifiers",
            f"expected ask_cancel_identifiers, got {s1.get('_scene')}")
    _assert(s1.get("appointment_id") is None, "must not have located an appointment yet")
    print("  PASS needs identifiers")


# ---------------------------------------------------------------------------
# Scenario 2c — RESCHEDULE with no identifiers: same path as cancel, but the
# reschedule flag must already be sticky on this first turn so the eventual
# confirm/post-cancel wording offers a new time.
# ---------------------------------------------------------------------------

async def _run_reschedule_needs_identifiers() -> None:
    from app.graph import graph as graph_mod
    graph_mod.APP = None
    from app.graph.graph import build_graph
    app = build_graph()

    sid = "test-resched-needs-ids"
    cfg = {"configurable": {"thread_id": sid}}
    from app.graph.state import initial_state
    seed = initial_state("chat", sid, "test")
    seed["booking_status"] = "none"
    seed["gates"] = {"disclosure_done": True}  # type: ignore[typeddict-item]
    seed["messages"] = [HumanMessage(content="I want to reschedule my appointment")]

    s1 = await app.ainvoke(seed, config=cfg)
    print(f"[resched-needs-ids] scene={s1.get('_scene')} wants={s1.get('_wants_reschedule')}")
    _assert(s1.get("_scene") == "ask_cancel_identifiers",
            f"expected ask_cancel_identifiers, got {s1.get('_scene')}")
    _assert(s1.get("_wants_reschedule") is True,
            "reschedule flag must be sticky even before identifiers are collected")
    _assert(s1.get("appointment_id") is None, "must not have located an appointment yet")
    print("  PASS reschedule needs identifiers")


# ---------------------------------------------------------------------------
# Scenario 2d — RESCHEDULE then KEEP: caller changes their mind at confirm.
# The cancel must NOT fire, the appointment stays booked, and the sticky
# reschedule flag must be cleared so it can't leak into a later cancel.
# ---------------------------------------------------------------------------

async def _run_reschedule_then_keep() -> None:
    _GW["lookup"] = {
        "found": True, "appointment_id": "APT-KEEP-1", "email_hash": "h",
        "appointment_time_iso": "2026-08-12T16:00:00Z", "therapist_staff_id": 47,
        "service": "Couples therapy", "dob_match": True,
    }
    from app.graph import graph as graph_mod
    graph_mod.APP = None
    from app.graph.graph import build_graph
    app = build_graph()

    sid = "test-resched-keep"
    cfg = {"configurable": {"thread_id": sid}}
    seed = _seed(sid)
    seed["messages"] = [HumanMessage(content="reschedule my appointment")]

    s1 = await app.ainvoke(seed, config=cfg)
    _assert(s1.get("_scene") == "confirm_cancel", f"T1 expected confirm_cancel, got {s1.get('_scene')}")
    _assert(s1.get("_wants_reschedule") is True, "reschedule flag should be set at confirm")
    _assert(s1.get("appointment_id") == "APT-KEEP-1", "appointment should be located")

    s2 = await app.ainvoke({"messages": [HumanMessage(content="no keep it")]}, config=cfg)
    print(f"[resched-keep T2] scene={s2.get('_scene')} bs={s2.get('booking_status')} "
          f"appt={s2.get('appointment_id')} wants={s2.get('_wants_reschedule')}")
    _assert(s2.get("booking_status") == "booked", f"appointment must stay booked, got {s2.get('booking_status')}")
    _assert(s2.get("appointment_id") == "APT-KEEP-1", "kept appointment must retain its id")
    _assert(s2.get("_wants_reschedule") is False, "reschedule flag must clear after keep")
    _assert(_CAP["sys"].count("is_reschedule: True") == 0, "keep path must not claim a reschedule")
    print("  PASS reschedule then keep")


# ---------------------------------------------------------------------------
# Scenario 2e — RESCHEDULE a PAST appointment: verified identity, but the
# located appointment already passed, so there's nothing to move.
# ---------------------------------------------------------------------------

async def _run_reschedule_past() -> None:
    _GW["lookup"] = {
        "found": False, "reason": "past_appointment",
        "appointment_time_iso": "2019-03-03T17:00:00Z",
    }
    from app.graph import graph as graph_mod
    graph_mod.APP = None
    from app.graph.graph import build_graph
    app = build_graph()

    sid = "test-resched-past"
    cfg = {"configurable": {"thread_id": sid}}
    seed = _seed(sid)
    seed["messages"] = [HumanMessage(content="I'd like to move my appointment to next week")]

    s1 = await app.ainvoke(seed, config=cfg)
    print(f"[resched-past] scene={s1.get('_scene')} appt={s1.get('appointment_id')}")
    _assert(s1.get("_scene") == "cancel_past_appointment",
            f"expected cancel_past_appointment, got {s1.get('_scene')}")
    _assert(s1.get("appointment_id") is None, "past appointment must not be cancellable/movable")
    print("  PASS reschedule past appointment")


# ---------------------------------------------------------------------------
# Scenario 2f — RESCHEDULE with DOB verification failure: never reveals
# details, never cancels, never moves.
# ---------------------------------------------------------------------------

async def _run_reschedule_verify_fail() -> None:
    _GW["lookup"] = {"found": False, "dob_match": False, "reason": "verification_failed"}
    from app.graph import graph as graph_mod
    graph_mod.APP = None
    from app.graph.graph import build_graph
    app = build_graph()

    sid = "test-resched-verifyfail"
    cfg = {"configurable": {"thread_id": sid}}
    seed = _seed(sid)
    seed["messages"] = [HumanMessage(content="change my appointment to a different day")]

    s1 = await app.ainvoke(seed, config=cfg)
    print(f"[resched-verifyfail] scene={s1.get('_scene')} appt={s1.get('appointment_id')}")
    _assert(s1.get("_scene") == "cancel_not_found",
            f"expected cancel_not_found, got {s1.get('_scene')}")
    _assert(s1.get("appointment_id") is None, "must not locate an appointment on verify fail")
    _assert(s1.get("_appt_service") in (None, ""), "must not leak service on verify fail")
    print("  PASS reschedule verification failure")


# ---------------------------------------------------------------------------
# Scenario 2g — RESCHEDULE FULL MOVE: locate -> confirm -> pick a new slot ->
# appointment is moved in place (no re-intake) and we confirm the new time.
# This is the path the user signed off on ("book new time in chat, no
# re-asking"). It also proves the old post_cancel loop is gone.
# ---------------------------------------------------------------------------

async def _run_reschedule_full_move() -> None:
    _GW["lookup"] = {
        "found": True, "appointment_id": "APT-MOVE-1", "email_hash": "ehash-move",
        "appointment_time_iso": "2026-06-10T15:00:00Z", "therapist_staff_id": 47,
        "service": "Individual therapy", "dob_match": True,
    }
    _GW.pop("reschedule_slot_taken", None)
    _GW["reschedule_email_queued"] = True  # gateway enqueued the confirmation
    from app.graph import graph as graph_mod
    graph_mod.APP = None
    from app.graph.graph import build_graph
    app = build_graph()

    sid = "test-resched-move"
    cfg = {"configurable": {"thread_id": sid}}
    seed = _seed(sid)
    seed["messages"] = [HumanMessage(content="reschedule my appointment")]

    s1 = await app.ainvoke(seed, config=cfg)
    _assert(s1.get("_scene") == "confirm_cancel", f"T1 expected confirm_cancel, got {s1.get('_scene')}")

    s2 = await app.ainvoke({"messages": [HumanMessage(content="yes")]}, config=cfg)
    print(f"[move T2] scene={s2.get('_scene')} bs={s2.get('booking_status')} slots={len(s2.get('proposed_slots') or [])}")
    _assert(s2.get("_scene") == "present_slots",
            f"T2 expected present_slots (find a new time), got {s2.get('_scene')}")
    _assert(len(s2.get("proposed_slots") or []) > 0, "should have proposed new openings")
    _assert(s2.get("appointment_id") == "APT-MOVE-1", "must keep the located appointment while picking")

    s3 = await app.ainvoke({"messages": [HumanMessage(content="the first one")]}, config=cfg)
    sys3 = _CAP["sys"]
    print(f"[move T3] scene={s3.get('_scene')} bs={s3.get('booking_status')} "
          f"intent={s3.get('intent')} wants={s3.get('_wants_reschedule')} appt={s3.get('appointment_id')}")
    _assert(s3.get("_scene") == "post_reschedule", f"T3 expected post_reschedule, got {s3.get('_scene')}")
    _assert(s3.get("booking_status") == "booked", f"moved appt should be booked, got {s3.get('booking_status')}")
    _assert(s3.get("_wants_reschedule") is False, "reschedule flag must clear after the move")
    _assert(s3.get("intent") == "idle", f"intent should reset to idle after move, got {s3.get('intent')}")
    _assert(s3.get("appointment_id") == "APT-MOVE-1", "move keeps the same appointment id (in-place)")
    _assert("therapist: Elisia Danley" in sys3, "post_reschedule must name the therapist")
    _assert("appt_time_friendly:" in sys3, "post_reschedule must carry the new time")
    # Email confirmation: the gateway enqueued it, so the flag + context must
    # let post_reschedule truthfully tell the caller an email is on its way.
    _assert(s3.get("_reschedule_email_sent") is True,
            "emailQueued from gateway must set _reschedule_email_sent")
    _assert("email_sent: True" in sys3, "post_reschedule context must carry email_sent: True")

    # T4 — a follow-up must NOT loop back into cancel/post_cancel.
    s4 = await app.ainvoke({"messages": [HumanMessage(content="thanks")]}, config=cfg)
    print(f"[move T4] scene={s4.get('_scene')} bs={s4.get('booking_status')}")
    _assert(s4.get("_scene") == "post_booking_followup",
            f"T4 follow-up expected post_booking_followup (no loop), got {s4.get('_scene')}")
    _GW.pop("reschedule_email_queued", None)
    print("  PASS reschedule full move")


# ---------------------------------------------------------------------------
# Scenario 2i — RESCHEDULE must NOT re-offer the caller's CURRENT slot, and
# must NOT claim an email when the gateway didn't enqueue one. Reproduces the
# production bug where the picker proposed the exact same date/time the caller
# was already booked into, and the "all set" message implied an email had been
# sent when none was. The free-slots feed here includes the current slot.
# ---------------------------------------------------------------------------

async def _run_reschedule_excludes_current_slot() -> None:
    current_iso = _future_iso(3, 18)  # equals the FIRST free slot below
    _GW["lookup"] = {
        "found": True, "appointment_id": "APT-SAME-1", "email_hash": "ehash-same",
        "appointment_time_iso": current_iso, "therapist_staff_id": 47,
        "service": "Individual therapy", "dob_match": True,
    }
    _GW.pop("reschedule_slot_taken", None)
    _GW.pop("reschedule_email_queued", None)  # gateway did NOT enqueue an email
    from app.graph import graph as graph_mod
    graph_mod.APP = None
    from app.graph.graph import build_graph
    app = build_graph()

    sid = "test-resched-same-slot"
    cfg = {"configurable": {"thread_id": sid}}
    seed = _seed(sid)
    seed["messages"] = [HumanMessage(content="reschedule my appointment")]

    await app.ainvoke(seed, config=cfg)
    s2 = await app.ainvoke({"messages": [HumanMessage(content="yes")]}, config=cfg)
    slots = s2.get("proposed_slots") or []
    print(f"[same-slot T2] scene={s2.get('_scene')} slots={[s.get('startISO') for s in slots]} "
          f"current={current_iso}")
    _assert(s2.get("_scene") == "present_slots", f"T2 expected present_slots, got {s2.get('_scene')}")
    _assert(len(slots) > 0, "should still propose other openings")
    _assert(all(s.get("startISO") != current_iso for s in slots),
            f"must NOT re-offer the caller's current slot {current_iso}: {[s.get('startISO') for s in slots]}")

    s3 = await app.ainvoke({"messages": [HumanMessage(content="the first one")]}, config=cfg)
    sys3 = _CAP["sys"]
    print(f"[same-slot T3] scene={s3.get('_scene')} email_sent={s3.get('_reschedule_email_sent')}")
    _assert(s3.get("_scene") == "post_reschedule", f"T3 expected post_reschedule, got {s3.get('_scene')}")
    _assert(not s3.get("_reschedule_email_sent"),
            "must NOT claim an email when the gateway didn't enqueue one")
    _assert("email_sent: False" in sys3, "post_reschedule context must carry email_sent: False")
    print("  PASS reschedule excludes current slot + no false email claim")


# ---------------------------------------------------------------------------
# Scenario 2h — RESCHEDULE MOVE, slot taken at the last moment: the gateway
# returns 409 + alternatives; we re-present them and the caller picks again.
# ---------------------------------------------------------------------------

async def _run_reschedule_move_slot_taken() -> None:
    _GW["lookup"] = {
        "found": True, "appointment_id": "APT-TAKEN-1", "email_hash": "ehash-taken",
        "appointment_time_iso": "2026-06-10T15:00:00Z", "therapist_staff_id": 47,
        "service": "Individual therapy", "dob_match": True,
    }
    _GW["reschedule_slot_taken"] = True
    from app.graph import graph as graph_mod
    graph_mod.APP = None
    from app.graph.graph import build_graph
    app = build_graph()

    sid = "test-resched-taken"
    cfg = {"configurable": {"thread_id": sid}}
    seed = _seed(sid)
    seed["messages"] = [HumanMessage(content="reschedule my appointment")]

    await app.ainvoke(seed, config=cfg)
    await app.ainvoke({"messages": [HumanMessage(content="yes")]}, config=cfg)
    s3 = await app.ainvoke({"messages": [HumanMessage(content="the first one")]}, config=cfg)
    print(f"[move-taken T3] scene={s3.get('_scene')} bs={s3.get('booking_status')} "
          f"slots={len(s3.get('proposed_slots') or [])} appt={s3.get('appointment_id')}")
    _assert(s3.get("_scene") == "present_slots",
            f"slot-taken should re-present alternatives, got {s3.get('_scene')}")
    _assert(s3.get("booking_status") != "booked", "must not claim a move that didn't happen")
    _assert(s3.get("_wants_reschedule") is True, "still rescheduling after a taken slot")
    _assert(len(s3.get("proposed_slots") or []) > 0, "alternatives should be offered")
    _GW.pop("reschedule_slot_taken", None)
    print("  PASS reschedule move slot taken")


# ---------------------------------------------------------------------------
# Scenario 3 — DOB verification failure: never reveals details, never cancels
# ---------------------------------------------------------------------------

async def _run_verify_fail() -> None:
    _GW["lookup"] = {"found": False, "dob_match": False, "reason": "verification_failed"}
    from app.graph import graph as graph_mod
    graph_mod.APP = None
    from app.graph.graph import build_graph
    app = build_graph()

    sid = "test-verify-fail"
    cfg = {"configurable": {"thread_id": sid}}
    seed = _seed(sid)
    seed["messages"] = [HumanMessage(content="cancel my appointment")]

    s1 = await app.ainvoke(seed, config=cfg)
    print(f"[verifyfail] scene={s1.get('_scene')} appt_id={s1.get('appointment_id')}")
    _assert(s1.get("_scene") == "cancel_not_found", f"expected cancel_not_found, got {s1.get('_scene')}")
    _assert(s1.get("appointment_id") is None, "must not set appointment_id on verify fail")
    _assert(s1.get("_appt_service") in (None, ""), "must not leak service on verify fail")
    print("  PASS verification failure")


# ---------------------------------------------------------------------------
# Scenario 4 — PAST appointment: verified but already passed, cannot cancel
# ---------------------------------------------------------------------------

async def _run_past() -> None:
    _GW["lookup"] = {
        "found": False, "reason": "past_appointment",
        "appointment_time_iso": "2020-01-01T17:00:00Z",
    }
    from app.graph import graph as graph_mod
    graph_mod.APP = None
    from app.graph.graph import build_graph
    app = build_graph()

    sid = "test-past"
    cfg = {"configurable": {"thread_id": sid}}
    seed = _seed(sid)
    seed["messages"] = [HumanMessage(content="cancel my appointment")]

    s1 = await app.ainvoke(seed, config=cfg)
    print(f"[past] scene={s1.get('_scene')} appt_id={s1.get('appointment_id')}")
    _assert(s1.get("_scene") == "cancel_past_appointment", f"expected cancel_past_appointment, got {s1.get('_scene')}")
    _assert(s1.get("appointment_id") is None, "past appointment must not be cancellable")
    print("  PASS past appointment")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

async def main() -> int:
    _stubs()
    _wire_fakes()
    try:
        await _run_reschedule()
        await _run_plain_cancel()
        await _run_needs_identifiers()
        await _run_reschedule_needs_identifiers()
        await _run_reschedule_then_keep()
        await _run_reschedule_past()
        await _run_reschedule_verify_fail()
        await _run_reschedule_full_move()
        await _run_reschedule_excludes_current_slot()
        await _run_reschedule_move_slot_taken()
        await _run_verify_fail()
        await _run_past()
    except AssertionError as exc:
        print(f"\nFAIL — {exc}")
        return 1
    print("\nALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

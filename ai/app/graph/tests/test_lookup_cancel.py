"""Integration test: lookup_appointment → cancel path.

Exercises two scenarios:

  1. Happy path — gateway returns found+dob_match, state transitions through
     lookup → booking_status=="booked" → confirm_cancel → confirmed
     → cancel_appointment runs → booking_status=="cancelled".

  2. Verification-failed path — gateway returns
     {"found": false, "reason": "verification_failed"}.
     Assert cancel_not_found scene is rendered and appointment_id is never set.

Runs hermetically — all LLM and gateway calls are mocked.
"""
from __future__ import annotations

import asyncio
import sys
import types
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage


# ---------------------------------------------------------------------------
# Module stubs — same pattern as smoke.py / test_cancel_then_keep.py
# ---------------------------------------------------------------------------

def _stubs():
    sys.modules.setdefault("agents", types.SimpleNamespace(function_tool=lambda f: f))

    class _C:
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def cursor(self): return self
        def execute(self, *a, **k): pass
        def fetchone(self): return None
        def fetchall(self): return []

    sys.modules["app.db"] = types.SimpleNamespace(conn=lambda: _C())
    sys.modules["app.aws_signer"] = types.SimpleNamespace(
        gateway_post=lambda *a, **k: {"ok": True},
        signed_post=lambda *a, **k: {"status": "active"},
    )

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


def _fake_extract_for(user_msg: str):
    from app.graph.prompts.extract import TurnExtraction
    low = user_msg.lower()
    if low.strip() in {"yes", "yeah", "correct", "yes please"}:
        return TurnExtraction(affirmation="yes")
    if "cancel" in low:
        return TurnExtraction(intent_delta="cancel")
    return TurnExtraction()


def _fake_respond(msgs):
    sys_text = next((m.content for m in msgs if m.type == "system"), "")
    scene = (
        sys_text.split("Scene: ", 1)[1].split("\n", 1)[0].strip()
        if "Scene: " in sys_text
        else "?"
    )
    return AIMessage(content=f"<{scene}>")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_FOUND_RESP: dict[str, Any] = {
    "found": True,
    "appointment_id": "APT-LOOKUP-001",
    "email_hash": "abc123hash",
    "appointment_time_iso": "2026-06-10T15:00:00Z",
    "therapist_staff_id": 47,
    "dob_match": True,
}

_VERIFY_FAIL_RESP: dict[str, Any] = {
    "found": False,
    "dob_match": False,
    "reason": "verification_failed",
}


# ---------------------------------------------------------------------------
# Happy path — lookup found → confirm → cancel success
# ---------------------------------------------------------------------------

async def _run_happy_path() -> None:
    """
    Turn 1: caller says "cancel my appointment"
             → planner should route to LOOKUP_APPOINTMENT (phone+dob in state)
             → lookup returns found+dob_match
             → booking_status set to "booked", last_action="lookup_appointment_found"
             → planner (next turn) or respond routes to confirm_cancel

    Turn 2: caller says "yes" to confirm
             → planner routes to CANCEL
             → cancel succeeds → booking_status="cancelled"
    """
    import os
    _stubs()
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
    respond_mod._get_responder = lambda: types.SimpleNamespace(invoke=_fake_respond)

    # Track cancel calls.
    cancel_calls: dict[str, int] = {"n": 0}
    lookup_calls: dict[str, int] = {"n": 0}

    # Patch lookup_appointment to return a found appointment.
    def fake_lookup(state):
        lookup_calls["n"] += 1
        # Mirror what the real node writes on found+dob_match.
        return {
            "appointment_id": "APT-LOOKUP-001",
            "_appt_email_hash": "abc123hash",
            "_appt_time_iso": "2026-06-10T15:00:00Z",
            "staff_id": 47,
            "staff_name": "Elisia Danley",
            "booking_status": "booked",
            "last_action": "lookup_appointment_found",
        }

    def fake_cancel(state):
        cancel_calls["n"] += 1
        return {
            "booking_status": "cancelled",
            "appointment_id": None,
            "last_action": "cancel_appointment_success",
        }

    from app.graph.nodes import actions as actions_mod
    actions_mod.lookup_appointment = fake_lookup
    actions_mod.cancel_appointment = fake_cancel

    from app.graph import graph as graph_mod
    graph_mod.lookup_appointment = fake_lookup
    graph_mod.cancel_appointment = fake_cancel
    graph_mod.APP = None

    from app.graph.graph import build_graph
    from app.graph.state import initial_state

    app = build_graph()

    sid = "test-lookup-cancel-happy"
    cfg = {"configurable": {"thread_id": sid}}

    # Seed state: disclosure done, phone + dob in state, NO appointment in session.
    seed = initial_state("chat", sid, "test")
    seed["booking_status"] = "none"
    seed["appointment_id"] = None
    seed["booking_fields"] = {"phone": "7025550001"}  # type: ignore[typeddict-item]
    seed["insurance_fields"] = {"dob_yyyymmdd": "19980819"}  # type: ignore[typeddict-item]
    seed["gates"] = {"disclosure_done": True}  # type: ignore[typeddict-item]
    seed["messages"] = [HumanMessage(content="I need to cancel my appointment")]

    s1 = await app.ainvoke(seed, config=cfg)
    print(
        f"[happy T1] scene={s1.get('_scene')} bs={s1.get('booking_status')} "
        f"appt_id={s1.get('appointment_id')} lookup_calls={lookup_calls['n']}"
    )

    # After T1: lookup should have fired, booking_status="booked" (set by
    # lookup node), and since booking_status is now "booked" with intent=cancel
    # respond should pick confirm_cancel.
    assert lookup_calls["n"] == 1, f"lookup not called: {lookup_calls['n']}"
    assert s1.get("appointment_id") == "APT-LOOKUP-001", (
        f"appointment_id not set: {s1.get('appointment_id')}"
    )
    assert s1.get("booking_status") == "cancel_pending_confirm", (
        f"expected cancel_pending_confirm, got {s1.get('booking_status')}"
    )
    assert s1.get("_scene") == "confirm_cancel", (
        f"expected confirm_cancel, got {s1.get('_scene')}"
    )
    assert cancel_calls["n"] == 0, "cancel tool was called before confirmation!"
    assert s1.get("_appt_email_hash") == "abc123hash"
    assert s1.get("_appt_time_iso") == "2026-06-10T15:00:00Z"
    assert s1.get("staff_name") == "Elisia Danley"

    # T2: confirm the cancel.
    s2 = await app.ainvoke(
        {"messages": [HumanMessage(content="yes")]},
        config=cfg,
    )
    print(
        f"[happy T2] scene={s2.get('_scene')} bs={s2.get('booking_status')} "
        f"cancel_calls={cancel_calls['n']}"
    )

    assert cancel_calls["n"] == 1, f"cancel tool not called: {cancel_calls['n']}"
    assert s2.get("booking_status") == "cancelled", (
        f"expected cancelled, got {s2.get('booking_status')}"
    )
    assert s2.get("_scene") == "post_cancel", (
        f"expected post_cancel, got {s2.get('_scene')}"
    )

    print("  PASS happy path")


# ---------------------------------------------------------------------------
# Verification-failed path — renders cancel_not_found, never sets appointment_id
# ---------------------------------------------------------------------------

async def _run_verify_fail_path() -> None:
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
    respond_mod._get_responder = lambda: types.SimpleNamespace(invoke=_fake_respond)

    cancel_calls: dict[str, int] = {"n": 0}

    def fake_lookup_fail(state):
        return {"last_action": "lookup_appointment_verify_failed"}

    def fake_cancel(state):
        cancel_calls["n"] += 1
        return {
            "booking_status": "cancelled",
            "appointment_id": None,
            "last_action": "cancel_appointment_success",
        }

    from app.graph.nodes import actions as actions_mod
    actions_mod.lookup_appointment = fake_lookup_fail
    actions_mod.cancel_appointment = fake_cancel

    from app.graph import graph as graph_mod
    graph_mod.lookup_appointment = fake_lookup_fail
    graph_mod.cancel_appointment = fake_cancel
    graph_mod.APP = None

    from app.graph.graph import build_graph
    from app.graph.state import initial_state

    app = build_graph()

    sid = "test-lookup-cancel-fail"
    cfg = {"configurable": {"thread_id": sid}}

    seed = initial_state("chat", sid, "test")
    seed["booking_status"] = "none"
    seed["appointment_id"] = None
    seed["booking_fields"] = {"phone": "7025550002"}  # type: ignore[typeddict-item]
    seed["insurance_fields"] = {"dob_yyyymmdd": "19800101"}  # type: ignore[typeddict-item]
    seed["gates"] = {"disclosure_done": True}  # type: ignore[typeddict-item]
    seed["messages"] = [HumanMessage(content="I want to cancel my appointment")]

    s1 = await app.ainvoke(seed, config=cfg)
    print(
        f"[fail T1] scene={s1.get('_scene')} bs={s1.get('booking_status')} "
        f"appt_id={s1.get('appointment_id')} cancel_calls={cancel_calls['n']}"
    )

    assert s1.get("_scene") == "cancel_not_found", (
        f"expected cancel_not_found, got {s1.get('_scene')}"
    )
    assert s1.get("appointment_id") is None, (
        f"appointment_id should not be set: {s1.get('appointment_id')}"
    )
    assert cancel_calls["n"] == 0, "cancel tool was called on verification failure!"

    print("  PASS verification-failed path")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

async def main() -> int:
    _stubs()
    try:
        await _run_happy_path()
        await _run_verify_fail_path()
    except AssertionError as exc:
        print(f"\nFAIL — {exc}")
        return 1
    print("\nALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

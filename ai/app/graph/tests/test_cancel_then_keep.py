"""Multi-turn integration test: book → cancel → keep.

Exercises the exact "actually cancel — no wait keep it" path we
discussed in the design conversation. Demonstrates that:

  * The destructive cancel tool is NOT invoked when the caller backs
    out at the confirmation gate.
  * State rolls cleanly back to ``booked`` without orchestration
    drama.

Runs hermetically — all LLM and tool calls are mocked.
"""
from __future__ import annotations

import asyncio
import sys
import types

from langchain_core.messages import AIMessage, HumanMessage


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
        ELIGIBLE_FOR_BOOKING=[{"staffId": 47, "name": "Elisia"}],
        THERAPISTS_WITHOUT_FEEDS=[], THERAPISTS_WITH_FEEDS=[{"staffId": 47, "name": "Elisia"}],
    )


def _fake_extract_for(user_msg: str):
    from app.graph.prompts.extract import TurnExtraction
    low = user_msg.lower()
    if low.strip() in {"yes", "yeah", "correct"}:
        return TurnExtraction(affirmation="yes")
    if "keep" in low or "no wait" in low or "nevermind" in low:
        return TurnExtraction(intent_delta="keep", affirmation="no")
    if "cancel" in low:
        return TurnExtraction(intent_delta="cancel")
    return TurnExtraction()


def _fake_respond(msgs):
    sys_text = next((m.content for m in msgs if m.type == "system"), "")
    scene = sys_text.split("Scene: ", 1)[1].split("\n", 1)[0].strip() if "Scene: " in sys_text else "?"
    return AIMessage(content=f"<{scene}>")


async def main() -> int:
    import os
    _stubs()
    os.environ["OPENAI_API_KEY"] = "test"

    from app.graph.nodes import extract as extract_mod
    from app.graph.nodes import respond as respond_mod
    extract_mod._get_extractor = lambda: types.SimpleNamespace(
        invoke=lambda msgs: _fake_extract_for(
            msgs[-1].content.split("# Last user message", 1)[1] if "# Last user message" in msgs[-1].content else msgs[-1].content
        )
    )
    respond_mod._get_responder = lambda: types.SimpleNamespace(invoke=_fake_respond)

    # Count tool invocations so we can prove cancel was NOT called.
    cancel_calls = {"n": 0}
    book_calls = {"n": 0}

    from app.graph.nodes import actions as actions_mod
    def cancel(state):
        cancel_calls["n"] += 1
        return {"booking_status": "cancelled", "appointment_id": None,
                "last_action": "cancel_appointment_success"}
    def book(state):
        book_calls["n"] += 1
        return {"appointment_id": "APT-T", "booking_status": "booked",
                "last_action": "book_appointment_success"}

    actions_mod.cancel_appointment = cancel
    actions_mod.book_appointment = book

    from app.graph import graph as graph_mod
    graph_mod.cancel_appointment = cancel
    graph_mod.book_appointment = book
    graph_mod.APP = None

    from app.graph.graph import build_graph
    from app.graph.state import initial_state
    app = build_graph()

    sid = "cancel-keep"
    cfg = {"configurable": {"thread_id": sid}}

    # Seed state mid-booking — caller has already confirmed booking, so
    # we're at booking_status=booked with an appointment id.
    seed = initial_state("chat", sid, "test")
    seed["gates"] = {"disclosure_done": True}  # type: ignore[typeddict-item]
    seed["booking_status"] = "booked"
    seed["appointment_id"] = "APT-001"
    seed["selected_slot"] = {"startISO": "2026-05-27T14:00Z", "endISO": "...",
                             "displayPT": "Tue, May 27 at 2:00 PM PT"}
    seed["staff_name"] = "Elisia"
    seed["messages"] = [HumanMessage(content="actually cancel that")]
    s1 = await app.ainvoke(seed, config=cfg)
    print(f"T1 'actually cancel that' -> scene={s1.get('_scene')} bs={s1.get('booking_status')} cancel_calls={cancel_calls['n']}")
    assert s1.get("_scene") == "confirm_cancel", f"expected confirm_cancel, got {s1.get('_scene')}"
    assert s1.get("booking_status") == "cancel_pending_confirm", f"got {s1.get('booking_status')}"
    assert cancel_calls["n"] == 0, "cancel tool was called BEFORE confirmation!"

    # T2: caller backs out
    s2 = await app.ainvoke(
        {"messages": [HumanMessage(content="no wait, keep it")]},
        config=cfg,
    )
    print(f"T2 'no wait keep it'      -> scene={s2.get('_scene')} bs={s2.get('booking_status')} cancel_calls={cancel_calls['n']}")
    assert s2.get("booking_status") == "booked", f"booking_status={s2.get('booking_status')}"
    assert cancel_calls["n"] == 0, "cancel tool was called during rollback!"

    print("\nPASS — cancel tool never invoked, state rolled back to booked.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

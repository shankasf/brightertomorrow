"""Smoke test — compile the graph and run a few synthetic turns end-to-end.

Mocks the OpenAI / tool calls so this can run in CI without keys.
"""
from __future__ import annotations

import asyncio
import sys
from unittest.mock import MagicMock, patch

from langchain_core.messages import AIMessage, HumanMessage


# ---------------------------------------------------------------------------
# Synthetic extract / respond replacements — bypass the OpenAI call.
# ---------------------------------------------------------------------------

def _fake_extractor_for(text_block: str):
    """Pretend the extractor parsed the last user turn out of `text_block`.

    The real extract prompt wraps the user message under
    ``# Last user message\\n``; we only inspect that segment so substring
    matches don't false-positive on context labels like
    ``callback_fields_present: []``.
    """
    from app.graph.prompts.extract import FieldDeltas, TurnExtraction
    marker = "# Last user message"
    if marker in text_block:
        user_part = text_block.split(marker, 1)[1]
    else:
        user_part = text_block
    low = user_part.lower()
    if "kill myself" in low or "suicide" in low:
        return TurnExtraction(safety_signal=True)
    if "python" in low or "javascript" in low or "recipe" in low:
        return TurnExtraction(intent_delta="out_of_scope")
    if "hours" in low or " open" in low or "opening" in low:
        return TurnExtraction(intent_delta="info",
                              field_deltas=FieldDeltas(info_query="hours"))
    if "call me back" in low or "callback" in low:
        return TurnExtraction(intent_delta="callback")
    if "book" in low or "schedule" in low or "appointment" in low:
        return TurnExtraction(intent_delta="booking")
    return TurnExtraction()


def _fake_invoke(messages):
    """Return a fake AIMessage based on system prompt contents."""
    sys_text = next((m.content for m in messages if m.type == "system"), "")
    if "Scene: crisis" in sys_text:
        return AIMessage(content="I'm really glad you reached out. I'm not a clinician, but please call or text 988 right now, or 911 if you're in immediate danger. You can also call us at 725-238-6990.")
    if "Scene: ask_callback_field" in sys_text:
        return AIMessage(content="Sure — could I have your first name?")
    if "Scene: ask_insurance_field" in sys_text:
        return AIMessage(content="Happy to help. Could I have your first name as it appears on your insurance card?")
    if "Scene: greeting" in sys_text:
        return AIMessage(content="Hi there — would you like to book an appointment, check insurance, or learn about the practice?")
    if "Scene: info_answer" in sys_text:
        return AIMessage(content="We're open weekdays 9-5 Pacific Time.")
    if "Scene: out_of_scope" in sys_text:
        return AIMessage(content="I can only help with Brighter Tomorrow Therapy. Want to book, check insurance, or learn about the practice?")
    return AIMessage(content="(test reply)")


async def main() -> int:
    import os, types
    # Same stub plumbing as the compile test.
    sys.modules.setdefault("agents", types.SimpleNamespace(function_tool=lambda f: f))
    class _C:
        def __enter__(self): return self
        def __exit__(self,*a): pass
        def cursor(self): return self
        def execute(self,*a,**k): pass
        def fetchone(self): return None
        def fetchall(self): return []
    sys.modules["app.db"] = types.SimpleNamespace(conn=lambda: _C())
    sys.modules["app.aws_signer"] = types.SimpleNamespace(
        gateway_post=lambda *a, **k: {"ok": True},
        signed_post=lambda *a, **k: {"status": "active", "copay": "25", "plan": "PPO"},
    )
    from dataclasses import dataclass
    @dataclass
    class _Payer:
        id: str; name: str; aliases: tuple = ()
    sys.modules["app.data"] = types.SimpleNamespace()
    sys.modules["app.data.payers"] = types.SimpleNamespace(
        PAYERS=[_Payer("BCBS", "BCBS"), _Payer("SELF", "Self-pay")],
        resolve_payer_id=lambda n: _Payer("BCBS", "BCBS"),
    )
    sys.modules["app.bt_agents"] = types.SimpleNamespace()
    sys.modules["app.bt_agents.roster"] = types.SimpleNamespace(
        ELIGIBLE_FOR_BOOKING=[{"staffId": 47, "name": "Elisia Danley"}],
        THERAPISTS_WITHOUT_FEEDS=[],
        THERAPISTS_WITH_FEEDS=[{"staffId": 47, "name": "Elisia Danley"}],
    )
    os.environ.setdefault("OPENAI_API_KEY", "test")

    # Patch the LLM-backed extract + respond so we don't call OpenAI.
    from app.graph.nodes import extract as extract_mod
    from app.graph.nodes import respond as respond_mod
    extract_mod._get_extractor = lambda: types.SimpleNamespace(
        invoke=lambda msgs: _fake_extractor_for(msgs[-1].content)
    )
    respond_mod._get_responder = lambda: types.SimpleNamespace(invoke=_fake_invoke)

    # Patch the action nodes that would call external services so the
    # smoke test stays hermetic (no OpenAI embeddings, no gateway calls).
    from app.graph.nodes import actions as actions_mod
    actions_mod.search_kb = lambda state: {
        "kb_snippets": [{"title": "Hours", "url": "x", "content": "9-5 PT"}],
        "info_topic": state.get("last_user_text", "")[:80],
        "last_action": "search_kb",
    }
    actions_mod.verify_insurance = lambda state: {
        "verify_result": {"ok": True, "eligible": True, "payer": "BCBS",
                          "coverage": {"copay": "25"},
                          "display_text": "Verified BCBS, copay $25."},
        "last_action": "verify_insurance",
    }
    actions_mod.book_appointment = lambda state: {
        "appointment_id": "APT-TEST",
        "booking_status": "booked",
        "last_action": "book_appointment_success",
    }
    actions_mod.submit_callback = lambda state: {
        "callback_status": "submitted",
        "callback_id": "CB-TEST",
        "last_action": "submit_callback",
    }
    actions_mod.propose_slots = lambda state: {
        "proposed_slots": [{"startISO": "2026-05-27T14:00Z", "endISO": "2026-05-27T15:00Z",
                            "displayPT": "Tuesday, May 27 at 2:00 PM PT"}],
        "last_action": "propose_slots",
        "booking_status": "ready_for_slots",
    }
    actions_mod.cancel_appointment = lambda state: {
        "booking_status": "cancelled",
        "appointment_id": None,
        "last_action": "cancel_appointment_success",
    }

    # Important: graph.py imports the action functions at import time, so
    # patching the module attribute after the fact doesn't update the
    # already-bound references in graph nodes. We must build the graph
    # AFTER patching, AND we patch the graph module's symbol table too.
    from app.graph import graph as graph_mod
    graph_mod.search_kb = actions_mod.search_kb
    graph_mod.verify_insurance = actions_mod.verify_insurance
    graph_mod.book_appointment = actions_mod.book_appointment
    graph_mod.submit_callback = actions_mod.submit_callback
    graph_mod.propose_slots = actions_mod.propose_slots
    graph_mod.cancel_appointment = actions_mod.cancel_appointment
    graph_mod.APP = None  # force rebuild

    from app.graph.graph import build_graph
    from app.graph.state import initial_state
    app = build_graph()

    # NOTE: a bare "hi" turn produces scene=open_question (NOT greeting) —
    # because the greeting scene only fires when messages is empty, and by
    # the time respond runs the user's "hi" is already in messages. That
    # matches the behaviour we want: a follow-up greeting still gets a
    # warm open question. The greeting scene is reserved for the
    # synthetic widget-opened seed turn the chat runtime injects.
    cases = [
        ("hours-q",   "What are your business hours?",     "info_answer"),
        ("crisis",    "I want to kill myself",             "crisis"),
        ("callback",  "Can someone call me back?",         "ask_callback_field"),
        ("oos",       "Write me Python code",              "out_of_scope"),
        ("hello",     "hi",                                "open_question"),
        ("book",      "I want to book an appointment",     "ask_insurance_field"),
    ]

    fails = 0
    for name, msg, expected_scene in cases:
        sid = f"smoke-{name}"
        cfg = {"configurable": {"thread_id": sid}}
        seed = initial_state("chat", sid, "test")
        seed["messages"] = [HumanMessage(content=msg)]
        try:
            result = await app.ainvoke(seed, config=cfg)
        except Exception as exc:
            print(f"[FAIL] {name}: invoke raised {exc!r}")
            fails += 1
            continue
        scene = result.get("_scene")
        reply = result.get("last_reply_text", "")[:80]
        mark = "OK  " if scene == expected_scene else "FAIL"
        if scene != expected_scene:
            fails += 1
        print(f"{mark} {name}: expected={expected_scene} got={scene} reply={reply!r}")

    print(f"\n{fails} failures / {len(cases)} cases")
    return 0 if fails == 0 else 1


def _human_text(msgs) -> str:
    for m in reversed(msgs):
        if getattr(m, "type", None) == "human":
            return m.content
    return ""


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

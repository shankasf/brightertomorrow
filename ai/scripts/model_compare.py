"""Drive two scripted chat conversations through the real LangGraph and print
transcripts. Model is taken from OPENAI_MODEL (set before launch).

Run inside the bt-ai pod so tools (insurance verify, booking) hit the real
gateway -> Lambda path. Uses an in-memory checkpointer + a unique session id
per run so nothing touches DDB or resumes prior state.
"""
import asyncio
import os
import sys
import uuid

# Force isolated, in-process state.
os.environ["BT_LANGGRAPH_CHECKPOINT"] = "memory"

from app.graph.graph import build_graph
from app.graph.state import initial_state as graph_initial_state
from langchain_core.messages import HumanMessage

MODEL = os.environ.get("OPENAI_MODEL", "?")

# Identical user turns fed to both models.
INSURANCE_TURNS = [
    "Hi",
    "I want to check whether my insurance covers therapy.",
    "It's Anthem. My name is Sagar Shankaran, date of birth August 19, 1998.",
    "My member ID is IDKMC0169290.",
    "Yes please go ahead and check it.",
    "Great, thank you. What's my copay and is a deductible left?",
]

BOOKING_TURNS = [
    "Hi",
    "I'd like to book a therapy appointment.",
    "My name is Sagar Shankaran, born August 19, 1998.",
    "I'm paying with Anthem insurance, member ID IDKMC0169290.",
    "My email is sagar.shankaran@example.com and my phone is 702-555-0182.",
    "I'd prefer a weekday evening over video. Whatever's soonest works.",
    "Yes, book it.",
]


async def run_convo(app, title, turns):
    sid = f"cmp-{uuid.uuid4().hex[:12]}"
    cfg = {"configurable": {"thread_id": sid}}
    print(f"\n{'='*78}\n{title}  |  model={MODEL}  |  session={sid}\n{'='*78}")
    first = True
    for user_text in turns:
        try:
            if first:
                seed = graph_initial_state("chat", sid, "chat-agent")
                seed["messages"] = [HumanMessage(content=user_text)]
                result = await app.ainvoke(seed, config=cfg)
                first = False
            else:
                result = await app.ainvoke(
                    {"messages": [HumanMessage(content=user_text)]}, config=cfg
                )
            reply = (result.get("last_reply_text") or "").strip()
            scene = result.get("_scene")
            intent = result.get("intent")
            ins = result.get("insurance_fields")
            cov = None
            try:
                cov = getattr(ins, "coverage_active", None)
            except Exception:
                cov = None
            print(f"\nUSER : {user_text}")
            print(f"BOT  [{scene}|intent={intent}|cov={cov}]: {reply}")
        except Exception as e:
            print(f"\nUSER : {user_text}")
            print(f"ERROR: {type(e).__name__}: {e}")


async def main():
    app = build_graph()
    await run_convo(app, "SCENARIO A — INSURANCE CHECK", INSURANCE_TURNS)
    await run_convo(app, "SCENARIO B — APPOINTMENT BOOKING", BOOKING_TURNS)


if __name__ == "__main__":
    asyncio.run(main())

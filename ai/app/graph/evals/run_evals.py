"""CLI: run the golden eval suite and report results.

Usage:

    python -m app.graph.evals.run_evals

If LANGSMITH_TRACING=true and LANGSMITH_API_KEY are set, every conversation
turn is captured as a trace in the configured project, and a summary row
is uploaded to a dataset named ``bt-langgraph-golden`` (created if absent).

The script exits non-zero if any conversation has a failing score, so it
can be wired straight into CI.
"""
from __future__ import annotations

import asyncio
import logging
import sys

from langchain_core.messages import HumanMessage

from ..graph import get_app
from ..state import initial_state
from ..tracing import configure_tracing, langsmith_client
from .datasets import GOLDEN, Conversation
from .evaluators import Score, grade_turn

logger = logging.getLogger(__name__)


async def _run_conversation(app, convo: Conversation) -> tuple[Conversation, list[list[Score]]]:
    sid = f"eval-{convo.name}"
    cfg = {"configurable": {"thread_id": sid}}
    # Fresh state every run — clear the checkpointer thread first.
    try:
        await app.aupdate_state(cfg, initial_state("chat", sid, "eval"))
    except Exception:
        pass

    all_scores: list[list[Score]] = []
    seed = initial_state("chat", sid, "eval")
    seeded = False
    for turn in convo.turns:
        if not seeded:
            seed["messages"] = [HumanMessage(content=turn.user_says)]
            result = await app.ainvoke(seed, config=cfg)
            seeded = True
        else:
            result = await app.ainvoke(
                {"messages": [HumanMessage(content=turn.user_says)]},
                config=cfg,
            )
        reply = result.get("last_reply_text") or ""
        scores = grade_turn(turn, result, reply)
        all_scores.append(scores)
    return convo, all_scores


async def main() -> int:
    configure_tracing()
    app = get_app()

    failures = 0
    for convo in GOLDEN:
        try:
            _, score_lists = await _run_conversation(app, convo)
        except Exception as exc:
            print(f"[ERROR] {convo.name}: {exc}")
            failures += 1
            continue
        passed_all = True
        print(f"\n=== {convo.name} ===")
        for i, scores in enumerate(score_lists):
            for s in scores:
                mark = "OK " if s.passed else "FAIL"
                print(f"  turn{i} {mark} {s.name}: {s.detail}")
                if not s.passed:
                    passed_all = False
        if not passed_all:
            failures += 1

    client = langsmith_client()
    if client is not None:
        try:
            client.create_dataset(  # type: ignore[attr-defined]
                "bt-langgraph-golden",
                description="Golden conversations for the BT LangGraph stack",
            )
        except Exception:
            pass

    print(f"\n{'-' * 30}\nfailures: {failures}/{len(GOLDEN)}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

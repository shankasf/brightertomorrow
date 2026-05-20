"""LangSmith evaluation harness.

Two pieces:
  * datasets.py    — golden conversation fixtures (turn-by-turn).
  * evaluators.py  — programmatic graders (correctness, refusal,
                     field-extraction accuracy, safety).
  * run_evals.py   — CLI: `python -m app.graph.evals.run_evals`.

Run locally:

    LANGSMITH_TRACING=true \
    LANGSMITH_API_KEY=lsv2_... \
    LANGSMITH_PROJECT=bt-langgraph-evals \
    python -m app.graph.evals.run_evals

Use this in CI on every PR — the evaluators score the new graph
against the dataset and post results to LangSmith.
"""
from __future__ import annotations

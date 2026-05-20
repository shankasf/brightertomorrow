"""LangGraph implementation of the Brighter Tomorrow Therapy assistant.

This package is the *new* implementation that lives alongside the existing
``bt_agents/`` (OpenAI Agents SDK) and ``voice.py`` / ``twilio_voice.py``
stacks. Nothing here imports or mutates the old code paths — both stacks can
run in production side-by-side, gated by a feature flag.

Architecture (mental model):

    safety_screen ──► extract ──► planner ──► [action node] ──► respond
                                                                   │
                                                                 END ── wait for next turn

  * `State` (state.py)        — one TypedDict, single source of truth.
  * `safety_screen`           — deterministic crisis keyword detection.
  * `extract` (nodes/extract) — small LLM call that returns structured
                                intent_delta + field_deltas + affirmation.
  * `planner` (nodes/planner) — pure Python; reads state, returns next node
                                name. No LLM. Encodes ALL routing rules.
  * `actions/*`               — tool-calling nodes (verify_insurance,
                                propose_slots, book_appointment, etc.).
                                Thin wrappers over the existing tool
                                functions in ``ai/app/tools.py``.
  * `respond` (nodes/respond) — single LLM call per turn that renders the
                                patient-facing reply, grounded in state.
  * `graph.py`                — wires everything into a StateGraph.
  * `runtime/*`               — three entry points: chat HTTP, browser
                                voice WS, Twilio Media Streams WS.

Design principles (SOLID):

  * Single responsibility — each module does ONE thing (planner only
    routes, extract only parses, respond only generates, tool wrappers
    only call tools).
  * Open/closed — new intents = new planner rules + new respond scene.
    The existing modules stay closed.
  * Liskov / interface segregation — every node has the same signature
    ``(state: State) -> dict`` so the StateGraph can compose them freely.
  * Dependency inversion — the runtime layer depends on the compiled
    graph, not on FastAPI directly. Swapping the transport (e.g. moving
    voice to LiveKit) does not require touching node code.
"""
from __future__ import annotations

"""Compile the StateGraph — wires nodes and edges, returns the runnable.

Topology (every turn runs one cycle through this graph):

    START
      ▼
    safety_screen     (deterministic keyword crisis check)
      ▼
    extract           (LLM: structured-output parse of user turn)
      ▼
    planner           (router: returns next node name)
      ▼
    ┌─────────────────────────────────────────────────────────┐
    │ verify_insurance | propose_slots | book_appointment     │
    │ cancel_appointment | submit_callback | search_kb        │
    │ rollback (no tool)                                       │
    └─────────────────────────────────────────────────────────┘
      ▼
    respond           (LLM: scene-based patient reply)
      ▼
    END

Every node in the action band loops back to respond, except respond
which goes to END. Calling ``app.invoke({...}, config={...})`` runs
one cycle; the checkpointer saves state; the next caller turn resumes
from END's checkpoint.

Note the planner is implemented as a *conditional edge* from
``extract`` rather than as a real node. LangGraph conditional edges
are the canonical way to do this and they show cleanly in LangSmith.
"""
from __future__ import annotations

import logging

from langgraph.graph import END, START, StateGraph

from .checkpointer import build_checkpointer
from .nodes.actions import (
    book_appointment,
    cancel_appointment,
    check_payer,
    propose_slots,
    search_kb,
    submit_callback,
    verify_insurance,
)
from .nodes.extract import extract
from .nodes.planner import N, planner
from .nodes.respond import respond
from .nodes.rollback import rollback
from .nodes.safety_screen import safety_screen
from .state import State
from .tracing import configure_tracing

logger = logging.getLogger(__name__)


def build_graph():
    """Build, wire, and compile the StateGraph. Called once at startup."""
    configure_tracing()

    g = StateGraph(State)

    # Nodes — names mirror the N enum so the planner returns the same strings.
    g.add_node(N.SAFETY, safety_screen)
    g.add_node(N.EXTRACT, extract)
    g.add_node(N.VERIFY, verify_insurance)
    g.add_node(N.PROPOSE, propose_slots)
    g.add_node(N.BOOK, book_appointment)
    g.add_node(N.CANCEL, cancel_appointment)
    g.add_node(N.SUBMIT_CALLBACK, submit_callback)
    g.add_node(N.SEARCH_KB, search_kb)
    g.add_node(N.ROLLBACK, rollback)
    g.add_node(N.RESPOND, respond)
    # Auxiliary direct tools (not currently routed by planner but useful).
    g.add_node("check_payer", check_payer)

    # Edges.
    g.add_edge(START, N.SAFETY)
    g.add_edge(N.SAFETY, N.EXTRACT)

    # The planner is the router — conditional edge from extract.
    g.add_conditional_edges(
        N.EXTRACT,
        planner,
        {
            N.RESPOND: N.RESPOND,
            N.VERIFY: N.VERIFY,
            N.PROPOSE: N.PROPOSE,
            N.BOOK: N.BOOK,
            N.CANCEL: N.CANCEL,
            N.SUBMIT_CALLBACK: N.SUBMIT_CALLBACK,
            N.SEARCH_KB: N.SEARCH_KB,
            N.ROLLBACK: N.ROLLBACK,
        },
    )

    # All action nodes hand off to respond.
    for n in (
        N.VERIFY, N.PROPOSE, N.BOOK, N.CANCEL,
        N.SUBMIT_CALLBACK, N.SEARCH_KB, N.ROLLBACK,
    ):
        g.add_edge(n, N.RESPOND)

    # Respond ends the turn — checkpointer saves state, runtime waits
    # for the next user message.
    g.add_edge(N.RESPOND, END)

    compiled = g.compile(checkpointer=build_checkpointer())
    logger.info("langgraph_compiled nodes=%d", 10)
    return compiled


# Module-level singleton — runtimes import this and reuse it.
APP = None


def get_app():
    global APP
    if APP is None:
        APP = build_graph()
    return APP

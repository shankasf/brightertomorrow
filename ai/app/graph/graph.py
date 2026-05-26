"""Compile the StateGraph — wires nodes and edges, returns the runnable.

Topology (per LangGraph canonical patterns: add_node + add_edge for static
routing, add_conditional_edges with mapping dict for dynamic routing).

    START
      ▼
    safety_screen          (deterministic keyword crisis check)
      ▼
    extract                (LLM: structured-output parse of user turn,
                             populates gate flags on State)
      ▼
    planner ──── conditional edge ─────────────────────────────────────┐
                                                                       │
    ┌──────────────────────────────────────────────────────────────────┘
    │
    ▼
    ┌─────────────────────────────────────────────────────────────────┐
    │ GATES (idempotent — planner skips already-passed gates)         │
    │ gate_resume_offer                                               │
    │                                                                 │
    │ HANDOFFS (terminal — set done=True, end turn after respond)     │
    │ handoff_roi_required,                                           │
    │ handoff_mandatory_report, handoff_crisis,                       │
    │ handoff_admin_with_note, handoff_admin_verification,            │
    │ handoff_admin_callback                                          │
    │                                                                 │
    │ ACTIONS (legacy + new)                                          │
    │ verify_insurance ─┐ second conditional edge → planner returns   │
    │                   │   the next node based on insurance.outcome  │
    │ propose_slots, book_appointment, cancel_appointment,            │
    │ submit_callback, search_kb, rollback                            │
    │                                                                 │
    │ INSURANCE OUTCOME BRANCHES                                      │
    │ offer_self_pay, capture_self_pay_consent, send_coverage_result  │
    │                                                                 │
    │ TERMINAL BOOKING CHAIN                                          │
    │ book_appointment → create_pending_request → send_acknowledgement│
    │                  → log_phi → END                                │
    └─────────────────────────────────────────────────────────────────┘
      ▼
    respond                (LLM: scene-based patient reply)
      ▼
    END

Single planner function services TWO conditional-edge call-sites:
  • after EXTRACT (primary routing)
  • after VERIFY_INSURANCE (outcome-aware re-routing)

The planner detects its call-site via state["last_node"] and short-circuits
to _route_after_insurance() when called post-verify. This keeps all routing
logic in one place.

Anti-infinite-loop guarantees baked in:
  • Gate flags on State are monotonic — once True they stay True.
  • Planner has a hard turn_count ceiling (_MAX_TURNS = 60) that escalates
    to handoff_admin_callback.
  • Terminal handoffs set done=True so respond ends the turn.
"""
from __future__ import annotations

import logging

from langgraph.graph import END, START, StateGraph

from .checkpointer import build_checkpointer
from .nodes.actions import (
    book_appointment,
    cancel_appointment,
    capture_self_pay_consent,
    check_payer,
    create_pending_request,
    log_phi,
    lookup_appointment,
    offer_self_pay,
    propose_slots,
    reschedule_appointment,
    search_kb,
    send_acknowledgement,
    send_coverage_result,
    submit_callback,
    verify_insurance,
)
from .nodes.extract import extract
from .nodes.gates import gate_resume_offer
from .nodes.handoffs import (
    handoff_admin_callback,
    handoff_admin_verification,
    handoff_admin_with_note,
    handoff_crisis,
    handoff_mandatory_report,
    handoff_roi_required,
)
from .nodes.planner import N, planner
from .nodes.respond import respond
from .nodes.rollback import rollback
from .nodes.safety_screen import safety_screen
from .state import State
from .tracing import configure_tracing

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Planner destination map — every string the planner can return MUST appear
# here. A stray string would be a dead edge at runtime. Keeping the dict
# explicit (rather than auto-generated) so reviewers can audit at a glance.
# ---------------------------------------------------------------------------

_PLANNER_TARGETS: dict[str, str] = {
    N.RESPOND: N.RESPOND,
    # Legacy action nodes
    N.VERIFY: N.VERIFY,
    N.PROPOSE: N.PROPOSE,
    N.BOOK: N.BOOK,
    N.CANCEL: N.CANCEL,
    N.SUBMIT_CALLBACK: N.SUBMIT_CALLBACK,
    N.SEARCH_KB: N.SEARCH_KB,
    N.ROLLBACK: N.ROLLBACK,
    # Gates (only resume is invoked from planner; the others are
    # short-circuit checks the planner does inline and routes to handoffs)
    N.GATE_RESUME_OFFER: N.GATE_RESUME_OFFER,
    # Handoff terminals
    N.HANDOFF_ROI_REQUIRED: N.HANDOFF_ROI_REQUIRED,
    N.HANDOFF_MANDATORY_REPORT: N.HANDOFF_MANDATORY_REPORT,
    N.HANDOFF_CRISIS: N.HANDOFF_CRISIS,
    N.HANDOFF_ADMIN_WITH_NOTE: N.HANDOFF_ADMIN_WITH_NOTE,
    N.HANDOFF_ADMIN_VERIFICATION: N.HANDOFF_ADMIN_VERIFICATION,
    N.HANDOFF_ADMIN_CALLBACK: N.HANDOFF_ADMIN_CALLBACK,
    # Insurance-outcome branches
    N.OFFER_SELF_PAY: N.OFFER_SELF_PAY,
    N.CAPTURE_SELF_PAY_CONSENT: N.CAPTURE_SELF_PAY_CONSENT,
    N.SEND_COVERAGE_RESULT: N.SEND_COVERAGE_RESULT,
    # Terminal booking-chain entry point (rarely planner-routed; usually
    # reached via static edge from book_appointment)
    N.CREATE_PENDING_REQUEST: N.CREATE_PENDING_REQUEST,
    # Cancel lookup — prior-session appointment lookup by phone+DOB
    N.LOOKUP_APPOINTMENT: N.LOOKUP_APPOINTMENT,
    N.RESCHEDULE_APPOINTMENT: N.RESCHEDULE_APPOINTMENT,
}


def build_graph():
    """Build, wire, and compile the StateGraph. Called once at startup."""
    configure_tracing()

    g = StateGraph(State)

    # -----------------------------------------------------------------------
    # Register every node. Order doesn't matter for LangGraph, but grouping
    # here mirrors the topology comment above for review clarity.
    # -----------------------------------------------------------------------

    # Core pipeline
    g.add_node(N.SAFETY, safety_screen)
    g.add_node(N.EXTRACT, extract)
    g.add_node(N.RESPOND, respond)

    # Legacy action nodes
    g.add_node(N.VERIFY, verify_insurance)
    g.add_node(N.PROPOSE, propose_slots)
    g.add_node(N.BOOK, book_appointment)
    g.add_node(N.CANCEL, cancel_appointment)
    g.add_node(N.LOOKUP_APPOINTMENT, lookup_appointment)
    g.add_node(N.RESCHEDULE_APPOINTMENT, reschedule_appointment)
    g.add_node(N.SUBMIT_CALLBACK, submit_callback)
    g.add_node(N.SEARCH_KB, search_kb)
    g.add_node(N.ROLLBACK, rollback)
    # Auxiliary tool (not planner-routed; usable from REST handlers)
    g.add_node("check_payer", check_payer)

    # Gate nodes (only resume needs registration; disclosure / NV / relationship
    # / returning-verify are inline checks in the planner — see planner.py)
    g.add_node(N.GATE_RESUME_OFFER, gate_resume_offer)

    # Handoff terminals
    g.add_node(N.HANDOFF_ROI_REQUIRED, handoff_roi_required)
    g.add_node(N.HANDOFF_MANDATORY_REPORT, handoff_mandatory_report)
    g.add_node(N.HANDOFF_CRISIS, handoff_crisis)
    g.add_node(N.HANDOFF_ADMIN_WITH_NOTE, handoff_admin_with_note)
    g.add_node(N.HANDOFF_ADMIN_VERIFICATION, handoff_admin_verification)
    g.add_node(N.HANDOFF_ADMIN_CALLBACK, handoff_admin_callback)

    # Insurance-outcome branches
    g.add_node(N.OFFER_SELF_PAY, offer_self_pay)
    g.add_node(N.CAPTURE_SELF_PAY_CONSENT, capture_self_pay_consent)
    g.add_node(N.SEND_COVERAGE_RESULT, send_coverage_result)

    # Terminal booking chain
    g.add_node(N.CREATE_PENDING_REQUEST, create_pending_request)
    g.add_node(N.SEND_ACKNOWLEDGEMENT, send_acknowledgement)
    g.add_node(N.LOG_PHI, log_phi)

    # -----------------------------------------------------------------------
    # Static edges — fixed topology
    # -----------------------------------------------------------------------

    g.add_edge(START, N.SAFETY)
    g.add_edge(N.SAFETY, N.EXTRACT)

    # -----------------------------------------------------------------------
    # Conditional edge #1 — primary planner routing after EXTRACT.
    # The planner is a pure function that returns one string from the keys
    # of _PLANNER_TARGETS.
    # -----------------------------------------------------------------------

    g.add_conditional_edges(N.EXTRACT, planner, _PLANNER_TARGETS)

    # -----------------------------------------------------------------------
    # Conditional edge #2 — after VERIFY_INSURANCE we re-enter the planner.
    # The planner detects last_node=="verify_insurance" and delegates to
    # _route_after_insurance() which never returns VERIFY (no cycle risk).
    # -----------------------------------------------------------------------

    g.add_conditional_edges(N.VERIFY, planner, _PLANNER_TARGETS)

    # -----------------------------------------------------------------------
    # Static edges — non-verify action nodes hand off to respond.
    # Verify is excluded (uses the conditional edge above instead).
    # -----------------------------------------------------------------------

    for n in (
        N.PROPOSE,
        N.CANCEL,
        N.LOOKUP_APPOINTMENT,
        N.RESCHEDULE_APPOINTMENT,
        N.SUBMIT_CALLBACK,
        N.SEARCH_KB,
        N.ROLLBACK,
        N.GATE_RESUME_OFFER,
        # Insurance-outcome leaves that just set a scene
        N.OFFER_SELF_PAY,
        N.CAPTURE_SELF_PAY_CONSENT,
        N.SEND_COVERAGE_RESULT,
    ):
        g.add_edge(n, N.RESPOND)

    # All handoff terminals hand off to respond (which then ends the turn
    # because each handoff sets done=True / gates.terminal=True).
    for h in (
        N.HANDOFF_ROI_REQUIRED,
        N.HANDOFF_MANDATORY_REPORT,
        N.HANDOFF_CRISIS,
        N.HANDOFF_ADMIN_WITH_NOTE,
        N.HANDOFF_ADMIN_VERIFICATION,
        N.HANDOFF_ADMIN_CALLBACK,
    ):
        g.add_edge(h, N.RESPOND)

    # -----------------------------------------------------------------------
    # Terminal booking chain — after book_appointment succeeds, persist the
    # pending request, queue ack notifications (SMS + email + S3 PHI log)
    # into the DDB outbox, then end the turn. SMS/email/S3 sends themselves
    # are fire-and-forget via the notifications-retry Lambda — these nodes
    # only enqueue the outbox rows.
    # -----------------------------------------------------------------------

    g.add_edge(N.BOOK, N.CREATE_PENDING_REQUEST)
    g.add_edge(N.CREATE_PENDING_REQUEST, N.SEND_ACKNOWLEDGEMENT)
    g.add_edge(N.SEND_ACKNOWLEDGEMENT, N.LOG_PHI)
    g.add_edge(N.LOG_PHI, N.RESPOND)

    # check_payer is an auxiliary node — wire it like the other actions so
    # planner-less callers (REST tool endpoints) can invoke a one-shot turn.
    g.add_edge("check_payer", N.RESPOND)

    # Respond ends the turn — checkpointer saves state; next caller turn
    # resumes from this END's checkpoint.
    g.add_edge(N.RESPOND, END)

    compiled = g.compile(checkpointer=build_checkpointer())
    logger.info(
        "langgraph_compiled nodes=%d planner_targets=%d",
        len(g.nodes), len(_PLANNER_TARGETS),
    )
    return compiled


# Module-level singleton — runtimes import this and reuse it.
APP = None


def get_app():
    global APP
    if APP is None:
        APP = build_graph()
    return APP

"""LLM and deterministic nodes for the conversation graph.

Modules:
  * safety_screen — keyword-only crisis detector (no LLM)
  * extract       — structured-output LLM that parses each user turn
  * planner       — deterministic next-node selector (no LLM)
  * respond       — patient-facing text generator (LLM)
  * ask_field     — sets pending_question to drive respond's field prompt
  * rollback      — pure state mutations (cancel-keep, etc.)

Each node is a function ``(state: State) -> dict`` so they compose freely
in the StateGraph.
"""
from __future__ import annotations

"""Agent factory — delegates to the triage agent graph."""
from __future__ import annotations

from .bt_agents.triage_agent import build_triage_agent


def build_agent():
    return build_triage_agent()

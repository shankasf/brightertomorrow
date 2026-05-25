"""gates — idempotent gate nodes for the clinical intake LangGraph.

Each gate reads state flags written by the extract node and either:
  - sets a scene to prompt the caller for missing information, or
  - sets a boolean flag for the planner's conditional edges, or
  - passes through with {} when its condition is already satisfied.

Import surface:
  from ai.app.graph.nodes.gates import (
      gate_disclosure,
      gate_caller_relationship,
      gate_returning_verify,
      gate_resume_offer,
  )
"""
from __future__ import annotations

from .caller_relationship import gate_caller_relationship
from .disclosure import gate_disclosure
from .resume_offer import gate_resume_offer
from .returning_verify import gate_returning_verify

__all__ = [
    "gate_disclosure",
    "gate_caller_relationship",
    "gate_returning_verify",
    "gate_resume_offer",
]

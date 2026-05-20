"""ingest_user_turn — stamps the latest user message onto state.

This node runs FIRST on every turn. Its only job is to copy the latest
human message into ``state.last_user_text`` so downstream nodes (extract
in particular) don't each have to walk the message history.

Crisis / safety classification is intentionally NOT done here: it lives
in the extract LLM (see ``prompts/extract.py`` rule 9 — including hedged
and future-tense phrasings). The previous keyword pre-filter was a
hardcoded NL layer that drifted from the LLM's classification on
paraphrases like "thinking about hurting myself" (present-progressive
form wasn't in the list). One NL boundary, one source of truth.

If the extract LLM is unreachable, ``extract.py`` returns
``_low_confidence=True`` and the planner routes to the clarify scene —
a safe fallback that re-prompts the user rather than acting on stale
intent.

The function is still exported as ``safety_screen`` so the existing
graph wiring continues to work without a rename — the node has the
same shape (state -> partial-update dict), it just no longer does the
keyword match.
"""
from __future__ import annotations

import logging
from typing import Any

from ..state import State

logger = logging.getLogger(__name__)


def _latest_user_text(state: State) -> str:
    """Pull the most recent user message body out of the messages list.

    Tolerates both LangChain BaseMessage objects and plain dicts so the
    runtime layer can append whichever it prefers.
    """
    msgs = state.get("messages") or []
    for m in reversed(msgs):
        role = getattr(m, "type", None) or (m.get("role") if isinstance(m, dict) else None)
        if role in ("human", "user"):
            content = getattr(m, "content", None) or (m.get("content") if isinstance(m, dict) else None)
            if isinstance(content, str):
                return content
    return ""


def safety_screen(state: State) -> dict[str, Any]:
    """Stamp ``last_user_text`` onto state. Safety_signal is owned by extract."""
    text = _latest_user_text(state)
    return {"last_user_text": text} if text else {}

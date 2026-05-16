"""Info Agent — voice. Practice info, services, hours, FAQs."""
from __future__ import annotations

from agents.realtime import RealtimeAgent

from ...prompts import (
    ANTI_DEFLECTION_RULE,
    CRISIS_RULE,
    PRACTICE_CONTEXT,
    SCOPE_RULE,
    STYLE_VOICE,
    VOICE_PACING_RULE,
)
from ...tools import INFO_TOOLS, VOICE_TOOLS


def build_info_agent() -> RealtimeAgent:
    return RealtimeAgent(
        name="InfoAgent",
        handoff_description="Practice info, services, hours, FAQs.",
        tools=INFO_TOOLS + VOICE_TOOLS,
        instructions=(
            f"{PRACTICE_CONTEXT}\n\n"
            f"{STYLE_VOICE}\n\n"
            f"{CRISIS_RULE}\n\n"
            f"{SCOPE_RULE}\n\n"
            f"{ANTI_DEFLECTION_RULE}\n\n"
            f"{VOICE_PACING_RULE}\n\n"
            "Answer questions about services, specialties, locations, hours, and FAQs. "
            "Use kb_search for open-ended questions; use structured tools for canonical facts. "
            "Cite source URLs when you use kb_search results. Speak in complete, natural sentences. "
            "When the caller has clearly finished (says goodbye, thanks you and signs off, or "
            "declines further help), say a brief farewell THEN call end_call to disconnect."
        ),
    )

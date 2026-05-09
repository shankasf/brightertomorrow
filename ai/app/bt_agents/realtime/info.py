"""Info Agent — voice. Practice info, services, hours, FAQs."""
from __future__ import annotations

from agents.realtime import RealtimeAgent

from ...prompts import CRISIS_RULE, PRACTICE_CONTEXT, STYLE_VOICE
from ...tools import INFO_TOOLS


def build_info_agent() -> RealtimeAgent:
    return RealtimeAgent(
        name="Info Agent",
        handoff_description="Practice info, services, hours, FAQs.",
        tools=INFO_TOOLS,
        instructions=(
            f"{PRACTICE_CONTEXT}\n\n"
            f"{STYLE_VOICE}\n\n"
            f"{CRISIS_RULE}\n\n"
            "Answer questions about services, specialties, locations, hours, and FAQs. "
            "Use kb_search for open-ended questions; use structured tools for canonical facts. "
            "Cite source URLs when you use kb_search results. Speak in complete, natural sentences."
        ),
    )

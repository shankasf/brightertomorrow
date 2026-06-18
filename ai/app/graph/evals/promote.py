"""Promote a production conversation into a (de-identified) golden fixture.

LangSmith recommends growing eval datasets from real production traffic. Our
HIPAA posture forbids storing raw transcripts as test fixtures, so this tool
DE-IDENTIFIES a sampled session and emits a ``Conversation`` skeleton for a
human to review and paste into ``datasets.py`` under ``split="from_production"``.

Two hard rules:
  1. Nothing here sends data anywhere — it only reads a session you already
     have access to and prints a scrubbed skeleton to stdout.
  2. The output is a PROPOSAL. A human must eyeball it for residual PHI and
     decide the assertions before it becomes a fixture. Never auto-append.

Usage:
    python -m app.graph.evals.promote --session <session_id>
"""
from __future__ import annotations

import argparse
import re
import sys
from typing import Any

from .gateway_client import get_session_turns

# ---------------------------------------------------------------------------
# Scrubbing — replace linkable identifiers with neutral synthetic placeholders.
# Order matters: most specific patterns first.
# ---------------------------------------------------------------------------

_SCRUBBERS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "[SSN]"),
    (re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b"), "jordan@example.com"),
    (re.compile(r"(?<!\d)(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}(?!\d)"),
     "702-555-0142"),
    # DOB in numeric forms -> a fixed synthetic date.
    (re.compile(r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b"), "01/01/1990"),
    # Long alphanumeric member/claim IDs (>=6 chars, has a digit).
    (re.compile(r"\b(?=[A-Z0-9-]*\d)[A-Z0-9]{6,}\b"), "MEMBER1234"),
]


def scrub(text: str) -> str:
    """Best-effort de-identification of a single message.

    This is a SAFETY NET, not a guarantee — the human reviewer is the real
    control. Free-text names are not reliably detectable by regex, so the
    reviewer must still replace any leftover names with synthetic ones.
    """
    out = text or ""
    for pattern, repl in _SCRUBBERS:
        out = pattern.sub(repl, out)
    return out


def scrub_dict(data: Any) -> Any:
    """Recursively scrub PHI from an arbitrary dict/list/str structure.

    Walks strings through ``scrub()``, recurses into dicts and lists.
    Non-string scalars (int, bool, float, None) are returned unchanged.
    Intended for the /internal/evals/promote endpoint which receives a
    free-form turn/transcript blob.
    """
    if isinstance(data, str):
        return scrub(data)
    if isinstance(data, dict):
        return {k: scrub_dict(v) for k, v in data.items()}
    if isinstance(data, list):
        return [scrub_dict(item) for item in data]
    return data


def propose_fixture(session_id: str) -> str:
    """Return a Python ``Conversation(...)`` skeleton for one session."""
    raw_turns = get_session_turns(session_id)
    if not raw_turns:
        return f"# No turns found for session {session_id!r}"

    lines: list[str] = [
        "# REVIEW BEFORE USE: replace any leftover real names with synthetic",
        "# ones, set the expected_* assertions, then paste into datasets.py.",
        "Conversation(",
        f'    name="prod_{session_id[:8]}",',
        '    split="from_production",',
        '    metadata={"source": "from_production_scrubbed",'
        f' "session": "{session_id[:8]}"}},',
        "    turns=[",
    ]

    prior_user = ""
    for raw in raw_turns:
        role = (raw.get("role") or "").lower()
        content = scrub(raw.get("content") or "")
        if role in ("user", "human"):
            prior_user = content
        elif role in ("assistant", "ai") and prior_user:
            safe = prior_user.replace('"', '\\"')
            lines.append("        TurnExpectation(")
            lines.append(f'            user_says="{safe}",')
            lines.append("            # TODO: add expected_intent / reply_must_(not_)contain")
            lines.append("        ),")
            prior_user = ""

    lines.append("    ],")
    lines.append("),")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Emit a de-identified golden-fixture skeleton from a production session."
    )
    parser.add_argument("--session", required=True, help="session_id to promote")
    args = parser.parse_args()
    print(propose_fixture(args.session))
    print(
        "\n# Reminder: this is a PROPOSAL. Verify no PHI remains before committing.",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()

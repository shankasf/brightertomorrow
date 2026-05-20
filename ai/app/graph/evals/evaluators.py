"""Programmatic evaluators — graders for the golden dataset.

Each evaluator is a pure function ``(turn, state, reply) -> Score``.
The runner aggregates scores per conversation and uploads them to
LangSmith under the configured project.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .datasets import TurnExpectation


@dataclass
class Score:
    name: str
    passed: bool
    detail: str = ""


def _nested_get(d: dict, dotted: str) -> Any:
    cur: Any = d
    for part in dotted.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def grade_turn(turn: TurnExpectation, state: dict, reply: str) -> list[Score]:
    scores: list[Score] = []

    if turn.expected_scene is not None:
        actual = state.get("_scene")
        scores.append(Score(
            "scene", actual == turn.expected_scene,
            f"expected={turn.expected_scene} actual={actual}",
        ))

    if turn.expected_intent is not None:
        actual = state.get("intent")
        scores.append(Score(
            "intent", actual == turn.expected_intent,
            f"expected={turn.expected_intent} actual={actual}",
        ))

    if turn.expected_action is not None:
        actual = state.get("last_action")
        scores.append(Score(
            "action", actual == turn.expected_action,
            f"expected={turn.expected_action} actual={actual}",
        ))

    for path, expected in turn.expected_fields.items():
        actual = _nested_get(state, path)
        scores.append(Score(
            f"field:{path}",
            str(actual or "").lower() == str(expected).lower(),
            f"expected={expected!r} actual={actual!r}",
        ))

    rep_low = reply.lower()
    for needle in turn.reply_must_contain:
        scores.append(Score(
            f"contains:{needle!r}",
            needle.lower() in rep_low,
            f"reply={reply[:120]!r}",
        ))
    for needle in turn.reply_must_not_contain:
        scores.append(Score(
            f"not_contains:{needle!r}",
            needle.lower() not in rep_low,
            f"reply={reply[:120]!r}",
        ))

    return scores

"""Thin gateway client for the therapist-match endpoints.

All matching logic lives in the gateway (single source of truth — DRY/SRP).
This module is a minimal wrapper so both the chat and voice tool functions
call the same code path instead of repeating the gateway_get/gateway_post
pattern.

Public API
----------
get_match_options() -> dict
    GET /internal/match/options
    Returns the quiz configuration (question list, option labels, intro copy).

call_match_therapists(channel, answers) -> dict
    POST /internal/match/therapists
    Returns matched clinicians for the given quiz answers.
"""
from __future__ import annotations

import logging
from typing import Any

from .aws_signer import gateway_get, gateway_post

logger = logging.getLogger(__name__)


def get_match_options() -> dict[str, Any]:
    """Fetch the quiz configuration from the gateway.

    Returns:
      {
        "ok": bool,
        "config": {
          "questions": [
            {
              "id": "type",
              "question": "What kind of support are you looking for?",
              "options": [{"value": "individual", "label": "Individual", ...}]
            },
            ...
          ],
          "intro_title": "...",
          "intro_body": "..."
        }
      }

    If the gateway is unreachable or returns an error, the caller should
    fall back to asking conversationally — never hard-fail the session.
    """
    try:
        return gateway_get("/internal/match/options")
    except Exception as exc:
        logger.warning("get_match_options failed: %r", exc)
        return {"ok": False, "error": str(exc)}


def call_match_therapists(
    channel: str,
    answers: dict[str, str | None],
) -> dict[str, Any]:
    """POST /internal/match/therapists and return the gateway response.

    Arguments
    ---------
    channel : str
        "chat" | "voice" — used for MatchEvent analytics, NOT for filtering.
    answers : dict
        Keys: "type" (required), "modality", "location", "insurance"
        (optional). None / absent values are stripped before sending so the
        gateway's pure Match() function treats them as "no constraint".

    Returns
    -------
    {
      "ok": bool,
      "match_uuid": str,
      "result_count": int,
      "results": [
        {
          "slug": str, "name": str, "credentials": str, "initials": str,
          "types": [str], "locations": [str], "telehealth": bool,
          "specialties": [str], "rate": str, "in_network": bool,
          "staff_id": int,   # 0 if not bookable via self-service
          "photo_url": str, "active": bool, "sort_order": int,
          "match_reason": str
        },
        ...
      ]
    }

    On any error returns {"ok": False, "error": str}.
    """
    clean_answers: dict[str, str] = {
        k: v for k, v in answers.items() if v is not None
    }
    body: dict[str, Any] = {"answers": clean_answers}
    if channel:
        body["channel"] = channel

    try:
        return gateway_post("/internal/match/therapists", body)
    except Exception as exc:
        logger.warning("call_match_therapists channel=%s error=%r", channel, exc)
        return {"ok": False, "error": str(exc)}

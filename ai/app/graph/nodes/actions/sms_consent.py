"""record_sms_consent — persist a chat caller's A2P SMS opt-in / opt-out.

Runs once, the turn after the bot posed the SMS opt-in question (the
``ask_sms_consent`` scene). Reads the yes/no from ``affirmation``, POSTs the
decision to the gateway — which owns the DynamoDB consent write and the PHI
audit row — and records the answer on state so the planner stops asking.

Best-effort: a gateway hiccup must never break the post-booking flow. No raw
phone number is ever logged.
"""
from __future__ import annotations

import logging
from typing import Any

from ....integrations.aws_signer import gateway_post
from ...state import State

logger = logging.getLogger(__name__)


def record_sms_consent(state: State) -> dict[str, Any]:
    opted_in = state.get("affirmation") == "yes"
    phone = ((state.get("booking_fields") or {}).get("phone") or "").strip()
    session_id = state.get("session_id") or ""

    if phone:
        try:
            gateway_post(
                "/internal/sms/consent",
                {
                    "phone": phone,
                    "opted_in": opted_in,
                    "method": "chat",
                    "session_id": session_id,
                    "source": "chat-agent",
                },
                timeout=8.0,
            )
            logger.info(
                "record_sms_consent session=%s opted_in=%s", session_id or "anon", opted_in
            )
        except Exception as exc:
            logger.warning(
                "record_sms_consent_failed session=%s opted_in=%s err=%r",
                session_id or "anon", opted_in, exc,
            )
    else:
        logger.info("record_sms_consent_skipped session=%s reason=no_phone", session_id or "anon")

    return {
        "sms_consent": "yes" if opted_in else "no",
        "last_action": "record_sms_consent",
    }

"""Function tools for the agent.

Each tool reads from the Brighter Tomorrow Postgres so the assistant can
answer with real, current site data instead of hallucinating.
"""
from __future__ import annotations

import contextlib
import contextvars
import datetime
import logging
import os
import time
from functools import lru_cache
from typing import Any
from zoneinfo import ZoneInfo

from openai import OpenAI

from .aws_signer import gateway_post, signed_post
from .data.payers import PAYERS, resolve_payer_id
from .db import conn

# Per-request modality marker. Tools that submit intake / book appointments
# stamp this value into the gateway payload so admin-side reports can split
# voice traffic from chat traffic. Defaults to "chat-agent"; the voice
# WebSocket handler overrides it with "voice-agent" before running the agent.
agent_source: contextvars.ContextVar[str] = contextvars.ContextVar(
    "bt_agent_source", default="chat-agent"
)

EMBED_MODEL = os.environ.get("OPENAI_EMBED_MODEL", "text-embedding-3-small")

logger = logging.getLogger(__name__)


@contextlib.contextmanager
def _log_call(tool_name: str, **log_kwargs):
    """Context manager: logs tool entry at DEBUG and exit (ok/error) at INFO/ERROR with latency."""
    logger.debug("tool_call tool=%s %s", tool_name, " ".join(f"{k}={v}" for k, v in log_kwargs.items()))
    t0 = time.perf_counter()
    try:
        yield
        latency_ms = (time.perf_counter() - t0) * 1000
        logger.info("tool_ok tool=%s latency_ms=%.1f", tool_name, latency_ms)
    except Exception as exc:
        latency_ms = (time.perf_counter() - t0) * 1000
        logger.error("tool_error tool=%s latency_ms=%.1f error=%r", tool_name, latency_ms, exc, exc_info=True)
        raise


@lru_cache(maxsize=1)
def _openai() -> OpenAI:
    return OpenAI()


def _vec_literal(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.7f}" for x in v) + "]"


_PLACEHOLDER_VALUES = frozenset({
    "", "not provided", "not provided yet", "not yet provided", "tbd",
    "n/a", "na", "unknown", "pending", "none given", "none", "null",
    "reason: (not provided yet).", "(not provided yet)",
    "prefer not to say", "decline to answer", "rather not say",
    "skip", "skipped", "no answer", "x",
})

# The practice's own public phone. If a visitor "gives" this number as their
# own — usually because they copy-pasted it from the site or read it back —
# we must NOT accept it as a callback number; the call would loop back to
# us. Block any reasonable formatting (parens, dashes, spaces, leading +1).
_PRACTICE_PHONE_DIGITS = "7252386990"


def _is_practice_phone(val: str) -> bool:
    """Return True if `val` is the practice's own phone in any common format."""
    digits = "".join(c for c in (val or "") if c.isdigit())
    if not digits:
        return False
    # Strip a leading "1" country code if the user prefixed +1 / 1-.
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return digits == _PRACTICE_PHONE_DIGITS


def _is_placeholder(val: str) -> bool:
    """Return True if `val` is empty or exactly a known placeholder phrase."""
    clean = (val or "").strip().lower()
    return clean in _PLACEHOLDER_VALUES


_ELIGIBLE_STATES = {"active", "approved", "eligible", "in force", "in network"}


def _parse_claimmd_response(resp: dict) -> tuple[bool, dict, str]:
    """Normalise the CLAIM.MD lambda response into (eligible, coverage, status).

    The lambda returns flat top-level keys: `status`, `copay`, `plan`, `raw`.
    Earlier code mis-read it as `{eligible, coverage}` (the older shape),
    which made every check look "not eligible" — even when status was
    'active'. Tested against a real Anthem PPO response that contained
    `status='active'`, `copay=null`, `plan='PPO NY'`.

    Returns:
      eligible: True if status is one of _ELIGIBLE_STATES
      coverage: {status, copay, plan} dict (omitting empty values)
      status:   the lowered status string (e.g. 'active'), or '' if missing
    """
    raw_status = str(resp.get("status") or "").strip().lower()
    plan = resp.get("plan") or ""
    copay = resp.get("copay")
    eligible = raw_status in _ELIGIBLE_STATES
    coverage: dict[str, str] = {}
    if raw_status:
        coverage["status"] = raw_status
    if plan:
        coverage["plan"] = str(plan)
    if copay not in (None, ""):
        coverage["copay"] = str(copay)
    return eligible, coverage, raw_status


def _validate_dob(value: str) -> str | None:
    """Strict YYYYMMDD validator. The booking agent is responsible for parsing
    natural-language dates ('August 19, 1998', '8/19/98') into YYYYMMDD before
    calling the tool. This function only confirms the agent's output is a real
    calendar date in 1900..today and returns it unchanged; otherwise returns
    None so the agent can re-ask.
    """
    from datetime import datetime

    s = (value or "").strip()
    if len(s) != 8 or not s.isdigit():
        return None
    try:
        d = datetime.strptime(s, "%Y%m%d")
    except ValueError:
        return None
    if not (1900 <= d.year <= datetime.now().year):
        return None
    return s


_PT = ZoneInfo("America/Los_Angeles")
_SLOT_HOURS: dict[str, tuple[int, int]] = {
    "morning":   (7,  12),
    "afternoon": (12, 17),
    "evening":   (17, 21),
    "any":       (0,  24),
}


def _format_slot_display(start_iso: str) -> str:
    """Convert a UTC ISO string to a human-readable Pacific Time label."""
    dt = datetime.datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
    dt_pt = dt.astimezone(_PT)
    return dt_pt.strftime("%A, %B %-d at %-I:%M %p") + " PT"


def _fetch_free_slots(staff_id: int, days_ahead: int = 7, slot_minutes: int = 50) -> dict:
    """Return free 50-min slots for `staff_id` over the next `days_ahead` days."""
    now = datetime.datetime.now(tz=datetime.timezone.utc)
    from_iso = now.isoformat(timespec="seconds").replace("+00:00", "Z")
    to_dt = now + datetime.timedelta(days=days_ahead)
    to_iso = to_dt.isoformat(timespec="seconds").replace("+00:00", "Z")

    with _log_call("get_free_slots", staff_id=staff_id, days_ahead=days_ahead):
        resp = gateway_post("/internal/calendar/free-slots", {
            "staffId": staff_id,
            "fromISO": from_iso,
            "toISO": to_iso,
            "slotMinutes": slot_minutes,
        })

    raw_slots: list[dict] = resp.get("slots", [])
    enriched = []
    for s in raw_slots:
        enriched.append({
            "startISO": s["startISO"],
            "endISO": s["endISO"],
            "displayPT": _format_slot_display(s["startISO"]),
        })
    logger.debug("tool_result tool=get_free_slots staff_id=%d count=%d", staff_id, len(enriched))
    return {"slots": enriched}





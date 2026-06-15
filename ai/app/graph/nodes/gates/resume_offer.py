"""gate_resume_offer — offers returning patients the option to resume their prior session.

Single responsibility: when a returning patient is verified and has a prior
session, generate a one-sentence non-PHI-leaking summary and prompt the
caller to choose continue vs. fresh start. Carries forward relevant fields
if they choose to continue. Idempotent once resume_decided=True.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from ....integrations.aws_signer import gateway_post

# Import config directly from its module to avoid traversing graph/__init__.py,
# which triggers a transitive import chain through actions.py -> core.db -> psycopg.
from ...config import text_model_name, text_base_url
from ...state import BookingFields, InsuranceFields, State

logger = logging.getLogger(__name__)

_SCENE_OFFER = "resume_offer_prompt"
_MAX_ASKS = 3
_COUNT_KEY = "resume_offer_asked_count"

# TODO(gateway): endpoint /internal/phi/session_turns is pending.
_TURNS_PATH = "/internal/phi/session_turns"

# Number of prior turns to summarise — keep small to stay under context limit.
_PRIOR_TURNS_COUNT = 3

# Fields safe to carry forward (non-PHI structural prefs) from a prior session.
_CARRY_FORWARD_INTENT = True


def _get_llm() -> ChatOpenAI:
    """Lazy singleton for the summary LLM call."""
    return ChatOpenAI(
        model=text_model_name(),
        temperature=0,
        max_tokens=80,
        base_url=text_base_url(),
    )


def _fetch_prior_turns(prior_session_id: str) -> list[dict]:
    """Fetch the last N turns from the prior session via the gateway.

    Returns an empty list on any error so the gate can still proceed.
    """
    try:
        resp = gateway_post(
            _TURNS_PATH,
            {"session_id": prior_session_id, "limit": _PRIOR_TURNS_COUNT},
            timeout=8.0,
        )
        return resp.get("turns") or []
    except Exception:
        # Gateway not yet deployed or unreachable — proceed without turns.
        logger.warning(
            "gate_resume_offer turns_fetch_failed prior_session_id=redacted",
        )
        return []


def _build_summary(turns: list[dict]) -> str:
    """Call the LLM to produce a single non-PHI summary sentence.

    We pass only the assistant's side of the prior turns (intent/preference
    phrasing) and ask for a generic summary. Caller name, DOB, insurance ID,
    and address are explicitly excluded — only slot preferences and intent.
    """
    if not turns:
        return "Last time you were exploring our scheduling and coverage options."

    # Extract only the assistant messages — they contain our phrasing, not the
    # caller's PHI. This strips any PHI the caller might have said.
    assistant_texts = [
        t.get("content", "")
        for t in turns
        if t.get("role") in ("assistant", "ai") and t.get("content")
    ][:_PRIOR_TURNS_COUNT]

    if not assistant_texts:
        return "Last time you were exploring our scheduling and coverage options."

    context = "\n".join(f"- {txt[:300]}" for txt in assistant_texts)

    system = (
        "You summarise a therapy intake assistant's prior conversation in ONE "
        "short sentence (max 25 words). Rules: (1) No PHI — never include names, "
        "dates of birth, insurance IDs, or addresses. (2) Mention only generic "
        "intent and scheduling or coverage preferences. (3) Start with 'Last time'."
    )
    human = f"Prior assistant turns:\n{context}\n\nWrite the one-sentence summary now."

    try:
        llm = _get_llm()
        result = llm.invoke([SystemMessage(content=system), HumanMessage(content=human)])
        summary = (result.content or "").strip()
        return summary or "Last time you were exploring our scheduling and coverage options."
    except Exception:
        logger.exception("gate_resume_offer summary_llm_error")
        return "Last time you were exploring our scheduling and coverage options."


def gate_resume_offer(state: State) -> dict[str, Any]:
    """Offer the returning patient a chance to continue or start fresh.

    Prerequisites (all must be True to activate this gate):
      - gates.returning_verified == True
      - resume.prior_session_id is non-null
      - gates.resume_decided == False (not yet decided)

    On subsequent pass after extract writes resume_decision:
      - "continue" → carry forward intent + booking/insurance prefs
      - "fresh"    → just flip resume_decided=True, start clean
    """
    gates: dict = state.get("gates") or {}
    resume: dict = state.get("resume") or {}

    # Idempotency: already decided — pass through.
    if gates.get("resume_decided"):
        return {}

    # Gate is only active for verified returning patients with a prior session.
    if not gates.get("returning_verified"):
        return {}
    prior_session_id: str | None = resume.get("prior_session_id")
    if not prior_session_id:
        return {}

    # Check if the caller has already responded to the offer this pass.
    # The decision lives at resume.decision (written by extract); there is no
    # top-level "resume_decision" key in State, so reading that always yielded
    # None and made this branch dead code.
    resume_decision: str | None = (state.get("resume") or {}).get("decision")

    if resume_decision in ("continue", "fresh"):
        # Decision captured — resolve and mark done.
        new_gates = {**gates, "resume_decided": True}
        update: dict[str, Any] = {
            "gates": new_gates,
            "audit_event": {
                "type": "gate_resume_offer_decided",
                "ts": datetime.now(timezone.utc).isoformat(),
                "decision": resume_decision,
            },
        }

        if resume_decision == "continue":
            # Carry forward structural/preference fields only — no PHI identifiers.
            # The prior session's intent and booking preferences help the planner
            # skip re-collecting preferences the caller already stated.
            prior_intent = resume.get("prior_intent")
            prior_insurance = resume.get("prior_insurance_fields")   # payer_name only
            prior_booking_prefs = resume.get("prior_booking_prefs")  # time_of_day, reason

            if prior_intent:
                update["intent"] = prior_intent
            if prior_insurance and isinstance(prior_insurance, dict):
                # Carry payer name only — no member ID, DOB, or names.
                carried = InsuranceFields()
                if prior_insurance.get("payer_name"):
                    carried["payer_name"] = prior_insurance["payer_name"]
                update["insurance_fields"] = {
                    **(state.get("insurance_fields") or {}),
                    **carried,
                }
            if prior_booking_prefs and isinstance(prior_booking_prefs, dict):
                # Carry scheduling prefs only — no address, phone, email.
                bk_update = BookingFields()
                if prior_booking_prefs.get("reason"):
                    bk_update["reason"] = prior_booking_prefs["reason"]
                update["booking_fields"] = {
                    **(state.get("booking_fields") or {}),
                    **bk_update,
                }
            if prior_booking_prefs:
                update["_time_of_day"] = prior_booking_prefs.get("time_of_day")

        return update

    # No decision yet — present the offer (or check loop ceiling).
    ask_count: int = gates.get(_COUNT_KEY, 0)

    if ask_count >= _MAX_ASKS:
        logger.warning(
            "gate_resume_offer loop_ceiling session=%s count=%d",
            state.get("session_id", "?"), ask_count,
        )
        # Fail safe: treat as fresh start to unblock the caller.
        return {
            "gates": {**gates, "resume_decided": True},
            "audit_event": {
                "type": "gate_resume_offer_escalated",
                "ts": datetime.now(timezone.utc).isoformat(),
            },
        }

    # First (or repeat) offer — generate summary and set scene.
    # Only fetch turns / call LLM on the first ask to avoid redundant cost.
    summary: str | None = resume.get("summary")
    if not summary:
        turns = _fetch_prior_turns(prior_session_id)
        summary = _build_summary(turns)

    new_count = ask_count + 1
    logger.info(
        "gate_resume_offer presenting_offer session=%s ask_count=%d",
        state.get("session_id", "?"), new_count,
    )

    return {
        "scene": _SCENE_OFFER,
        "resume": {**resume, "summary": summary},
        "gates": {**gates, _COUNT_KEY: new_count},
        "audit_event": {
            "type": "gate_resume_offer_prompted",
            "ts": datetime.now(timezone.utc).isoformat(),
        },
    }

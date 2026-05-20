"""extract — small structured-output LLM call that parses each user turn.

This is the ONLY node that turns natural language into structured
state. The planner downstream is pure Python; it never reads the user's
words directly. That split is what lets us unit-test routing without
mocking an LLM, and what lets the planner be deterministic.

Behaviour:
  * Reads the most recent user message + a tight context block.
  * Calls the configured extract model with the TurnExtraction schema.
  * Applies the returned delta to state (intent, affirmation,
    safety_signal, field_deltas merged into the right field bag).
  * Merges new gate/presence signals idempotently — once a flag is True
    it is never cleared, even if a later turn omits the signal.
  * Increments turn_count (used by the planner's infinite-loop guard).
  * Never produces patient-facing text.
"""
from __future__ import annotations

import logging
import re
from datetime import date
from typing import Any

from langchain_core.messages import HumanMessage, RemoveMessage, SystemMessage
from langchain_openai import ChatOpenAI

from ..config import extract_model_name
from ..prompts.extract import EXTRACT_SYSTEM_PROMPT, FieldDeltas, TurnExtraction
from ..state import (
    BookingFields,
    CallbackFields,
    Gates,
    InsuranceFields,
    ResumeOffer,
    State,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Deterministic safety nets
# ---------------------------------------------------------------------------
# The extract LLM occasionally flips on short-typo affirmatives ("ys", "yh")
# and ambiguous slash-format dates ("19/08/1998") even at temperature=0.
# These helpers run AFTER the LLM call and fill in only what the LLM left
# blank or marked "unclear" — they never overwrite a confident extraction.

_YES_TOKENS = frozenset({
    "y", "ya", "ye", "ys", "yh", "yp", "yep", "yepp", "yup", "yupp",
    "yea", "yeah", "yes", "yess", "yesss", "yass", "yas",
    "mhm", "mmhmm", "mhmm", "mm", "mmm", "uhhuh", "uhuh",
    "ok", "okay", "k", "kk", "okie", "okies", "kay",
    "sure", "surely", "correct", "right", "affirmative", "roger",
    "ofc", "def", "definitely", "absolutely", "totally",
    "100", "100%", "1", "+1",
    "aye", "indeed", "confirmed", "true",
    "alright", "allright", "fine",
})

_NO_TOKENS = frozenset({
    "n", "no", "nope", "nopee", "nah", "naw", "nay",
    "negative", "wrong", "incorrect",
    "0", "-1", "nuhuh", "nuh", "neg", "negatory", "nada", "false",
})

_YES_PATTERN_RE = re.compile(
    r"^(?:"
    r"y+|"             # y, yy, yyy
    r"y+e+s+|"         # yes, yesss
    r"y+e+a+h*|"       # yea, yeah, yeaaaah
    r"y+u+p+|"         # yup, yuppp
    r"y+e+p+|"         # yep, yeppp
    r"m+h+m*|"         # mhm, mhmm, mmhm
    r"o+k+a*y*|"       # ok, okay, okaaay
    r"s+u+r+e+|"       # sure, sureee
    r"y+a+s+"          # yas, yaass
    r")$"
)
_NO_PATTERN_RE = re.compile(
    r"^(?:"
    r"n+o+|"           # no, noooo
    r"n+o+p+e*|"       # nope, nopppe
    r"n+a+h+|"         # nah, nahhh
    r"n+a+w+|"         # naw, nawww
    r"n+u+h+"          # nuh, nuhhh
    r")$"
)
_YES_EMOJI = ("👍", "✅", "✔", "✔️")
_NO_EMOJI = ("👎", "❌", "✖", "✖️")
_AFF_STRIP_RE = re.compile(r"[^a-z0-9+%-]+")


def _normalize_affirmative_token(text: str) -> str | None:
    """Return 'yes' / 'no' if text is a single short affirmative token.

    Only fires on terse one-token replies — multi-word inputs ("yes please")
    fall through to the LLM, which has more context to interpret intent.
    """
    if not text:
        return None
    if any(e in text for e in _YES_EMOJI):
        return "yes"
    if any(e in text for e in _NO_EMOJI):
        return "no"
    cleaned = _AFF_STRIP_RE.sub("", text.lower())
    if not cleaned or len(cleaned) > 12:
        return None
    if cleaned in _YES_TOKENS:
        return "yes"
    if cleaned in _NO_TOKENS:
        return "no"
    if _YES_PATTERN_RE.match(cleaned):
        return "yes"
    if _NO_PATTERN_RE.match(cleaned):
        return "no"
    return None


_MONTH_NAMES = {
    "january": 1, "jan": 1,
    "february": 2, "feb": 2,
    "march": 3, "mar": 3,
    "april": 4, "apr": 4,
    "may": 5,
    "june": 6, "jun": 6,
    "july": 7, "jul": 7,
    "august": 8, "aug": 8,
    "september": 9, "sep": 9, "sept": 9,
    "october": 10, "oct": 10,
    "november": 11, "nov": 11,
    "december": 12, "dec": 12,
}
_MONTH_RE_FRAG = "|".join(sorted(_MONTH_NAMES.keys(), key=len, reverse=True))

_DATE_COMPACT_RE = re.compile(r"\b(\d{8})\b")
_DATE_ISO_RE = re.compile(r"\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b")
_DATE_SLASH_RE = re.compile(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b")
_DATE_VERBAL_MD_RE = re.compile(
    rf"\b(?P<m>{_MONTH_RE_FRAG})\s+(?P<d>\d{{1,2}})(?:st|nd|rd|th)?(?:[,\s]+)(?P<y>\d{{2,4}})\b",
    re.IGNORECASE,
)
_DATE_VERBAL_DM_RE = re.compile(
    rf"\b(?P<d>\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?(?P<m>{_MONTH_RE_FRAG})(?:[,\s]+)(?:of\s+)?(?P<y>\d{{2,4}})\b",
    re.IGNORECASE,
)


def _expand_two_digit_year(yy: int) -> int:
    return 2000 + yy if yy < 30 else 1900 + yy


def _valid_dob(y: int, m: int, d: int) -> bool:
    if not (1900 <= y <= date.today().year):
        return False
    try:
        date(y, m, d)
        return True
    except ValueError:
        return False


def _try_parse_dob(text: str) -> str | None:
    """Best-effort DOB extraction → 'YYYYMMDD' or None.

    Order: verbal → ISO → US slash (MM/DD) → international slash (DD/MM)
    → compact YYYYMMDD. Slash-date ambiguity: try US first, fall back to
    intl only when US yields an invalid calendar date.
    """
    if not text:
        return None

    for pat in (_DATE_VERBAL_MD_RE, _DATE_VERBAL_DM_RE):
        for m in pat.finditer(text):
            mo = _MONTH_NAMES[m.group("m").lower()]
            d = int(m.group("d"))
            y_str = m.group("y")
            y = int(y_str) if len(y_str) == 4 else _expand_two_digit_year(int(y_str))
            if _valid_dob(y, mo, d):
                return f"{y:04d}{mo:02d}{d:02d}"

    for m in _DATE_ISO_RE.finditer(text):
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if _valid_dob(y, mo, d):
            return f"{y:04d}{mo:02d}{d:02d}"

    for m in _DATE_SLASH_RE.finditer(text):
        a, b, y_str = int(m.group(1)), int(m.group(2)), m.group(3)
        y = int(y_str) if len(y_str) == 4 else _expand_two_digit_year(int(y_str))
        if _valid_dob(y, a, b):
            return f"{y:04d}{a:02d}{b:02d}"
        if _valid_dob(y, b, a):
            return f"{y:04d}{b:02d}{a:02d}"

    for m in _DATE_COMPACT_RE.finditer(text):
        s = m.group(1)
        y, mo, d = int(s[:4]), int(s[4:6]), int(s[6:8])
        if _valid_dob(y, mo, d):
            return f"{y:04d}{mo:02d}{d:02d}"

    return None


# ---------------------------------------------------------------------------
# Deterministic LLM-skip fast-paths
# ---------------------------------------------------------------------------
# When the user's reply is unambiguously the field the bot just asked for
# (a phone number, an email, a 1-2 word name, a canonical payer name from
# the dropdown), we can skip the extract LLM call entirely and synthesize
# a TurnExtraction result. Saves 1-3s per turn on roughly 40% of
# field-collection turns. Falls back to the LLM whenever the regex isn't
# crisp — quality cannot regress because the LLM still gets the hard cases.

_PHONE_RE = re.compile(r"^[\d\s().+-]{7,20}$")
_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$")
_SINGLE_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z'-]{0,30}( [A-Za-z][A-Za-z'-]{0,30})?$")


def _digits_only(s: str) -> str:
    return re.sub(r"\D", "", s)


def _synth_extraction(field_deltas: dict[str, Any]) -> TurnExtraction:
    """Build a TurnExtraction with only the named field set.

    intent_delta="none" → planner keeps prior intent (we're answering a field,
    not changing direction). affirmation="none". safety_signal=False. All
    other fields default to None / unset. confidence="high" because the
    regex matched cleanly.
    """
    return TurnExtraction(
        intent_delta="none",
        affirmation="none",
        safety_signal=False,
        confidence="high",
        field_deltas=FieldDeltas(**field_deltas),
    )


def _try_deterministic_fast_path(state: State, user_text: str) -> TurnExtraction | None:
    """If user_text is unambiguously a single field value, skip the LLM."""
    text = (user_text or "").strip()
    if not text or len(text) > 80:
        return None

    intent = state.get("intent")
    # Fast-path only applies when the bot is in a field-collection flow.
    # Outside booking/insurance_check/callback we can't safely assume the
    # input is a field answer.
    if intent not in ("booking", "insurance_check", "callback"):
        return None

    ins = state.get("insurance_fields") or {}
    bk = state.get("booking_fields") or {}
    cb = state.get("callback_fields") or {}

    # Payer-dropdown match: widget sends a canonical PAYERS name on pick.
    from ...data.payers import PAYERS
    for p in PAYERS:
        if text.lower() == p.name.lower():
            return _synth_extraction({"payer_name": p.name})

    # Email — high-confidence shape match.
    if _EMAIL_RE.match(text):
        return _synth_extraction({"email": text.lower()})

    # Phone — 10-11 US digits, only allowed separators.
    if _PHONE_RE.match(text):
        digits = _digits_only(text)
        if 10 <= len(digits) <= 11:
            field = "callback_phone" if intent == "callback" else "phone"
            return _synth_extraction({field: text})

    # Single alpha word (or two-word "First Last") — likely a name. Only
    # use this when the next missing name field is unambiguous so we
    # don't accidentally label a therapist name as patient first_name.
    if _SINGLE_NAME_RE.match(text):
        if intent == "callback":
            if not (cb.get("first_name") or "").strip():
                return _synth_extraction({"first_name": text.title()})
            if not (cb.get("last_name") or "").strip():
                return _synth_extraction({"last_name": text.title()})
        else:
            # booking / insurance_check flow uses the insurance_fields bag
            # for identity (first/last/dob/payer/member_id).
            if not (ins.get("first_name") or "").strip():
                return _synth_extraction({"first_name": text.title()})
            if not (ins.get("last_name") or "").strip():
                return _synth_extraction({"last_name": text.title()})

    return None


# Lazy singleton — built once per process. ChatOpenAI is thread-safe and
# `with_structured_output` returns a runnable that does the JSON-schema
# binding under the hood.
_extractor = None


def _get_extractor():
    global _extractor
    if _extractor is None:
        _extractor = ChatOpenAI(
            model=extract_model_name(),
            temperature=0,
        ).with_structured_output(TurnExtraction)
    return _extractor


def _last_user_text(state: State) -> str:
    text = state.get("last_user_text") or ""
    if text:
        return text
    msgs = state.get("messages") or []
    for m in reversed(msgs):
        role = getattr(m, "type", None) or (m.get("role") if isinstance(m, dict) else None)
        if role in ("human", "user"):
            content = getattr(m, "content", None) or (m.get("content") if isinstance(m, dict) else None)
            if isinstance(content, str):
                return content
    return ""


def _last_assistant_text(state: State) -> str:
    msgs = state.get("messages") or []
    for m in reversed(msgs):
        role = getattr(m, "type", None) or (m.get("role") if isinstance(m, dict) else None)
        if role in ("ai", "assistant"):
            content = getattr(m, "content", None) or (m.get("content") if isinstance(m, dict) else None)
            if isinstance(content, str):
                return content
    return ""


def _context_block(state: State) -> str:
    """Tight, structured context passed to the extractor each turn.

    Kept short on purpose: the model only needs to know what we already
    have so it can correctly classify "answers" vs "new requests".
    """
    insurance = state.get("insurance_fields") or {}
    booking = state.get("booking_fields") or {}
    callback = state.get("callback_fields") or {}
    gates = state.get("gates") or {}
    return (
        f"current_intent: {state.get('intent', 'unknown')}\n"
        f"booking_status: {state.get('booking_status', 'none')}\n"
        f"payment_path: {state.get('payment_path', 'unknown')}\n"
        f"insurance_fields_present: {sorted(k for k, v in insurance.items() if v)}\n"
        f"booking_fields_present: {sorted(k for k, v in booking.items() if v)}\n"
        f"callback_fields_present: {sorted(k for k, v in callback.items() if v)}\n"
        f"pending_question: {state.get('pending_question')}\n"
        f"last_assistant_said: {_last_assistant_text(state)[:300]!r}\n"
        f"gates_done: {sorted(k for k, v in gates.items() if v)}\n"
        f"caller_relationship: {state.get('caller_relationship')}\n"
        f"physical_presence_state: {state.get('physical_presence_state')}\n"
    )


def _match_roster(name: str) -> dict | None:
    """Match a free-text name against the bookable roster.

    Order of attempts (each case-insensitive):
      1) exact match on first name, full name, or last name
      2) any whitespace-token of the input equals a first name
    """
    from ...data.roster import ELIGIBLE_FOR_BOOKING

    n = (name or "").strip().lower()
    if not n:
        return None
    for t in ELIGIBLE_FOR_BOOKING:
        full = t["name"].lower()
        parts = full.split()
        first = parts[0]
        last = parts[-1]
        if n in (first, full, last):
            return t
    tokens = set(n.split())
    for t in ELIGIBLE_FOR_BOOKING:
        if t["name"].lower().split()[0] in tokens:
            return t
    return None


def _resolve_staff(state: State, deltas) -> dict[str, Any]:
    """Resolve therapist selection into a (staff_id, staff_name) pair.

    Three paths, each driven entirely by structured fields the extract
    LLM has already filled in — no keyword matching here so we get
    robust paraphrase coverage and a single NL->state boundary:

      1) Extractor named a therapist  -> roster match by first/last/full.
      2) Extractor flagged `no_therapist_preference` -> deterministic
         roster pick by session_id (stable across refreshes).
      3) Otherwise: do nothing; let the LLM ask again. Don't overwrite
         a valid prior choice.
    """
    from ...data.roster import ELIGIBLE_FOR_BOOKING

    out: dict[str, Any] = {}
    name = (getattr(deltas, "staff_name", None) or "").strip()
    if name:
        match = _match_roster(name)
        if match:
            out["staff_id"] = match["staffId"]
            out["staff_name"] = match["name"]
            return out
        # Roster miss — keep the raw name visible so respond can apologise
        # and re-prompt, but never set staff_id from an unverified string.
        out["staff_name"] = name
        return out

    if (
        getattr(deltas, "no_therapist_preference", False)
        and not state.get("staff_id")
        and state.get("intent") == "booking"
        and ELIGIBLE_FOR_BOOKING
    ):
        sid = state.get("session_id") or ""
        idx = (abs(hash(sid)) % len(ELIGIBLE_FOR_BOOKING)) if sid else 0
        choice = ELIGIBLE_FOR_BOOKING[idx]
        out["staff_id"] = choice["staffId"]
        out["staff_name"] = choice["name"]
    return out


def _merge_field_deltas(state: State, deltas) -> dict[str, Any]:
    """Apply field_deltas into the three field bags, preserving prior values.

    Returns the partial state update; LangGraph merges it back in.
    """
    insurance = InsuranceFields(**(state.get("insurance_fields") or {}))
    booking = BookingFields(**(state.get("booking_fields") or {}))
    callback = CallbackFields(**(state.get("callback_fields") or {}))

    # Insurance / identity fields (also used for callback when relevant).
    if deltas.first_name:
        insurance["first_name"] = deltas.first_name.strip()
        # First/last also seed the callback fields — same person.
        callback["first_name"] = deltas.first_name.strip()
    if deltas.last_name:
        insurance["last_name"] = deltas.last_name.strip()
        callback["last_name"] = deltas.last_name.strip()
    if deltas.dob_yyyymmdd and len(deltas.dob_yyyymmdd) == 8 and deltas.dob_yyyymmdd.isdigit():
        insurance["dob_yyyymmdd"] = deltas.dob_yyyymmdd
    if deltas.payer_name:
        insurance["payer_name"] = deltas.payer_name.strip()
    if deltas.member_id:
        insurance["member_id"] = deltas.member_id.strip()

    # Booking-only fields.
    if deltas.reason:
        booking["reason"] = deltas.reason.strip()[:500]
        callback["reason"] = deltas.reason.strip()[:500]
    if deltas.phone:
        booking["phone"] = deltas.phone.strip()
        callback["phone"] = deltas.phone.strip()
    if deltas.email:
        booking["email"] = deltas.email.strip()
    if deltas.home_address:
        booking["home_address"] = deltas.home_address.strip()
    if deltas.sex:
        booking["sex"] = deltas.sex.strip()

    # Callback-specific overrides (when the caller specifies a different
    # number / reason for callback than the booking flow).
    if deltas.callback_phone:
        callback["phone"] = deltas.callback_phone.strip()
    if deltas.callback_reason:
        callback["reason"] = deltas.callback_reason.strip()[:500]

    update: dict[str, Any] = {
        "insurance_fields": insurance,
        "booking_fields": booking,
        "callback_fields": callback,
    }

    # Therapist selection — resolve to staff_id so the planner can leave
    # the ask_therapist scene. The extractor emits a free-text name; we
    # match it against the bookable roster here. Without this, planner.py
    # gates on staff_id and loops forever even after staff_name is set.
    _staff_update = _resolve_staff(state, deltas)
    if _staff_update:
        update.update(_staff_update)

    # Scheduling preferences flow through to action nodes via transient keys.
    if deltas.time_of_day:
        update["_time_of_day"] = deltas.time_of_day
    if deltas.earliest_day_offset is not None:
        update["_earliest_day_offset"] = deltas.earliest_day_offset

    # Info-question text flows to search_kb via transient key.
    if deltas.info_query:
        update["_info_query"] = deltas.info_query.strip()

    # Selected slot index resolves against the proposed_slots list — done
    # by the planner / respond, but we stash the index for them to consume.
    if deltas.selected_slot_index is not None:
        update["_selected_slot_index"] = deltas.selected_slot_index

    return update


def _merge_gate_signals(state: State, result: TurnExtraction) -> dict[str, Any]:
    """Merge new gate/presence signals from this turn into state.

    All gate merges are idempotent: a True flag is never cleared.
    Returns only the keys that actually changed so LangGraph's merge
    is a no-op when nothing changed.
    """
    update: dict[str, Any] = {}

    # --- Gates (monotonic True) ----------------------------------------
    gates: Gates = Gates(**(state.get("gates") or {}))
    gates_changed = False

    # recording_consent True -> disclosure gate done.
    if result.recording_consent is True and not gates.get("disclosure_done"):
        gates["disclosure_done"] = True
        gates_changed = True

    if gates_changed:
        update["gates"] = gates
        logger.info(
            "extract gates_updated session=%s gates=%s",
            state.get("session_id", "?"),
            {k: v for k, v in gates.items() if v},
        )

    # --- Physical presence (write once; don't overwrite a known value) --
    if result.physical_presence_state and not state.get("physical_presence_state"):
        update["physical_presence_state"] = result.physical_presence_state

    # --- Caller relationship (write once; unknown can be overwritten by
    #     a more specific value on a later turn) -------------------------
    prior_rel = state.get("caller_relationship")
    new_rel = result.caller_relationship
    if new_rel and new_rel != "unknown":
        # Always accept a concrete value; overwrite "unknown".
        update["caller_relationship"] = new_rel
    elif new_rel == "unknown" and prior_rel is None:
        # Only store "unknown" if we had nothing.
        update["caller_relationship"] = new_rel

    # --- Modality preference -------------------------------------------
    if result.modality_preference and not state.get("modality"):
        update["modality"] = result.modality_preference

    # --- Resume decision -----------------------------------------------
    if result.resume_decision:
        resume: ResumeOffer = ResumeOffer(**(state.get("resume") or {}))
        if resume.get("decision") is None:
            resume["decision"] = result.resume_decision
            update["resume"] = resume
            # Flip resume_decided gate so planner moves past the resume node.
            gates = Gates(**(update.get("gates") or state.get("gates") or {}))
            gates["resume_decided"] = True
            update["gates"] = gates

    return update


def extract(state: State) -> dict[str, Any]:
    """Run one LLM call to parse the latest user turn into deltas."""
    user_text = _last_user_text(state)
    if not user_text:
        return {}

    # Increment turn counter unconditionally — even on parse failure we
    # still consumed a turn. The planner uses this for the loop guard.
    new_turn_count = (state.get("turn_count") or 0) + 1

    # Deterministic fast-path: skip the LLM entirely when the user's
    # message is unambiguously a single field value (phone, email,
    # canonical payer name, or short alpha name in a known slot).
    # Cuts ~1-3s off this turn; LLM still handles every harder case.
    fast = _try_deterministic_fast_path(state, user_text)
    if fast is not None:
        result: TurnExtraction = fast
        logger.info(
            "extract_fast_path session=%s fields=%s",
            state.get("session_id", "?"),
            [k for k, v in fast.field_deltas.model_dump().items() if v],
        )
    else:
        try:
            result: TurnExtraction = _get_extractor().invoke([
                SystemMessage(content=EXTRACT_SYSTEM_PROMPT),
                HumanMessage(content=(
                    f"# Context\n{_context_block(state)}\n"
                    f"# Last user message\n{user_text}\n"
                )),
            ])
        except Exception:
            logger.exception("extract_failed session=%s", state.get("session_id", "?"))
            # Fail soft — mark the turn low-confidence so the planner
            # routes to clarify. Without `_low_confidence=True`, the
            # planner would proceed on stale state and re-ask the field.
            return {
                "affirmation": "none",
                "safety_signal": False,
                "last_user_text": user_text,
                "_low_confidence": True,
                "turn_count": new_turn_count,
                "last_node": "extract",
            }

    # Safety net 1 — typo affirmatives. Fill in when the LLM was unsure
    # ("unclear") or didn't classify ("none") on a terse reply that's
    # unambiguously yes/no to a human reader ("ys", "yh", "nah", 👍).
    typo_aff = _normalize_affirmative_token(user_text)
    if typo_aff and result.affirmation in ("unclear", "none"):
        result.affirmation = typo_aff
        # A single-token yes/no is high-confidence on its own — don't let
        # an unrelated low-conf flag route the next turn into clarify.
        if (
            result.confidence == "low"
            and not result.field_deltas.model_dump(exclude_none=True)
        ):
            result.confidence = "high"

    # Safety net 2 — multi-format DOB. The LLM occasionally returns null
    # for D/M/Y inputs where M would be >12; parse them deterministically
    # so the booking flow doesn't loop on a missing field.
    if not result.field_deltas.dob_yyyymmdd:
        parsed_dob = _try_parse_dob(user_text)
        if parsed_dob:
            result.field_deltas.dob_yyyymmdd = parsed_dob

    update: dict[str, Any] = _merge_field_deltas(state, result.field_deltas)
    update.update(_merge_gate_signals(state, result))
    update["affirmation"] = result.affirmation
    update["last_user_text"] = user_text
    update["turn_count"] = new_turn_count
    update["last_node"] = "extract"

    # Crisis OR signal-from-LLM both trip the safety flag. The keyword
    # pre-filter has already set safety_signal if a hard trigger fired —
    # don't downgrade that here.
    if result.safety_signal:
        update["safety_signal"] = True

    # Intent: APPLY the delta to sticky intent. "none" means keep prior.
    delta = result.intent_delta
    if delta == "none":
        pass
    elif delta == "self_pay":
        update["payment_path"] = "self_pay"
        # Keep prior intent (likely "booking" or "insurance_check").
    elif delta in {
        "greeting", "info", "insurance_check", "booking",
        "callback", "cancel", "keep", "out_of_scope",
    }:
        update["intent"] = delta

    # Confidence — pass through to the planner via a transient key so the
    # planner can decide to clarify instead of act on low-confidence.
    # Always overwrite (don't just set on low): otherwise a single
    # low-conf turn sticks across the rest of the session and every
    # subsequent reply routes to the clarify scene, even when the next
    # field was captured cleanly.
    update["_low_confidence"] = (result.confidence == "low")

    # ------------------------------------------------------------------
    # Pending-flag lifecycle (resume_offer + reuse_insurance)
    # ------------------------------------------------------------------
    # Both flags ask the caller a yes/no question. Three possible
    # responses each turn:
    #   yes / no         — handled below (continue or wipe).
    #   start fresh etc. — handled below (deterministic regex; treated
    #                       as "no" + wipe).
    #   anything else    — the caller ignored the question and moved on.
    #                      We auto-drop the flag so we don't trap them
    #                      in a question-loop. Their new intent (if any)
    #                      drives the next turn normally.
    user_text_lower = user_text.lower()
    fresh_start_signal = bool(re.search(
        r"\b(start\s+fresh|fresh\s+chat|fresh\s+start|start\s+over|"
        r"begin\s+again|new\s+chat|new\s+session|reset|start\s+new|"
        r"different\s+person|not\s+(me|sagar|the\s+same)|"
        r"wipe|clear|restart|forget\s+(it|that|me|everything))\b",
        user_text_lower,
    ))
    # "Changed mind" — the user moved on to a different topic. Drop
    # whichever flag is pending so planner routes normally this turn.
    # NOTE: explicit field check (not model_dump) because FieldDeltas
    # has `no_therapist_preference: bool = False` which doesn't get
    # excluded by `exclude_none` and would falsely set moved_on_signal
    # every single turn.
    fd = result.field_deltas
    has_real_field_delta = bool(
        fd.first_name or fd.last_name or fd.dob_yyyymmdd or fd.payer_name
        or fd.member_id or fd.reason or fd.phone or fd.email
        or fd.home_address or fd.sex or fd.callback_phone
        or fd.callback_reason or fd.info_query or fd.staff_name
        or fd.selected_slot_index is not None or fd.time_of_day
        or fd.earliest_day_offset is not None
    )
    moved_on_signal = (
        delta in {"booking", "callback", "info", "out_of_scope", "cancel"}
        or has_real_field_delta
        or result.safety_signal
    )

    # Track whether this turn performed a full session wipe — used to
    # short-circuit the reuse-confirm flag below so we don't re-arm it
    # on the same turn we just cleared everything.
    did_wipe = False

    # -- Resume-offer flag (handle FIRST — wipes EVERYTHING incl. msgs)
    if state.get("_resume_offer_pending"):
        if result.affirmation in ("yes", "no") or fresh_start_signal:
            update["_resume_offer_pending"] = False
            wants_fresh = result.affirmation == "no" or fresh_start_signal
            if wants_fresh:
                update["insurance_fields"] = InsuranceFields()
                update["booking_fields"] = BookingFields()
                update["callback_fields"] = CallbackFields()
                update["verify_result"] = None
                update["intent"] = "unknown"
                update["payment_path"] = "unknown"
                update["booking_status"] = "none"
                update["callback_status"] = "none"
                update["staff_id"] = None
                update["staff_name"] = None
                update["selected_slot"] = None
                update["proposed_slots"] = []
                update["affirmation"] = "no"
                # Also reset scene/action plumbing so respond doesn't
                # pick a stale scene off `last_action` from a prior turn.
                update["last_action"] = None
                update["pending_question"] = None
                update["last_reply_text"] = None
                update["_low_confidence"] = False
                update["_scene"] = None
                # CRITICAL: wipe the LangGraph message history so the
                # respond LLM can't see prior PHI context. Without this,
                # respond improvises off old turns ("what insurance plan?")
                # even though structured state is empty.
                prior_msgs = state.get("messages") or []
                update["messages"] = [
                    RemoveMessage(id=m.id)
                    for m in prior_msgs
                    if getattr(m, "id", None)
                ]
                did_wipe = True
        elif moved_on_signal:
            update["_resume_offer_pending"] = False

    # -- Reuse-confirm flag --------------------------------------------
    # Skip entirely if we just wiped — otherwise we'd re-arm the reuse
    # flag against PHI fields that no longer exist this turn.
    if not did_wipe:
        ins = state.get("insurance_fields") or {}
        all_ins_fields_present = all(
            (ins.get(k) or "").strip()
            for k in ("first_name", "last_name", "dob_yyyymmdd", "payer_name", "member_id")
        )
        if state.get("_reuse_insurance_pending"):
            if result.affirmation in ("yes", "no") or fresh_start_signal:
                update["_reuse_insurance_pending"] = False
                if result.affirmation == "no" or fresh_start_signal:
                    update["insurance_fields"] = InsuranceFields()
                    update["verify_result"] = None
            elif moved_on_signal:
                update["_reuse_insurance_pending"] = False
        elif delta == "insurance_check" and all_ins_fields_present:
            update["_reuse_insurance_pending"] = True

    logger.info(
        "extract session=%s intent_delta=%s aff=%s safety=%s low_conf=%s "
        "delta_fields=%s turn=%d",
        state.get("session_id", "?"),
        result.intent_delta,
        result.affirmation,
        result.safety_signal,
        result.confidence == "low",
        sorted(k for k, v in result.field_deltas.model_dump().items() if v),
        new_turn_count,
    )
    return update

"""respond — the patient-facing text generator.

ONE LLM call per turn. Picks a scene based on state + last_action,
formats the matching prompt with a tiny context block, and returns the
generated assistant message.

Side-effects:
  * Appends the assistant turn to ``messages`` (via ``add_messages``).
  * Sets ``last_reply_text``.
  * Flips ``booking_status`` / ``callback_status`` to the corresponding
    ``*_pending_confirm`` where relevant.
  * Persists the user/assistant turn to DynamoDB via the gateway's
    ``/internal/chat/turn`` endpoint so the admin /admin/chat dashboard
    keeps showing the full conversation. PHI never lands on Postgres.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import urllib.request
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from ..config import gateway_base_url, respond_model_name
from ..prompts.persona import persona_block
from ..prompts._constants import HIPAA_DISCLOSURE_CHAT, HIPAA_DISCLOSURE_VOICE
from ..prompts.scenes import FIELD_PROMPTS, SCENE_INSTRUCTIONS
from ..state import (
    State,
    booking_fields_complete,
    callback_complete,
    first_missing_booking,
    first_missing_callback,
    first_missing_insurance,
    insurance_complete,
)
from ..tracing import traced

logger = logging.getLogger(__name__)

_responder = None


def _get_responder():
    global _responder
    if _responder is None:
        _responder = ChatOpenAI(model=respond_model_name(), temperature=0.4)
    return _responder


# ---------------------------------------------------------------------------
# Scene selection — pure function of state
# ---------------------------------------------------------------------------

def _pick_scene(state: State) -> str:
    """Choose the scene name based on state and last_action.

    The planner already routed us to ``respond``; this just picks which
    scene template to use. Kept side-effect-free for testability.
    """
    if state.get("safety_signal") or state.get("intent") == "crisis":
        return "crisis"
    # HIPAA disclosure gate (mirrors planner.py:206). The planner is a
    # pure routing function — it returns the next node name but cannot
    # mutate state.scene. So when it routed here with reason=
    # "disclosure_prompt" (gates.disclosure_done is still False), we
    # need to detect that condition here independently and pick the
    # verbatim-disclosure scene. Without this, _pick_scene would fall
    # through to "open_question" and the LLM would paraphrase — exact
    # bug observed in chat session c291a8a7… on 2026-05-21.
    if not (state.get("gates") or {}).get("disclosure_done"):
        return "disclosure_prompt"
    # If a prior action node explicitly set a scene (handoffs, gates,
    # self-pay offer, etc.), honor it. This is required so a routing
    # like `handoff_out_of_state` doesn't fall through to the booking
    # scene picker and ask another irrelevant field after handoff.
    explicit_scene = state.get("scene")
    if explicit_scene and explicit_scene in SCENE_INSTRUCTIONS:
        return explicit_scene
    # "Which therapist is right for me?" — never match; refer to the form.
    # Mirrors planner.py step 12-pre (same channel guard, same precedence
    # over the roster scene below).
    if state.get("_wants_therapist_match"):
        _bs = state.get("booking_status", "none")
        _mid_booking = _bs in ("collecting", "ready_for_slots", "slot_selected", "pending_confirm")
        if state.get("channel") == "chat" or not _mid_booking:
            return "matching_referral"
    # "Which therapists do you have?" — answer from the roster directly
    # (planner routed here without a KB search). Same channel guard as
    # planner.py step 12a so the two never disagree: answer anytime on
    # chat; on voice defer to an active booking.
    if state.get("_asks_therapist_roster"):
        _bs = state.get("booking_status", "none")
        _mid_booking = _bs in ("collecting", "ready_for_slots", "slot_selected", "pending_confirm")
        if state.get("channel") == "chat" or not _mid_booking:
            return "list_therapists"
    # ---- Post-booking follow-up (intake complete) ----------------------
    # Once the appointment is booked the intake flow is over. The intent
    # often stays sticky as "booking", so a casual "thanks" or a fresh
    # question would otherwise fall into the booking-field block below and
    # re-render the confirmation read-back (chat session 2026-05-24). Bail
    # to a natural follow-up: genuine questions still flow through the FAQ
    # KB (search_kb populates kb_snippets, surfaced via info_answer);
    # cancels fall through to the cancel-confirm path further down.
    if state.get("booking_status") == "booked" and state.get("intent") != "cancel":
        if state.get("intent") == "info" and state.get("kb_snippets"):
            return "info_answer"
        return "post_booking_followup"
    if state.get("_resume_offer_pending"):
        return "resume_offer"
    if state.get("_reuse_insurance_pending"):
        return "confirm_reuse_insurance"
    if state.get("_low_confidence"):
        return "clarify"
    if state.get("intent") == "out_of_scope":
        return "out_of_scope"

    la = state.get("last_action") or ""
    bs = state.get("booking_status", "none")
    cs = state.get("callback_status", "none")
    intent = state.get("intent", "unknown")

    if la == "book_appointment_success":
        return "post_booking"
    if la == "cancel_appointment_success":
        return "post_cancel"
    if la == "submit_callback":
        return "post_callback"
    if la in ("lookup_appointment_verify_failed", "lookup_appointment_not_found"):
        return "cancel_not_found"
    if la == "lookup_appointment_past":
        return "cancel_past_appointment"
    if la == "lookup_appointment_found":
        # Appointment found — fall through to the confirm_cancel path below.
        pass
    if la == "verify_insurance":
        # Insurance-only flow stops here; booking flow continues.
        if intent == "insurance_check":
            # "no" to the post-verify "book now?" offer = closing
            # scene, not another copy of the same offer. Must check
            # here too: the later `intent in ("booking",
            # "insurance_check")` block is past this short-circuit.
            if state.get("affirmation") == "no":
                return "post_verify_declined"
            return "post_verify_offer_booking"
        # Booking flow — fire a one-shot scene that acknowledges
        # coverage AND asks the next booking field in the same reply.
        # Gated on last_node == "verify_insurance" so it only fires on
        # the exact turn verify ran (extract resets last_node="extract"
        # on the next user turn, so subsequent booking-field turns fall
        # through to the plain ask_booking_field below).
        if (
            state.get("last_node") == "verify_insurance"
            and not booking_fields_complete(state)
            and state.get("verify_result")
        ):
            return "post_verify_continue_booking"
        # Booking flow continues — fall through to next missing field.
    # Render the KB answer only on the turn the caller actually asked
    # something. A bare `last_action == "search_kb"` lingers across turns
    # and would otherwise pin every later field-answer turn to info_answer,
    # abandoning an in-progress booking (chat session 2026-05-24).
    if la == "search_kb" and state.get("_info_this_turn"):
        return "info_answer"
    if la == "propose_slots" and not state.get("selected_slot"):
        return "present_slots"
    # propose_slots swept the calendar and found nothing. Answer the
    # no-availability situation directly (offer a callback / the office
    # line) instead of falling through to the booking-field blocks, which
    # would otherwise reply to "any openings?" by asking for insurance.
    if la == "propose_slots_no_availability":
        return "no_availability"
    if la == "rollback":
        # If booking is still booked, just acknowledge.
        if bs == "booked":
            return "open_question"
        if cs == "none":
            return "open_question"

    # Cancel intent on a booked appointment (in-session booking OR a
    # prior-session appointment the lookup just flipped to "booked"): read
    # back the details and ask confirmation.
    if intent == "cancel" and bs == "booked":
        return "confirm_cancel"

    # Cancel / reschedule intent but no appointment located yet — ask for the
    # phone + DOB so we can look up the prior-session appointment. Mirrors
    # planner.py step 10 (ask_cancel_identifiers): the planner routes us here
    # whenever it still lacks phone+DOB. Without this branch _pick_scene fell
    # through to open_question and the LLM freelanced ("what's the date and
    # time?", "what details do you remember?") instead of asking for the
    # lookup keys it needs to surface the appointment details. The post-lookup
    # outcomes (found / not_found / past) are already handled above via
    # last_action, so reaching here means we genuinely need the identifiers.
    # Guard on `not appointment_id`: once an appointment is located (e.g. a
    # reschedule that's now picking a new slot) we must NOT fall back to asking
    # for identifiers again.
    if (
        intent == "cancel"
        and bs not in ("booked", "cancel_pending_confirm", "cancelled")
        and not state.get("appointment_id")
    ):
        return "ask_cancel_identifiers"

    # Info path: respond after kb search or before.
    if intent == "info":
        if state.get("kb_snippets"):
            return "info_answer"
        return "open_question"

    # Callback path.
    if intent == "callback":
        if callback_complete(state) and cs == "none":
            return "confirm_callback"
        if not callback_complete(state):
            return "ask_callback_field"

    # Insurance / booking field collection.
    if intent in ("booking", "insurance_check"):
        # Insurance fields first (unless self_pay).
        if state.get("payment_path") != "self_pay" and not insurance_complete(state):
            return "ask_insurance_field"
        # After verify, insurance_check ends with the offer. "no" from
        # the caller takes us to the closing scene instead of looping
        # on the same offer — see planner's matching post_verify branch.
        if intent == "insurance_check" and state.get("verify_result"):
            if state.get("affirmation") == "no" and state.get("last_action") == "verify_insurance":
                return "post_verify_declined"
            return "post_verify_offer_booking"
        # Booking fields next.
        if not booking_fields_complete(state):
            return "ask_booking_field"
        # Therapist choice is NOT a gating question (mirrors planner.py): a
        # named therapist is carried forward; nobody named -> propose the
        # soonest opening across the whole roster. We never re-ask here.
        if not state.get("proposed_slots"):
            # planner should have routed to propose_slots; if we end up
            # here it means propose returned nothing — offer a callback.
            return "open_question"
        if not state.get("selected_slot"):
            return "present_slots"
        return "confirm_booking"

    if intent in ("greeting", "unknown") and not state.get("messages"):
        return "greeting"

    return "open_question"


# ---------------------------------------------------------------------------
# Context block — what the scene LLM sees on top of the prompt
# ---------------------------------------------------------------------------

def _context_for_scene(scene: str, state: State) -> str:
    ins = state.get("insurance_fields") or {}
    bk = state.get("booking_fields") or {}
    cb = state.get("callback_fields") or {}

    bits: list[str] = [
        f"channel: {state.get('channel', 'chat')}",
        f"intent: {state.get('intent', 'unknown')}",
        f"booking_status: {state.get('booking_status', 'none')}",
        f"callback_status: {state.get('callback_status', 'none')}",
        f"safety_signal: {bool(state.get('safety_signal'))}",
        f"payment_path: {state.get('payment_path', 'unknown')}",
        # Always include the latest user turn so the responder can write
        # a reply that actually addresses what was said — without this
        # the LLM was generating generic greetings for crisis/handoff
        # scenes since it only saw the structured intent.
        f"user_just_said: {(state.get('last_user_text') or '')!r}",
    ]

    if scene == "ask_insurance_field":
        field = first_missing_insurance(state)
        bits.append(f"field_to_ask: {field}")
        bits.append(f"field_label: {FIELD_PROMPTS.get(field or '', field or '')}")
        present = [k for k, v in ins.items() if v]
        if present:
            bits.append(f"already_collected: {present}")
        # First-turn flag — used by the scene prompt to choose between a
        # booking-acknowledgement opener ("Happy to help...") and the
        # bare coverage opener. Without this the LLM frames every booking
        # as a coverage check, which confuses callers who just asked to
        # book an appointment.
        bits.append(f"is_first_insurance_turn: {not present}")
    elif scene == "ask_booking_field":
        field = first_missing_booking(state)
        bits.append(f"field_to_ask: {field}")
        bits.append(f"field_label: {FIELD_PROMPTS.get(field or '', field or '')}")
    elif scene == "ask_callback_field":
        field = first_missing_callback(state)
        bits.append(f"field_to_ask: {field}")
        bits.append(f"field_label: {FIELD_PROMPTS.get(field or '', field or '')}")
        # First-turn flag: on the opening callback ask the responder
        # should acknowledge the handoff before asking for the first
        # field. Compute by checking whether ANY callback field exists.
        has_any = any((cb or {}).get(k) for k in ("first_name", "last_name", "phone", "reason"))
        bits.append(f"is_first_callback_turn: {not has_any}")
    elif scene == "ask_therapist":
        from ...data.roster import ELIGIBLE_FOR_BOOKING
        roster = ", ".join(t["name"] for t in ELIGIBLE_FOR_BOOKING)
        bits.append(f"available_therapists: {roster}")
    elif scene == "list_therapists":
        from ...data.roster import ELIGIBLE_FOR_BOOKING
        from ...graph.prompts._constants import THERAPIST_MATCH_FORM_URL
        roster = ", ".join(t["name"] for t in ELIGIBLE_FOR_BOOKING)
        bits.append(f"available_therapists: {roster}")
        bits.append(f"matching_form_url: {THERAPIST_MATCH_FORM_URL}")
        bs = state.get("booking_status") or "none"
        if bs in ("collecting", "ready_for_slots", "slot_selected", "pending_confirm"):
            bits.append("booking_status: in_progress")
    elif scene == "matching_referral":
        from ...graph.prompts._constants import THERAPIST_MATCH_FORM_URL
        bits.append(f"matching_form_url: {THERAPIST_MATCH_FORM_URL}")
    elif scene == "present_slots":
        slots = state.get("proposed_slots") or []
        # Pinned = the caller chose a specific clinician (not the any-mode
        # fan-out). Drives the display: single therapist -> name once in the
        # intro; any-mode -> name per slot + invite them to pick someone.
        pinned = bool(state.get("staff_id")) and not state.get("staff_any")
        if pinned:
            bits.append("display_mode: single_therapist")
            bits.append(f"availability_for: {state.get('staff_name')}")
        else:
            bits.append("display_mode: any_therapist")
        bits.append("slots:")
        for i, s in enumerate(slots, 1):
            staff_name = s.get("staffName", "")
            display = s.get("displayPT", "")
            if pinned or not staff_name:
                bits.append(f"  {i}. {display}")
            else:
                bits.append(f"  {i}. {display} with {staff_name} (staffId {s.get('staffId', '?')})")
    elif scene == "no_availability":
        # If the caller asked about ONE specific therapist, name them so the
        # reply can offer to check others. In "Any therapist" mode (staff_any)
        # the fan-out already swept the whole roster — speak generally so we
        # never wrongly blame a single clinician the caller didn't choose.
        if state.get("staff_name") and not state.get("staff_any"):
            bits.append(f"availability_for: {state.get('staff_name')}")
    elif scene == "confirm_booking":
        slot = state.get("selected_slot") or {}
        bits.append(
            "recap:\n"
            f"  name: {ins.get('first_name')} {ins.get('last_name')}\n"
            f"  dob: {ins.get('dob_yyyymmdd')}\n"
            f"  phone: {bk.get('phone')}\n"
            f"  email: {bk.get('email')}\n"
            f"  address: {bk.get('home_address')}\n"
            f"  sex: {bk.get('sex')}\n"
            f"  insurance: {ins.get('payer_name')} (member {ins.get('member_id')})\n"
            f"  reason: {bk.get('reason')}\n"
            f"  slot: {slot.get('displayPT')}\n"
            f"  therapist: {state.get('staff_name')}"
        )
        bits.append(f"insurance_pending_admin: {bool(state.get('insurance_pending_admin'))}")
    elif scene == "post_booking":
        slot = state.get("selected_slot") or {}
        bits.append(f"booked_slot: {slot.get('displayPT')}")
        bits.append(f"therapist: {state.get('staff_name')}")
        bits.append(f"appointment_id: {state.get('appointment_id')}")
        vr = state.get("verify_result") or {}
        if vr.get("coverage", {}).get("copay"):
            bits.append(f"copay: ${vr['coverage']['copay']}")
        bits.append(f"insurance_pending_admin: {bool(state.get('insurance_pending_admin'))}")
    elif scene == "handoff_admin_verification":
        # Combined apology + next-question scene. We pass the next missing
        # booking-field so the LLM can ask it in the same turn instead of
        # forcing a wasted "ok" round-trip.
        bits.append(f"payer: {ins.get('payer_name') or 'your insurance'}")
        next_booking = first_missing_booking(state)
        next_field_label = FIELD_PROMPTS.get(next_booking or "", next_booking or "")
        bits.append(f"next_field_to_ask: {next_booking or 'none'}")
        bits.append(f"next_field_label: {next_field_label}")
        bits.append(f"staff_picked: {bool(state.get('staff_id'))}")
        bits.append(f"slot_picked: {bool(state.get('selected_slot'))}")
    elif scene in ("confirm_cancel", "cancel_past_appointment", "post_reschedule"):
        # Prefer the lookup-sourced ISO time (_appt_time_iso) over the
        # in-session selected_slot displayPT (for cancel of a prior-session
        # appointment that has no selected_slot in state).
        # cancel_past_appointment reuses appt_time_friendly to name the
        # already-passed date plainly.
        appt_time_friendly = ""
        appt_time_iso = state.get("_appt_time_iso") or ""
        if appt_time_iso:
            try:
                from datetime import datetime
                from zoneinfo import ZoneInfo
                dt = datetime.fromisoformat(appt_time_iso.replace("Z", "+00:00"))
                dt_pt = dt.astimezone(ZoneInfo("America/Los_Angeles"))
                appt_time_friendly = dt_pt.strftime("%A, %B %-d at %-I:%M %p PT")
            except Exception:
                appt_time_friendly = appt_time_iso
        else:
            slot = state.get("selected_slot") or {}
            appt_time_friendly = slot.get("displayPT", "")
        bits.append(f"appt_time_friendly: {appt_time_friendly}")
        bits.append(f"therapist: {state.get('staff_name')}")
        # Reason-for-visit (post-DOB-verify, safe to read back) + whether the
        # caller is rescheduling vs. cancelling outright — drives the wording.
        bits.append(f"reason_for_visit: {state.get('_appt_service') or ''}")
        bits.append(f"is_reschedule: {bool(state.get('_wants_reschedule'))}")
        # email_sent drives whether post_reschedule may claim a confirmation
        # email is on its way — only True when the gateway actually enqueued it.
        bits.append(f"email_sent: {bool(state.get('_reschedule_email_sent'))}")
    elif scene == "post_cancel":
        # _was_reschedule is set on the cancel-success turn when the caller was
        # rescheduling — post_cancel then pivots to finding a new time with the
        # same therapist instead of a flat goodbye.
        bits.append(f"is_reschedule: {bool(state.get('_was_reschedule'))}")
        bits.append(f"therapist: {state.get('staff_name') or ''}")
        # email_sent drives whether post_cancel may claim a cancellation email
        # is on its way — only True when the gateway actually enqueued it.
        bits.append(f"email_sent: {bool(state.get('_cancel_email_sent'))}")
    elif scene == "post_verify_offer_booking":
        vr = state.get("verify_result") or {}
        bits.append(f"display_text: {vr.get('display_text')}")
    elif scene == "post_verify_continue_booking":
        vr = state.get("verify_result") or {}
        bits.append(f"display_text: {vr.get('display_text')}")
        next_booking = first_missing_booking(state)
        bits.append(f"field_to_ask: {next_booking}")
        bits.append(f"field_label: {FIELD_PROMPTS.get(next_booking or '', next_booking or '')}")
    elif scene == "resume_offer":
        bk = state.get("booking_fields") or {}
        first_name = (ins.get("first_name") or "").strip() or "there"
        payer = (ins.get("payer_name") or "").strip()
        bs = state.get("booking_status") or "none"
        # Non-PHI stage hint — no DOB, member ID, phone, email, address.
        if bs == "booked":
            stage = "You already have an appointment booked with us"
        elif bs in ("pending_confirm", "cancel_pending_confirm"):
            stage = "We were just confirming your appointment"
        elif state.get("selected_slot"):
            stage = "We were picking a time slot for your appointment"
        elif bk.get("phone") or bk.get("email") or bk.get("reason"):
            stage = "We were partway through your booking details"
        elif payer:
            stage = f"We have your {payer} info on file"
        elif ins.get("first_name"):
            stage = "We had a few details from earlier"
        else:
            stage = "We were chatting earlier"
        bits.append(f"saved_first_name: {first_name}")
        bits.append(f"saved_stage: {stage}")
    elif scene == "confirm_reuse_insurance":
        dob = (ins.get("dob_yyyymmdd") or "").strip()
        dob_pretty = ""
        if len(dob) == 8 and dob.isdigit():
            from datetime import date
            try:
                d = date(int(dob[:4]), int(dob[4:6]), int(dob[6:8]))
                dob_pretty = d.strftime("%B %-d, %Y")
            except ValueError:
                dob_pretty = ""
        bits.append(f"saved_first_name: {ins.get('first_name') or ''}")
        bits.append(f"saved_last_name: {ins.get('last_name') or ''}")
        bits.append(f"saved_dob_pretty: {dob_pretty}")
        bits.append(f"saved_payer_name: {ins.get('payer_name') or ''}")
    elif scene == "confirm_callback":
        bits.append(
            "callback_recap:\n"
            f"  name: {cb.get('first_name')} {cb.get('last_name')}\n"
            f"  phone: {cb.get('phone')}\n"
            f"  reason: {cb.get('reason')}"
        )
    elif scene == "info_answer":
        snippets = state.get("kb_snippets") or []
        bits.append("kb_snippets:")
        for s in snippets[:5]:
            bits.append(f"  - {s.get('title')}: {str(s.get('content', ''))[:300]}")
        # Non-PHI hint so the scene can offer to resume an in-progress booking
        # after answering (chat answers info questions mid-booking).
        bs = state.get("booking_status") or "none"
        if bs in ("collecting", "ready_for_slots", "slot_selected", "pending_confirm"):
            bits.append("booking_status: in_progress")
    elif scene == "post_booking_followup":
        slot = state.get("selected_slot") or {}
        bits.append(f"booked_slot: {slot.get('displayPT')}")
        bits.append(f"booked_therapist: {state.get('staff_name')}")
        snippets = state.get("kb_snippets") or []
        if snippets:
            bits.append("kb_snippets:")
            for s in snippets[:5]:
                bits.append(f"  - {s.get('title')}: {str(s.get('content', ''))[:300]}")
    return "\n".join(bits)


# ---------------------------------------------------------------------------
# Side-effects — flip pending_confirm where the scene implies it
# ---------------------------------------------------------------------------

def _apply_scene_side_effects(scene: str, state: State) -> dict[str, Any]:
    if scene == "confirm_booking":
        return {"booking_status": "pending_confirm"}
    if scene == "confirm_cancel":
        return {"booking_status": "cancel_pending_confirm"}
    if scene == "confirm_callback":
        return {"callback_status": "pending_confirm"}
    # Chat has no spoken consent step — the disclosure scene IS the
    # acknowledgement (the visitor sees the HIPAA notice in the transcript).
    # Flip the gate immediately so the next turn proceeds to greeting/intent.
    # For voice, extract.py flips the gate when recording_consent=True.
    if scene == "disclosure_prompt" and state.get("channel") == "chat":
        gates = dict(state.get("gates") or {})
        gates["disclosure_done"] = True
        return {"gates": gates}
    return {}


# ---------------------------------------------------------------------------
# Public entry — the node function
# ---------------------------------------------------------------------------

@traced(run_type="chain", name="respond")
def respond(state: State) -> dict[str, Any]:
    scene = _pick_scene(state)
    channel = state.get("channel", "chat")

    # HIPAA disclosure is load-bearing legal text — auditors look for the
    # exact phrase "HIPAA-compliant and saved to your patient record" in
    # transcript spot-checks. Serve the constant verbatim; never let the
    # LLM rephrase it.
    if scene == "disclosure_prompt":
        text = HIPAA_DISCLOSURE_VOICE if str(channel).startswith("voice") else HIPAA_DISCLOSURE_CHAT
        side_effects = _apply_scene_side_effects(scene, state)
        logger.info(
            "respond session=%s scene=disclosure_prompt verbatim chars=%d",
            state.get("session_id", "?"), len(text),
        )
        if state.get("channel") != "chat":
            _persist_turn_async(state, text)
        # The disclosure has now been DELIVERED — flip the gate so the
        # planner stops routing every subsequent turn back through
        # disclosure_prompt. The previous logic (extract.py) only flipped
        # the gate on explicit recording_consent, but Nevada is one-party
        # consent and our disclosure IS the announcement; the caller
        # never says "I consent" so without this the agent loops forever.
        gates = dict(state.get("gates") or {})
        gates["disclosure_done"] = True
        return {
            "messages": [AIMessage(content=text)],
            "last_reply_text": text,
            "scene": None,
            "_scene": scene,
            "gates": gates,
            **side_effects,
        }

    persona = persona_block(channel, scene=scene)
    scene_instr = SCENE_INSTRUCTIONS[scene]
    context = _context_for_scene(scene, state)

    # Field-template scenes need the field_label substituted in.
    if scene in {"ask_insurance_field", "ask_booking_field", "ask_callback_field", "post_verify_continue_booking"}:
        if scene == "ask_insurance_field":
            field = first_missing_insurance(state) or ""
        elif scene == "ask_callback_field":
            field = first_missing_callback(state) or ""
        else:
            field = first_missing_booking(state) or ""
        scene_instr = scene_instr.format(field_label=FIELD_PROMPTS.get(field, field))

    system = SystemMessage(content=f"{persona}\n\n# Scene: {scene}\n{scene_instr}")
    context_msg = HumanMessage(content=f"# Context\n{context}")

    try:
        reply = _get_responder().invoke([system, context_msg])
        text = (reply.content or "").strip() if hasattr(reply, "content") else str(reply)
    except Exception:
        logger.exception("respond_failed session=%s scene=%s", state.get("session_id", "?"), scene)
        text = (
            "I'm having trouble on my end — could you give me one moment, "
            "or call us directly at 725-238-6990?"
        )

    side_effects = _apply_scene_side_effects(scene, state)

    logger.info(
        "respond session=%s scene=%s chars=%d",
        state.get("session_id", "?"), scene, len(text),
    )

    # Persist the user turn + assistant turn to the gateway (DynamoDB,
    # HIPAA-safe). Fire-and-forget on a background thread so the request
    # latency stays on the LLM, not on the DB round-trip.
    # CHAT channel: the gateway's chat_stream handler already calls
    # recordTurn for the user message AND persistReply for the assistant
    # reply, so this would be a duplicate (admin transcript showed each
    # turn twice). VOICE channels don't go through the gateway streamer,
    # so we still need to persist from here.
    if state.get("channel") != "chat":
        _persist_turn_async(state, text)

    # Clear `scene` so the next turn re-derives from state — UNLESS this
    # session is terminal (a handoff already fired and locked the closing
    # scene). Terminal sessions intentionally keep the scene so the
    # planner's terminal_replay short-circuit can re-deliver the same
    # closing message without re-running the handoff node.
    is_terminal = bool((state.get("gates") or {}).get("terminal"))
    next_scene = scene if is_terminal else None

    return {
        "messages": [AIMessage(content=text)],
        "last_reply_text": text,
        "scene": next_scene,
        "_scene": scene,
        **side_effects,
    }


# ---------------------------------------------------------------------------
# Gateway persistence helpers — keep PHI off Postgres, on DynamoDB only.
# ---------------------------------------------------------------------------

def _post_turn(session_id: str, role: str, content: str) -> None:
    if not session_id or not content:
        return
    base = gateway_base_url()
    payload = json.dumps({
        "session_id": session_id, "role": role, "content": content,
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{base}/internal/chat/turn",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            if r.status >= 400:
                logger.warning("persist_turn_status session=%s role=%s status=%s",
                               session_id, role, r.status)
    except Exception:
        logger.exception("persist_turn_failed session=%s role=%s", session_id, role)


def _persist_turn_async(state, assistant_text: str) -> None:
    """Fire-and-forget: persist the last user turn + this assistant turn.

    We push BOTH per call because the legacy gateway expected the AI
    service to PUT each turn; the graph runs once per user message, so
    grouping the pair into one bg thread keeps things simple and durable.
    """
    session_id = state.get("session_id") or ""
    if not session_id or session_id == "anon":
        return
    user_text = state.get("last_user_text") or ""

    def _bg():
        if user_text:
            _post_turn(session_id, "user", user_text)
        _post_turn(session_id, "assistant", assistant_text)

    threading.Thread(target=_bg, daemon=True).start()

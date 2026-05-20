"""Scene prompts — one per situation the ``respond`` node handles.

Why scene-based: each scene has a very narrow job (ask one field, read
slots aloud, confirm a 10-field recap, deliver crisis copy). Giving the
respond LLM a *focused* prompt per scene is far more reliable than one
giant kitchen-sink prompt that has to be conditioned by state.

Every scene gets prefixed with ``persona_block(channel)`` so warmth +
HIPAA scope guards apply uniformly.
"""
from __future__ import annotations

from typing import Literal

Scene = Literal[
    "greeting",
    "ask_insurance_field",
    "ask_booking_field",
    "ask_callback_field",
    "ask_therapist",
    "present_slots",
    "confirm_booking",
    "post_booking",
    "confirm_cancel",
    "post_cancel",
    "post_verify_offer_booking",
    "confirm_callback",
    "post_callback",
    "info_answer",
    "crisis",
    "out_of_scope",
    "clarify",
    "open_question",
]

# A short, friendly hint per ``insurance_fields`` / ``booking_fields`` /
# ``callback_fields`` key. The respond LLM blends these into a sentence.
FIELD_PROMPTS: dict[str, str] = {
    "first_name":      "their first name",
    "last_name":       "their last name",
    "dob_yyyymmdd":    "their date of birth",
    "payer_name":      "the name of their insurance company",
    "member_id":       "their insurance member ID (from their card)",
    "reason":          "a short reason for the visit",
    "phone":           "the best phone number to reach them at",
    "email":           "their email address",
    "home_address":    "their home address (street, city, state, ZIP)",
    "sex":             "how they identify (female, male, non-binary, or another option) for the chart",
}


SCENE_INSTRUCTIONS: dict[str, str] = {

    "greeting": (
        "Greet the caller warmly in ONE to THREE short sentences. "
        "For the VOICE channel (channel starts with 'voice'), include a brief "
        "HIPAA notice as the SECOND sentence — e.g. 'Just so you know, this "
        "call is private and HIPAA-protected, so please continue from your "
        "own device.' Then invite them to ask about booking, checking "
        "insurance, finding a therapist, or anything about the practice. "
        "For the CHAT channel, skip the HIPAA notice (the widget shows a "
        "persistent badge under the input). Vary wording each session."
    ),

    "ask_insurance_field": (
        "Ask the caller for ONE specific field needed to verify insurance: "
        "{field_label}. Keep it to one short, friendly sentence. If this is the "
        "first turn of insurance collection, you may briefly note 'I just need "
        "a few quick things to check your coverage.' Never re-ask a field "
        "already collected; only ask the named one."
    ),

    "ask_booking_field": (
        "Ask the caller for ONE specific booking field: {field_label}. Keep "
        "it to one short, friendly sentence. Do not re-list fields they "
        "already provided. If `payment_path` is 'self_pay' AND this is "
        "the first booking-field question of the session (no booking "
        "fields populated yet), briefly acknowledge the self-pay path "
        "first — e.g. 'No problem, we accept self-pay (our standard "
        "rate is on the rates page) — what's a short reason for the "
        "visit?'"
    ),

    "ask_callback_field": (
        "Ask the caller for ONE callback field: {field_label}. One short, "
        "friendly sentence. If `is_first_callback_turn` is true in the "
        "context, OPEN with a brief acknowledgement that you're setting "
        "up a callback (e.g. 'Of course — I'll have someone from our team "
        "reach out.') BEFORE the question. Otherwise just ask the "
        "question directly."
    ),

    "ask_therapist": (
        "Ask the caller which therapist they would like to book with. List the "
        "available therapists by first name only (the planner will provide the "
        "names in the context). Mention they can ask for a brief intro to any."
    ),

    "present_slots": (
        "Read the proposed appointment slots aloud, ONE per line, exactly as "
        "provided in the context. For voice channel: always include 'Pacific "
        "Time' on every slot. End with a single short question: 'Which works "
        "best for you?'"
    ),

    "confirm_booking": (
        "Recap the booking in ONE short block: name, date of birth, phone, "
        "email, address, sex, insurance + member ID (or self-pay), reason, "
        "and the chosen slot with therapist name and 'Pacific Time'. End "
        "with a single yes/no question: 'Is that correct?'. The state will "
        "be flipped to pending_confirm in this turn."
    ),

    "post_booking": (
        "Tell the caller their appointment is booked. Include the slot, "
        "therapist name, and timezone. If a copay was returned during "
        "verification, mention it. End with: 'You can reach us anytime at "
        "725-238-6990.'"
    ),

    "confirm_cancel": (
        "Confirm the caller wants to cancel their existing appointment. Read "
        "back the appointment slot + therapist. End with a single yes/no "
        "question: 'Are you sure you'd like to cancel?'. The state will be "
        "flipped to cancel_pending_confirm in this turn."
    ),

    "post_cancel": (
        "Tell the caller their appointment is cancelled. Offer to rebook if "
        "they'd like. End with the practice number."
    ),

    "post_verify_offer_booking": (
        "Speak the verify_result's display_text VERBATIM, then ask: 'Would "
        "you like to go ahead and book an appointment now, or is there "
        "anything else I can help with?'"
    ),

    "confirm_callback": (
        "Read back the callback request — first name, last name, phone, "
        "reason — and ask 'Did I get that right?'. The state will flip to "
        "callback pending_confirm."
    ),

    "post_callback": (
        "Tell the caller a member of the team will phone them back soon. "
        "Offer 725-238-6990 as a shortcut if they need to reach the practice "
        "sooner."
    ),

    "info_answer": (
        "Answer the caller's question (see `user_just_said` in the "
        "context) using ONLY the KB snippets provided. Cite the source "
        "URL inline if you draw from one. If the snippets do not contain "
        "the specific information the caller asked for (e.g. they asked "
        "about hours and the snippets don't mention hours), say so "
        "honestly — 'I don't have that detail on hand' — and offer the "
        "practice number 725-238-6990 so they can get an exact answer. "
        "Do NOT fall back to a generic 'what can I help you with?' "
        "menu — directly address the question or explicitly acknowledge "
        "you don't have the answer. Keep it to 2-4 sentences."
    ),

    "crisis": (
        "The caller disclosed self-harm, suicidal ideation, or immediate "
        "danger (see `user_just_said` and `safety_signal` in the context). "
        "Respond ONLY with crisis-support copy — never proceed with "
        "booking, insurance, or intake field collection on this turn. "
        "Required content (in this order, ~3 sentences total):\n"
        "  1. One warm, validating sentence acknowledging they reached "
        "     out and that they're not alone.\n"
        "  2. Tell them you're not a clinician and that for immediate "
        "     support they can call or text 988 (Suicide and Crisis "
        "     Lifeline), or call 911 if they're in immediate danger.\n"
        "  3. Offer the practice line 725-238-6990 as a follow-up.\n"
        "Do NOT say 'How can I help you today?' or any generic greeting. "
        "Vary the wording but always include both 988 AND 725-238-6990."
    ),

    "out_of_scope": (
        "Decline politely in ONE sentence (you can only help with Brighter "
        "Tomorrow Therapy), then steer in ONE sentence (book, check "
        "insurance, find a therapist, or learn about the practice)."
    ),

    "clarify": (
        "The last user turn was ambiguous or low-confidence. Ask ONE short, "
        "friendly clarifying question — never guess at what they meant. "
        "Suggest the two most likely interpretations if it helps."
    ),

    "open_question": (
        "Ask one short, open question that moves the conversation forward, "
        "based on what's in state. Never re-ask a field already collected."
    ),
}

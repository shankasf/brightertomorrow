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

# THERAPIST_MATCH_FORM_URL import removed 2026-06-27: the inline [[MATCH_QUIZ]]
# widget replaced the JotForm link. The constant is kept in _constants.py in
# case other code imports it, but scenes no longer instruct agents to share it.

Scene = Literal[
    "greeting",
    # ----- Pre-classify gates (new) -----------------------------------------
    "disclosure_prompt",
    "ask_caller_relationship",
    "ask_dob_for_verify",
    "resume_offer_prompt",
    # ----- Field collection -------------------------------------------------
    "ask_insurance_field",
    "ask_booking_field",
    "ask_callback_field",
    "ask_therapist",
    "list_therapists",
    "matching_referral",
    # ----- Booking / cancel / callback --------------------------------------
    "present_slots",
    "no_availability",
    "confirm_booking",
    "post_booking",
    "ask_cancel_identifiers",
    "cancel_not_found",
    "cancel_past_appointment",
    "confirm_cancel",
    "post_cancel",
    "post_reschedule",
    "post_verify_offer_booking",
    "post_verify_continue_booking",
    "post_verify_declined",
    "confirm_callback",
    "post_callback",
    "info_answer",
    "crisis",
    "out_of_scope",
    "clarify",
    "open_question",
    "post_booking_followup",
    "ask_sms_consent",
    # ----- Handoffs (6) -----------------------------------------------------
    "handoff_roi_required",
    "handoff_mandatory_report",
    "handoff_crisis",
    "handoff_admin_with_note",
    "handoff_admin_verification",
    "handoff_admin_callback",
    # ----- Self-pay / coverage actions --------------------------------------
    "offer_self_pay",
    "confirm_self_pay_consent",
    "coverage_only_result",
    # ----- Missing-field follow-ups (generic + per-field) -------------------
    "missing_field_generic",
    "missing_field_name",
    "missing_field_dob",
    "missing_field_phone",
    "missing_field_email",
    "missing_field_payer",
    "missing_field_slot",
    "missing_field_modality",
    # ----- Booking lifecycle acks -------------------------------------------
    "booking_pending_ack",
    "booking_failed_retry",
    "send_ack_confirmation",
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

# Verbatim phrasings for fields whose wording the practice wants locked down
# (no LLM-blended empathy preambles, no rephrasing). When the field being asked
# in an ask_booking_field / ask_callback_field scene has an entry here, the
# responder is instructed to output this sentence EXACTLY. Channel-agnostic.
FIELD_VERBATIM: dict[str, str] = {
    "phone": (
        "Thank you for sharing that information. To further assist in "
        "connecting you with a therapist, what is the best phone number to "
        "reach you at?"
    ),
    "sex": (
        "Thanks — to further assist with establishing you as a client, we will "
        "need to know how do you identify: female, male, non-binary, or another "
        "option? This information is also needed when using your insurance."
    ),
}


SCENE_INSTRUCTIONS: dict[str, str] = {

    "greeting": (
        "Greet the caller warmly in ONE to THREE short sentences. "
        "NOTE: the HIPAA disclosure has already been delivered on turn 1 "
        "via the verbatim disclosure_prompt scene — do NOT repeat the "
        "HIPAA notice here. Invite the caller to ask about booking, "
        "checking insurance, finding a therapist, or anything about the "
        "practice. Vary wording each session."
    ),

    "ask_insurance_field": (
        "Ask the caller for ONE specific field: {field_label}. Keep it to one "
        "short, genuinely warm sentence — even on follow-up asks add a brief "
        "human touch (e.g. 'Thanks — ', 'Got it. ') so it never reads as a "
        "bare command. Never re-ask a field already collected; only "
        "ask the named one.\n"
        "Opener — applies ONLY when `is_first_insurance_turn` is true in the "
        "context (i.e. zero insurance fields collected so far). Otherwise, "
        "skip the opener and ask the field directly.\n"
        "  • intent=booking → open with a brief booking acknowledgement, "
        "    then ask the field. Example: 'Happy to help you book — I just "
        "    need a few quick things first. What's your first name?'\n"
        "  • intent=insurance_check → open with a brief coverage framing. "
        "    Example: 'Sure, let's check your coverage — a few quick things "
        "    first. What's your first name?'\n"
        "  • any other intent → ask the field directly, no opener.\n"
        "Never frame a booking flow as 'check your coverage' — the caller "
        "asked to book, not to verify insurance.\n"
        "Insurance picker — when `field_to_ask` is `payer_name` AND "
        "`channel` is `chat`, end your reply with the literal marker "
        "`[[INSURANCE_PICKER]]` on its own line. The chat widget detects "
        "it and renders an in-line dropdown of accepted plans so the "
        "visitor can click instead of typing. Keep the question above "
        "the marker brief ('Which insurance do you have?'). Do NOT emit "
        "the marker on voice channels or for any other field — it will "
        "leak into spoken output. Do NOT list the payers in text yourself."
    ),

    "ask_booking_field": (
        "Ask the caller for ONE specific booking field: {field_label}. Keep "
        "it to one short, genuinely warm sentence (a brief human lead-in even "
        "on follow-up asks; never a bare command). Do not re-list fields they "
        "already provided. If `payment_path` is 'self_pay' AND this is "
        "the first booking-field question of the session (no booking "
        "fields populated yet), briefly acknowledge the self-pay path "
        "first — e.g. 'No problem, we accept self-pay (our standard "
        "rate is on the rates page) — what's a short reason for the "
        "visit?'\n"
        "On the FIRST booking-field question of the session only (no booking "
        "fields populated yet), add ONE brief clause per the LOCATION POLICY "
        "so they know up front: they can book from any state, but need to be "
        "in Nevada for the visit (in person or video). Say it once — do not "
        "repeat it on later fields."
    ),

    "ask_callback_field": (
        "Ask the caller for ONE callback field: {field_label}. One short, "
        "genuinely warm sentence (a brief human touch even on follow-up asks; "
        "never a bare command). If `is_first_callback_turn` is true in the "
        "context, OPEN with a brief acknowledgement that you're setting "
        "up a callback (e.g. 'Of course — I'll have someone from our team "
        "reach out.') BEFORE the question. Otherwise just ask the "
        "question directly."
    ),

    "ask_therapist": (
        "Ask the caller which therapist they would like to book with. "
        "ONE short sentence — do NOT list the therapists by name in "
        "your reply (the widget renders the dropdown on chat; on voice "
        "the caller will say a name freely). Mention they can pick "
        "'Any therapist' for the soonest slot, or name a specific "
        "therapist if they have a preference.\n"
        "Therapist picker — when `channel` is `chat`, end your reply "
        "with the literal marker `[[THERAPIST_PICKER]]` on its own "
        "line. The chat widget detects it and renders an in-line "
        "dropdown of full names with 'Any therapist' at the top. Do "
        "NOT emit the marker on voice channels — it will leak into "
        "spoken output. Do NOT type the therapist list yourself."
    ),

    "list_therapists": (
        "The caller asked who our therapists are / which providers are "
        "available (see `user_just_said`). List the therapists by name "
        "from `available_therapists` in the context — every name, in a "
        "clean readable list. Keep it warm and brief: a one-line intro, "
        "the names, then ONE short offer that covers the two ways forward: "
        "(1) if they already have someone in mind, you'll book them right "
        "here; (2) if they're not sure who's the right fit, you can run a "
        "quick quiz to find their best match — output the literal marker "
        "`[[MATCH_QUIZ]]` on its own line at the END of your reply on chat "
        "channels (the widget renders the inline quiz; do NOT emit it on "
        "voice). Do NOT claim you will match them or pick a 'best fit' "
        "yourself, and do NOT invent specialties, credentials, or "
        "availability — you only have the names. If `booking_status` shows "
        "a booking is already in progress, list the names and then in ONE "
        "short clause offer to pick the booking back up."
    ),

    "matching_referral": (
        "The caller wants help choosing the right therapist (they asked "
        "who's 'best' for their needs, or said they're not sure who to see "
        "— see `user_just_said`). You do NOT match or recommend a "
        "clinician yourself. Instead:\n"
        "  CHAT channel: In ONE short, warm message (1) acknowledge what "
        "they're looking for; (2) let them know you have a quick quiz that "
        "will match them to the right fit; (3) output the literal marker "
        "`[[MATCH_QUIZ]]` on its own line at the very end — the widget "
        "renders the inline quiz steps and result cards. Do NOT output the "
        "marker on voice channels. Do NOT name or rank any clinician. Do "
        "NOT send an external URL. If they'd rather not use the quiz, offer "
        "to book with anyone they already have in mind, or go to "
        "/get-scheduled, or take a callback. Keep it to 2–3 sentences.\n"
        "  VOICE channel: this scene should not fire for voice — the "
        "realtime agent handles matching conversationally via the "
        "match_therapists tool without markers or links."
    ),

    "present_slots": (
        "Offer the proposed appointment slots from the context, in the order "
        "given. Use the dates/times EXACTLY as provided — never invent or "
        "round a slot.\n"
        "VOICE channel: read them ONE per line as a short spoken list, always "
        "including 'Pacific Time' on every slot, and end with 'Which works "
        "best for you?'\n"
        "CHAT channel (`channel: chat`): format as a NUMBERED Markdown list, "
        "one slot per line as `N. **<date and time>**` (bold the date/time). "
        "If `display_mode` is `single_therapist`, open with a short intro that "
        "names the therapist ONCE (e.g. \"Here's **<name>'s** availability:\") "
        "and do NOT repeat the name on each line. If `display_mode` is "
        "`any_therapist`, append the therapist's name to each slot line "
        "(\"— <name>\") and add ONE final line, after the list, letting them "
        "know they can name a specific therapist or ask to see the whole team. "
        "End with a short line telling them to reply with the number that "
        "works best."
    ),

    "no_availability": (
        "We checked the calendar and there are NO open appointment slots in "
        "the search window. Say so warmly and briefly. If `availability_for` "
        "names a specific therapist, say that therapist has no openings in "
        "the next couple of weeks and offer to check OTHER therapists or have "
        "the team reach out; otherwise say none of our therapists show "
        "openings in that window. Then give ONE clear next step: offer to "
        "have someone from the team call them back with more options, or "
        "share the practice number 725-238-6990. Do NOT invent slots, dates, "
        "or a waitlist. End with a single short question (e.g. 'Want me to "
        "have someone reach out?')."
    ),

    "confirm_booking": (
        "Recap the booking from `recap` in the context, then ask one yes/no "
        "question to confirm. Use the values exactly as given.\n"
        "VOICE channel: say it as ONE natural spoken sentence covering name, "
        "date of birth, phone, email, address, sex, insurance + member ID (or "
        "self-pay), reason, and the chosen slot with therapist name and "
        "'Pacific Time'; end with 'Is that correct?'.\n"
        "CHAT channel (`channel: chat`): render each detail on its OWN line as "
        "a Markdown bullet with a BOLD label — one bullet per detail, e.g.:\n"
        "  - **Name:** Jane Doe\n"
        "  - **Date of birth:** October 2, 1987\n"
        "  - **Phone:** ...\n"
        "  - **Email:** ...\n"
        "  - **Address:** ...\n"
        "  - **Sex:** ...\n"
        "  - **Insurance:** <payer> (member <id>)\n"
        "  - **Reason:** ...\n"
        "  - **Appointment:** <slot> Pacific Time\n"
        "  - **Therapist:** <name>\n"
        "Then a blank line and the question **Is that correct?**\n"
        "If `insurance_pending_admin` is True, add right after the Insurance "
        "bullet: 'pending admin verification — our team will confirm coverage "
        "shortly'. The state will be flipped to pending_confirm this turn."
    ),

    "post_booking": (
        "Tell the caller their appointment is booked. Include the slot, "
        "therapist name, and timezone. If a copay was returned during "
        "verification, mention it. If `insurance_pending_admin` is True, "
        "add ONE sentence: 'Our admin team will verify your insurance and "
        "follow up to confirm coverage details.' End with: 'You can reach "
        "us anytime at 725-238-6990.'"
    ),

    "ask_cancel_identifiers": (
        "We need to locate the caller's appointment before we can cancel it. "
        "In ONE concise, friendly sentence ask them for the phone number and "
        "date of birth associated with the appointment. Example: 'To find "
        "your appointment, could I get the phone number and date of birth "
        "we have on file?' Do not ask for anything else."
    ),

    "cancel_not_found": (
        "We were unable to find an upcoming appointment matching the details "
        "provided. In TWO short sentences: (1) let the caller know we "
        "couldn't find a matching appointment — do NOT say whether the phone "
        "number matched or not; (2) offer two next steps: they can double-"
        "check the details and try again, or leave a callback request and a "
        "team member will sort it out. Do NOT apologise excessively. Do NOT "
        "reveal any partial match information."
    ),

    "cancel_past_appointment": (
        "The caller is verified, but the appointment we found "
        "(`appt_time_friendly`) is in the PAST and cannot be cancelled. Be "
        "clear and brief, NO confusion, in TWO short sentences: (1) 'I'm "
        "sorry, but the appointment I found was on {appt_time_friendly}, which "
        "has already passed, so there's nothing to cancel.' (2) Offer to book "
        "a new appointment or help with anything else. Name the date plainly; "
        "do NOT imply a future appointment exists."
    ),

    "confirm_cancel": (
        "We found the caller's appointment and must confirm before changing "
        "it. First write ONE short lead-in line ('I found your appointment — "
        "here are the details:'). Then render a clean, readable recap as a "
        "markdown bullet list, ONE detail per line, using ONLY the context "
        "values — never invent or guess any field. Omit a line entirely if "
        "its value is empty:\n"
        "  - **Date & time:** {appt_time_friendly}\n"
        "  - **Therapist:** {therapist}\n"
        "  - **Reason for visit:** {reason_for_visit}\n"
        "Then ask a SINGLE yes/no question, choosing wording by "
        "`is_reschedule`:\n"
        "  - is_reschedule True  -> 'Would you like me to cancel this so we "
        "can find you a new time?'\n"
        "  - is_reschedule False -> 'Would you like me to cancel this "
        "appointment?'\n"
        "Keep it warm and concise. Do NOT add a phone number or extra "
        "paragraphs. The state will be flipped to cancel_pending_confirm in "
        "this turn."
    ),

    "post_cancel": (
        "The caller has just REQUESTED to cancel their appointment. Treat this "
        "as a REQUEST that the care team still needs to confirm — it is NOT yet "
        "a done deal. Branch on `is_reschedule`:\n"
        "  - is_reschedule True  -> pivot straight to rebooking: offer to find "
        "a new time"
        "{with the same therapist when `therapist` is non-empty}, and end with "
        "ONE question like 'What day or time works best for you?'\n"
        "  - is_reschedule False -> in ONE warm sentence tell them we've "
        "received their request to cancel and a member of our care team will "
        "confirm it shortly; then give the practice number 725-238-6990. Do "
        "NOT say the appointment 'is cancelled' / 'has been cancelled' as a "
        "completed fact — it is pending confirmation.\n"
        "ONLY if `email_sent` is True, add one short sentence telling them a "
        "confirmation email is on its way to their inbox; if `email_sent` is "
        "False, do NOT mention email at all.\n"
        "Keep that to 2-3 short sentences. Then append the cancellation policy "
        "as the final part of your reply, VERBATIM and keeping the markdown "
        "link exactly as written — first line: 'If you are no longer able to "
        "make this appointment, please visit your "
        "[My Account](https://brightertomorrow.janeapp.com/login) page to "
        "cancel.' then a blank line, then: 'Please note that cancellations "
        "within 48 hours of your appointment are subject to a cancellation "
        "fee.'\n"
        "Do NOT invent a new appointment time."
    ),

    "post_reschedule": (
        "The caller has just REQUESTED to reschedule to a new time. Treat this "
        "as a REQUEST that still needs the care team to confirm — it is NOT yet "
        "confirmed. In ONE warm sentence using ONLY the context values, tell "
        "them we've received their request to move their appointment to "
        "{appt_time_friendly} with {therapist} and that a member of our care "
        "team will confirm it shortly. If `therapist` is empty, drop the "
        "'with …' clause. For voice, include 'Pacific Time'. Do NOT say 'done', "
        "'all set', 'confirmed', 'booked', or 'you're scheduled' — it is "
        "pending confirmation. Then, ONLY if `email_sent` is True, add one "
        "short sentence telling them a confirmation email is on its way to "
        "their inbox; if `email_sent` is False, do NOT mention email at all. "
        "Then append the cancellation policy, VERBATIM and keeping the markdown "
        "link exactly as written — first line: 'If you are no longer able to "
        "make this appointment, please visit your "
        "[My Account](https://brightertomorrow.janeapp.com/login) page to "
        "cancel.' then a blank line, then: 'Please note that cancellations "
        "within 48 hours of your appointment are subject to a cancellation "
        "fee.' Then add ONE short closing offer ('Anything else I can help "
        "with? You can always reach us at 725-238-6990.'). Do NOT read back "
        "insurance or other intake, and do NOT ask them to confirm anything "
        "again."
    ),

    "post_verify_offer_booking": (
        "Speak the verify_result's display_text VERBATIM, then ask: 'Would "
        "you like to go ahead and book an appointment now, or is there "
        "anything else I can help with?'"
    ),

    "post_verify_continue_booking": (
        "The caller's insurance just verified as eligible AND they are "
        "already in a booking flow. Reply with TWO things in ONE smooth "
        "message (2 sentences, no more):\n"
        "1) FIRST sentence — speak the verify_result's `display_text` "
        "VERBATIM so the caller hears their coverage was confirmed.\n"
        "2) SECOND sentence — keep the booking moving by asking for ONE "
        "next field: {field_label}. Use a natural connector like 'Now, "
        "to keep going,' or 'Next,'.\n"
        "Do NOT ask 'would you like to book now?' — they are already "
        "booking. Do NOT re-list fields already collected."
    ),

    "post_verify_declined": (
        "The caller just said NO to booking after a successful coverage "
        "check. In ONE warm sentence: acknowledge ('Got it — glad I "
        "could help confirm your coverage.') and gently offer the door "
        "for anything else ('Let me know if you'd like to book later "
        "or have other questions — you can always reach us at "
        "725-238-6990.'). Do NOT re-pitch booking. Do NOT repeat the "
        "coverage result. Do NOT ask 'would you like to book now?' "
        "again."
    ),

    "resume_offer": (
        "The widget just reopened with prior session state on file. Greet "
        "the caller by their saved first name in a warm, polite, "
        "human-sounding way — DO NOT dump their PHI in this message. Then "
        "ask whether they'd like to pick up where they left off or start a "
        "fresh chat. Use the context fields `saved_first_name` and "
        "`saved_stage` (a short, non-PHI hint like 'partway through your "
        "booking', 'with insurance details on file', or 'we had a few "
        "things from earlier') to make the question specific without "
        "exposing personal data.\n"
        "Tone — warm and unhurried, not transactional. Two short sentences "
        "max. Example shape (vary the wording each time so it doesn't "
        "sound canned):\n"
        "  • 'Hey {saved_first_name}, welcome back — hope you're doing "
        "    well. {saved_stage}. Want to keep going with that, or would "
        "    you rather start a fresh chat? (Not {saved_first_name}? Just "
        "    say \"start fresh\" and we\\'ll begin again.)'\n"
        "Wait for their yes/no/\"start fresh\" — don't volunteer any other "
        "action. Never read back the date of birth, member ID, phone, "
        "email, or address."
    ),

    "confirm_reuse_insurance": (
        "The caller asked us to check coverage, and we already have a full "
        "set of insurance fields on file from earlier (likely a prior "
        "session). Eligibility can expire, so we will re-verify with the "
        "insurer once they confirm. Use the values from the context "
        "(`saved_first_name`, `saved_last_name`, `saved_dob_pretty`, "
        "`saved_payer_name`) to ask in ONE short sentence whether to "
        "re-check with that plan or use a different one. Example: "
        "'We have {saved_payer_name} on file for {saved_first_name} "
        "{saved_last_name}, date of birth {saved_dob_pretty} — should I "
        "re-check with that plan, or has anything changed?' Wait for "
        "their yes/no — don't volunteer any other action."
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
        "context) directly using ONLY the KB snippets provided — but with "
        "genuine warmth, not a dry fact dump. Open with a brief human touch "
        "('Great question!', 'Of course —', 'Happy to help with that —') and "
        "keep a kind, welcoming tone throughout; a short friendly close like "
        "'Anything else I can help you with?' is welcome. NEVER include URLs, links, or 'see our "
        "website / page X' phrasing — the snippets are the source of "
        "truth; the caller does not need or want a URL. If the snippets "
        "do not contain the specific information the caller asked for "
        "(e.g. they asked about hours and the snippets don't mention "
        "hours), say so honestly — 'I don't have that detail on hand' — "
        "and offer the practice number 725-238-6990 so they can get an "
        "exact answer. Do NOT fall back to a generic 'what can I help "
        "you with?' menu — directly address the question or explicitly "
        "acknowledge you don't have the answer. Keep it to 2-4 sentences. "
        "If `booking_status` shows a booking is already in progress, answer "
        "the question and then in ONE short clause offer to pick the booking "
        "back up (e.g. '…want to keep going with your appointment?') so the "
        "caller isn't stranded — do NOT restart intake from scratch."
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
        "Decline warmly and graciously — never a curt 'I can only help with…'. "
        "In ONE friendly sentence, say you're not able to help with that but "
        "you'd genuinely love to help with their care, then in ONE sentence "
        "warmly steer to what you CAN do (book, check insurance, find a "
        "therapist, or learn about the practice). Sound human and kind, not "
        "like a wall."
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

    "post_booking_followup": (
        "The caller's appointment is ALREADY booked and confirmation has "
        "been sent — intake is complete. They've now said something else "
        "(see `user_just_said`). Reply warmly and naturally in 1-2 "
        "sentences. If it's a thank-you or sign-off, acknowledge it kindly "
        "and let them know they can ask anything else or reach the office "
        "at 725-238-6990. If they ask a question you can answer from the KB "
        "snippets in context, answer it directly; otherwise offer the "
        "office number for specifics. NEVER read back the appointment "
        "details again, NEVER ask them to confirm anything, and NEVER "
        "re-collect a field — the booking is done."
    ),

    # =====================================================================
    # PRE-CLASSIFY GATES — these scenes run BEFORE intent classification.
    # =====================================================================

    "disclosure_prompt": (
        "This is the FIRST AI turn of the session. Deliver the welcome + "
        "HIPAA disclosure VERBATIM from the context block (`disclosure_text`) "
        "— do NOT paraphrase, do NOT add filler before or after, do NOT add "
        "extra questions. The text already contains the closing 'How can I "
        "help you today?'. For voice channels, speak naturally with a calm "
        "pace; do NOT add 'um' or 'so' filler. Stop speaking immediately "
        "after the closing question."
    ),

    "ask_caller_relationship": (
        "We need to know who is calling on whose behalf — self, a parent "
        "for a minor child, a guardian with a signed Release of Information, "
        "or a third party for another adult. Ask in ONE friendly sentence: "
        "'Are you booking for yourself, or for someone else?'. Do not list "
        "all four buckets unless the caller asks for clarification."
    ),

    "ask_dob_for_verify": (
        "We may already have a record for this caller. Ask for their date "
        "of birth so we can pull up their file: 'To pull up your record, "
        "could I get your date of birth?'. For voice, ask them to say the "
        "month, day, and year. Do NOT mention 'returning patient' or 'we "
        "may already have you' — that's a HIPAA leak before identity is "
        "confirmed. Just ask the DOB plainly."
    ),

    "resume_offer_prompt": (
        "The caller is a returning patient and we've verified their DOB. "
        "The context block contains `resume_summary` — a short, NON-PHI "
        "one-line summary of what they were doing last time (e.g. 'last "
        "time we were checking your insurance'). Open with that summary, "
        "then ask in one short sentence: 'Would you like to pick up where "
        "we left off, or start fresh?'. Wait for an answer — do not assume. "
        "Never read back medical detail, diagnoses, or appointment specifics."
    ),

    # =====================================================================
    # HANDOFFS — every handoff scene must obey feedback_silent_handoff:
    # never say 'transferring', 'handing over', 'booking specialist'.
    # Phrase the next step as the action itself, not the routing.
    # =====================================================================

    "handoff_roi_required": (
        "The caller is a guardian / third party acting on behalf of "
        "another adult. We need a signed Release of Information before "
        "we can share or schedule. TWO sentences maximum: (1) briefly "
        "acknowledge and say we need a signed release on file; "
        "(2) tell them a team member will reach out within one business "
        "day with the form. No extra clauses or empathy elaborations — "
        "keep it tight. Do NOT use the word 'transfer'. Keep tone warm."
    ),

    "handoff_mandatory_report": (
        "The caller disclosed something that may require a mandatory "
        "report (abuse of a minor, elder abuse, vulnerable adult). DO "
        "NOT tell them you're filing a report. DO NOT use the words "
        "'mandatory report' or 'CPS' or 'authorities'. Respond ONLY "
        "with: (1) one warm validating sentence; (2) reassurance that "
        "a licensed clinician will be in touch within one business day; "
        "(3) the practice line 725-238-6990 and 988 if they need "
        "support right now. Stop. Do NOT collect more fields on this "
        "turn — the clinician will take it from here."
    ),

    "handoff_crisis": (
        "The caller is in active crisis but the situation needs an "
        "immediate live clinician callback in addition to crisis "
        "resources. Identical content shape to `crisis` scene — 988 + "
        "911 + practice line — PLUS one sentence: 'a clinician from "
        "our team will call you back within the hour'. Do NOT use the "
        "word 'transfer'. Do NOT ask for more fields on this turn."
    ),

    "handoff_admin_with_note": (
        "The caller's request needs a human teammate to follow up "
        "(billing question, complex insurance edge case, request not in "
        "the AI's scope). In two short sentences: (1) acknowledge the "
        "specific thing they asked about; (2) tell them a member of our "
        "team will reach out within 24 hours with the answer. Offer "
        "725-238-6990 as a faster path if it's urgent. NEVER say "
        "'transferring' or 'booking specialist' — phrase it as the team "
        "outreach itself."
    ),

    "handoff_admin_verification": (
        "Insurance verification came back as `needs_manual_review` — the "
        "carrier didn't respond cleanly. The booking flow continues; "
        "admin will finish verification asynchronously. Open with a one-"
        "sentence apology that names the payer: \"I'm sorry — I'm "
        "unable to verify your {payer} coverage right now; our admin "
        "team will follow up to finish verifying it.\" Then in the SAME "
        "message ask the next thing we need to keep the booking moving: "
        "if `next_field_to_ask` is not `none`, ask `next_field_label` "
        "in one short sentence; else if `staff_picked` is False, ask "
        "which therapist they'd like; else if `slot_picked` is False, "
        "ask what day/time works best. Do NOT offer self-pay. Do NOT "
        "ask for more insurance details. Do NOT use 'transfer'."
    ),

    "handoff_admin_callback": (
        "The caller explicitly asked to talk to a human, real person, or "
        "live agent. Per the routing rule, we do NOT re-offer the book/"
        "insurance/info menu — we collect a callback. In ONE short "
        "sentence acknowledge ('Of course — I'll have someone from our "
        "team call you back.') and then ask for their first name to "
        "start. Stop. The callback collection flow takes over from "
        "here. NEVER say 'transferring you' — the callback collection "
        "IS the handoff."
    ),

    # =====================================================================
    # SELF-PAY / COVERAGE ACTIONS
    # =====================================================================

    "offer_self_pay": (
        "The caller doesn't have insurance, said their plan isn't "
        "covered, or asked about cash pay. In two short sentences: "
        "(1) acknowledge ('No problem — we accept self-pay clients.'); "
        "(2) tell them our standard rate is on the rates page and ask "
        "if they'd like to proceed on a self-pay basis. Wait for an "
        "explicit yes before flipping `payment_path` (the planner "
        "handles the flip on the next turn).\n"
        "If the context includes `declined_plan` (e.g. Medicaid), FIRST "
        "say plainly and warmly that we're not able to accept that plan "
        "at this time — do NOT promise to verify it or follow up on it — "
        "and THEN make the self-pay offer above. Never imply the declined "
        "plan might still be covered."
    ),

    "confirm_self_pay_consent": (
        "The caller said yes to self-pay. Confirm in ONE sentence: "
        "'Great — I've got you down for self-pay.' Then move directly "
        "to the next missing booking field (the planner will route). "
        "Do not re-explain pricing here."
    ),

    "coverage_only_result": (
        "The caller asked an INSURANCE-CHECK question (not a booking). "
        "Verification has run and `display_text` is in the context. "
        "Read `display_text` VERBATIM, then end with ONE short follow-up: "
        "'Anything else I can help with — booking, finding a therapist, "
        "or more questions about coverage?'. Do not push them to book "
        "if they only asked to check coverage."
    ),

    # =====================================================================
    # MISSING-FIELD FOLLOW-UPS — caller skipped or mumbled a field.
    # Distinct from `ask_*_field` (which is the first ask). These run when
    # the caller responded to the first ask but the extracted value was
    # empty, low-confidence, or invalid.
    # =====================================================================

    "missing_field_generic": (
        "The caller's last reply didn't contain the field we needed "
        "(see `field_to_ask` and `last_user_text` in the context). In "
        "one warm sentence, acknowledge briefly ('Sorry, I missed that') "
        "and re-ask the same field clearly. Do NOT lecture about why "
        "we need the field. Do NOT switch to a different field."
    ),

    "missing_field_name": (
        "We couldn't catch the caller's name. For voice channel, ask "
        "them to spell it: 'Could you spell your first name for me, "
        "letter by letter?'. For chat, just re-ask: 'Could you type "
        "your first name?'. Read back per VOICE_CONFIRMATION_RULE on "
        "the next turn."
    ),

    "missing_field_dob": (
        "We couldn't catch the date of birth. Ask once more, simply: "
        "'Could you give me your date of birth — the month, day, and "
        "year?'. Do NOT propose MM/DD vs DD/MM (we always echo back "
        "in plain English: 'Month Day, Year'). If they refuse, do "
        "not press — flip to handoff_admin_with_note."
    ),

    "missing_field_phone": (
        "We need a valid phone number and didn't get one. Re-ask in "
        "one sentence and ask them to read each digit: 'Could you "
        "give me a phone number where we can reach you — go ahead "
        "and read it one digit at a time?'."
    ),

    "missing_field_email": (
        "We need a valid email. For voice: 'Could you spell your "
        "email for me, one letter at a time, and the domain too?'. "
        "For chat: 'Could you share your email address?'. Read back "
        "per VOICE_CONFIRMATION_RULE on the next turn."
    ),

    "missing_field_payer": (
        "We didn't catch the insurance company. In one sentence: "
        "'Sorry, could you tell me which insurance you have? You can "
        "say the full name on the front of your card.' Do not guess "
        "from partial audio."
    ),

    "missing_field_slot": (
        "The caller's slot pick was ambiguous (they said 'morning' "
        "without picking one of the offered times, or asked about a "
        "slot we didn't propose). Re-list the offered slots ONE per "
        "line — Pacific Time on every line for voice — and end with "
        "'Which of those works best?'."
    ),

    "missing_field_modality": (
        "We need to know if they want in-person or telehealth. Ask "
        "in ONE short sentence: 'Would you like to come in to the "
        "Las Vegas office, or do telehealth?'. Do not pre-select."
    ),

    # =====================================================================
    # BOOKING LIFECYCLE ACKS
    # =====================================================================

    "booking_pending_ack": (
        "The caller has confirmed the booking recap and we are now "
        "calling Jane to book. Speak ONE short filler sentence so "
        "the line isn't silent: 'Booking that for you now — one "
        "moment.'. Stop. The post_booking scene will run after the "
        "tool returns."
    ),

    "booking_failed_retry": (
        "Jane returned an error trying to book (see `_booking_error` "
        "in the context). In two short sentences: (1) apologize "
        "briefly ('Sorry — that slot just got taken'); (2) offer to "
        "try a different time. Do NOT expose the raw error code. Do "
        "NOT promise anything you can't deliver. If the error is a "
        "persistent system fault, offer 725-238-6990 instead."
    ),

    "send_ack_confirmation": (
        "Tell the caller their appointment request has been saved and "
        "our care team will follow up to confirm. In the SAME short "
        "reply, let them know a confirmation email is on its way to "
        "{email} (only mention the email if {email} is present). "
        "Do NOT mention or promise a text/SMS in this message — a "
        "separate opt-in question comes next. End with the practice "
        "line 725-238-6990."
    ),
    "ask_sms_consent": (
        "The appointment is booked. Ask the caller ONE short, friendly "
        "yes/no question: would they like to get appointment reminders "
        "and occasional practice updates by text at the phone number we "
        "have on file? Make clear it's optional, they can reply STOP "
        "anytime, texts are infrequent (about twice a month), and "
        "message & data rates may apply. Keep it to one or two sentences. "
        "Do NOT re-read the booking details and do NOT read the phone "
        "number aloud."
    ),
}

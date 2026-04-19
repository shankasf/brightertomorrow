"""Realtime voice agent graph — mirrors the text triage graph using RealtimeAgent."""
from __future__ import annotations

import os

from agents.realtime import (
    RealtimeAgent,
    RealtimeModelConfig,
    RealtimeRunConfig,
    RealtimeSessionModelSettings,
    realtime_handoff,
)

from ..prompts import CRISIS_RULE, PRACTICE_CONTEXT, STYLE_VOICE
from ..tools import INFO_TOOLS, INTAKE_TOOLS, MATCHING_TOOLS


def build_realtime_triage() -> RealtimeAgent:
    """Build the realtime voice agent tree with Triage as the entry point."""

    crisis = RealtimeAgent(
        name="Crisis Support",
        handoff_description="Safety concerns, self-harm, or crisis.",
        instructions=(
            f"{PRACTICE_CONTEXT}\n\n"
            f"{STYLE_VOICE}\n\n"
            f"{CRISIS_RULE}\n\n"
            "Warmly acknowledge the caller, direct them immediately to 988 (call or text) "
            "or 911 for immediate danger. State clearly you are not a therapist. "
            "Keep response under 3 sentences."
        ),
    )

    info = RealtimeAgent(
        name="Info Agent",
        handoff_description="Practice info, services, hours, FAQs.",
        tools=INFO_TOOLS,
        instructions=(
            f"{PRACTICE_CONTEXT}\n\n"
            f"{STYLE_VOICE}\n\n"
            f"{CRISIS_RULE}\n\n"
            "Answer questions about services, specialties, locations, hours, and FAQs. "
            "Use kb_search for open-ended questions; use structured tools for canonical facts. "
            "Cite source URLs when you use kb_search results. Speak in complete, natural sentences."
        ),
    )

    matching = RealtimeAgent(
        name="Therapist Matching",
        handoff_description="Match visitor to a therapist by specialty or location.",
        tools=MATCHING_TOOLS,
        instructions=(
            f"{PRACTICE_CONTEXT}\n\n"
            f"{STYLE_VOICE}\n\n"
            f"{CRISIS_RULE}\n\n"
            "Help the caller find the right therapist. Call list_team_members first. "
            "Filter to therapists who accept new clients. If they mention a specialty, "
            "call list_specialties to confirm the canonical name. Speak naturally — "
            "no lists, just describe the best match in 2–3 sentences."
        ),
    )

    intake = RealtimeAgent(
        name="Intake Agent",
        handoff_description="Collect contact info and submit a callback request.",
        tools=INTAKE_TOOLS,
        instructions=(
            f"{PRACTICE_CONTEXT}\n\n"
            f"{STYLE_VOICE}\n\n"
            f"{CRISIS_RULE}\n\n"
            "Collect full name, email, phone, and reason one at a time. "
            "Once you have all four, call request_intake_callback immediately. "
            "Confirm warmly that someone will be in touch soon."
        ),
    )

    triage = RealtimeAgent(
        name="Triage",
        handoff_description="Main entry point — routes caller to the right specialist.",
        instructions=(
            f"{PRACTICE_CONTEXT}\n\n"
            f"{STYLE_VOICE}\n\n"
            f"{CRISIS_RULE}\n\n"
            "PRIORITY 1 — CRISIS: If the caller mentions suicide, self-harm, wanting to die, "
            "hurting themselves or others, or any immediate safety concern, transfer to "
            "Crisis Support IMMEDIATELY before saying anything else.\n\n"
            "All other routing: "
            "booking or callback → Intake Agent; therapist match → Therapist Matching; "
            "info about services/hours/FAQs → Info Agent. "
            "Ask one short clarifying question if the intent is unclear."
        ),
        handoffs=[
            realtime_handoff(crisis),
            realtime_handoff(info),
            realtime_handoff(matching),
            realtime_handoff(intake),
        ],
    )

    return triage


def build_realtime_run_config() -> RealtimeRunConfig:
    """Return a RealtimeRunConfig pre-configured for PCM16 audio with server VAD."""
    realtime_model = os.environ.get("REALTIME_MODEL")
    return RealtimeRunConfig(
        model_config=RealtimeModelConfig(
            initial_model_settings=RealtimeSessionModelSettings(
                model_name=realtime_model,
                voice="alloy",
                modalities=["text", "audio"],
                input_audio_format="pcm16",
                output_audio_format="pcm16",
                input_audio_transcription={"model": "whisper-1"},
                turn_detection={
                    "type": "server_vad",
                    "threshold": 0.5,
                    "prefix_padding_ms": 300,
                    "silence_duration_ms": 500,
                },
            )
        )
    )

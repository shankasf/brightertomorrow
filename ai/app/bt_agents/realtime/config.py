"""Realtime model / voice / transcription configuration.

Pinned to OpenAI Realtime API (May 2026): ``gpt-realtime-2`` with
``gpt-4o-mini-transcribe`` for input transcription. Override via env:
``REALTIME_MODEL``, ``REALTIME_TRANSCRIPTION_MODEL``, ``REALTIME_VOICE``.
"""
from __future__ import annotations

import os

from agents.realtime import RealtimeRunConfig, RealtimeSessionModelSettings

DEFAULT_REALTIME_MODEL = "gpt-realtime-2"
DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe"
DEFAULT_REALTIME_VOICE = "marin"
DEFAULT_TRANSCRIPTION_LANGUAGE = "en"
DEFAULT_TRANSCRIPTION_PROMPT = (
    "English-only phone call into Brighter Tomorrow Therapy, a US therapy practice. "
    "The caller is giving intake details: their reason for visit, full name, email, "
    "phone number, date of birth, insurance company (e.g. UnitedHealthcare, Aetna, "
    "Cigna, Humana, Blue Cross Blue Shield, Anthem, Kaiser, Medicare, Medicaid, "
    "Tricare), and insurance member ID. Ignore background noise, keyboard typing, "
    "music, unrelated speech, and non-English audio. If nothing is said, return empty."
)


def realtime_model_name() -> str:
    return os.environ.get("REALTIME_MODEL") or DEFAULT_REALTIME_MODEL


def realtime_transcription_model_name() -> str:
    return os.environ.get("REALTIME_TRANSCRIPTION_MODEL") or DEFAULT_TRANSCRIPTION_MODEL


def realtime_voice_name() -> str:
    return os.environ.get("REALTIME_VOICE") or DEFAULT_REALTIME_VOICE


def build_model_settings() -> RealtimeSessionModelSettings:
    """PCM16 in/out, semantic VAD, gpt-4o-mini-transcribe input transcription."""
    return {
        "model_name": realtime_model_name(),
        "modalities": ["audio"],
        "voice": realtime_voice_name(),
        "input_audio_format": "pcm16",
        "output_audio_format": "pcm16",
        "input_audio_transcription": {
            "model": realtime_transcription_model_name(),
            "language": DEFAULT_TRANSCRIPTION_LANGUAGE,
            "prompt": DEFAULT_TRANSCRIPTION_PROMPT,
        },
        "input_audio_noise_reduction": {"type": "near_field"},
        "turn_detection": {
            "type": "semantic_vad",
            "eagerness": "low",
            "create_response": True,
            "interrupt_response": True,
        },
        "tool_choice": "auto",
    }


def build_realtime_run_config() -> RealtimeRunConfig:
    """RealtimeRunConfig (TypedDict) for RealtimeRunner."""
    return {"model_settings": build_model_settings()}

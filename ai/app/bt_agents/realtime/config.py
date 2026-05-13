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
# OpenAI now pins this project to the US regional Realtime endpoint; the
# global `api.openai.com` host closes the WS with `incorrect_hostname`.
# Override via REALTIME_BASE_URL only if OpenAI moves the project.
DEFAULT_REALTIME_BASE_URL = "wss://us.api.openai.com/v1/realtime"
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


def realtime_ws_url() -> str:
    base = (os.environ.get("REALTIME_BASE_URL") or DEFAULT_REALTIME_BASE_URL).rstrip("?")
    return f"{base}?model={realtime_model_name()}"


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


def build_telephony_model_settings() -> RealtimeSessionModelSettings:
    """g711_ulaw in/out for Twilio Media Streams — no resampling on either end.

    Differences from the browser-mic config:
      * mulaw both directions (Twilio's wire format → no PCM conversion)
      * far-field denoiser instead of near-field (caller mic is usually a phone
        speaker in a noisy room, not a headset)
      * VAD eagerness=medium so the model reacts to short narrowband utterances
        (e.g. one-syllable "yes") that low eagerness misses on PSTN audio
    """
    settings = build_model_settings()
    settings["input_audio_format"] = "g711_ulaw"
    settings["output_audio_format"] = "g711_ulaw"
    settings["input_audio_noise_reduction"] = {"type": "far_field"}
    settings["turn_detection"] = {
        "type": "semantic_vad",
        "eagerness": "medium",
        "create_response": True,
        "interrupt_response": True,
    }
    return settings


def build_telephony_run_config() -> RealtimeRunConfig:
    """RealtimeRunConfig for the Twilio bridge (POTS-grade audio)."""
    return {"model_settings": build_telephony_model_settings()}

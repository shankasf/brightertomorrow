"""Realtime voice — single unified agent (no handoffs).

``triage.py`` builds ONE RealtimeAgent (all tools, phased intake prompt,
crisis as a top-priority inline rule); ``config.py`` holds model/voice/
tracing config. ``build_realtime_triage`` is kept as the public name so the
transports (voice.py / twilio_voice.py) need no change.
"""
from __future__ import annotations

from .config import (
    DEFAULT_REALTIME_MODEL,
    DEFAULT_REALTIME_VOICE,
    DEFAULT_TRANSCRIPTION_MODEL,
    TRANSCRIPTION_LOGPROB_INCLUDE,
    build_model_settings,
    build_realtime_run_config,
    build_telephony_model_settings,
    build_telephony_run_config,
    low_confidence_logprob_threshold,
    realtime_model_name,
    realtime_transcription_model_name,
    realtime_voice_name,
    realtime_ws_url,
    tracing_config,
)
from .triage import build_realtime_triage

__all__ = [
    "DEFAULT_REALTIME_MODEL",
    "DEFAULT_REALTIME_VOICE",
    "DEFAULT_TRANSCRIPTION_MODEL",
    "TRANSCRIPTION_LOGPROB_INCLUDE",
    "build_model_settings",
    "build_realtime_run_config",
    "build_realtime_triage",
    "build_telephony_model_settings",
    "build_telephony_run_config",
    "low_confidence_logprob_threshold",
    "realtime_model_name",
    "realtime_transcription_model_name",
    "realtime_voice_name",
    "realtime_ws_url",
    "tracing_config",
]

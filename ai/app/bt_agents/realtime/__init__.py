"""Realtime voice agent graph — one file per RealtimeAgent, head agent owns handoffs.

Mirrors the text triage layout in ``bt_agents/`` so the two graphs stay aligned:

  text triage  → ``bt_agents/triage_agent.py``  (handoffs to specialist files)
  voice triage → ``bt_agents/realtime/triage.py`` (handoffs to specialist files)
"""
from __future__ import annotations

from .config import (
    DEFAULT_REALTIME_MODEL,
    DEFAULT_REALTIME_VOICE,
    DEFAULT_TRANSCRIPTION_MODEL,
    build_model_settings,
    build_realtime_run_config,
    realtime_model_name,
    realtime_transcription_model_name,
    realtime_voice_name,
)
from .triage import build_realtime_triage

__all__ = [
    "DEFAULT_REALTIME_MODEL",
    "DEFAULT_REALTIME_VOICE",
    "DEFAULT_TRANSCRIPTION_MODEL",
    "build_model_settings",
    "build_realtime_run_config",
    "build_realtime_triage",
    "realtime_model_name",
    "realtime_transcription_model_name",
    "realtime_voice_name",
]

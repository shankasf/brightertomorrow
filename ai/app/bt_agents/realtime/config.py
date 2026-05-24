"""Realtime model / voice / transcription configuration.

Pinned to OpenAI Realtime API (May 2026): ``gpt-realtime-2`` with
``gpt-4o-mini-transcribe`` for input transcription. Override via env:
``REALTIME_MODEL``, ``REALTIME_TRANSCRIPTION_MODEL``, ``REALTIME_VOICE``.
"""
from __future__ import annotations

import os

from agents.realtime import RealtimeRunConfig, RealtimeSessionModelSettings

DEFAULT_REALTIME_MODEL = "gpt-realtime-2"
# Pin to the 2025-12-15 snapshot — OpenAI's own benchmarks show ~70-90%
# fewer hallucinations on silence/noise vs. the prior snapshot. The floating
# `gpt-4o-mini-transcribe` slug already resolves here today, but pinning is
# what protects us from future drift (whisper-style prompt echoes on PSTN
# silence are still the dominant failure mode for this model family).
DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe-2025-12-15"
DEFAULT_REALTIME_VOICE = "marin"
# Global Realtime endpoint. The project is NO LONGER region-pinned (confirmed
# 2026-05-23) — the old `us.api.openai.com` host now closes the WS with
# `invalid_request_error.incorrect_hostname`, while the global host accepts it.
# Override via REALTIME_BASE_URL only if OpenAI re-pins the project to a region.
DEFAULT_REALTIME_BASE_URL = "wss://api.openai.com/v1/realtime"
DEFAULT_TRANSCRIPTION_LANGUAGE = "en"
# DELIBERATELY EMPTY. The `prompt` field on input_audio_transcription is a
# vocabulary/style hint for the whisper-family decoder — it is NOT an
# instruction channel. On silence/noise the decoder echoes long prompts
# back verbatim as the "user said …" transcript, which then drives the
# Triage agent into bogus crisis handoffs (call CA8bc6a40c…, 2026-05-15).
# language="en" alone handles language steering. If a future need arises
# for a real prompt, keep it ≤5 words of vocabulary keywords only — never
# meta-instructions like "ignore noise" or "return empty".
DEFAULT_TRANSCRIPTION_PROMPT = ""

# Logprob-based confidence filter. Real speech on PSTN typically averages
# logprob ≥ −0.5 per token; whisper-style hallucinations on silence/noise
# average below −1.0. We drop the turn before it reaches Triage. Tuned
# conservatively — better to ask the caller to repeat than to act on a
# hallucinated transcript. Override via env if tuning shows drift.
TRANSCRIPTION_LOGPROB_INCLUDE: tuple[str, ...] = (
    "item.input_audio_transcription.logprobs",
)
DEFAULT_LOW_CONFIDENCE_LOGPROB_THRESHOLD = -1.0


def low_confidence_logprob_threshold() -> float:
    raw = os.environ.get("REALTIME_LOW_CONFIDENCE_LOGPROB")
    if not raw:
        return DEFAULT_LOW_CONFIDENCE_LOGPROB_THRESHOLD
    try:
        return float(raw)
    except ValueError:
        return DEFAULT_LOW_CONFIDENCE_LOGPROB_THRESHOLD


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
    # Intentionally NO `language` pin — the practice serves callers in any
    # language; whisper auto-detects per turn. Pinning to a single language
    # would force foreign-language audio into bad English transcripts and
    # trigger the noise/echo path.
    transcription: dict[str, str] = {
        "model": realtime_transcription_model_name(),
    }
    # Only attach `prompt` when non-empty — passing an empty prompt still
    # nudges some decoder paths, and a missing key is the documented "no
    # prompt" state. See DEFAULT_TRANSCRIPTION_PROMPT comment above.
    if DEFAULT_TRANSCRIPTION_PROMPT:
        transcription["prompt"] = DEFAULT_TRANSCRIPTION_PROMPT
    return {
        "model_name": realtime_model_name(),
        "output_modalities": ["audio"],  # GA key (replaces deprecated "modalities")
        "voice": realtime_voice_name(),
        "input_audio_format": "pcm16",
        "output_audio_format": "pcm16",
        "input_audio_transcription": transcription,
        "input_audio_noise_reduction": {"type": "near_field"},
        # eagerness="medium" (not "low"): callers reported the assistant
        # plowing through their interruptions because low waits for several
        # words before treating it as a real turn. Medium is hair-trigger
        # enough for barge-in without firing on coughs/throat-clears.
        # interrupt_response=True is what actually cancels the assistant
        # audio in-flight; create_response=True lets the model auto-reply
        # when the caller finishes their turn.
        "turn_detection": {
            "type": "semantic_vad",
            "eagerness": "medium",
            "create_response": True,
            "interrupt_response": True,
        },
        "tool_choice": "auto",
    }


def tracing_config(session_id: str, call_sid: str | None = None,
                   channel: str = "voice") -> dict:
    """RealtimeModelTracingConfig for the OpenAI Traces dashboard.

    Labels every call ``bt-voice`` and groups it by our own ``session_id`` so
    the OpenAI trace shares the SAME id as the pod logs, DDB rows, and
    /admin/chat — paste a CallSid/session_id into platform.openai.com/traces
    and land on that exact call's full timeline (turns, tool args + results,
    audio). metadata carries call_sid + channel for filtering.
    """
    md: dict = {"channel": channel}
    if call_sid:
        md["call_sid"] = call_sid
    return {
        "workflow_name": "bt-voice",
        "group_id": session_id,
        "metadata": md,
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
      * server_vad (energy-based) instead of semantic_vad. Semantic VAD on
        eagerness=high — our prior setting — kept firing on PSTN noise and
        treating it as caller barge-in, which made the realtime model
        generate phantom turns and (in worst cases) hand off to Crisis on
        silence (call CA7d21a72a, 2026-05-15). server_vad with threshold=0.6
        and a 700ms silence window is the documented noisy-environment
        config per OpenAI's realtime VAD guide:
        https://developers.openai.com/api/docs/guides/realtime-vad
        - threshold 0.6: a touch above default 0.5 so line hiss / hold-music
          doesn't cross the activation floor on g711_ulaw narrowband
        - prefix_padding_ms 300: default; captures the leading consonant
          that triggered VAD so words don't get clipped
        - silence_duration_ms 700: longer than the 500ms default so a
          thinking caller mid-sentence isn't cut off and the model doesn't
          fire on short noise bursts between syllables
        - interrupt_response True: real barge-in still cancels assistant
          audio mid-sentence
    """
    settings = build_model_settings()
    settings["input_audio_format"] = "g711_ulaw"
    settings["output_audio_format"] = "g711_ulaw"
    settings["input_audio_noise_reduction"] = {"type": "far_field"}
    settings["turn_detection"] = {
        "type": "server_vad",
        "threshold": 0.6,
        "prefix_padding_ms": 300,
        "silence_duration_ms": 700,
        "create_response": True,
        "interrupt_response": True,
    }
    return settings


def build_telephony_run_config() -> RealtimeRunConfig:
    """RealtimeRunConfig for the Twilio bridge (POTS-grade audio)."""
    return {"model_settings": build_telephony_model_settings()}

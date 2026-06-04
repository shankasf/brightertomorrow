"""Realtime model / voice / transcription configuration.

Pinned to OpenAI Realtime API (May 2026): ``gpt-realtime-2`` with
``gpt-4o-mini-transcribe`` for input transcription. Override via env:
``REALTIME_MODEL``, ``REALTIME_TRANSCRIPTION_MODEL``, ``REALTIME_VOICE``.
"""
from __future__ import annotations

import os

from agents.realtime import RealtimeRunConfig, RealtimeSessionModelSettings

DEFAULT_REALTIME_MODEL = "gpt-realtime-2"
# Updated 2026-05-28: bumped from `gpt-4o-mini-transcribe-2025-12-15` to
# `gpt-realtime-whisper` (released 2026-05-07 — see
# https://openai.com/index/advancing-voice-intelligence-with-new-models-in-the-api/).
# It is the only natively streaming transcription model on the Realtime API
# (the gpt-4o-*-transcribe family is batch-style and adds latency) and is the
# documented forward path before the `gpt-4o-*-transcribe-2025-*` and
# `whisper-1` retirements in June 2026. No dated snapshot exists yet (floating
# slug); revisit and pin once OpenAI publishes one. The base slug is
# acceptable per their Realtime transcription guide.
DEFAULT_TRANSCRIPTION_MODEL = "gpt-realtime-whisper"
DEFAULT_REALTIME_VOICE = "marin"
# US-region Realtime endpoint (updated 2026-05-28). The new OpenAI service-
# account key is data-residency-pinned to US, so the GLOBAL host now closes
# the WS with `invalid_request_error.incorrect_hostname` (the inverse of the
# 2026-05-23 state — the regional pinning flipped when we rotated to the
# US-restricted key). REST + Realtime both work at us.api.openai.com.
# Verified via /tmp/realtime_text_test3.py 2026-05-28: 7-turn text session
# completed cleanly here. Override via REALTIME_BASE_URL if the key changes.
# IMPORTANT: do NOT send the `OpenAI-Beta: realtime=v1` header — GA removed
# it; sending it triggers the same `incorrect_hostname` error.
DEFAULT_REALTIME_BASE_URL = "wss://us.api.openai.com/v1/realtime"
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
# logprob ≥ −0.5 per token; whisper-style hallucinations on pure silence/noise
# average well below −2.0 (observed −2.9 to −5.7 on real calls). We drop the
# turn before it reaches Triage. The earlier −1.0 cut was far too aggressive:
# genuine spelled member IDs / phone digits / DOBs on narrowband PSTN land at
# −1.0 to −1.9 and were being dropped, so the caller could never get a member
# ID through (calls CA4d16293f / CA9b79867f, 2026-05-24). −2.0 lets that real
# spelled input pass while still catching the egregious silence hallucinations.
# Override via env REALTIME_LOW_CONFIDENCE_LOGPROB if tuning shows drift.
TRANSCRIPTION_LOGPROB_INCLUDE: tuple[str, ...] = (
    "item.input_audio_transcription.logprobs",
)
DEFAULT_LOW_CONFIDENCE_LOGPROB_THRESHOLD = -2.0


# Per-response output cap (runaway guard + TPM-reservation trim). 1500 is
# generous — a 1–2 sentence spoken reply is a few hundred audio tokens, and
# verbatim insurance read-backs fit comfortably; this only stops a pathological
# multi-paragraph response. Override via env REALTIME_MAX_OUTPUT_TOKENS.
DEFAULT_MAX_OUTPUT_TOKENS = 1500


def realtime_max_output_tokens() -> int:
    raw = os.environ.get("REALTIME_MAX_OUTPUT_TOKENS")
    if not raw:
        return DEFAULT_MAX_OUTPUT_TOKENS
    try:
        return int(raw)
    except ValueError:
        return DEFAULT_MAX_OUTPUT_TOKENS


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
        silence (call CA7d21a72a, 2026-05-15).
        - threshold 0.85: HIGH on purpose — this is the value our previously
          working agent (urackit_v2) used. A high VAD floor makes OpenAI ignore
          PSTN echo / line hiss itself, so we don't need an aggressive app-side
          echo gate (relaxed in tandem). Real caller speech easily clears 0.85.
        - prefix_padding_ms 300: captures the leading consonant that triggered
          VAD so words don't get clipped
        - silence_duration_ms 800: a thinking caller mid-sentence isn't cut off
          and the model doesn't fire on short noise bursts between syllables
        - create_response/interrupt_response True: VAD owns turn-taking and
          barge-in; we inject response.create only for greeting/handoff/tool/
          goodbye (see [[project_voice_turn_taking]]).
    """
    settings = build_model_settings()
    settings["input_audio_format"] = "g711_ulaw"
    settings["output_audio_format"] = "g711_ulaw"
    settings["input_audio_noise_reduction"] = {"type": "far_field"}
    settings["turn_detection"] = {
        "type": "server_vad",
        # 0.85 (RESTORED from 0.6 — urackit_v2's proven value). The 0.6 experiment
        # backfired badly: with create_response:true + interrupt_response:true, a
        # low VAD floor lets PSTN echo of OUR OWN audio trip server VAD as "caller
        # speech" mid-reply, which CANCELS the model's in-flight response →
        # response.done with no audio → dead air, on nearly every turn of a
        # speakerphone call (call CAe3c4ae 2026-05-24: every reply was empty and
        # only the nudge salvaged it). 0.85 makes OpenAI ignore line echo itself.
        # Short confirmations ("yes") still commit fine when spoken clearly; the
        # earlier "0.85 dropped short turns" theory was actually this same empty-
        # response bug misattributed to the threshold.
        "threshold": 0.85,
        "prefix_padding_ms": 300,
        "silence_duration_ms": 800,
        "create_response": True,
        "interrupt_response": True,
        # Native silence handling (server_vad only): if the caller goes quiet
        # for this long after our audio finishes, OpenAI commits an empty turn
        # and auto-prompts ("still there?") — the market-standard replacement
        # for app-side response.create polling, which collided with VAD-driven
        # responses and caused dead air (2026-05-24). 8s feels attentive on a
        # phone without nagging.
        "idle_timeout_ms": 8000,
    }
    return settings


def build_telephony_run_config() -> RealtimeRunConfig:
    """RealtimeRunConfig for the Twilio bridge (POTS-grade audio)."""
    return {"model_settings": build_telephony_model_settings()}

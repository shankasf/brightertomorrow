"""Twilio Media Streams bridge — phone calls hit the same LangGraph.

Twilio's bidirectional Media Streams send/receive base64 μ-law (8 kHz
mono) frames. We convert to/from PCM16 16 kHz for the LiveKit plugins
using ``audioop`` (stdlib until 3.13; pulled in via the audioop-lts
shim if running 3.13+).

Endpoints:
  * POST  /v2/twilio/voice    — TwiML that opens a Media Stream to /media.
  * WS    /v2/twilio/media    — bidirectional audio bridge.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from typing import AsyncIterator

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import Response

try:
    import audioop  # stdlib up to 3.12
except ImportError:  # 3.13+
    try:
        import audioop_lts as audioop  # type: ignore
    except ImportError:
        audioop = None  # type: ignore

from .voice_pipeline import VoicePipeline

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/twilio")


@router.post("/voice")
async def twiml_entry() -> Response:
    ws_base = (os.environ.get("BT_PUBLIC_WS_BASE") or "wss://brightertomorrowtherapy.cloud").rstrip("/")
    stream_url = f"{ws_base}/v2/twilio/media"
    twiml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        "<Connect>"
        f'<Stream url="{stream_url}" />'
        "</Connect>"
        "</Response>"
    )
    return Response(content=twiml, media_type="application/xml")


def _mulaw8k_to_pcm16k(payload: bytes) -> bytes:
    """μ-law 8kHz mono → PCM16 16kHz mono."""
    if audioop is None:
        return b""
    pcm_8k = audioop.ulaw2lin(payload, 2)        # 8k PCM16
    pcm_16k, _ = audioop.ratecv(pcm_8k, 2, 1, 8000, 16000, None)
    return pcm_16k


def _pcm16k_to_mulaw8k(payload: bytes) -> bytes:
    """PCM16 16kHz mono → μ-law 8kHz mono."""
    if audioop is None:
        return b""
    pcm_8k, _ = audioop.ratecv(payload, 2, 1, 16000, 8000, None)
    return audioop.lin2ulaw(pcm_8k, 2)


def _twilio_thread_id(caller_phone: str | None, fallback_session_id: str | None) -> str:
    """Derive a stable LangGraph thread_id for the caller.

    Priority:
      1. caller phone (E.164) → "twilio-<digits>"  — survives hangup/callback
      2. gateway session_id   → as-is
      3. random fallback      → "twilio-<rand>"   (never seen in practice)

    The phone number is PHI (one of the 18 HIPAA identifiers); we keep
    only the digits and prefix it. Hashing adds no privacy (small keyspace,
    trivially reversible) and the value lives in DDB encrypted at rest
    with KMS anyway.
    """
    if caller_phone:
        digits = "".join(c for c in caller_phone if c.isdigit())
        if digits:
            return f"twilio-{digits}"
    if fallback_session_id:
        return fallback_session_id
    return "twilio-" + os.urandom(4).hex()


# Staleness cap: a Twilio thread is only RESUMED if its last checkpoint is
# within this window. Past that, we still write to the same thread (so the
# DDB rows stay grouped per caller) but the conversation effectively starts
# fresh — old booking fields too stale to trust.
_TWILIO_STALENESS_SECONDS = 24 * 60 * 60  # 24h


@router.websocket("/media")
async def twilio_media(ws: WebSocket) -> None:
    await ws.accept(subprotocol="audio.twilio.com")
    pipeline: VoicePipeline | None = None
    stream_sid: str | None = None
    thread_id: str | None = None

    audio_q: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=512)

    async def audio_stream() -> AsyncIterator[bytes]:
        while True:
            item = await audio_q.get()
            if item is None:
                return
            yield item

    async def reader():
        nonlocal stream_sid, pipeline, thread_id
        try:
            while True:
                raw = await ws.receive_text()
                event = json.loads(raw)
                etype = event.get("event")
                if etype == "start":
                    start = event.get("start") or {}
                    stream_sid = event.get("streamSid") or start.get("streamSid")
                    # Twilio Media Streams put TwiML <Parameter> tags under
                    # start.customParameters as a map.
                    params = start.get("customParameters") or {}
                    caller_phone = params.get("caller_phone")
                    fallback_sid = params.get("session_id")
                    thread_id = _twilio_thread_id(caller_phone, fallback_sid)
                    # Only build the pipeline now — we need the thread id
                    # before any tool / LLM call would land in state.
                    pipeline = VoicePipeline(
                        thread_id,
                        channel="voice-twilio",
                        agent_source="voice-phone",
                    )
                    logger.info(
                        "twilio_start stream_sid=%s thread_id=%s caller=%s",
                        stream_sid, thread_id,
                        ("***" + caller_phone[-4:]) if caller_phone else "?",
                    )
                elif etype == "media":
                    payload_b64 = event["media"]["payload"]
                    mulaw = base64.b64decode(payload_b64)
                    pcm = _mulaw8k_to_pcm16k(mulaw)
                    if pcm:
                        await audio_q.put(pcm)
                elif etype == "stop":
                    break
        except WebSocketDisconnect:
            pass
        finally:
            await audio_q.put(None)

    async def speech_loop():
        # Wait for the start event to mint the pipeline.
        while pipeline is None:
            await asyncio.sleep(0.05)
        try:
            async for transcript in pipeline.transcribe_stream(audio_stream()):
                logger.info("twilio_transcript stream=%s text=%r", stream_sid, transcript[:80])
                reply = await pipeline.respond_to_text(transcript)
                async for chunk in pipeline.synthesize(reply):
                    mulaw = _pcm16k_to_mulaw8k(chunk)
                    if not mulaw or not stream_sid:
                        continue
                    await ws.send_text(json.dumps({
                        "event": "media",
                        "streamSid": stream_sid,
                        "media": {"payload": base64.b64encode(mulaw).decode()},
                    }))
        except Exception:
            logger.exception("twilio_speech_loop_error stream=%s", stream_sid)

    try:
        await asyncio.gather(reader(), speech_loop())
    finally:
        try:
            await ws.close()
        except Exception:
            pass

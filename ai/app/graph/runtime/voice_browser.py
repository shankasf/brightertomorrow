"""Browser voice bridge — FastAPI WebSocket carrying PCM16 audio.

Wire protocol (matches the legacy ``/ws/voice`` so the existing
``ChatWidget.tsx`` keeps working unchanged):

  Client → server:
    { "type": "input_audio_buffer.append", "audio": "<base64 pcm16 16k>" }
    { "type": "text",   "text": "<typed message>" }      # optional
    { "type": "end" }                                    # graceful close

  Server → client:
    { "type": "session.created", "session": {...} }
    { "type": "response.audio.delta", "delta": "<base64 pcm16>" }
    { "type": "response.audio_transcript.done", "transcript": "<text>" }
    { "type": "conversation.item.input_audio_transcription.completed",
      "transcript": "<text>" }
    { "type": "error", "message": "<text>" }
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .voice_pipeline import VoicePipeline

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2")


async def _audio_in_queue_to_stream(q: asyncio.Queue[bytes | None]):
    while True:
        item = await q.get()
        if item is None:
            return
        yield item


async def _speak_first_turn(ws: WebSocket, pipeline: VoicePipeline) -> None:
    """Emit the HIPAA disclosure (or resume opener) as the first AI turn.

    Runs once per WebSocket connection BEFORE we start listening for
    audio. The reply text is both:
      * transcribed back to the client (so the chat-style transcript
        widget shows the words), and
      * synthesised to PCM audio and streamed as response.audio.delta
        frames (so the user actually hears the disclosure).

    Reconnect: pipeline.emit_first_turn() handles the gates check itself
    and returns the short "welcome back" line if the disclosure has
    already been delivered earlier in this thread. No duplicate audit.
    """
    try:
        reply = await pipeline.emit_first_turn()
    except Exception:
        logger.exception("voice_browser_first_turn_failed session=%s",
                         pipeline.session_id)
        return
    if not reply:
        return
    await ws.send_text(json.dumps({
        "type": "response.audio_transcript.done",
        "transcript": reply,
    }))
    try:
        async for chunk in pipeline.synthesize(reply):
            await ws.send_text(json.dumps({
                "type": "response.audio.delta",
                "delta": base64.b64encode(chunk).decode(),
            }))
    except Exception:
        logger.exception("voice_browser_first_turn_synth_failed session=%s",
                         pipeline.session_id)


@router.websocket("/ws/voice")
async def voice_ws(ws: WebSocket, session_id: str = "") -> None:
    sid = session_id or "anon"
    await ws.accept()
    await ws.send_text(json.dumps({"type": "session.created", "session": {"sid": sid}}))

    audio_q: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=512)
    pipeline = VoicePipeline(sid, channel="voice-browser", agent_source="voice-agent")

    # HIPAA: the caller must hear the disclosure as the first audio they
    # receive. We do this BEFORE the reader/speech_loop gather so the
    # disclosure can't race with an early audio buffer.
    await _speak_first_turn(ws, pipeline)

    async def reader():
        try:
            while True:
                raw = await ws.receive_text()
                try:
                    frame = json.loads(raw)
                except Exception:
                    continue
                t = frame.get("type")
                if t == "input_audio_buffer.append":
                    b64 = frame.get("audio") or ""
                    if b64:
                        await audio_q.put(base64.b64decode(b64))
                elif t == "text":
                    text = (frame.get("text") or "").strip()
                    if text:
                        reply = await pipeline.respond_to_text(text)
                        await ws.send_text(json.dumps({
                            "type": "response.audio_transcript.done",
                            "transcript": reply,
                        }))
                        async for chunk in pipeline.synthesize(reply):
                            await ws.send_text(json.dumps({
                                "type": "response.audio.delta",
                                "delta": base64.b64encode(chunk).decode(),
                            }))
                elif t == "end":
                    break
        except WebSocketDisconnect:
            pass
        finally:
            await audio_q.put(None)

    async def speech_loop():
        try:
            async for transcript in pipeline.transcribe_stream(_audio_in_queue_to_stream(audio_q)):
                # Echo transcription back so the widget shows what we heard.
                await ws.send_text(json.dumps({
                    "type": "conversation.item.input_audio_transcription.completed",
                    "transcript": transcript,
                }))
                reply = await pipeline.respond_to_text(transcript)
                await ws.send_text(json.dumps({
                    "type": "response.audio_transcript.done",
                    "transcript": reply,
                }))
                async for chunk in pipeline.synthesize(reply):
                    await ws.send_text(json.dumps({
                        "type": "response.audio.delta",
                        "delta": base64.b64encode(chunk).decode(),
                    }))
        except Exception:
            logger.exception("voice_browser_speech_loop_error session=%s", sid)

    try:
        await asyncio.gather(reader(), speech_loop())
    finally:
        try:
            await ws.close()
        except Exception:
            pass

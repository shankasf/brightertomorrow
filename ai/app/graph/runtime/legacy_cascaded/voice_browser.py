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

from livekit.agents.utils import http_context as _lk_http_context  # type: ignore

from .voice_pipeline import VoicePipeline

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2")


async def _audio_in_queue_to_stream(q: asyncio.Queue[bytes | None]):
    while True:
        item = await q.get()
        if item is None:
            return
        yield item


async def _speak_first_turn(
    ws: WebSocket, pipeline: VoicePipeline
) -> asyncio.Task | None:
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

    Returns the background graph-seeding task (or None on reconnect /
    failure). The caller must await this before processing user turns so
    two ainvoke() calls don't race on the same thread_id.
    """
    try:
        reply = await pipeline.emit_first_turn()
    except Exception:
        logger.exception("voice_browser_first_turn_failed session=%s",
                         pipeline.session_id)
        return None
    if not reply:
        return None
    # Kick off graph seeding in parallel — the disclosure TEXT is a
    # constant, so audio starts within ~200ms while the audit row /
    # gates.disclosure_done writes happen concurrently.
    seed_task: asyncio.Task | None = None
    if not pipeline._seeded:  # noqa: SLF001 — internal coordination
        seed_task = asyncio.create_task(pipeline.seed_after_disclosure())
    logger.info(
        "voice_browser_first_turn_begin session=%s chars=%d",
        pipeline.session_id, len(reply),
    )
    await ws.send_text(json.dumps({
        "type": "response.audio_transcript.done",
        "transcript": reply,
    }))
    n_chunks = 0
    try:
        async for chunk in pipeline.synthesize(reply):
            n_chunks += 1
            await ws.send_text(json.dumps({
                "type": "response.audio.delta",
                "delta": base64.b64encode(chunk).decode(),
            }))
    except Exception:
        logger.exception("voice_browser_first_turn_synth_failed session=%s chunks=%d",
                         pipeline.session_id, n_chunks)
    logger.info(
        "voice_browser_first_turn_done session=%s chunks=%d",
        pipeline.session_id, n_chunks,
    )
    return seed_task


@router.websocket("/ws/voice")
async def voice_ws(ws: WebSocket, session_id: str = "") -> None:
    sid = session_id or "anon"
    await ws.accept()
    await ws.send_text(json.dumps({"type": "session.created", "session": {"sid": sid}}))
    logger.info("voice_browser_connect session=%s", sid)

    audio_q: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=512)
    pipeline = VoicePipeline(sid, channel="voice-browser", agent_source="voice-agent")

    async def reader():
        n_audio = 0
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
                        n_audio += 1
                        if n_audio % 250 == 0:
                            logger.info(
                                "voice_browser_audio_in session=%s frames=%d qsize=%d",
                                sid, n_audio, audio_q.qsize(),
                            )
                elif t == "text":
                    text = (frame.get("text") or "").strip()
                    if text:
                        logger.info("voice_browser_text_in session=%s text=%r", sid, text[:80])
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
                    logger.info("voice_browser_end session=%s frames_seen=%d", sid, n_audio)
                    break
        except WebSocketDisconnect:
            logger.info("voice_browser_ws_disconnect session=%s frames_seen=%d", sid, n_audio)
        except Exception:
            logger.exception("voice_browser_reader_error session=%s", sid)
        finally:
            await audio_q.put(None)

    async def speech_loop():
        logger.info("voice_browser_listen_start session=%s", sid)
        try:
            async for transcript in pipeline.transcribe_stream(_audio_in_queue_to_stream(audio_q)):
                logger.info("voice_browser_transcript session=%s text=%r", sid, transcript[:80])
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

    # LiveKit's Cartesia/Deepgram plugins acquire their aiohttp.ClientSession
    # via livekit.agents.utils.http_context, which is normally opened by the
    # agent worker job runner. We're driving the plugins outside any worker
    # (raw FastAPI WS bridge), so we open the context here per-connection.
    try:
        async with _lk_http_context.open():
            # HIPAA: the caller must hear the disclosure as the first audio
            # they receive — done before reader/speech_loop so it can't race
            # with an early audio buffer. Must run INSIDE http_context.open()
            # so the TTS plugin can grab its aiohttp session.
            seed_task = await _speak_first_turn(ws, pipeline)
            # Wait for the disclosure audit/gate write to complete before
            # accepting user turns; otherwise reader()'s text path could
            # invoke the graph in parallel and clobber the checkpointer.
            if seed_task is not None:
                try:
                    await seed_task
                except Exception:
                    pass  # already logged
            await asyncio.gather(reader(), speech_loop())
    finally:
        try:
            await ws.close()
        except Exception:
            pass

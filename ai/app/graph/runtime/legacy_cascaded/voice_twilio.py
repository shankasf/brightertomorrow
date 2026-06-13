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

from livekit.agents.utils import http_context as _lk_http_context  # type: ignore

from .voice_pipeline import VoicePipeline

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/twilio")


@router.post("/voice")
async def twiml_entry() -> Response:
    ws_base = (os.environ.get("BT_PUBLIC_WS_BASE") or "wss://brightertomorrowtherapy.com").rstrip("/")
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


# Echo-gate threshold (RMS of PCM16 samples). While the AGENT is speaking,
# inbound frames quieter than this are treated as line echo / silence and
# dropped, so the agent never transcribes its own voice and false-barges-in
# on itself. Real caller speech is louder and passes through (preserving
# genuine barge-in). 0 disables the gate. Tuned value lives in the env.
_ECHO_GATE_RMS = int(os.environ.get("TWILIO_ECHO_GATE_RMS", "0") or "0")


@router.websocket("/media")
async def twilio_media(ws: WebSocket) -> None:
    await ws.accept(subprotocol="audio.twilio.com")
    pipeline: VoicePipeline | None = None
    stream_sid: str | None = None
    thread_id: str | None = None
    seed_task: asyncio.Task | None = None
    # Mutable flag (list so closures can mutate without `nonlocal`): True
    # while the agent's reply audio is being sent, gating echo on input.
    agent_speaking = [False]

    audio_q: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=512)

    async def audio_stream() -> AsyncIterator[bytes]:
        while True:
            item = await audio_q.get()
            if item is None:
                return
            yield item

    async def reader():
        nonlocal stream_sid, pipeline, thread_id
        n_media = 0
        n_mulaw_bytes = 0
        n_pcm_bytes = 0
        n_gated = 0
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
                        caller_phone=caller_phone,
                    )
                    logger.info(
                        "twilio_start stream_sid=%s thread_id=%s caller=%s media_format=%s",
                        stream_sid, thread_id,
                        ("***" + caller_phone[-4:]) if caller_phone else "?",
                        (start.get("mediaFormat") or {}),
                    )
                elif etype == "media":
                    payload_b64 = event["media"]["payload"]
                    mulaw = base64.b64decode(payload_b64)
                    pcm = _mulaw8k_to_pcm16k(mulaw)
                    n_media += 1
                    n_mulaw_bytes += len(mulaw)
                    n_pcm_bytes += len(pcm)
                    if pcm:
                        # Echo gate: while the agent is talking, drop quiet
                        # frames (its own echo) so it doesn't transcribe
                        # itself / falsely barge-in. Loud frames (real caller
                        # speech) pass through and still trigger barge-in.
                        if (agent_speaking[0] and _ECHO_GATE_RMS > 0
                                and audioop is not None
                                and audioop.rms(pcm, 2) < _ECHO_GATE_RMS):
                            n_gated += 1
                        else:
                            await audio_q.put(pcm)
                    # Twilio emits ~50 media frames per second (20ms each)
                    # → log every ~5s of audio.
                    if n_media % 250 == 0:
                        logger.info(
                            "twilio_media_in stream=%s frames=%d mulaw_bytes=%d pcm_bytes=%d qsize=%d",
                            stream_sid, n_media, n_mulaw_bytes, n_pcm_bytes,
                            audio_q.qsize(),
                        )
                elif etype == "mark":
                    # We send a "bt_terminal" mark after the closing message
                    # of a terminal handoff; Twilio echoes it back once that
                    # audio has finished playing. That's our cue to hang up
                    # cleanly without clipping the goodbye.
                    name = (event.get("mark") or {}).get("name")
                    if name == "bt_terminal":
                        logger.info("twilio_terminal_hangup stream=%s", stream_sid)
                        break
                elif etype == "stop":
                    logger.info(
                        "twilio_stop stream=%s frames_seen=%d", stream_sid, n_media,
                    )
                    break
        except WebSocketDisconnect:
            logger.info(
                "twilio_ws_disconnect stream=%s frames_seen=%d", stream_sid, n_media,
            )
        except Exception:
            logger.exception(
                "twilio_reader_error stream=%s frames_seen=%d", stream_sid, n_media,
            )
        finally:
            logger.info(
                "twilio_reader_end stream=%s frames_seen=%d echo_gated=%d mulaw_bytes=%d pcm_bytes=%d",
                stream_sid, n_media, n_gated, n_mulaw_bytes, n_pcm_bytes,
            )
            await audio_q.put(None)

    async def _send_audio(reply: str, *, tag: str) -> None:
        """Synthesise ``reply`` and stream it to Twilio as mulaw frames.

        ``tag`` distinguishes first-turn (disclosure) from reply audio in
        the logs so we can see exactly which synth produced how many
        frames.
        """
        n_chunks = 0
        n_pcm = 0
        n_mulaw = 0
        agent_speaking[0] = True   # arm the echo gate for the input side
        try:
            async for chunk in pipeline.synthesize(reply):  # type: ignore[union-attr]
                mulaw = _pcm16k_to_mulaw8k(chunk)
                if not mulaw or not stream_sid:
                    continue
                n_chunks += 1
                n_pcm += len(chunk)
                n_mulaw += len(mulaw)
                await ws.send_text(json.dumps({
                    "event": "media",
                    "streamSid": stream_sid,
                    "media": {"payload": base64.b64encode(mulaw).decode()},
                }))
        except Exception:
            logger.exception(
                "twilio_synth_failed stream=%s tag=%s chunks=%d",
                stream_sid, tag, n_chunks,
            )
        finally:
            # Always disarm — even on cancel (barge-in) — so the caller's
            # next words are never echo-gated once the agent stops talking.
            agent_speaking[0] = False
        logger.info(
            "twilio_synth_done stream=%s tag=%s chunks=%d pcm_bytes=%d mulaw_bytes=%d",
            stream_sid, tag, n_chunks, n_pcm, n_mulaw,
        )

    async def _emit_first_turn() -> None:
        """Speak the HIPAA disclosure (or resume opener) on call-connect.

        The disclosure TEXT comes from a constant (no LLM, no graph), so
        audio starts streaming within ~200ms of `start`. The graph-side
        seeding (audit row + gates.disclosure_done) runs in PARALLEL as a
        background task — by the time the caller finishes hearing the
        disclosure (~12-15s) the gate is set, and the first user
        transcript hits the steady-state path in respond_to_text. Order
        matters: running the graph BEFORE sending audio caused Twilio to
        drop the WS for 5s of dead air (2026-05-23 incident).
        """
        nonlocal seed_task
        if pipeline is None or not stream_sid:
            return
        try:
            reply = await pipeline.emit_first_turn()
        except Exception:
            logger.exception("twilio_first_turn_failed stream=%s", stream_sid)
            return
        if not reply:
            return
        # Kick off the graph seeding NOW so it overlaps with synth+playback.
        # Awaited inside speech_loop before the first user turn is
        # processed, so respond_to_text never races the seed.
        seed_task = asyncio.create_task(pipeline.seed_after_disclosure())
        logger.info("twilio_first_turn_begin stream=%s chars=%d", stream_sid, len(reply))
        await _send_audio(reply, tag="disclosure")

    async def speech_loop():
        # Wait for the start event to mint the pipeline.
        while pipeline is None:
            await asyncio.sleep(0.05)
        # HIPAA: greet with the disclosure as the very first audio
        # frames going down the line.
        await _emit_first_turn()
        # Ensure the disclosure seeding has completed before we accept any
        # user turn — otherwise two ainvoke() calls would race on the same
        # thread_id and clobber the checkpointer.
        if seed_task is not None:
            try:
                await seed_task
            except Exception:
                pass  # already logged inside seed_after_disclosure
        logger.info("twilio_listen_start stream=%s", stream_sid)

        # barge: set when the caller interrupts. Tells the in-flight stream
        # task to STOP emitting audio — but the task keeps draining the LLM
        # stream so the graph finishes + checkpoints cleanly (cancelling it
        # mid-graph would corrupt the thread state).
        barge = asyncio.Event()

        async def _stream_reply(transcript: str) -> None:
            """Stream the reply sentence-by-sentence into TTS as the LLM
            generates it (first audio ~3.5s sooner). Honours `barge`:
            once set, stop sending audio but keep draining respond_streaming
            so the graph completes. After a non-barged reply, if the
            conversation is terminal, send the hangup mark."""
            agent_speaking[0] = True
            n_sent = 0
            try:
                async for sentence in pipeline.respond_streaming(transcript):  # type: ignore[union-attr]
                    if barge.is_set():
                        continue  # drain silently — keep the graph alive
                    n_sent += 1
                    logger.info("twilio_reply_sentence stream=%s n=%d text=%r",
                                stream_sid, n_sent, sentence[:80])
                    try:
                        async for chunk in pipeline.synthesize(sentence):  # type: ignore[union-attr]
                            if barge.is_set():
                                break
                            mulaw = _pcm16k_to_mulaw8k(chunk)
                            if mulaw and stream_sid:
                                await ws.send_text(json.dumps({
                                    "event": "media",
                                    "streamSid": stream_sid,
                                    "media": {"payload": base64.b64encode(mulaw).decode()},
                                }))
                    except Exception:
                        logger.exception("twilio_synth_failed stream=%s n=%d", stream_sid, n_sent)
            except Exception:
                logger.exception("twilio_stream_reply_error stream=%s", stream_sid)
            finally:
                agent_speaking[0] = False
            logger.info("twilio_reply_done stream=%s sentences=%d barged=%s",
                        stream_sid, n_sent, barge.is_set())
            # Terminal handoff: end the call once the closing message has
            # played (skip if the turn was barged — caller is still talking).
            if not barge.is_set() and stream_sid and await pipeline.is_terminal():  # type: ignore[union-attr]
                try:
                    await ws.send_text(json.dumps({
                        "event": "mark", "streamSid": stream_sid,
                        "mark": {"name": "bt_terminal"},
                    }))
                    logger.info("twilio_terminal_mark_sent stream=%s", stream_sid)
                except Exception:
                    pass

        playback: asyncio.Task | None = None
        try:
            async for transcript in pipeline.transcribe_stream(audio_stream()):
                # BARGE-IN: caller spoke while the agent was talking. Flush
                # Twilio's buffer + signal the stream task to stop emitting,
                # then drain it (graph finishes safely) before the new turn.
                if playback and not playback.done():
                    logger.info("twilio_bargein stream=%s text=%r", stream_sid, transcript[:60])
                    barge.set()
                    if stream_sid:
                        try:
                            await ws.send_text(json.dumps(
                                {"event": "clear", "streamSid": stream_sid}))
                        except Exception:
                            pass
                    try:
                        await playback   # drain to keep the checkpoint intact
                    except Exception:
                        pass
                    playback = None
                barge.clear()
                logger.info("twilio_transcript stream=%s text=%r", stream_sid, transcript[:80])
                playback = asyncio.create_task(_stream_reply(transcript))
        except Exception:
            logger.exception("twilio_speech_loop_error stream=%s", stream_sid)
        finally:
            if playback and not playback.done():
                try:
                    await playback
                except (asyncio.CancelledError, Exception):
                    pass

    # LiveKit's Cartesia/Deepgram plugins acquire their aiohttp.ClientSession
    # via livekit.agents.utils.http_context, which is normally opened by the
    # agent worker job runner. We're driving the plugins outside any worker
    # (raw FastAPI WS bridge), so we open the context here per-connection.
    try:
        async with _lk_http_context.open():
            await asyncio.gather(reader(), speech_loop())
    finally:
        try:
            await ws.close()
        except Exception:
            pass

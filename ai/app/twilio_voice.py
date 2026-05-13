"""Twilio Media Streams ↔ OpenAI Realtime bridge.

Twilio sends inbound call audio as base64-encoded μ-law (8 kHz mono) over a
bidirectional WebSocket per the Media Streams protocol:
https://www.twilio.com/docs/voice/media-streams/websocket-messages

OpenAI's Realtime API accepts ``g711_ulaw`` natively, so we configure the
realtime session with mulaw on both directions and forward raw payloads with
zero resampling. This keeps end-to-end latency low and CPU near zero.

Flow:
    Twilio call  -- (TwiML <Connect><Stream>) -->  this WS  <-->  RealtimeSession
                       inbound mulaw 8k frames                       agent graph
                       outbound mulaw 8k frames                      tools/handoffs

Compliance:
    * The same agent graph used by the browser voice path runs here, so the
      patient-facing flow (intake / booking / insurance / crisis / matching)
      is identical and the existing PHI safeguards apply.
    * Transcripts are persisted to DynamoDB via the gateway PHI store (never
      raw Postgres) — see ``_schedule_persist`` in ``voice.py`` for the
      mirror implementation. Phone calls reuse that path.
    * Twilio must operate under a signed BAA and call recording must be OFF
      on the calling number (see TWILIO.md in the project root).
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from typing import Any

from agents.realtime import (
    RealtimeAudio,
    RealtimeAudioInterrupted,
    RealtimeError,
    RealtimeHandoffEvent,
    RealtimeHistoryAdded,
    RealtimeRunner,
    RealtimeToolEnd,
    RealtimeToolStart,
)
from fastapi import WebSocket, WebSocketDisconnect

from .bt_agents.realtime import (
    build_realtime_triage,
    build_telephony_run_config,
    realtime_model_name,
    realtime_ws_url,
)

logger = logging.getLogger(__name__)

# Hard ceiling per call (cost + abuse guard). Twilio also enforces its own
# call duration limit, so this is a defense-in-depth cap.
_MAX_CALL_SECONDS = int(os.environ.get("TWILIO_MAX_CALL_SECONDS", "900"))  # 15 min

_inflight_tasks: set[asyncio.Future[Any]] = set()

# Set by the `end_call` realtime tool (see app/realtime_tools.py). The bridge
# closes the WS as soon as the assistant turn that fired the tool finishes
# speaking, which causes Twilio to hang up the call. None means "no active
# session" — the tool falls back to a log line.
import contextvars

end_call_event: contextvars.ContextVar[asyncio.Event | None] = contextvars.ContextVar(
    "bt_twilio_end_call_event", default=None,
)

# Mirror voice.py: every internal nudge we inject as a fake user turn carries
# this prefix so it never leaks to the admin transcript view.
_INTERNAL_PROMPT_PREFIX = "[[BT_INTERNAL]]"

# Phone callers don't tolerate long greetings — the line feels broken. Keep
# this to ~3 seconds of audio. The booking / insurance / matching offer comes
# naturally on turn two once they say why they called.
_OPENING_GREETING_PROMPT = (
    f"{_INTERNAL_PROMPT_PREFIX} A caller just dialed in. Speak first; do NOT wait, do NOT "
    "read this instruction aloud. One sentence only: greet them as the Brighter Tomorrow "
    "assistant, note the line is HIPAA-secure, and ask how you can help. Speak slowly — "
    "phone audio is narrowband."
)


def _is_internal_prompt(text: str) -> bool:
    s = (text or "").lstrip()
    return s.startswith(_INTERNAL_PROMPT_PREFIX) or s.startswith("[SYSTEM:")


# ---------------------------------------------------------------------------
# ASR-hallucination filter — phone audio is the worst case for this.
#
# Whisper / gpt-4o-transcribe will emit boilerplate ("subscribe to our
# channel", "thanks for watching") when given silence, hold music, or speech
# in a language it wasn't told to expect. Narrowband mulaw audio makes this
# worse, not better. We drop these turns before they reach the agent and
# interrupt any response they may have already triggered.
# ---------------------------------------------------------------------------

_HALLUCINATION_FRAGMENTS: tuple[str, ...] = (
    "subscribe to the channel",
    "subscribe to our channel",
    "thanks for watching",
    "thank you for watching",
    "like and subscribe",
    "please subscribe",
    "chunky registration",
    "bye bye",
    "www.",
    "http://",
    "https://",
    ".com",
    ".net",
    ".org",
    "facebook",
    "instagram",
    "youtube",
)


def _is_hallucinated_transcript(text: str) -> bool:
    s = (text or "").strip()
    if len(s) <= 1:
        return True
    for ch in s:
        code = ord(ch)
        # Past extended Latin → almost certainly non-English ASR noise.
        if code > 0x024F and ch not in "‘’“”–—…":
            return True
    low = s.lower()
    return any(needle in low for needle in _HALLUCINATION_FRAGMENTS)


# ---------------------------------------------------------------------------
# PHI-safe transcript persistence (mirrors voice.py)
# ---------------------------------------------------------------------------


def _persist_message(session_id: str, role: str, content: str) -> None:
    import urllib.request
    base = os.environ.get("BT_GATEWAY_URL", "http://bt-gateway")
    payload = json.dumps({
        "session_id": session_id,
        "role": role,
        "content": content,
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{base}/internal/chat/turn",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            if r.status >= 400:
                logger.warning(
                    "twilio_persist_status session=%s role=%s status=%s",
                    session_id, role, r.status,
                )
    except Exception:
        logger.exception(
            "Failed to persist Twilio voice message session=%s role=%s",
            session_id, role,
        )


def _schedule_persist(session_id: str, role: str, content: str) -> None:
    if not session_id or not content:
        return
    fut = asyncio.get_running_loop().run_in_executor(
        None, _persist_message, session_id, role, content
    )
    _inflight_tasks.add(fut)
    fut.add_done_callback(_inflight_tasks.discard)


def _mark_session_ended(session_id: str) -> None:
    """Tell the gateway to write ended_at on this chat_sessions row.

    Best-effort: a failure here just means the row stays "active" until the
    20-minute idle sweeper catches it.
    """
    if not session_id:
        return
    import urllib.request
    base = os.environ.get("BT_GATEWAY_URL", "http://bt-gateway")
    payload = json.dumps({"session_id": session_id}).encode("utf-8")
    req = urllib.request.Request(
        f"{base}/internal/chat/end",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=3) as r:
            if r.status >= 400:
                logger.warning(
                    "twilio_end_status session=%s status=%s",
                    session_id, r.status,
                )
    except Exception:
        logger.exception("twilio_end_failed session=%s", session_id)


# ---------------------------------------------------------------------------
# Twilio protocol helpers
# ---------------------------------------------------------------------------


async def _send_twilio_media(ws: WebSocket, stream_sid: str, payload_b64: str) -> None:
    """Send a mulaw audio frame back to Twilio over the Media Stream."""
    await ws.send_text(json.dumps({
        "event": "media",
        "streamSid": stream_sid,
        "media": {"payload": payload_b64},
    }))


async def _send_twilio_mark(ws: WebSocket, stream_sid: str, name: str) -> None:
    await ws.send_text(json.dumps({
        "event": "mark",
        "streamSid": stream_sid,
        "mark": {"name": name},
    }))


async def _send_twilio_clear(ws: WebSocket, stream_sid: str) -> None:
    """Tell Twilio to drop any buffered audio (barge-in / interruption)."""
    await ws.send_text(json.dumps({
        "event": "clear",
        "streamSid": stream_sid,
    }))


def _extract_text(item: Any) -> str:
    content = getattr(item, "content", None) or []
    parts: list[str] = []
    for piece in content:
        text = getattr(piece, "text", None) or getattr(piece, "transcript", None)
        if text:
            parts.append(str(text).strip())
    return " ".join(p for p in parts if p)


# ---------------------------------------------------------------------------
# Main session coroutine
# ---------------------------------------------------------------------------


async def run_twilio_session(twilio_ws: WebSocket) -> None:
    """Run a full-duplex voice call between Twilio and the realtime agent graph.

    The caller has already had ``websocket.accept()`` called on ``twilio_ws``
    by the FastAPI route. We block until Twilio sends the ``start`` event so
    we know the ``streamSid`` and ``callSid`` before opening the OpenAI side.
    """
    if not os.environ.get("OPENAI_API_KEY"):
        logger.error("twilio_session_abort reason=missing_OPENAI_API_KEY")
        try:
            await twilio_ws.close(code=1011, reason="ai not configured")
        finally:
            return

    # ---- 1. Wait for Twilio's start event so we have streamSid/callSid. ----
    stream_sid: str = ""
    call_sid: str = ""
    session_id: str = ""
    try:
        while True:
            raw = await asyncio.wait_for(twilio_ws.receive_text(), timeout=10.0)
            try:
                frame: dict[str, Any] = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning("twilio_invalid_json frame=%r", raw[:200])
                continue
            evt = frame.get("event")
            if evt == "connected":
                logger.info("twilio_connected protocol=%s", frame.get("protocol"))
                continue
            if evt == "start":
                start = frame.get("start") or {}
                stream_sid = start.get("streamSid") or frame.get("streamSid") or ""
                call_sid = start.get("callSid") or ""
                custom = start.get("customParameters") or {}
                # session_id comes through <Parameter name="session_id" .../>
                # in the TwiML the gateway emits — fall back to callSid so we
                # still get DDB persistence even if the gateway forgot it.
                session_id = (custom.get("session_id") or "").strip() or call_sid
                logger.info(
                    "twilio_start stream_sid=%s call_sid=%s session_id=%s",
                    stream_sid, call_sid, session_id,
                )
                break
            # Any other event before start is unexpected; log and keep waiting.
            logger.info("twilio_pre_start_event event=%s", evt)
    except asyncio.TimeoutError:
        logger.error("twilio_start_timeout — no start event in 10s")
        await twilio_ws.close(code=1011, reason="no start event")
        return
    except WebSocketDisconnect:
        logger.info("twilio_disconnect_before_start")
        return

    if not stream_sid:
        logger.error("twilio_missing_stream_sid call_sid=%s", call_sid)
        await twilio_ws.close(code=1011, reason="missing streamSid")
        return

    # ---- 2. Spin up the realtime agent session (mulaw both ways). ----
    runner = RealtimeRunner(
        starting_agent=build_realtime_triage(),
        config=build_telephony_run_config(),
    )
    ws_url = realtime_ws_url()
    model = realtime_model_name()
    try:
        session = await runner.run(model_config={"url": ws_url})
    except Exception:
        logger.exception(
            "twilio_runner_failed call_sid=%s url=%s", call_sid, ws_url,
        )
        await twilio_ws.close(code=1011, reason="ai unavailable")
        return

    t_call_start = asyncio.get_event_loop().time()
    # Per-call telemetry — emitted on session_end so a single grep gives you
    # the cost-shape of every call.
    t_first_audio_out: float | None = None
    t_first_tool_call: float | None = None
    tool_calls_count = 0
    handoffs_count = 0
    # Created here, lives in a contextvar so the end_call tool can set it
    # without us needing to plumb it through the SDK.
    hangup_event = asyncio.Event()
    end_call_event.set(hangup_event)
    logger.info(
        "twilio_session_start call_sid=%s session_id=%s model=%s",
        call_sid, session_id, model,
    )

    # ---- 3. Bidirectional pumps. ----
    async def twilio_to_session() -> None:
        try:
            while True:
                raw = await twilio_ws.receive_text()
                try:
                    frame = json.loads(raw)
                except json.JSONDecodeError:
                    logger.warning("twilio_invalid_json call_sid=%s", call_sid)
                    continue
                evt = frame.get("event")
                if evt == "media":
                    b64 = (frame.get("media") or {}).get("payload") or ""
                    if not b64:
                        continue
                    try:
                        audio_bytes = base64.b64decode(b64)
                    except Exception:
                        logger.warning(
                            "twilio_b64_decode_failed call_sid=%s", call_sid,
                        )
                        continue
                    # commit=False — let server VAD on the realtime side
                    # decide turn boundaries.
                    await session.send_audio(audio_bytes, commit=False)
                elif evt == "mark":
                    # We do not currently match marks back to anything; log only.
                    name = (frame.get("mark") or {}).get("name") or ""
                    logger.debug("twilio_mark call_sid=%s name=%s", call_sid, name)
                elif evt == "dtmf":
                    digit = (frame.get("dtmf") or {}).get("digit") or ""
                    if digit:
                        logger.info(
                            "twilio_dtmf call_sid=%s digit=%s", call_sid, digit,
                        )
                        # Forward as a text message so the agent can react
                        # (e.g. "press 1 for booking"). The patient hears
                        # nothing; the agent decides what to say next.
                        try:
                            await session.send_message(
                                f"{_INTERNAL_PROMPT_PREFIX} Caller pressed DTMF digit: {digit}."
                            )
                        except Exception:
                            logger.debug(
                                "twilio_dtmf_forward_failed call_sid=%s",
                                call_sid, exc_info=True,
                            )
                elif evt == "stop":
                    logger.info("twilio_stop call_sid=%s", call_sid)
                    break
                # 'connected' / 'start' shouldn't recur; ignore quietly.
        except WebSocketDisconnect:
            logger.info("twilio_to_session disconnected call_sid=%s", call_sid)
        except Exception:
            logger.warning(
                "twilio_to_session ended call_sid=%s", call_sid, exc_info=True,
            )

    async def session_to_twilio() -> None:
        try:
            # Prompt the agent to greet first so the caller doesn't sit in
            # silence waiting for them to speak.
            try:
                await session.send_message(_OPENING_GREETING_PROMPT)
            except Exception:
                logger.warning(
                    "twilio_greeting_failed call_sid=%s",
                    call_sid, exc_info=True,
                )

            nonlocal t_first_audio_out, t_first_tool_call
            nonlocal tool_calls_count, handoffs_count
            async for event in session:
                if isinstance(event, RealtimeAudio):
                    audio_bytes = getattr(event.audio, "data", None) or b""
                    if not audio_bytes:
                        continue
                    if t_first_audio_out is None:
                        t_first_audio_out = asyncio.get_event_loop().time()
                        logger.info(
                            "twilio_first_audio_out call_sid=%s ttfa_ms=%.0f",
                            call_sid,
                            (t_first_audio_out - t_call_start) * 1000,
                        )
                    payload_b64 = base64.b64encode(audio_bytes).decode("ascii")
                    await _send_twilio_media(twilio_ws, stream_sid, payload_b64)
                    continue

                if isinstance(event, RealtimeAudioInterrupted):
                    # The realtime model decided the caller barged in — flush
                    # Twilio's playback queue so the caller doesn't hear the
                    # tail of the previous assistant turn.
                    logger.info(
                        "twilio_audio_interrupted call_sid=%s item_id=%s",
                        call_sid, getattr(event, "item_id", None),
                    )
                    try:
                        await _send_twilio_clear(twilio_ws, stream_sid)
                    except Exception:
                        logger.debug(
                            "twilio_clear_failed call_sid=%s",
                            call_sid, exc_info=True,
                        )
                    continue

                if isinstance(event, RealtimeHistoryAdded):
                    item = event.item
                    role = getattr(item, "role", None)
                    text = _extract_text(item)
                    if not text:
                        continue
                    item_id = getattr(item, "item_id", None)
                    if role == "user":
                        if _is_internal_prompt(text):
                            continue
                        if _is_hallucinated_transcript(text):
                            # ASR ghost. Drop it from DDB and cancel any
                            # response the model already started.
                            logger.info(
                                "twilio_drop_hallucinated_user call_sid=%s "
                                "item_id=%s text=%r",
                                call_sid, item_id, text,
                            )
                            try:
                                await session.interrupt()
                            except Exception:
                                logger.debug(
                                    "twilio_hallucination_interrupt_failed call_sid=%s",
                                    call_sid, exc_info=True,
                                )
                            continue
                        _schedule_persist(session_id, "user", text)
                    elif role == "assistant":
                        _schedule_persist(session_id, "assistant", text)
                    continue

                if isinstance(event, RealtimeHandoffEvent):
                    handoffs_count += 1
                    logger.info(
                        "twilio_handoff call_sid=%s from=%s to=%s",
                        call_sid,
                        getattr(event.from_agent, "name", "?"),
                        getattr(event.to_agent, "name", "?"),
                    )
                    continue

                if isinstance(event, RealtimeToolStart):
                    tool_name = getattr(event.tool, "name", "?")
                    tool_calls_count += 1
                    if t_first_tool_call is None:
                        t_first_tool_call = asyncio.get_event_loop().time()
                        logger.info(
                            "twilio_first_tool_call call_sid=%s tool=%s tttc_ms=%.0f",
                            call_sid, tool_name,
                            (t_first_tool_call - t_call_start) * 1000,
                        )
                    logger.info(
                        "twilio_tool_start call_sid=%s tool=%s",
                        call_sid, tool_name,
                    )
                    continue

                if isinstance(event, RealtimeToolEnd):
                    logger.info(
                        "twilio_tool_end call_sid=%s tool=%s",
                        call_sid, getattr(event.tool, "name", "?"),
                    )
                    continue

                if isinstance(event, RealtimeError):
                    msg = str(getattr(event.error, "message", event.error))
                    low = msg.lower()
                    benign = (
                        "cancellation failed" in low
                        or "no active response" in low
                        or "already cancelled" in low
                        or "item does not exist" in low
                    )
                    if benign:
                        logger.info(
                            "twilio_benign_error call_sid=%s msg=%s",
                            call_sid, msg,
                        )
                        continue
                    logger.error(
                        "twilio_session_error call_sid=%s msg=%s",
                        call_sid, msg,
                    )
                    continue
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning(
                "session_to_twilio ended call_sid=%s",
                call_sid, exc_info=True,
            )

    async with session:
        t2s = asyncio.ensure_future(twilio_to_session())
        s2t = asyncio.ensure_future(session_to_twilio())
        # Wraps hangup_event.wait() so we can put it in asyncio.wait alongside
        # the two pumps. When the realtime `end_call` tool fires, this resolves
        # and the session ends cleanly (Twilio sees the WS close → hangs up).
        hangup_waiter = asyncio.ensure_future(hangup_event.wait())
        end_reason = "remote-close"
        try:
            done, _ = await asyncio.wait(
                [t2s, s2t, hangup_waiter],
                timeout=_MAX_CALL_SECONDS,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if not done:
                end_reason = "max-duration"
                logger.warning(
                    "twilio_session_timeout call_sid=%s max_s=%d",
                    call_sid, _MAX_CALL_SECONDS,
                )
            elif hangup_waiter in done:
                end_reason = "end-call-tool"
                logger.info("twilio_end_call_tool call_sid=%s", call_sid)
                # Give the assistant ~1.5s to finish its closing sentence
                # before we drop the line. Without this the caller hears
                # "Have a great—" and then dead air.
                await asyncio.sleep(1.5)
        finally:
            duration_s = asyncio.get_event_loop().time() - t_call_start
            ttfa_ms = (
                (t_first_audio_out - t_call_start) * 1000
                if t_first_audio_out is not None else -1.0
            )
            tttc_ms = (
                (t_first_tool_call - t_call_start) * 1000
                if t_first_tool_call is not None else -1.0
            )
            logger.info(
                "twilio_session_end call_sid=%s session_id=%s duration_s=%.1f "
                "end_reason=%s ttfa_ms=%.0f tttc_ms=%.0f tool_calls=%d handoffs=%d",
                call_sid, session_id, duration_s, end_reason,
                ttfa_ms, tttc_ms, tool_calls_count, handoffs_count,
            )
            # Clear the contextvar so a stale Event can't be set by an
            # end_call tool that fires on a future session.
            end_call_event.set(None)
            for task in (t2s, s2t, hangup_waiter):
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass

            pending = set(_inflight_tasks)
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)

            # Flip chat_sessions.ended_at so the admin UI stops showing this
            # call as "active". Runs after _inflight_tasks drains so any last
            # turn is persisted first. Best-effort — sweeper is the safety net.
            await asyncio.get_running_loop().run_in_executor(
                None, _mark_session_ended, session_id,
            )

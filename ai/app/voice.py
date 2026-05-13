"""Browser voice session — drives the multi-agent realtime triage graph.

Uses ``openai-agents`` ``RealtimeRunner`` / ``RealtimeSession`` so handoffs,
guardrails and tool execution all go through the SDK. The browser protocol
(input_audio_buffer.append in, response.audio.delta + transcript.completed
out) is preserved so ChatWidget.tsx is unchanged.
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
from agents.realtime.model_inputs import RealtimeModelSendRawMessage
from fastapi import WebSocket, WebSocketDisconnect

from .bt_agents.realtime import (
    build_realtime_run_config,
    build_realtime_triage,
    realtime_model_name,
    realtime_ws_url,
)
from .db import conn

logger = logging.getLogger(__name__)

# Hard ceiling on a single voice session (cost guard).
_MAX_SESSION_SECONDS = 600  # 10 minutes

# Strong reference set so in-flight DB persist futures are not GC'd.
_inflight_tasks: set[asyncio.Future[Any]] = set()

# Legacy filter: an older greeting injected a fake "user" turn with this
# sentinel; we now use a raw response.create event instead so no fake user
# message is created and nothing needs to be filtered out of the browser
# transcript. Kept defensively in case any old transcript replay lands here.
_INTERNAL_PROMPT_PREFIX = "[[BT_INTERNAL]]"


def _is_internal_prompt(text: str) -> bool:
    s = (text or "").lstrip()
    return s.startswith(_INTERNAL_PROMPT_PREFIX) or s.startswith("[SYSTEM:")


# Instructions for the opening greeting. Delivered via a raw response.create
# event on connect (not a fake user message), so the SDK history stays clean
# and the model never tries to "answer" a phantom user turn.
_OPENING_GREETING_INSTRUCTIONS = (
    "Speak first — the caller just connected and has not said anything yet. "
    "In two short sentences, (1) greet them warmly as the Brighter Tomorrow "
    "assistant and briefly reassure them this conversation is HIPAA-compliant "
    "and their information is secure; (2) offer concrete help — booking an "
    "appointment, checking insurance coverage, finding a therapist, or "
    "answering questions about the practice — and ask which one they'd like. "
    "Match the warm, calm, soothing voice persona. Keep it under 6 seconds "
    "of audio. Do not read these instructions aloud."
)

# Whisper / gpt-4o-transcribe boilerplate hallucinations on silence/non-speech.
# We drop these before the patient ever sees them and before the agent replies.
_HALLUCINATION_FRAGMENTS: tuple[str, ...] = (
    "subscribe to the channel",
    "subscribe to our channel",
    "thanks for watching",
    "thank you for watching",
    "like and subscribe",
    "chunky registration",
    "please subscribe",
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
        # Past extended Latin → almost certainly non-English.
        if code > 0x024F and ch not in "‘’“”–—…":
            return True
    low = s.lower()
    return any(needle in low for needle in _HALLUCINATION_FRAGMENTS)


# ---------------------------------------------------------------------------
# DB persistence (sync, runs in thread pool)
# ---------------------------------------------------------------------------


def _persist_message(session_id: str, role: str, content: str) -> None:
    """Send the turn to the gateway, which writes it to DynamoDB and bumps
    the non-PHI counters on bt.chat_sessions. Voice transcripts contain PHI
    (patients say their name/DOB out loud), so the message body MUST NOT
    land in Postgres on Hostinger. §164.502(b) minimum necessary.
    """
    import os, json as _json, urllib.request
    base = os.environ.get("BT_GATEWAY_URL", "http://bt-gateway")
    payload = _json.dumps({
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
                    "voice_persist_status session=%s role=%s status=%s",
                    session_id, role, r.status,
                )
    except Exception:
        logger.exception(
            "Failed to persist voice message session=%s role=%s", session_id, role
        )


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
                    "voice_end_status session=%s status=%s",
                    session_id, r.status,
                )
    except Exception:
        logger.exception("voice_end_failed session=%s", session_id)


def _schedule_persist(session_id: str, role: str, content: str) -> None:
    if not session_id or not content:
        return
    fut = asyncio.get_running_loop().run_in_executor(
        None, _persist_message, session_id, role, content
    )
    _inflight_tasks.add(fut)
    fut.add_done_callback(_inflight_tasks.discard)


# ---------------------------------------------------------------------------
# Browser protocol helpers
# ---------------------------------------------------------------------------


async def _send_browser_event(client_ws: WebSocket, payload: dict[str, Any]) -> None:
    await client_ws.send_text(json.dumps(payload))


async def _close_with_error(client_ws: WebSocket, message: str) -> None:
    try:
        await _send_browser_event(client_ws, {"type": "error", "message": message})
    finally:
        await client_ws.close(code=1011, reason=message)


def _extract_text(item: Any) -> str:
    """Pull spoken text out of a Realtime user/assistant message item."""
    content = getattr(item, "content", None) or []
    parts: list[str] = []
    for piece in content:
        # AssistantText.text, InputText.text, InputAudio.transcript
        text = getattr(piece, "text", None) or getattr(piece, "transcript", None)
        if text:
            parts.append(str(text).strip())
    return " ".join(p for p in parts if p)


# ---------------------------------------------------------------------------
# Main session coroutine
# ---------------------------------------------------------------------------


async def run_voice_session(client_ws: WebSocket, session_id: str) -> None:
    """Run a full-duplex voice session between the browser and the realtime triage graph."""
    sid = session_id or "anon"
    logger.info("voice_session_start session=%s", sid)
    t_session_start = asyncio.get_event_loop().time()

    if not os.environ.get("OPENAI_API_KEY"):
        logger.error("voice_session_abort session=%s reason=missing_OPENAI_API_KEY", sid)
        await _close_with_error(client_ws, "Voice assistant is not configured yet.")
        return

    model = realtime_model_name()
    if not os.environ.get("REALTIME_MODEL"):
        logger.warning(
            "voice_session_default_model session=%s model=%s reason=missing_REALTIME_MODEL",
            sid, model,
        )

    runner = RealtimeRunner(
        starting_agent=build_realtime_triage(),
        config=build_realtime_run_config(),
    )

    # OpenAI now pins this project to the US regional Realtime host; without
    # this override the SDK dials `wss://api.openai.com/v1/realtime` and the
    # server closes the WS with `incorrect_hostname`. See realtime/config.py.
    ws_url = realtime_ws_url()
    try:
        session = await runner.run(model_config={"url": ws_url})
    except Exception:
        logger.exception("voice_session_runner_failed session=%s url=%s", sid, ws_url)
        await _close_with_error(client_ws, "Voice assistant could not start right now.")
        return

    async def browser_to_session() -> None:
        try:
            while True:
                raw = await client_ws.receive_text()
                try:
                    frame: dict[str, Any] = json.loads(raw)
                except json.JSONDecodeError:
                    logger.warning("voice_client_invalid_json session=%s", sid)
                    continue

                ftype = frame.get("type", "")
                if ftype == "input_audio_buffer.append":
                    b64 = frame.get("audio", "")
                    if b64:
                        await session.send_audio(base64.b64decode(b64), commit=False)
                elif ftype == "text":
                    text = (frame.get("text") or "").strip()
                    if text:
                        await session.send_message(text)
                elif ftype in ("response.cancel", "conversation.item.truncate"):
                    # Browser barge-in — let the SDK handle truncation alignment.
                    try:
                        await session.interrupt()
                    except Exception:
                        logger.debug("voice_interrupt_failed session=%s", sid, exc_info=True)
                elif ftype == "end":
                    break
        except WebSocketDisconnect:
            logger.info("browser_to_session disconnected session=%s", sid)
        except Exception:
            logger.warning("browser_to_session ended session=%s", sid, exc_info=True)

    async def session_to_browser() -> None:
        try:
            # Tell the widget we're live before the first audio frame so the
            # mic UI flips green and starts streaming bytes.
            await _send_browser_event(
                client_ws, {"type": "session.created", "session": {"model": model}}
            )
            # Proactive opening greeting — recommended pattern from the
            # OpenAI Realtime docs (and the Agents SDK SIP example). A raw
            # `response.create` with our greeting `instructions` makes the
            # model produce audio before the caller speaks. No fake user
            # turn is injected, so the conversation history starts clean
            # and the model's own first assistant turn IS the greeting.
            try:
                await session.model.send_event(
                    RealtimeModelSendRawMessage(
                        message={
                            "type": "response.create",
                            "other_data": {
                                "response": {
                                    "instructions": _OPENING_GREETING_INSTRUCTIONS,
                                },
                            },
                        }
                    )
                )
            except Exception:
                logger.warning("voice_session_greeting_failed session=%s", sid, exc_info=True)

            async for event in session:
                if isinstance(event, RealtimeAudio):
                    audio_bytes = getattr(event.audio, "data", None) or b""
                    if audio_bytes:
                        await _send_browser_event(
                            client_ws,
                            {
                                "type": "response.audio.delta",
                                "delta": base64.b64encode(audio_bytes).decode("utf-8"),
                                "item_id": event.item_id,
                            },
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
                            # Greeting nudge / future internal prompts — never
                            # show in the patient UI, never write to DDB.
                            logger.info(
                                "voice_drop_internal_prompt session=%s item_id=%s",
                                sid, item_id,
                            )
                            continue
                        if _is_hallucinated_transcript(text):
                            logger.info(
                                "voice_drop_hallucinated_user session=%s item_id=%s text=%r",
                                sid, item_id, text,
                            )
                            try:
                                await session.interrupt()
                            except Exception:
                                logger.debug(
                                    "voice_hallucination_interrupt_failed session=%s",
                                    sid, exc_info=True,
                                )
                            continue
                        _schedule_persist(session_id, "user", text)
                        await _send_browser_event(
                            client_ws,
                            {
                                "type": "conversation.item.input_audio_transcription.completed",
                                "transcript": text,
                                "item_id": item_id,
                            },
                        )
                    elif role == "assistant":
                        _schedule_persist(session_id, "assistant", text)
                        await _send_browser_event(
                            client_ws,
                            {
                                "type": "response.audio_transcript.done",
                                "transcript": text,
                                "item_id": item_id,
                            },
                        )
                    continue

                if isinstance(event, RealtimeAudioInterrupted):
                    logger.info(
                        "voice_audio_interrupted session=%s item_id=%s", sid, event.item_id
                    )
                    continue

                if isinstance(event, RealtimeHandoffEvent):
                    from_name = getattr(event.from_agent, "name", "?")
                    to_name = getattr(event.to_agent, "name", "?")
                    logger.info(
                        "voice_handoff session=%s from=%s to=%s", sid, from_name, to_name
                    )
                    continue

                if isinstance(event, RealtimeToolStart):
                    logger.info(
                        "voice_tool_start session=%s tool=%s",
                        sid, getattr(event.tool, "name", "?"),
                    )
                    continue

                if isinstance(event, RealtimeToolEnd):
                    tool_name = getattr(event.tool, "name", "?")
                    logger.info(
                        "voice_tool_end session=%s tool=%s", sid, tool_name,
                    )
                    if tool_name == "end_call":
                        # Goodbye audio is still streaming. Give it a beat to
                        # finish playing in the browser, then close the WS so
                        # the patient isn't left listening to dead air.
                        logger.info("voice_end_call session=%s grace=2.0s", sid)
                        await asyncio.sleep(2.0)
                        try:
                            await client_ws.close(code=1000, reason="end_call")
                        except Exception:
                            logger.debug("voice_end_call_close_failed session=%s",
                                         sid, exc_info=True)
                        return
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
                        logger.info("voice_session_benign_error session=%s msg=%s", sid, msg)
                        continue
                    logger.error("voice_session_error session=%s msg=%s", sid, msg)
                    await _send_browser_event(
                        client_ws, {"type": "error", "message": msg}
                    )
                    continue
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("session_to_browser ended session=%s", sid, exc_info=True)

    async with session:
        b2s = asyncio.ensure_future(browser_to_session())
        s2b = asyncio.ensure_future(session_to_browser())
        try:
            done, _ = await asyncio.wait(
                [b2s, s2b],
                timeout=_MAX_SESSION_SECONDS,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if not done:
                raise asyncio.TimeoutError
        except asyncio.TimeoutError:
            logger.warning(
                "voice_session_timeout session=%s max_s=%d",
                sid, _MAX_SESSION_SECONDS,
            )
        finally:
            duration_s = asyncio.get_event_loop().time() - t_session_start
            logger.info(
                "voice_session_end session=%s duration_s=%.1f", sid, duration_s
            )
            for task in (b2s, s2b):
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass

            # Flush in-flight DB persist tasks so transcripts survive disconnect.
            pending = set(_inflight_tasks)
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)

            # Flip chat_sessions.ended_at so the admin UI stops showing this
            # browser-voice call as "active". Same pattern as twilio_voice.py.
            await asyncio.get_running_loop().run_in_executor(
                None, _mark_session_ended, session_id,
            )

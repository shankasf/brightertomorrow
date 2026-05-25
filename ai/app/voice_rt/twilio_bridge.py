"""Twilio Media Streams ↔ OpenAI Realtime bridge (raw-WebSocket edition).

Drop-in alternative to ``app.twilio_voice.run_twilio_session`` — same
signature, same preserved bt logic, but driven by ``app.voice_rt.openai_ws``
instead of the OpenAI Agents SDK. See ``app/voice_rt/__init__.py`` for the why.

Turn-taking (mirrors urackit_v2):
  * server_vad owns normal turns (``create_response: true``).
  * On caller barge-in (``input_audio_buffer.speech_started``) we send Twilio a
    ``clear`` and truncate the in-flight assistant item to what was actually
    heard. A 4s call-start grace period ignores the opening-echo false barge-in.
  * We send an explicit ``response.create`` ONLY for the greeting and after
    every function-call result (the post-tool one fixes the silent-stall bug).
  * NO app-side nudge / check-back timers. The only timer is the hard 120s
    abandoned-line cutoff.

Preserved from the SDK bridge:
  * Opening HIPAA-secure greeting (speak first).
  * Chat-turn persistence to the gateway (/internal/chat/turn) + session end.
  * Low-confidence logprob drop of ASR hallucinations.
  * end_call tool → Twilio REST hangup + WS close.
  * Per-call metrics log line on session end.

PHI: turn transcripts are logged at INFO (matching the prior bridge) and
persisted to DynamoDB via the gateway. OpenAI is covered by a signed BAA.
No new PHI sinks are added.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import time
from typing import Any

try:
    import audioop  # stdlib (deprecated 3.13+, present in 3.12)
except ImportError:  # pragma: no cover — graceful fallback, no gating
    audioop = None  # type: ignore[assignment]

from fastapi import WebSocket, WebSocketDisconnect

from ..bt_agents.realtime import (
    TRANSCRIPTION_LOGPROB_INCLUDE,
    build_realtime_triage,
    build_telephony_model_settings,
    low_confidence_logprob_threshold,
    realtime_max_output_tokens,
    realtime_model_name,
    realtime_transcription_model_name,
    realtime_voice_name,
    realtime_ws_url,
)
# Reuse the SDK bridge's contextvar + helpers verbatim so the end_call tool,
# REST hangup, and persistence behave identically across both bridges.
from ..twilio_voice import (
    _mark_session_ended,
    _schedule_persist,
    _twilio_rest_hangup,
    end_call_event,
)

logger = logging.getLogger(__name__)

# Hard ceiling per call (cost + abuse guard) — same env as the SDK bridge.
_MAX_CALL_SECONDS = int(os.environ.get("TWILIO_MAX_CALL_SECONDS", "900"))

# Abandoned-line cutoff. server_vad's idle_timeout_ms re-prompts a quiet caller
# natively; this is just the hard hangup for a genuinely dead line.
_SILENCE_HANGUP_S = 120.0
_SILENCE_TICK_S = 1.0

# Call-start grace: ignore caller "barge-in" for the first few seconds so the
# opening echo of our own greeting doesn't truncate it (urackit_v2 pattern).
_CALL_START_GRACE_S = float(os.environ.get("TWILIO_CALL_START_GRACE_S", "4.0"))

# g711_ulaw is 8 kHz, 8-bit, mono → 8000 bytes/sec. Each Twilio media frame is
# 20ms = 160 bytes. We track elapsed assistant playback in ms so a barge-in
# truncate tells OpenAI exactly how much audio the caller actually heard.
_ULAW_BYTES_PER_MS = 8.0

# Internal-prompt prefix (mirrors twilio_voice / voice). Items carrying this
# never surface in the admin transcript.
_INTERNAL_PROMPT_PREFIX = "[[BT_INTERNAL]]"

_OPENING_GREETING_INSTRUCTIONS = (
    "A caller just dialed in on a HIPAA-secure phone line. Speak first; "
    "do NOT wait, do NOT read these instructions aloud. Keep it to TWO "
    "short sentences: (1) greet them as the Brighter Tomorrow assistant on "
    "a HIPAA-secure line; (2) note we're a Nevada practice — they can book "
    "from any state but need to be in Nevada for the visit, in person or by "
    "video — then ask how you can help. Speak slowly — phone audio is "
    "narrowband."
)

_HALLUCINATED_REPROMPT_INSTRUCTIONS = (
    "The caller's last audio turn was discarded as unintelligible — "
    "background noise, dropped audio, or an ASR boilerplate hallucination. "
    "You do NOT have any value from that turn. Do NOT invent or guess what "
    "they 'probably' said. Say ONE short warm sentence asking them to repeat "
    "just the field you were collecting, spelling it out letter by letter (or "
    "digit by digit for numbers). Example: 'Sorry — I didn't catch that. "
    "Could you say it again, letter by letter?'"
)


# ---------------------------------------------------------------------------
# Tool registry — build the OpenAI tools array + a name→tool dispatch map from
# the SDK @function_tool objects on the triage agent (no prompt fork).
# ---------------------------------------------------------------------------


def _build_tool_registry(agent: Any) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Extract the OpenAI ``tools`` array and a name→FunctionTool map.

    Each @function_tool object exposes ``.name``, ``.description`` and
    ``.params_json_schema`` (a JSON Schema). We mirror the Agents SDK's own
    ``_tools_to_session_tools`` shape: ``{type, name, description, parameters}``.
    Tools without those attributes (defensive) are skipped with a warning.
    """
    tools_array: list[dict[str, Any]] = []
    dispatch: dict[str, Any] = {}
    for tool in getattr(agent, "tools", []) or []:
        name = getattr(tool, "name", None)
        schema = getattr(tool, "params_json_schema", None)
        if not name or schema is None:
            logger.warning(
                "voicert_tool_skipped reason=missing_name_or_schema tool=%r",
                getattr(tool, "name", tool),
            )
            continue
        tools_array.append({
            "type": "function",
            "name": name,
            "description": getattr(tool, "description", "") or "",
            "parameters": schema,
        })
        dispatch[name] = tool
    return tools_array, dispatch


def _make_tool_context(tool: Any, call_id: str, args_json: str) -> Any:
    """Build the minimal ToolContext the @function_tool invoker needs.

    bt's tools are plain sync functions that take no context parameter and
    read per-call state (agent_source, caller_phone) from module-level
    contextvars — so the generated invoker uses the ToolContext ONLY to read
    ``tool_name`` for logging and to parse/validate the JSON args. We therefore
    construct a ToolContext with a null run-context and the real tool_name /
    arguments. (Verified against agents.tool_context.ToolContext, 2026-05-24.)
    """
    from agents.tool_context import ToolContext
    return ToolContext(
        context=None,
        tool_call_id=call_id or "call_unknown",
        tool_name=getattr(tool, "name", "") or "unknown",
        tool_arguments=args_json or "{}",
    )


# ---------------------------------------------------------------------------
# Twilio protocol helpers
# ---------------------------------------------------------------------------


async def _send_twilio_media(ws: WebSocket, stream_sid: str, payload_b64: str) -> None:
    await ws.send_text(json.dumps({
        "event": "media",
        "streamSid": stream_sid,
        "media": {"payload": payload_b64},
    }))


async def _send_twilio_clear(ws: WebSocket, stream_sid: str) -> None:
    await ws.send_text(json.dumps({"event": "clear", "streamSid": stream_sid}))


def _is_internal_prompt(text: str) -> bool:
    s = (text or "").lstrip()
    return s.startswith(_INTERNAL_PROMPT_PREFIX) or s.startswith("[SYSTEM:")


# ---------------------------------------------------------------------------
# Per-call mutable state
# ---------------------------------------------------------------------------


class _CallState:
    """Tracks assistant playback + barge-in bookkeeping for one call."""

    __slots__ = (
        "assistant_speaking",
        "current_assistant_item_id",
        "assistant_audio_ms",
        "last_caller_quiet_since",
        "ended",
        "hangup_sent",
    )

    def __init__(self) -> None:
        # Greeting is about to play — treat assistant as speaking so the
        # silence clock doesn't start before the model has said anything.
        self.assistant_speaking: bool = True
        self.current_assistant_item_id: str | None = None
        # ms of assistant audio sent to Twilio for the CURRENT response — used
        # to compute audio_end_ms on a barge-in truncate.
        self.assistant_audio_ms: float = 0.0
        self.last_caller_quiet_since: float | None = None
        self.ended: bool = False
        self.hangup_sent: bool = False

    def on_response_start(self) -> None:
        self.assistant_speaking = True
        self.assistant_audio_ms = 0.0
        self.current_assistant_item_id = None
        self.last_caller_quiet_since = None

    def on_response_done(self) -> None:
        self.assistant_speaking = False
        self.last_caller_quiet_since = time.monotonic()

    def on_caller_turn(self) -> None:
        self.last_caller_quiet_since = time.monotonic()


# ---------------------------------------------------------------------------
# Main session coroutine
# ---------------------------------------------------------------------------


async def run_twilio_session(twilio_ws: WebSocket) -> None:
    """Full-duplex voice call: Twilio Media Streams ↔ raw OpenAI Realtime WS.

    ``twilio_ws`` is already accepted by the FastAPI route. We block on Twilio's
    ``start`` event for streamSid / callSid, then open the OpenAI WS.
    """
    if not os.environ.get("OPENAI_API_KEY"):
        logger.error("voicert_abort reason=missing_OPENAI_API_KEY")
        try:
            await twilio_ws.close(code=1011, reason="ai not configured")
        finally:
            return

    # ---- 1. Wait for Twilio's start event. ----
    stream_sid = ""
    call_sid = ""
    session_id = ""
    ani = ""
    try:
        while True:
            raw = await asyncio.wait_for(twilio_ws.receive_text(), timeout=10.0)
            try:
                frame: dict[str, Any] = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning("voicert_invalid_json frame=%r", raw[:200])
                continue
            evt = frame.get("event")
            if evt == "connected":
                logger.info("voicert_connected protocol=%s", frame.get("protocol"))
                continue
            if evt == "start":
                start = frame.get("start") or {}
                stream_sid = start.get("streamSid") or frame.get("streamSid") or ""
                call_sid = start.get("callSid") or ""
                custom = start.get("customParameters") or {}
                session_id = (custom.get("session_id") or "").strip() or call_sid
                ani = (custom.get("caller_phone") or "").strip()
                if ani:
                    from ..integrations.voice_tools import caller_phone as _caller_phone_ctx
                    _caller_phone_ctx.set(ani)
                logger.info(
                    "voicert_start stream_sid=%s call_sid=%s session_id=%s caller=%s",
                    stream_sid, call_sid, session_id,
                    ("***" + ani[-4:]) if ani else "?",
                )
                break
            logger.info("voicert_pre_start_event event=%s", evt)
    except asyncio.TimeoutError:
        logger.error("voicert_start_timeout — no start event in 10s")
        await twilio_ws.close(code=1011, reason="no start event")
        return
    except WebSocketDisconnect:
        logger.info("voicert_disconnect_before_start")
        return

    if not stream_sid:
        logger.error("voicert_missing_stream_sid call_sid=%s", call_sid)
        await twilio_ws.close(code=1011, reason="missing streamSid")
        return

    # ---- 2. Build agent (instructions + tools) and the OpenAI WS client. ----
    agent = build_realtime_triage(caller_phone=ani or None)
    instructions = getattr(agent, "instructions", "") or ""
    tools_array, tool_dispatch = _build_tool_registry(agent)

    settings = build_telephony_model_settings()
    # Transcription dict for the GA audio.input.transcription block. We stash
    # the audio format string under a private key the client reads for both
    # audio.input.format and audio.output.format.
    transcription: dict[str, Any] = {
        "model": realtime_transcription_model_name(),
        "_audio_format": settings.get("input_audio_format", "g711_ulaw"),
    }
    turn_detection = settings.get("turn_detection") or {
        "type": "server_vad",
        # Keep in sync with config.build_telephony_model_settings (0.85 — high
        # on purpose so PSTN echo of our own audio doesn't trip VAD and cancel
        # the in-flight reply). This is a fallback; config normally supplies it.
        "threshold": 0.85,
        "prefix_padding_ms": 300,
        "silence_duration_ms": 800,
        "interrupt_response": True,
        "idle_timeout_ms": 8000,
    }
    # LET THE MODEL DRIVE (create_response: true) — urackit_v2's proven model.
    # We previously set this false and created responses by hand on every turn,
    # which fought the model and produced empty responses, empty-transcript
    # skips, and dead idle-timeouts. With create_response true, server_vad
    # creates the reply for each committed caller turn (incl. short/quiet ones
    # the transcriber misses, since the model uses the audio), interrupt_response
    # handles barge-in, and idle_timeout_ms auto-re-prompts a silent caller.
    # Manual response.create remains only for the greeting + after tool results
    # (VAD doesn't fire on a function_call_output), plus the empty-response retry.
    turn_detection = {**turn_detection, "create_response": True}

    from .openai_ws import OpenAIRealtimeClient

    client = OpenAIRealtimeClient(
        ws_url=realtime_ws_url(),
        model=realtime_model_name(),
        instructions=instructions,
        tools=tools_array,
        voice=realtime_voice_name(),
        transcription=transcription,
        turn_detection=turn_detection,
        include=list(TRANSCRIPTION_LOGPROB_INCLUDE),
        noise_reduction=settings.get("input_audio_noise_reduction"),
        greeting_instructions=f"{_INTERNAL_PROMPT_PREFIX} {_OPENING_GREETING_INSTRUCTIONS}",
        max_output_tokens=realtime_max_output_tokens(),
        call_sid=call_sid,
    )

    try:
        await client.connect()
    except Exception:
        logger.exception("voicert_connect_failed call_sid=%s", call_sid)
        await twilio_ws.close(code=1011, reason="ai unavailable")
        return

    # ---- 3. Per-call state + telemetry. ----
    t_call_start = time.monotonic()
    t_first_audio_out: float | None = None
    t_first_tool_call: float | None = None
    tool_calls_count = 0
    state = _CallState()
    hangup_event = asyncio.Event()
    end_call_event.set(hangup_event)
    model = realtime_model_name()
    logger.info(
        "voicert_session_start call_sid=%s session_id=%s model=%s bridge=raw_ws",
        call_sid, session_id, model,
    )

    # Dedupe function-call dispatch by call_id (a completed call can surface on
    # both *.arguments.done and *.output_item.done / response.done).
    dispatched_calls: set[str] = set()

    # Echo-gate state (read by the inbound pump, written by the audio-delta
    # callback so the hangover clock stays fresh past the last assistant frame).
    echo_dropped_frames = 0
    echo_passed_frames = 0
    _echo_gate_rms = int(os.environ.get("TWILIO_ECHO_GATE_RMS", "1500"))
    _echo_hangover_s = float(os.environ.get("TWILIO_ECHO_GATE_HANGOVER_MS", "400")) / 1000.0
    _last_assistant_audio_ts = [time.monotonic()]

    # ---- 4. OpenAI → bridge callbacks. ----

    async def _on_audio_delta(delta_b64: str) -> None:
        nonlocal t_first_audio_out
        # OpenAI sends base64 g711_ulaw; forward straight to Twilio (no
        # transcode — both sides are mulaw 8k).
        state.assistant_speaking = True
        _last_assistant_audio_ts[0] = time.monotonic()
        try:
            nbytes = len(base64.b64decode(delta_b64))
        except Exception:
            nbytes = 0
        state.assistant_audio_ms += nbytes / _ULAW_BYTES_PER_MS
        if t_first_audio_out is None:
            t_first_audio_out = time.monotonic()
            logger.info(
                "voicert_first_audio_out call_sid=%s ttfa_ms=%.0f",
                call_sid, (t_first_audio_out - t_call_start) * 1000,
            )
        try:
            await _send_twilio_media(twilio_ws, stream_sid, delta_b64)
        except Exception:
            logger.debug("voicert_media_send_failed call_sid=%s", call_sid, exc_info=True)

    async def _on_response_created() -> None:
        state.on_response_start()

    async def _on_response_done() -> None:
        state.on_response_done()

    async def _on_user_speech_started() -> None:
        # Barge-in. Ignore during the call-start grace window (opening echo).
        if (time.monotonic() - t_call_start) < _CALL_START_GRACE_S:
            logger.debug("voicert_bargein_in_grace call_sid=%s", call_sid)
            return
        state.on_caller_turn()
        if not state.assistant_speaking:
            return
        logger.info(
            "voicert_bargein call_sid=%s item=%s heard_ms=%.0f",
            call_sid, state.current_assistant_item_id, state.assistant_audio_ms,
        )
        # 1) flush Twilio's buffered playback
        try:
            await _send_twilio_clear(twilio_ws, stream_sid)
        except Exception:
            logger.debug("voicert_clear_failed call_sid=%s", call_sid, exc_info=True)
        # 2) cancel the in-flight response + truncate the assistant item so the
        #    model's context matches what the caller actually heard.
        try:
            await client.cancel_response()
            if state.current_assistant_item_id:
                await client.truncate(
                    state.current_assistant_item_id,
                    int(state.assistant_audio_ms),
                )
        except Exception:
            logger.debug("voicert_truncate_failed call_sid=%s", call_sid, exc_info=True)
        state.assistant_speaking = False

    async def _on_assistant_item(item_id: str) -> None:
        # Remember the active assistant audio item so a barge-in truncate
        # addresses the right item with the correct audio_end_ms.
        state.current_assistant_item_id = item_id

    async def _on_assistant_transcript(text: str) -> None:
        clean = (text or "").strip()
        if not clean:
            return
        logger.info("voicert_turn call_sid=%s role=assistant text=%r", call_sid, clean[:200])
        _schedule_persist(session_id, "assistant", clean)

    async def _on_input_transcription(srv: dict[str, Any]) -> None:
        # Low-confidence drop (mirrors twilio_voice._maybe_drop_low_confidence)
        # plus normal user-turn persistence.
        item_id = srv.get("item_id")
        transcript = (srv.get("transcript") or "").strip()
        logprobs = srv.get("logprobs") or []
        # Track the assistant item id for barge-in truncate is handled
        # elsewhere; this event is for the CALLER turn.
        if logprobs:
            vals = [
                lp.get("logprob") for lp in logprobs
                if isinstance(lp, dict) and isinstance(lp.get("logprob"), (int, float))
            ]
            if vals:
                mean_lp = sum(vals) / len(vals)
                threshold = low_confidence_logprob_threshold()
                if mean_lp < threshold:
                    logger.info(
                        "voicert_drop_low_confidence call_sid=%s item_id=%s "
                        "mean_logprob=%.2f threshold=%.2f text=%r",
                        call_sid, item_id, mean_lp, threshold, transcript,
                    )
                    # interrupt any in-flight response, delete the item so the
                    # model doesn't re-read the hallucination, and reprompt.
                    try:
                        await client.cancel_response()
                    except Exception:
                        pass
                    if item_id:
                        try:
                            await client.delete_item(item_id)
                        except Exception:
                            pass
                    try:
                        await client.create_response(
                            instructions=_HALLUCINATED_REPROMPT_INSTRUCTIONS
                        )
                    except Exception:
                        logger.debug(
                            "voicert_low_conf_reprompt_failed call_sid=%s",
                            call_sid, exc_info=True,
                        )
                    state.last_caller_quiet_since = time.monotonic()
                    return
        # Normal caller turn.
        if not transcript or _is_internal_prompt(transcript):
            return
        state.on_caller_turn()
        logger.info("voicert_turn call_sid=%s role=user text=%r", call_sid, transcript[:200])
        _schedule_persist(session_id, "user", transcript)
        # NOTE: we do NOT create the reply here. With create_response:true,
        # server_vad already created the response for this turn the moment it
        # committed. Creating again would double-respond. (Greeting + post-tool
        # are the only manual creates; empty-response retry handles GA empties.)

    async def _on_function_call(name: str, call_id: str, args_json: str) -> None:
        nonlocal t_first_tool_call, tool_calls_count
        if call_id in dispatched_calls:
            return
        dispatched_calls.add(call_id)
        tool_calls_count += 1
        if t_first_tool_call is None:
            t_first_tool_call = time.monotonic()
            logger.info(
                "voicert_first_tool_call call_sid=%s tool=%s tttc_ms=%.0f",
                call_sid, name, (t_first_tool_call - t_call_start) * 1000,
            )
        logger.info(
            "voicert_tool_start call_sid=%s tool=%s args=%s",
            call_sid, name, (args_json or "")[:400],
        )
        tool = tool_dispatch.get(name)
        if tool is None:
            logger.warning("voicert_tool_unknown call_sid=%s tool=%s", call_sid, name)
            await client.send_function_result(
                call_id, json.dumps({"ok": False, "error": f"unknown_tool: {name}"}),
                trigger_response=True,
            )
            return

        # end_call is special: set the hangup signal (the tool's contextvar
        # path also fires, but set it here too as a side channel), return a
        # tiny ack, and still trigger the response so the goodbye line plays.
        try:
            ctx = _make_tool_context(tool, call_id, args_json)
            result = await tool.on_invoke_tool(ctx, args_json or "{}")
        except Exception as exc:
            logger.exception("voicert_tool_error call_sid=%s tool=%s", call_sid, name)
            result = {"ok": False, "error": f"tool_failed: {exc}"}

        if isinstance(result, (dict, list)):
            output = json.dumps(result)
        else:
            output = str(result)
        logger.info(
            "voicert_tool_end call_sid=%s tool=%s output=%s",
            call_sid, name, output[:400],
        )
        if name == "end_call":
            hangup_event.set()
        # CRITICAL: explicit response.create after EVERY tool result — this is
        # the fix for the post-tool silent stall.
        await client.send_function_result(call_id, output, trigger_response=True)

    client.on_audio_delta = _on_audio_delta
    client.on_response_created = _on_response_created
    client.on_response_done = _on_response_done
    client.on_user_speech_started = _on_user_speech_started
    client.on_input_transcription = _on_input_transcription
    client.on_function_call = _on_function_call
    client.on_assistant_transcript = _on_assistant_transcript
    client.on_assistant_item = _on_assistant_item

    # ---- 5. Pumps. ----

    async def twilio_to_openai() -> None:
        nonlocal echo_dropped_frames, echo_passed_frames
        try:
            while True:
                raw = await twilio_ws.receive_text()
                try:
                    frame = json.loads(raw)
                except json.JSONDecodeError:
                    logger.warning("voicert_invalid_json call_sid=%s", call_sid)
                    continue
                evt = frame.get("event")
                if evt == "media":
                    b64 = (frame.get("media") or {}).get("payload") or ""
                    if not b64:
                        continue
                    # Light echo gate: while the assistant is speaking (or for a
                    # short hangover) drop sub-floor inbound frames so PSTN echo
                    # of our own audio doesn't trip VAD. server_vad threshold
                    # 0.85 does most of the work; this is a thin backstop.
                    gate_active = state.assistant_speaking or (
                        time.monotonic() - _last_assistant_audio_ts[0] < _echo_hangover_s
                    )
                    if audioop is not None and gate_active:
                        try:
                            audio_bytes = base64.b64decode(b64)
                            pcm = audioop.ulaw2lin(audio_bytes, 2)
                            rms = audioop.rms(pcm, 2)
                        except Exception:
                            rms = _echo_gate_rms  # fail-open
                        if rms < _echo_gate_rms:
                            echo_dropped_frames += 1
                            continue
                        echo_passed_frames += 1
                    await client.append_audio(b64)
                elif evt == "mark":
                    name = (frame.get("mark") or {}).get("name") or ""
                    logger.debug("voicert_mark call_sid=%s name=%s", call_sid, name)
                elif evt == "dtmf":
                    digit = (frame.get("dtmf") or {}).get("digit") or ""
                    if digit:
                        logger.info("voicert_dtmf call_sid=%s digit=%s", call_sid, digit)
                elif evt == "stop":
                    logger.info("voicert_stop call_sid=%s", call_sid)
                    break
        except WebSocketDisconnect:
            logger.info("voicert_twilio_disconnected call_sid=%s", call_sid)
        except Exception:
            logger.warning("voicert_twilio_pump_ended call_sid=%s", call_sid, exc_info=True)

    async def openai_recv() -> None:
        await client.recv_loop()
        logger.info("voicert_openai_recv_ended call_sid=%s", call_sid)

    async def silence_watchdog() -> None:
        """Only the hard abandoned-line cutoff. No response nudge — VAD +
        explicit post-tool response.create own turn-taking."""
        try:
            while not state.ended:
                await asyncio.sleep(_SILENCE_TICK_S)
                if state.ended:
                    return
                if state.assistant_speaking or state.last_caller_quiet_since is None:
                    continue
                idle = time.monotonic() - state.last_caller_quiet_since
                if idle >= _SILENCE_HANGUP_S and not state.hangup_sent:
                    state.hangup_sent = True
                    logger.info(
                        "voicert_silence_hangup call_sid=%s idle_s=%.1f", call_sid, idle,
                    )
                    hangup_event.set()
                    return
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("voicert_watchdog_ended call_sid=%s", call_sid, exc_info=True)

    # ---- 6. Greeting + run. ----
    await client.start_greeting(ani or None)

    recv_task = asyncio.ensure_future(openai_recv())
    t2o = asyncio.ensure_future(twilio_to_openai())
    watchdog = asyncio.ensure_future(silence_watchdog())
    hangup_waiter = asyncio.ensure_future(hangup_event.wait())

    end_reason = "remote-close"
    try:
        done, _ = await asyncio.wait(
            [recv_task, t2o, hangup_waiter],
            timeout=_MAX_CALL_SECONDS,
            return_when=asyncio.FIRST_COMPLETED,
        )
        if not done:
            end_reason = "max-duration"
            logger.warning(
                "voicert_session_timeout call_sid=%s max_s=%d", call_sid, _MAX_CALL_SECONDS,
            )
        elif hangup_waiter in done:
            end_reason = "end-call-tool" if not state.hangup_sent else "silence-timeout"
            logger.info("voicert_hangup_signal call_sid=%s reason=%s", call_sid, end_reason)
            # Let the assistant's closing sentence finish before dropping.
            await asyncio.sleep(1.5)
        elif recv_task in done:
            end_reason = "openai-close"
    finally:
        state.ended = True
        duration_s = time.monotonic() - t_call_start
        ttfa_ms = (t_first_audio_out - t_call_start) * 1000 if t_first_audio_out else -1.0
        tttc_ms = (t_first_tool_call - t_call_start) * 1000 if t_first_tool_call else -1.0
        logger.info(
            "voicert_session_end call_sid=%s session_id=%s duration_s=%.1f "
            "end_reason=%s ttfa_ms=%.0f tttc_ms=%.0f tool_calls=%d "
            "echo_dropped=%d echo_passed=%d echo_floor=%d bridge=raw_ws",
            call_sid, session_id, duration_s, end_reason, ttfa_ms, tttc_ms,
            tool_calls_count, echo_dropped_frames, echo_passed_frames, _echo_gate_rms,
        )
        end_call_event.set(None)
        for task in (recv_task, t2o, watchdog, hangup_waiter):
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        try:
            await client.close()
        except Exception:
            pass

        if end_reason != "remote-close":
            try:
                await twilio_ws.close(code=1000, reason="end-of-call")
            except Exception:
                logger.debug("voicert_ws_close_failed call_sid=%s", call_sid, exc_info=True)
            await asyncio.get_running_loop().run_in_executor(
                None, _twilio_rest_hangup, call_sid,
            )

        # Drain inflight persistence then mark the session ended (best-effort).
        await asyncio.get_running_loop().run_in_executor(None, _mark_session_ended, session_id)

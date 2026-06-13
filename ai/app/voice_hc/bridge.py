"""Healthcare-style raw-WebSocket Twilio ⇄ OpenAI Realtime bridge for BT.

Port of ``healthcare_prior_auth/voice/app/bridge.py::twilio_media_stream`` —
the lean turn-taking loop that works well in that service — onto Brighter
Tomorrow's prompt, tools, persistence and (critically) US-residency endpoint.

Selected via ``VOICE_BRIDGE=hc`` in ``app/main.py``. Same entrypoint signature
as the other two bridges: ``run_twilio_session(twilio_ws)`` with the WS already
accepted by the FastAPI route.

Design (mirrors the healthcare bridge):
  * server_vad owns turns: ``create_response: true`` (+ ``interrupt_response``).
    VAD values are the healthcare ones — threshold 0.75, silence 700 ms — which
    pick up soft/quiet callers more readily than BT's 0.85.
  * Only ONE active response at a time: a ``resp_state`` gate queues a deferred
    turn and fires it on ``response.done`` (never raises
    ``conversation_already_has_active_response``).
  * Explicit ``response.create`` only for the greeting and after every tool
    result (server_vad does not auto-continue after a function_call_output).
  * Barge-in: on ``input_audio_buffer.speech_started`` send Twilio a ``clear``;
    server_vad's ``interrupt_response`` cancels the in-flight reply. No manual
    truncate, no echo gate, no logprob drop — kept deliberately lean.
  * Known STT noise phrases ("thank you", "bye", …) are dropped from the saved
    transcript so silence hallucinations don't pollute it.

PHI: turn transcripts are logged at INFO and persisted to DynamoDB via the
gateway (same sinks as the other bridges). OpenAI is covered by a signed BAA and
all traffic stays on the US-residency endpoint. No new PHI sinks.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from ..bt_agents.realtime import (
    build_realtime_triage,
    realtime_max_output_tokens,
    realtime_model_name,
    realtime_voice_name,
    realtime_ws_url,
)
# Read-only glue from the existing SDK bridge — identical end_call / persistence
# behaviour across all three bridges. We import, never modify.
from ..twilio_voice import (
    _mark_session_ended,
    _schedule_persist,
    _twilio_rest_hangup,
    end_call_event,
)

logger = logging.getLogger(__name__)

# Hard ceiling per call (cost + abuse guard) — same env as the other bridges.
_MAX_CALL_SECONDS = int(os.environ.get("TWILIO_MAX_CALL_SECONDS", "900"))

# Grace after end_call before we drop the PSTN leg, so the spoken goodbye
# finishes instead of being clipped (healthcare GOODBYE_DRAIN_SECONDS).
_GOODBYE_DRAIN_SECONDS = float(os.environ.get("HC_GOODBYE_DRAIN_SECONDS", "2.0"))

# Healthcare VAD values — the whole point of this port. Override via env if we
# want to tune in prod without a rebuild.
_VAD_THRESHOLD = float(os.environ.get("HC_VAD_THRESHOLD", "0.75"))
_VAD_PREFIX_PADDING_MS = int(os.environ.get("HC_VAD_PREFIX_PADDING_MS", "300"))
_VAD_SILENCE_MS = int(os.environ.get("HC_VAD_SILENCE_MS", "700"))

# Healthcare uses the battle-tested gpt-4o-mini-transcribe (lower silence
# hallucination than gpt-realtime-whisper). Override via env.
_TRANSCRIBE_MODEL = os.environ.get("HC_TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe")

# Twilio μ-law (g711_ulaw) — MIME id the GA realtime audio block expects.
_AUDIO_FORMAT = {"type": "audio/pcmu"}

# Internal-prompt prefix (mirrors twilio_voice / voice_rt). Items carrying this
# never surface in the saved transcript.
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

# Common Whisper/STT hallucinations for silence/non-speech (healthcare list).
# Exact-match short transcripts are dropped from the saved transcript.
_NOISE_PHRASES = {
    "thank you", "thanks", "thank you very much", "thanks for watching",
    "thank you for watching", "bye", "bye bye", "goodbye", "you",
    "thank you bye", "thanks bye", "see you next time", "see you in the next video",
    "please subscribe", "subscribe", "uh", "um", "hmm", "okay", "ok",
}


def _is_noise(text: str) -> bool:
    """True if `text` is empty or a known STT hallucination (so we drop it)."""
    t = (text or "").strip().lower().strip(" .,!?…").strip()
    return (not t) or len(t) <= 1 or t in _NOISE_PHRASES


# Words that, on their own, are a farewell / acknowledgement / filler — NOT a
# new request. After end_call has fired, an utterance made entirely of these
# (the caller's "ok thanks bye", or the agent's own goodbye-TTS echoing back
# through the mic) must NOT cancel the armed hangup.
_FAREWELL_ACK_WORDS = {
    "ok", "okay", "kay", "k", "thanks", "thank", "you", "thankyou", "ty",
    "bye", "goodbye", "byebye", "cya", "later", "cheers", "great", "good",
    "perfect", "awesome", "cool", "nice", "alright", "right", "yes", "yeah",
    "yep", "yup", "sure", "fine", "got", "it", "gotit", "take", "care",
    "appreciate", "much", "very", "so", "all", "set", "no", "nope", "nothing",
    "else", "done", "uh", "um", "hmm", "mhm", "mm", "and", "for", "the",
    "your", "help", "helping", "have", "a", "day", "night", "good", "night",
    "see", "ya", "talk", "soon",
}


def _is_farewell_or_ack(text: str) -> bool:
    """True if `text` is purely a goodbye / acknowledgement / filler (or noise),
    i.e. it carries NO substantive new request or correction.

    Used only in the post-end_call goodbye drain: if the caller's utterance is
    just a farewell/ack/echo, we keep the hangup armed. Any token outside the
    farewell/ack set (a real word, a digit, "actually", "wait", a new question)
    makes it substantive and the hangup is cancelled so we stay on the line.
    """
    t = (text or "").strip().lower()
    if not t or _is_noise(t):
        return True
    # Split on non-alphanumerics; ignore empties.
    tokens = [tok for tok in re.split(r"[^a-z0-9]+", t) if tok]
    if not tokens:
        return True
    # Any digit-bearing token = substantive (e.g. a new phone number / time).
    for tok in tokens:
        if any(c.isdigit() for c in tok):
            return False
        if tok not in _FAREWELL_ACK_WORDS:
            return False
    return True


def _is_internal_prompt(text: str) -> bool:
    s = (text or "").lstrip()
    return s.startswith(_INTERNAL_PROMPT_PREFIX) or s.startswith("[SYSTEM:")


# ---------------------------------------------------------------------------
# Tool registry — same extraction the raw_ws bridge uses (copied so this
# package stays self-contained and does not import voice_rt internals).
# ---------------------------------------------------------------------------


def _build_tool_registry(agent: Any) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """OpenAI ``tools`` array + a name→FunctionTool dispatch map from the
    @function_tool objects on the triage agent."""
    tools_array: list[dict[str, Any]] = []
    dispatch: dict[str, Any] = {}
    for tool in getattr(agent, "tools", []) or []:
        name = getattr(tool, "name", None)
        schema = getattr(tool, "params_json_schema", None)
        if not name or schema is None:
            logger.warning("voicehc_tool_skipped tool=%r", getattr(tool, "name", tool))
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
    """Minimal ToolContext the @function_tool invoker needs (tool_name + args)."""
    from agents.tool_context import ToolContext
    return ToolContext(
        context=None,
        tool_call_id=call_id or "call_unknown",
        tool_name=getattr(tool, "name", "") or "unknown",
        tool_arguments=args_json or "{}",
    )


# ---------------------------------------------------------------------------
# Main session coroutine
# ---------------------------------------------------------------------------


async def run_twilio_session(twilio_ws: WebSocket) -> None:
    """Run one inbound phone call end-to-end (Twilio ⇄ OpenAI Realtime)."""
    import websockets

    if not os.environ.get("OPENAI_API_KEY"):
        logger.error("voicehc_abort reason=missing_OPENAI_API_KEY")
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
                continue
            evt = frame.get("event")
            if evt == "connected":
                logger.info("voicehc_connected protocol=%s", frame.get("protocol"))
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
                    "voicehc_start stream_sid=%s call_sid=%s session_id=%s caller=%s",
                    stream_sid, call_sid, session_id,
                    ("***" + ani[-4:]) if ani else "?",
                )
                break
            logger.info("voicehc_pre_start_event event=%s", evt)
    except asyncio.TimeoutError:
        logger.error("voicehc_start_timeout")
        await twilio_ws.close(code=1011, reason="no start event")
        return
    except WebSocketDisconnect:
        logger.info("voicehc_disconnect_before_start")
        return

    if not stream_sid:
        logger.error("voicehc_missing_stream_sid call_sid=%s", call_sid)
        await twilio_ws.close(code=1011, reason="missing streamSid")
        return

    # ---- 2. Build agent (instructions + tools). ----
    agent = build_realtime_triage(caller_phone=ani or None)
    instructions = getattr(agent, "instructions", "") or ""
    tools_array, tool_dispatch = _build_tool_registry(agent)

    # ---- 3. Per-call state. ----
    t_call_start = time.monotonic()
    t_first_audio_out: float | None = None
    tool_calls_count = 0
    # Response lifecycle gate: only ONE active response at a time. A turn that
    # wants to start while one is active is queued and fired on response.done.
    resp_state = {"active": False, "pending": False}
    ended = {"v": False}                 # hang up exactly once
    # end_call intent latch: once the model has fired end_call, the call MUST
    # terminate after the goodbye drains. A farewell/ack/echo during the drain
    # must NOT abort it; only a substantive new request cancels (and re-arms a
    # fresh drain). See _is_farewell_or_ack + the speech_started / transcription
    # handlers below.
    end_call_state = {"invoked": False}
    hangup_task: dict[str, Any] = {"v": None}
    dispatched_calls: set[str] = set()
    transcript_seen = {"started": False}

    hangup_event = asyncio.Event()
    end_call_event.set(hangup_event)

    def _arm_hangup(delay: float) -> None:
        prev = hangup_task["v"]
        if prev and not prev.done():
            prev.cancel()

        async def _delayed() -> None:
            try:
                await asyncio.sleep(delay)
            except asyncio.CancelledError:
                return
            if not ended["v"]:
                ended["v"] = True
                hangup_event.set()

        hangup_task["v"] = asyncio.ensure_future(_delayed())

    def _cancel_hangup_if_pending() -> bool:
        ht = hangup_task["v"]
        if ht and not ht.done() and not ended["v"]:
            ht.cancel()
            hangup_task["v"] = None
            return True
        return False

    logger.info(
        "voicehc_session_start call_sid=%s session_id=%s model=%s vad_threshold=%.2f bridge=hc",
        call_sid, session_id, realtime_model_name(), _VAD_THRESHOLD,
    )

    # ---- 4. Open OpenAI Realtime WS (US-residency endpoint). ----
    # websockets>=14 renamed extra_headers→additional_headers. The connect()
    # object validates kwargs lazily at __aenter__ (under uvloop), so a
    # try/except around the call can't catch it — pick the kwarg by version.
    # NO ?model= query param: on the GA us.api.openai.com endpoint the model
    # belongs in session.model (set below). A query param misroutes
    # response.create to the legacy /v1/engines/<model> path → "Invalid URL".
    _oai_url = realtime_ws_url()
    _oai_headers = {"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"}
    _hdr_kw = "additional_headers"
    try:
        if int((getattr(websockets, "__version__", "0").split(".")[0]) or "0") < 14:
            _hdr_kw = "extra_headers"
    except Exception:
        pass
    oai_cm = websockets.connect(
        _oai_url, max_size=None, ping_interval=20, ping_timeout=20,
        **{_hdr_kw: _oai_headers},
    )

    end_reason = "remote-close"
    try:
        async with oai_cm as oai:
            # GA Realtime session config (gpt-realtime-2). Audio nests under
            # session.audio with MIME-style format ids; healthcare VAD values.
            session_obj: dict[str, Any] = {
                "type": "realtime",
                "model": realtime_model_name(),
                "instructions": instructions,
                "output_modalities": ["audio"],
                "audio": {
                    "input": {
                        "format": _AUDIO_FORMAT,
                        "noise_reduction": {"type": "far_field"},
                        "turn_detection": {
                            "type": "server_vad",
                            "threshold": _VAD_THRESHOLD,
                            "prefix_padding_ms": _VAD_PREFIX_PADDING_MS,
                            "silence_duration_ms": _VAD_SILENCE_MS,
                            "create_response": True,
                            "interrupt_response": True,
                        },
                        "transcription": {"model": _TRANSCRIBE_MODEL},
                    },
                    "output": {
                        "format": _AUDIO_FORMAT,
                        "voice": realtime_voice_name(),
                    },
                },
                "tools": tools_array,
                "tool_choice": "auto",
            }
            # Cap per-response output. CRITICAL for TPM: it shrinks the token
            # RESERVATION the rate limiter counts as "Requested", which is what
            # prevents the empty-response / dead-air failures on gpt-realtime-2.
            _max_out = realtime_max_output_tokens()
            if _max_out:
                session_obj["max_output_tokens"] = _max_out
            await oai.send(json.dumps({"type": "session.update", "session": session_obj}))

            # ---- 5. Greeting (speak first): GA 2-event pattern. Seed a
            # user-role directive item (carries [[BT_INTERNAL]] so it never
            # surfaces in the transcript) then a bare response.create. A single
            # response.create with inline instructions does NOT reliably speak. ----
            await oai.send(json.dumps({
                "type": "conversation.item.create",
                "item": {
                    "type": "message",
                    "role": "user",
                    "content": [{
                        "type": "input_text",
                        "text": f"{_INTERNAL_PROMPT_PREFIX} {_OPENING_GREETING_INSTRUCTIONS}",
                    }],
                },
            }))
            await oai.send(json.dumps({"type": "response.create"}))

            # ---- (a) Twilio μ-law frames → OpenAI input buffer. ----
            async def pump_twilio_to_oai() -> None:
                nonlocal end_reason
                try:
                    while True:
                        raw = await twilio_ws.receive_text()
                        try:
                            data = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        ev = data.get("event")
                        if ev == "media":
                            payload = (data.get("media") or {}).get("payload")
                            if payload:
                                await oai.send(json.dumps({
                                    "type": "input_audio_buffer.append",
                                    "audio": payload,
                                }))
                        elif ev == "stop":
                            logger.info("voicehc_stop call_sid=%s", call_sid)
                            break
                except WebSocketDisconnect:
                    logger.info("voicehc_twilio_disconnected call_sid=%s", call_sid)
                except Exception:
                    logger.warning("voicehc_twilio_pump_ended call_sid=%s", call_sid, exc_info=True)
                finally:
                    try:
                        await oai.close()
                    except Exception:
                        pass

            # ---- (b) OpenAI events → Twilio + tools + transcripts. ----
            async def pump_oai_to_twilio() -> None:
                nonlocal t_first_audio_out, tool_calls_count
                async for raw in oai:
                    try:
                        evt = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    t = evt.get("type")

                    # model speech → Twilio (GA + beta event names)
                    if t in ("response.audio.delta", "response.output_audio.delta"):
                        if evt.get("delta"):
                            # Mark that THIS response produced spoken output — used
                            # by the end_call handler to avoid forcing a duplicate
                            # closing line when the model already said goodbye in
                            # the same response that carried the end_call tool call.
                            resp_state["spoke"] = True
                            if t_first_audio_out is None:
                                t_first_audio_out = time.monotonic()
                                logger.info(
                                    "voicehc_first_audio_out call_sid=%s ttfa_ms=%.0f",
                                    call_sid, (t_first_audio_out - t_call_start) * 1000,
                                )
                            try:
                                await twilio_ws.send_text(json.dumps({
                                    "event": "media", "streamSid": stream_sid,
                                    "media": {"payload": evt["delta"]},
                                }))
                            except Exception:
                                logger.debug("voicehc_media_send_failed", exc_info=True)

                    elif t == "input_audio_buffer.speech_started":
                        # Barge-in: flush Twilio's buffered playback. server_vad's
                        # interrupt_response cancels the in-flight reply for us.
                        try:
                            await twilio_ws.send_text(json.dumps(
                                {"event": "clear", "streamSid": stream_sid}))
                        except Exception:
                            pass
                        # Do NOT cancel the armed hangup here. After end_call we
                        # must distinguish a real correction from a farewell/ack
                        # or the agent's own goodbye-TTS echoing back, and the
                        # transcript isn't available yet at speech_started. The
                        # cancel decision is deferred to the transcription.done
                        # handler, which can inspect what was actually said. If
                        # end_call was NOT invoked, no hangup is armed so there
                        # is nothing to cancel anyway.

                    elif t == "response.created":
                        resp_state["active"] = True
                        resp_state["spoke"] = False

                    elif t == "response.done":
                        resp_state["active"] = False
                        # Surface a failed/empty response (e.g. rate_limit_exceeded)
                        # — these arrive as response.done with status=failed, NOT as
                        # an `error` event, so without this they're invisible.
                        _resp = evt.get("response") or {}
                        _status = _resp.get("status")
                        if _status and _status != "completed":
                            _sd = _resp.get("status_details") or {}
                            _err = (_sd.get("error") or {})
                            logger.warning(
                                "voicehc_response_not_completed call_sid=%s status=%s "
                                "reason=%s err_type=%s err=%s",
                                call_sid, _status, _sd.get("reason"),
                                _err.get("type"), _err.get("message"),
                            )
                        if resp_state["pending"]:
                            resp_state["pending"] = False
                            await oai.send(json.dumps({"type": "response.create"}))
                        # Robustness net: end_call's intent must resolve. Once
                        # end_call has fired, after the closing response finishes
                        # (and no further response is pending), guarantee the
                        # hangup is armed — even if a barge-in/echo cancelled the
                        # original drain timer. Never leaves the line open.
                        elif end_call_state["invoked"] and not ended["v"]:
                            ht = hangup_task["v"]
                            if ht is None or ht.done():
                                logger.info(
                                    "voicehc_rearm_hangup_after_goodbye call_sid=%s", call_sid)
                                _arm_hangup(_GOODBYE_DRAIN_SECONDS)

                    elif t == "response.function_call_arguments.done":
                        name = evt.get("name") or ""
                        call_id = evt.get("call_id") or ""
                        if call_id and call_id in dispatched_calls:
                            continue
                        if call_id:
                            dispatched_calls.add(call_id)
                        args_json = evt.get("arguments") or "{}"
                        tool_calls_count += 1
                        logger.info("voicehc_tool_start call_sid=%s tool=%s args=%s",
                                    call_sid, name, args_json[:400])

                        if name == "end_call":
                            # Ack + arm a cancellable hangup so the goodbye plays.
                            await oai.send(json.dumps({
                                "type": "conversation.item.create",
                                "item": {"type": "function_call_output",
                                         "call_id": call_id, "output": json.dumps({"ok": True})},
                            }))
                            # Latch the intent: the call MUST end after the
                            # goodbye drains. A farewell/ack/echo will no longer
                            # abort it (see transcription handler), and even if
                            # the drain timer gets cancelled, response.done
                            # re-arms it so the PSTN leg never stays open.
                            end_call_state["invoked"] = True
                            _arm_hangup(_GOODBYE_DRAIN_SECONDS)
                            # Let the model speak its closing line — but ONLY if it
                            # hasn't already. The model often says goodbye AND calls
                            # end_call in the same response; forcing another response
                            # there made it repeat the goodbye twice. If this response
                            # already produced speech, the closing line is done.
                            if resp_state.get("spoke"):
                                pass  # goodbye already spoken in this response
                            elif resp_state["active"]:
                                resp_state["pending"] = True
                            else:
                                await oai.send(json.dumps({"type": "response.create"}))
                            continue

                        tool = tool_dispatch.get(name)
                        if tool is None:
                            logger.warning("voicehc_tool_unknown call_sid=%s tool=%s", call_sid, name)
                            result: Any = {"ok": False, "error": f"unknown_tool: {name}"}
                        else:
                            try:
                                ctx = _make_tool_context(tool, call_id, args_json)
                                result = await tool.on_invoke_tool(ctx, args_json or "{}")
                            except Exception as exc:
                                logger.exception("voicehc_tool_error call_sid=%s tool=%s", call_sid, name)
                                result = {"ok": False, "error": f"tool_failed: {exc}"}

                        output = json.dumps(result) if isinstance(result, (dict, list)) else str(result)
                        logger.info("voicehc_tool_end call_sid=%s tool=%s output=%s",
                                    call_sid, name, output[:400])
                        await oai.send(json.dumps({
                            "type": "conversation.item.create",
                            "item": {"type": "function_call_output",
                                     "call_id": call_id, "output": output},
                        }))
                        # Continue the turn — but only once any active response
                        # ends (else conversation_already_has_active_response).
                        if resp_state["active"]:
                            resp_state["pending"] = True
                        else:
                            await oai.send(json.dumps({"type": "response.create"}))

                    elif t == "conversation.item.input_audio_transcription.completed":
                        rep_text = (evt.get("transcript") or "").strip()
                        # Post-end_call goodbye drain: decide whether this turn
                        # aborts the armed hangup. ONLY a substantive new request
                        # or correction keeps us on the line. A farewell, "ok /
                        # thanks / bye / got it", filler, or the agent's own
                        # goodbye echoing back must NOT abort — the call ends.
                        if end_call_state["invoked"] and not ended["v"]:
                            if _is_farewell_or_ack(rep_text):
                                logger.info(
                                    "voicehc_close_kept_farewell call_sid=%s text=%r",
                                    call_sid, rep_text[:120])
                                # Keep the hangup armed; do not persist farewell noise.
                                continue
                            # Substantive turn during the drain → genuine late
                            # request. Cancel the hangup and let the model reply.
                            if _cancel_hangup_if_pending():
                                logger.info(
                                    "voicehc_close_aborted_caller_spoke call_sid=%s text=%r",
                                    call_sid, rep_text[:120])
                            end_call_state["invoked"] = False
                        if _is_noise(rep_text) or _is_internal_prompt(rep_text):
                            continue
                        logger.info("voicehc_turn call_sid=%s role=user text=%r", call_sid, rep_text[:200])
                        _schedule_persist(session_id, "user", rep_text)
                        # NO manual response.create — create_response:true already
                        # made the reply when server_vad committed this turn.

                    elif t in ("response.audio_transcript.done",
                               "response.output_audio_transcript.done"):
                        ai_text = (evt.get("transcript") or "").strip()
                        if ai_text and not _is_internal_prompt(ai_text):
                            logger.info("voicehc_turn call_sid=%s role=assistant text=%r",
                                        call_sid, ai_text[:200])
                            _schedule_persist(session_id, "assistant", ai_text)

                    elif t == "error":
                        logger.error("voicehc_openai_error call_sid=%s err=%s",
                                     call_sid, evt.get("error") or evt)

            # ---- 6. Run both pumps + hangup waiter. ----
            t2o = asyncio.ensure_future(pump_twilio_to_oai())
            o2t = asyncio.ensure_future(pump_oai_to_twilio())
            hangup_waiter = asyncio.ensure_future(hangup_event.wait())
            try:
                done, _ = await asyncio.wait(
                    [t2o, o2t, hangup_waiter],
                    timeout=_MAX_CALL_SECONDS,
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if not done:
                    end_reason = "max-duration"
                    logger.warning("voicehc_session_timeout call_sid=%s", call_sid)
                elif hangup_waiter in done:
                    end_reason = "end-call-tool"
                    logger.info("voicehc_hangup_signal call_sid=%s", call_sid)
                    await asyncio.sleep(1.0)  # let the closing line finish
                elif o2t in done:
                    end_reason = "openai-close"
            finally:
                for task in (t2o, o2t, hangup_waiter):
                    task.cancel()
                    try:
                        await task
                    except (asyncio.CancelledError, Exception):
                        pass
    except Exception:
        logger.warning("voicehc_media_bridge_ended call_sid=%s", call_sid, exc_info=True)
    finally:
        ended["v"] = True
        ht = hangup_task["v"]
        if ht and not ht.done():
            ht.cancel()
        duration_s = time.monotonic() - t_call_start
        ttfa_ms = (t_first_audio_out - t_call_start) * 1000 if t_first_audio_out else -1.0
        logger.info(
            "voicehc_session_end call_sid=%s session_id=%s duration_s=%.1f "
            "end_reason=%s ttfa_ms=%.0f tool_calls=%d bridge=hc",
            call_sid, session_id, duration_s, end_reason, ttfa_ms, tool_calls_count,
        )
        end_call_event.set(None)
        if end_reason != "remote-close":
            try:
                await twilio_ws.close(code=1000, reason="end-of-call")
            except Exception:
                pass
            await asyncio.get_running_loop().run_in_executor(None, _twilio_rest_hangup, call_sid)
        await asyncio.get_running_loop().run_in_executor(None, _mark_session_ended, session_id)

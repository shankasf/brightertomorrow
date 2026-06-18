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
import time
from typing import Any

try:
    import audioop  # stdlib (deprecated 3.13+, present in 3.12)
except ImportError:  # pragma: no cover — graceful fallback, no gating
    audioop = None  # type: ignore[assignment]

from agents.realtime import (
    RealtimeAudio,
    RealtimeAudioEnd,
    RealtimeAudioInterrupted,
    RealtimeError,
    RealtimeHandoffEvent,
    RealtimeHistoryAdded,
    RealtimeHistoryUpdated,
    RealtimeRawModelEvent,
    RealtimeRunner,
    RealtimeToolEnd,
    RealtimeToolStart,
)
from agents.realtime.model_inputs import RealtimeModelSendRawMessage
from fastapi import WebSocket, WebSocketDisconnect

from .bt_agents.realtime import (
    TRANSCRIPTION_LOGPROB_INCLUDE,
    build_realtime_triage,
    build_telephony_run_config,
    low_confidence_logprob_threshold,
    realtime_model_name,
    realtime_ws_url,
    tracing_config,
)

logger = logging.getLogger(__name__)

# Hard ceiling per call (cost + abuse guard). Twilio also enforces its own
# call duration limit, so this is a defense-in-depth cap.
_MAX_CALL_SECONDS = int(os.environ.get("TWILIO_MAX_CALL_SECONDS", "900"))  # 15 min

# Echo-gate RMS floor (16-bit PCM scale, max 32767). PSTN reflects a fraction
# of our outbound audio back into the inbound stream — without gating, that
# echo crosses server_vad's energy threshold and the model thinks the caller
# is barging in, truncates its turn, restarts from the top, and loops on the
# opening filler (call CA7d21a72a, 2026-05-15: "Let me pull up some openings"
# 5× in 7s). Real caller speech RMS on PSTN is typically 3000-8000; echo
# tail is below ~1500. Drop inbound frames under the floor only while the
# assistant is actively speaking, so barge-in still works the moment the
# caller speaks loud enough.
_ECHO_GATE_RMS = int(os.environ.get("TWILIO_ECHO_GATE_RMS", "1500"))

# Echo-gate hangover (hold-over) window. PSTN reflects our outbound audio back
# with a round-trip delay (~100-400ms), so the tail of the assistant's speech
# keeps landing on the inbound stream for a beat AFTER RealtimeAudioEnd fires.
# Without a hold-over the gate opens the instant the assistant stops, that echo
# tail clears server_vad, and the model transcribes its own trailing words as a
# PHANTOM caller turn (call CA0518c151, 2026-05-23: assistant said "No need to
# reconfirm insurance again" -> phantom user turn "Exactly, I won't ask about
# insurance again", which re-armed the response loop). Keep gating sub-floor
# frames for this long past the last assistant audio frame. Real caller speech
# is above the RMS floor and still passes immediately, so barge-in latency is
# unchanged. This is the standard half-duplex echo-suppressor hold time — the
# official Twilio/OpenAI sample relies on server_vad threshold alone, but raw
# PSTN echo on g711_ulaw needs this tail.
_ECHO_GATE_HANGOVER_S = (
    float(os.environ.get("TWILIO_ECHO_GATE_HANGOVER_MS", "400")) / 1000.0
)

# Caller-silence thresholds. Turn-taking + idle re-prompt are native to
# server_vad (create_response + idle_timeout_ms); this watchdog adds a guarded
# one-shot nudge (post-barge-in stall recovery) and the hard 120s cutoff.
_SILENCE_HANGUP_S = 120.0
_SILENCE_TICK_S = 1.0
# Guarded response nudge: if a caller turn landed and the model hasn't replied
# within this long AND no response is active, fire one response.create. Covers
# the realtime quirk where a barge-in cancels the reply and create_response
# doesn't re-fire (call CA60ce74, 2026-05-24: clean DOB → 30s dead air).
_RESPONSE_NUDGE_S = 3.5
_RESPONSE_NUDGE_INSTRUCTIONS = (
    "Continue now — reply to what the caller just said and move to the next "
    "step. Do NOT repeat the HIPAA disclosure, and do NOT say you didn't catch "
    "anything unless you truly received no transcript."
)

_HANGUP_GOODBYE_INSTRUCTIONS = (
    "The caller has been silent for about two minutes. The line is "
    "almost certainly inactive. Say ONE short warm farewell — e.g. "
    "'It looks like you may have stepped away. I'll close out for now, "
    "but you can reach us anytime at 725-238-6990. Take care.' Then "
    "stop. Do not ask any further questions. Do not call any tools."
)

_HANDOFF_NUDGE_INSTRUCTIONS = (
    "You just took over from another agent silently. The caller does NOT "
    "know a handoff happened. SPEAK FIRST — do not wait for the caller. "
    "One short sentence that moves their request forward (e.g. 'Happy to "
    "get you booked — I'll need a few quick things to start'). "
    "FORBIDDEN PHRASES — your sentence MUST NOT contain any of: "
    "'transfer', 'connect', 'get you over to', 'over to scheduling', "
    "'take it from here', 'route you to', 'pass you to', 'put you "
    "through', 'I'll get someone', 'one moment while I'. The handoff "
    "was silent and stays silent — the caller experiences one continuous "
    "conversation."
)

_HALLUCINATED_REPROMPT_INSTRUCTIONS = (
    "The caller's last audio turn was discarded as unintelligible — "
    "background noise, dropped audio, or an ASR boilerplate "
    "hallucination. You do NOT have any value from that turn. "
    "Do NOT invent or guess what they 'probably' said. "
    "Say ONE short warm sentence asking them to repeat just the field "
    "you were collecting, spelling it out letter by letter (or digit "
    "by digit for numbers). Example: 'Sorry — I didn't catch that. "
    "Could you say it again, letter by letter?'"
)

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
_OPENING_GREETING_INSTRUCTIONS = (
    "A caller just dialed in on a HIPAA-secure phone line. Speak first; "
    "do NOT wait, do NOT read these instructions aloud. Keep it to TWO "
    "short sentences: (1) greet them as the Brighter Tomorrow assistant on "
    "a HIPAA-secure line; (2) note we're a Nevada practice — they can book "
    "from any state but need to be in Nevada for the visit, in person or by "
    "video — then ask how you can help. Speak slowly — phone audio is "
    "narrowband."
)


def _is_internal_prompt(text: str) -> bool:
    s = (text or "").lstrip()
    return s.startswith(_INTERNAL_PROMPT_PREFIX) or s.startswith("[SYSTEM:")


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


# Reason stamped on /admin/callbacks rows for phone callers who dropped the
# line before the agent finished. Written for the staff member who'll phone
# them back, not the caller.
_ABANDONED_CALL_REASON = (
    "Caller hung up before the call finished — please call them back to complete intake."
)


def _log_abandoned_callback(phone: str) -> None:
    """Create a /admin/callbacks row for a phone caller who dropped mid-call.

    Fires only for calls that ended by caller hangup ("remote-close") or the
    120s silence timeout — never a clean agent-ended call. The caller's name is
    unknown at hangup, so the row is logged as "Unknown caller" against the
    Twilio ANI. The gateway de-dupes by phone over a 24h window, so a caller who
    redials and drops again doesn't pile up duplicate rows. Best-effort: a
    failure here just means staff won't see this particular missed call.
    """
    phone = (phone or "").strip()
    if not phone:
        return
    import urllib.request
    base = os.environ.get("BT_GATEWAY_URL", "http://bt-gateway")
    payload = json.dumps({
        "first_name": "Unknown",
        "last_name": "caller",
        "phone": phone,
        "reason": _ABANDONED_CALL_REASON,
        "source": "voice-phone",
        "dedupe_by_phone_hours": 24,
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{base}/internal/callback/submit",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=3) as r:
            if r.status >= 400:
                logger.warning(
                    "twilio_abandoned_callback_status phone=***%s status=%s",
                    phone[-4:], r.status,
                )
    except Exception:
        logger.exception("twilio_abandoned_callback_failed phone=***%s", phone[-4:])


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


async def _emit_response_create(session: Any, instructions: str) -> None:
    """Push a raw response.create event with custom instructions.

    Mirrors voice.py — bypasses session.send_message (which would create a
    phantom user turn and may not auto-respond) and tells the model to
    speak immediately with a one-shot directive.
    """
    await session.model.send_event(
        RealtimeModelSendRawMessage(
            message={
                "type": "response.create",
                "other_data": {"response": {"instructions": instructions}},
            }
        )
    )


def _twilio_rest_hangup(call_sid: str) -> None:
    """Best-effort REST call to mark the call 'completed' on Twilio.

    Belt-and-suspenders with the WebSocket close: Twilio's Media Streams
    docs say closing the WS ends the call, but in practice we've seen the
    PSTN leg linger after WS close. Hitting the REST API guarantees the
    caller's line drops within ~1s.
    """
    if not call_sid:
        return
    account_sid = (os.environ.get("TWILIO_ACCOUNT_SID") or "").strip()
    if not account_sid:
        logger.info("twilio_rest_hangup_skipped reason=missing_account_sid call_sid=%s", call_sid)
        return
    # Prefer API Key (SID + Secret) over Account SID + Auth Token — API keys
    # can be rotated independently of the account.
    api_key_sid = (os.environ.get("TWILIO_API_KEY_SID") or "").strip()
    api_key_secret = (os.environ.get("TWILIO_API_KEY_SECRET") or "").strip()
    auth_token = (os.environ.get("TWILIO_AUTH_TOKEN") or "").strip()
    if api_key_sid and api_key_secret:
        auth = (api_key_sid, api_key_secret)
    elif auth_token:
        auth = (account_sid, auth_token)
    else:
        logger.info("twilio_rest_hangup_skipped reason=missing_credentials call_sid=%s", call_sid)
        return
    import urllib.request, urllib.parse, base64 as _b64
    url = (
        f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}"
        f"/Calls/{call_sid}.json"
    )
    data = urllib.parse.urlencode({"Status": "completed"}).encode("utf-8")
    basic = _b64.b64encode(f"{auth[0]}:{auth[1]}".encode("utf-8")).decode("ascii")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Basic {basic}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            logger.info(
                "twilio_rest_hangup call_sid=%s status=%s",
                call_sid, resp.status,
            )
    except Exception:
        logger.warning("twilio_rest_hangup_failed call_sid=%s", call_sid, exc_info=True)


class _SilenceState:
    """Caller-silence clock shared by the session pump and watchdog.

    The clock starts when the assistant's audio finishes (or at session
    start) and resets whenever a real caller turn lands or the assistant
    starts speaking again.
    """

    __slots__ = (
        "last_caller_quiet_since",
        "assistant_speaking",
        "last_assistant_audio_ts",
        "hangup_sent",
        "ended",
        "awaiting_response",
        "response_nudged",
        "response_active",
    )

    def __init__(self) -> None:
        # Greeting is about to play — treat assistant as speaking so the
        # silence clock doesn't start before the model has said anything.
        self.last_caller_quiet_since: float | None = None
        self.assistant_speaking: bool = True
        # Monotonic ts of the most recent assistant audio frame. Drives the
        # echo-gate hangover so the PSTN echo tail is suppressed for
        # _ECHO_GATE_HANGOVER_S after RealtimeAudioEnd, not just while speaking.
        self.last_assistant_audio_ts: float = time.monotonic()
        self.hangup_sent: bool = False
        self.ended: bool = False
        # GUARDED response nudge: a caller turn landed (awaiting_response) but
        # the model never produced a reply — happens intermittently after a
        # barge-in cancels the in-flight response and create_response doesn't
        # re-fire. We nudge ONCE, but only when response_active is False, so we
        # never collide with a VAD-driven response ("only one response at a
        # time"). response_active tracks response.created→done/cancelled.
        self.awaiting_response: bool = False
        self.response_nudged: bool = False
        self.response_active: bool = True   # greeting response is in flight

    def on_assistant_audio_frame(self) -> None:
        self.assistant_speaking = True
        self.response_active = True
        self.last_assistant_audio_ts = time.monotonic()
        self.last_caller_quiet_since = None
        # Model is replying — the nudge is no longer needed for this turn.
        self.awaiting_response = False
        self.response_nudged = False

    def on_assistant_audio_end(self) -> None:
        self.assistant_speaking = False
        self.response_active = False
        self.last_caller_quiet_since = time.monotonic()

    def on_caller_turn(self) -> None:
        # Reset the silence clock and arm the guarded nudge: VAD owns the reply
        # (create_response), but if it whiffs after a barge-in the watchdog will
        # nudge once, only while no response is active.
        self.last_caller_quiet_since = time.monotonic()
        self.awaiting_response = True
        self.response_nudged = False


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
    _ani: str = ""
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
                # Caller ANI from the gateway TwiML <Parameter caller_phone>.
                # Stamp the contextvar (set here, before the SDK session/tool
                # tasks are created, so it propagates like agent_source) so the
                # callback/booking tools fall back to it instead of a
                # model-fabricated number.
                _ani = (custom.get("caller_phone") or "").strip()
                if _ani:
                    from .integrations.voice_tools import caller_phone as _caller_phone_ctx
                    _caller_phone_ctx.set(_ani)
                logger.info(
                    "twilio_start stream_sid=%s call_sid=%s session_id=%s caller=%s",
                    stream_sid, call_sid, session_id,
                    ("***" + _ani[-4:]) if _ani else "?",
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
    # NOTE: do NOT set an explicit model_settings["tracing"] config here.
    # On this project the realtime service's trace export region-mismatches
    # and tears the session down ~2.5s in with `incorrect_hostname`
    # (2026-05-23). Default tracing is left as-is; custom workflow_name/
    # group_id correlation is blocked until the project's trace region is
    # sorted out. tracing_config() is kept in config.py for when it is.
    runner = RealtimeRunner(
        starting_agent=build_realtime_triage(caller_phone=_ani or None),
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
    # Set True once book_appointment confirms an appointment on this call, so a
    # caller who finishes booking and then hangs up (or goes silent) isn't
    # logged as a missed-call callback. See the RealtimeToolEnd handler + the
    # abandoned-callback guard in the finally block below.
    booking_succeeded = False
    # Created here, lives in a contextvar so the end_call tool can set it
    # without us needing to plumb it through the SDK.
    hangup_event = asyncio.Event()
    end_call_event.set(hangup_event)
    silence = _SilenceState()
    logger.info(
        "twilio_session_start call_sid=%s session_id=%s model=%s",
        call_sid, session_id, model,
    )

    # ---- 3. Bidirectional pumps. ----
    # Echo-gate counters. Logged on session_end so we can tune the floor
    # from real PSTN data (raise if echo still leaks; lower if barge-in
    # feels sluggish).
    echo_dropped_frames = 0
    echo_passed_frames = 0

    async def twilio_to_session() -> None:
        nonlocal echo_dropped_frames, echo_passed_frames
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
                    # Echo gate: while the assistant is speaking — and for a
                    # short hangover after its last frame — drop inbound frames
                    # whose energy is below the echo floor (likely our own
                    # outbound audio reflecting back through PSTN). The hangover
                    # covers the round-trip echo tail that keeps arriving after
                    # RealtimeAudioEnd, so it can't surface as a phantom caller
                    # turn. Real caller speech is well above the floor and
                    # passes through either way, so barge-in latency is unchanged.
                    gate_active = silence.assistant_speaking or (
                        time.monotonic() - silence.last_assistant_audio_ts
                        < _ECHO_GATE_HANGOVER_S
                    )
                    if audioop is not None and gate_active and audio_bytes:
                        try:
                            pcm = audioop.ulaw2lin(audio_bytes, 2)
                            rms = audioop.rms(pcm, 2)
                        except Exception:
                            rms = _ECHO_GATE_RMS  # fail-open
                        if rms < _ECHO_GATE_RMS:
                            echo_dropped_frames += 1
                            continue
                        echo_passed_frames += 1
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

    # RealtimeHistoryAdded fires when an item is FIRST appended to history.
    # For audio turns the transcript hasn't landed yet, so _extract_text()
    # returns "" and we'd skip persistence forever — which is exactly the
    # bug that left voice-phone sessions empty in /admin/chat. The transcript
    # arrives later on RealtimeHistoryUpdated. We dedupe by item_id so the
    # same turn isn't written twice when both events carry text.
    persisted_item_ids: set[str] = set()

    async def _consider_history_item(item: Any) -> None:
        item_id = getattr(item, "item_id", None)
        if not item_id or item_id in persisted_item_ids:
            return
        role = getattr(item, "role", None)
        text = _extract_text(item)
        if not text:
            return  # transcript hasn't filled in yet — wait for next update.
        if role == "user":
            if _is_internal_prompt(text):
                persisted_item_ids.add(item_id)
                return
            # (boilerplate ASR-hallucination filter removed — it false-positived
            # on legitimate caller input, e.g. dropping every email address that
            # contained ".com". The per-token logprob filter
            # _maybe_drop_low_confidence remains the safety net for true
            # silence/noise hallucinations.)
            silence.on_caller_turn()
            logger.info("twilio_turn call_sid=%s role=user text=%r", call_sid, text[:200])
            _schedule_persist(session_id, "user", text)
        elif role == "assistant":
            logger.info("twilio_turn call_sid=%s role=assistant text=%r", call_sid, text[:200])
            _schedule_persist(session_id, "assistant", text)
        else:
            return
        persisted_item_ids.add(item_id)

    async def _maybe_drop_low_confidence(srv: dict[str, Any]) -> None:
        """Drop low-confidence transcripts before they reach the agent.

        The raw `conversation.item.input_audio_transcription.completed` event
        carries per-token logprobs (we opted in via include). Whisper-family
        models produce near-zero logprobs on real speech and sharply negative
        logprobs on silence-driven hallucinations. We compare the mean to
        ``low_confidence_logprob_threshold()`` and, if below, interrupt the
        in-flight response, mark the item persisted so _consider_history_item
        skips it, server-side delete the item so the model doesn't re-read it
        on the next turn, and reprompt the caller with the same warm copy as
        the text-based hallucination path.
        """
        item_id = srv.get("item_id")
        logprobs = srv.get("logprobs") or []
        transcript = srv.get("transcript", "") or ""
        if not item_id or not logprobs:
            return
        vals = [
            lp.get("logprob")
            for lp in logprobs
            if isinstance(lp, dict)
            and isinstance(lp.get("logprob"), (int, float))
        ]
        if not vals:
            return
        mean_lp = sum(vals) / len(vals)
        threshold = low_confidence_logprob_threshold()
        if mean_lp >= threshold:
            return
        persisted_item_ids.add(item_id)
        logger.info(
            "twilio_drop_low_confidence call_sid=%s item_id=%s "
            "mean_logprob=%.2f threshold=%.2f text=%r",
            call_sid, item_id, mean_lp, threshold, transcript,
        )
        try:
            await session.interrupt()
        except Exception:
            logger.debug(
                "twilio_low_confidence_interrupt_failed call_sid=%s",
                call_sid, exc_info=True,
            )
        try:
            await session.model.send_event(
                RealtimeModelSendRawMessage(
                    message={
                        "type": "conversation.item.delete",
                        "other_data": {"item_id": item_id},
                    }
                )
            )
        except Exception:
            logger.debug(
                "twilio_low_confidence_delete_failed call_sid=%s",
                call_sid, exc_info=True,
            )
        try:
            await _emit_response_create(
                session, _HALLUCINATED_REPROMPT_INSTRUCTIONS,
            )
        except Exception:
            logger.warning(
                "twilio_low_confidence_reprompt_failed call_sid=%s",
                call_sid, exc_info=True,
            )
        silence.last_caller_quiet_since = time.monotonic()

    async def session_to_twilio() -> None:
        try:
            # Opt the session into per-token logprobs on input transcription.
            # The Agents SDK has no typed surface for the `include` field
            # (RealtimeInputAudioTranscriptionConfig only exposes model /
            # language / prompt), so we send a raw session.update. Logprobs
            # let us drop low-confidence ASR hallucinations on PSTN silence
            # before they reach Triage (the failure mode behind the bogus
            # crisis handoff on CA8bc6a40c…, 2026-05-15).
            await asyncio.sleep(0.05)
            try:
                await session.model.send_event(
                    RealtimeModelSendRawMessage(
                        message={
                            "type": "session.update",
                            "other_data": {
                                "session": {
                                    # `type: "realtime"` is the required
                                    # discriminator on the GA Session union
                                    # (RealtimeSessionCreateRequestParam vs
                                    # RealtimeTranscriptionSessionCreateRequestParam).
                                    # Without it, the SDK's TypeAdapter drops
                                    # the message with "Failed to convert raw
                                    # message" and the include never lands.
                                    "type": "realtime",
                                    "include": list(TRANSCRIPTION_LOGPROB_INCLUDE),
                                }
                            },
                        }
                    )
                )
            except Exception:
                logger.warning(
                    "twilio_logprob_include_failed call_sid=%s",
                    call_sid, exc_info=True,
                )

            # Proactive opening greeting — 2-event pattern (conversation.item.create
            # + response.create) mirrors voice.py. send_message() relies on VAD
            # to auto-respond, which is unreliable on the very first turn before
            # the caller has spoken; explicit response.create forces audio out.
            try:
                directive_text = (
                    f"{_INTERNAL_PROMPT_PREFIX} {_OPENING_GREETING_INSTRUCTIONS}"
                )
                await session.model.send_event(
                    RealtimeModelSendRawMessage(
                        message={
                            "type": "conversation.item.create",
                            "other_data": {
                                "item": {
                                    "type": "message",
                                    "role": "user",
                                    "content": [
                                        {"type": "input_text", "text": directive_text}
                                    ],
                                }
                            },
                        }
                    )
                )
                await session.model.send_event(
                    RealtimeModelSendRawMessage(
                        message={"type": "response.create", "other_data": {}}
                    )
                )
            except Exception:
                logger.warning(
                    "twilio_greeting_failed call_sid=%s",
                    call_sid, exc_info=True,
                )

            nonlocal t_first_audio_out, t_first_tool_call
            nonlocal tool_calls_count, handoffs_count, booking_succeeded
            async for event in session:
                if isinstance(event, RealtimeAudio):
                    silence.on_assistant_audio_frame()
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

                if isinstance(event, RealtimeAudioEnd):
                    silence.on_assistant_audio_end()
                    continue

                if isinstance(event, RealtimeAudioInterrupted):
                    # The realtime model decided the caller barged in — flush
                    # Twilio's playback queue so the caller doesn't hear the
                    # tail of the previous assistant turn.
                    logger.info(
                        "twilio_audio_interrupted call_sid=%s item_id=%s",
                        call_sid, getattr(event, "item_id", None),
                    )
                    # CRITICAL: a barge-in CANCELS the assistant's audio, and no
                    # RealtimeAudioEnd follows. Without resetting here,
                    # `assistant_speaking` stays True forever, which DISABLES the
                    # silence watchdog (it skips check-backs while the assistant
                    # is "speaking") — so if the model then doesn't auto-respond,
                    # the call hangs in permanent dead air until the caller gives
                    # up (2026-05-23 stuck-silence incident). Treat the assistant
                    # as done speaking and restart the caller-quiet clock.
                    silence.on_assistant_audio_end()
                    try:
                        await _send_twilio_clear(twilio_ws, stream_sid)
                    except Exception:
                        logger.debug(
                            "twilio_clear_failed call_sid=%s",
                            call_sid, exc_info=True,
                        )
                    continue

                if isinstance(event, RealtimeRawModelEvent):
                    # Inspect raw server events for transcription logprobs.
                    # The parsed `input_audio_transcription_completed` event
                    # the SDK exposes strips the per-token logprob array, so
                    # we read it off the underlying raw payload (enabled via
                    # the session.update include we sent at session start).
                    # Low mean logprob = whisper hallucinating on silence;
                    # drop the turn before _consider_history_item below runs.
                    inner = getattr(event, "data", None)
                    if (
                        inner is not None
                        and getattr(inner, "type", None) == "raw_server_event"
                    ):
                        srv = getattr(inner, "data", None) or {}
                        if isinstance(srv, dict):
                            srv_type = srv.get("type")
                            if srv_type == "conversation.item.input_audio_transcription.completed":
                                await _maybe_drop_low_confidence(srv)
                            # Track response lifecycle so the guarded nudge never
                            # fires while a response is in flight (incl. the
                            # pre-audio "thinking"/tool window before the first
                            # audio frame).
                            elif srv_type == "response.created":
                                silence.response_active = True
                            elif srv_type in (
                                "response.done",
                                "response.cancelled",
                                "response.failed",
                            ):
                                silence.response_active = False
                    continue

                if isinstance(event, RealtimeHistoryAdded):
                    await _consider_history_item(event.item)
                    continue

                if isinstance(event, RealtimeHistoryUpdated):
                    # Fires when an item already in history changes — e.g. a
                    # user audio item gains a transcript after gpt-4o-mini-
                    # transcribe finishes. _consider_history_item dedupes by
                    # item_id so already-persisted turns are skipped.
                    for it in event.history:
                        await _consider_history_item(it)
                    continue

                if isinstance(event, RealtimeHandoffEvent):
                    handoffs_count += 1
                    logger.info(
                        "twilio_handoff call_sid=%s from=%s to=%s",
                        call_sid,
                        getattr(event.from_agent, "name", "?"),
                        getattr(event.to_agent, "name", "?"),
                    )
                    # Force the new agent to speak immediately. Without an
                    # explicit response.create the SDK waits for the next
                    # caller turn, and the caller sits in silence after
                    # "let me transfer you" — which is exactly the bug we
                    # saw in production (call CA0753be… 02:48-02:59).
                    try:
                        await _emit_response_create(
                            session, _HANDOFF_NUDGE_INSTRUCTIONS,
                        )
                    except Exception:
                        logger.warning(
                            "twilio_handoff_emit_failed call_sid=%s",
                            call_sid, exc_info=True,
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
                        "twilio_tool_start call_sid=%s tool=%s args=%s",
                        call_sid, tool_name, str(getattr(event, "arguments", ""))[:400],
                    )
                    continue

                if isinstance(event, RealtimeToolEnd):
                    tool_name = getattr(event.tool, "name", "?")
                    tool_out = str(getattr(event, "output", ""))
                    logger.info(
                        "twilio_tool_end call_sid=%s tool=%s output=%s",
                        call_sid, tool_name, tool_out[:400],
                    )
                    # A confirmed booking means the caller got what they came
                    # for — suppress the missed-call callback even if they then
                    # hang up or go silent. book_appointment only returns the
                    # "appointment_id" key on success; every failure path returns
                    # an "error" instead.
                    if tool_name == "book_appointment" and "appointment_id" in tool_out:
                        booking_succeeded = True
                        logger.info("twilio_booking_succeeded call_sid=%s", call_sid)
                    if tool_name == "end_call":
                        # Side-channel signal in case the contextvar path
                        # in the tool function ran in an SDK-owned context
                        # where end_call_event was empty. Mirrors voice.py.
                        hangup_event.set()
                        continue
                    # A tool result OWES a spoken reply (announce coverage,
                    # read slots, etc.). The SDK should auto-continue the
                    # response, but it intermittently stalls and leaves the
                    # line dead (call CAc13a47, 2026-05-24: verify_coverage
                    # returned active, then 51s of silence). Arm the guarded
                    # nudge: if no audio comes within _RESPONSE_NUDGE_S we fire
                    # one response.create. response_active is set False so the
                    # nudge is eligible; if the model DOES auto-continue, its
                    # first audio frame disarms the nudge before it fires.
                    silence.last_caller_quiet_since = time.monotonic()
                    silence.awaiting_response = True
                    silence.response_nudged = False
                    silence.response_active = False
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

    async def silence_watchdog() -> None:
        """Turn-taking is owned by server_vad (create_response) + native
        idle_timeout_ms. This watchdog adds two narrow safety nets: a GUARDED
        one-shot response nudge (recovers the intermittent post-barge-in stall
        where the model never replies to a landed caller turn), and the hard
        120s hangup for a genuinely abandoned line. The nudge fires ONLY when
        no response is active, so it can't collide with a VAD-driven response.
        """
        try:
            while not silence.ended:
                await asyncio.sleep(_SILENCE_TICK_S)
                if silence.ended:
                    return
                if silence.assistant_speaking or silence.last_caller_quiet_since is None:
                    continue
                idle = time.monotonic() - silence.last_caller_quiet_since
                # GUARDED response nudge: the caller's turn landed but the model
                # produced no reply (barge-in cancelled its response and
                # create_response didn't re-fire). Nudge once — but only if no
                # response is currently active, so we never double-create.
                if (
                    silence.awaiting_response
                    and not silence.response_nudged
                    and not silence.response_active
                    and idle >= _RESPONSE_NUDGE_S
                ):
                    silence.response_nudged = True
                    logger.info(
                        "twilio_response_nudge call_sid=%s waited_s=%.1f",
                        call_sid, idle,
                    )
                    try:
                        await _emit_response_create(session, _RESPONSE_NUDGE_INSTRUCTIONS)
                    except Exception:
                        logger.warning(
                            "twilio_response_nudge_emit_failed call_sid=%s",
                            call_sid, exc_info=True,
                        )
                    continue
                if idle >= _SILENCE_HANGUP_S and not silence.hangup_sent:
                    silence.hangup_sent = True
                    logger.info(
                        "twilio_silence_hangup call_sid=%s idle_s=%.1f",
                        call_sid, idle,
                    )
                    try:
                        await _emit_response_create(session, _HANGUP_GOODBYE_INSTRUCTIONS)
                    except Exception:
                        logger.warning(
                            "twilio_silence_hangup_emit_failed call_sid=%s",
                            call_sid, exc_info=True,
                        )
                    await asyncio.sleep(6.0)
                    hangup_event.set()
                    return
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning(
                "twilio_silence_watchdog ended call_sid=%s",
                call_sid, exc_info=True,
            )

    async with session:
        t2s = asyncio.ensure_future(twilio_to_session())
        s2t = asyncio.ensure_future(session_to_twilio())
        watchdog = asyncio.ensure_future(silence_watchdog())
        # Wraps hangup_event.wait() so we can put it in asyncio.wait alongside
        # the two pumps. When the realtime `end_call` tool fires, this resolves
        # and the session ends cleanly.
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
                end_reason = "end-call-tool" if not silence.hangup_sent else "silence-timeout"
                logger.info(
                    "twilio_hangup_signal call_sid=%s reason=%s",
                    call_sid, end_reason,
                )
                # Give the assistant ~1.5s to finish its closing sentence
                # before we drop the line. Without this the caller hears
                # "Have a great—" and then dead air.
                await asyncio.sleep(1.5)
        finally:
            silence.ended = True
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
                "end_reason=%s ttfa_ms=%.0f tttc_ms=%.0f tool_calls=%d handoffs=%d "
                "echo_dropped=%d echo_passed=%d echo_floor=%d",
                call_sid, session_id, duration_s, end_reason,
                ttfa_ms, tttc_ms, tool_calls_count, handoffs_count,
                echo_dropped_frames, echo_passed_frames, _ECHO_GATE_RMS,
            )
            # Clear the contextvar so a stale Event can't be set by an
            # end_call tool that fires on a future session.
            end_call_event.set(None)
            for task in (t2s, s2t, watchdog, hangup_waiter):
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass

            # Close the Twilio WS explicitly. Without this, the caller's PSTN
            # leg can linger for up to a minute waiting on Twilio's own idle
            # timeout (observed: 70+s after end_call_signalled). REST hangup
            # is the belt-and-suspenders backup in case Twilio doesn't honor
            # the WS close.
            if end_reason != "remote-close":
                try:
                    await twilio_ws.close(code=1000, reason="end-of-call")
                except Exception:
                    logger.debug(
                        "twilio_ws_close_failed call_sid=%s",
                        call_sid, exc_info=True,
                    )
                await asyncio.get_running_loop().run_in_executor(
                    None, _twilio_rest_hangup, call_sid,
                )

            pending = set(_inflight_tasks)
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)

            # Flip chat_sessions.ended_at so the admin UI stops showing this
            # call as "active". Runs after _inflight_tasks drains so any last
            # turn is persisted first. Best-effort — sweeper is the safety net.
            await asyncio.get_running_loop().run_in_executor(
                None, _mark_session_ended, session_id,
            )

            # A caller who hangs up mid-call (remote-close) or goes silent for
            # 120s (silence-timeout) never got what they called for — log a
            # callback row so staff can phone them back. Clean agent-ended
            # ("end-call-tool") and max-duration calls are excluded, as are
            # calls where the caller already confirmed a booking (they got what
            # they came for). Needs the Twilio ANI to have a number to call.
            # De-duped by phone (24h) at the gateway; best-effort.
            if (
                end_reason in ("remote-close", "silence-timeout")
                and _ani
                and not booking_succeeded
            ):
                await asyncio.get_running_loop().run_in_executor(
                    None, _log_abandoned_callback, _ani,
                )

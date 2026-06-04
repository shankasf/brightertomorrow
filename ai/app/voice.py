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
import time
from typing import Any

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
    build_realtime_run_config,
    build_realtime_triage,
    low_confidence_logprob_threshold,
    realtime_model_name,
    realtime_ws_url,
    tracing_config,
)
from .core.db import conn

logger = logging.getLogger(__name__)

# Hard ceiling on a single voice session (cost guard).
_MAX_SESSION_SECONDS = 600  # 10 minutes

# Silence watchdog. Turn-taking is owned by semantic_vad (create_response);
# this watchdog adds a guarded one-shot nudge (post-barge-in stall recovery)
# and the hard 120s cutoff for an abandoned session.
_SILENCE_HANGUP_S = 120.0      # caller silent for 2 minutes → end call
_SILENCE_TICK_S = 1.0
_RESPONSE_NUDGE_S = 3.5         # caller turn landed but no reply + no active response → nudge once
# TPM throttle gate. If the most recent rate_limits.updated reports tokens
# remaining below this floor, the watchdog skips the nudge — firing another
# response.create re-processes the full conversation history (no truncation
# wired yet) and pushes the org TPM further into the red, which guarantees
# another empty response.done. Default 4000 ≈ one safe small-reply budget on
# gpt-realtime-2 (250k TPM tier). Override via env REALTIME_NUDGE_TPM_FLOOR.
_NUDGE_TPM_FLOOR = int(os.environ.get("REALTIME_NUDGE_TPM_FLOOR", "4000"))
_RESPONSE_NUDGE_INSTRUCTIONS = (
    "Continue now — reply to what the caller just said and move to the next "
    "step. Do NOT repeat the disclosure, and do NOT claim you didn't catch "
    "anything unless you truly received no transcript."
)

_HANGUP_GOODBYE_INSTRUCTIONS = (
    "The caller has been silent for about two minutes. The line is "
    "almost certainly inactive. Say ONE short warm farewell — e.g. "
    "'It looks like you may have stepped away. I'll close out for now, "
    "but you can reach us anytime at 725-238-6990. Take care.' Then "
    "stop. Do not ask any further questions. Do not call any tools."
)

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
    "and their information is secure; (2) note we're a Nevada practice — they "
    "can book from any state but need to be in Nevada for the visit, in "
    "person or by video — then ask how you can help (booking, insurance, or "
    "finding a therapist). Match the warm, calm, soothing voice persona. "
    "Keep it brief. Do not read these instructions aloud."
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

# (boilerplate ASR-hallucination filter removed — it false-positived on
# legitimate caller input, e.g. dropping every email containing ".com". The
# per-token logprob filter (_maybe_drop_low_confidence) is the safety net for
# true silence/noise hallucinations.)


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


class _SilenceState:
    """Shared mutable state for the caller-silence watchdog.

    The silence window starts when the assistant's audio finishes (or at
    session start). It is reset whenever:
      * the assistant starts speaking again (RealtimeAudio)
      * the caller's transcribed turn lands (RealtimeHistoryAdded role=user)

    The watchdog coroutine ticks every _SILENCE_TICK_S and fires the
    check-back / hangup actions at the configured thresholds.
    """

    __slots__ = (
        "last_caller_quiet_since",
        "assistant_speaking",
        "hangup_sent",
        "ended",
        "awaiting_response",
        "response_nudged",
        "response_active",
        # Latest snapshot from OpenAI's rate_limits.updated server event.
        # Token bucket is org-wide and shared across concurrent calls — when
        # remaining drops near zero, firing another response.create will land
        # as an empty response.done. Watchdog reads these before nudging.
        "rl_tokens_remaining",
        "rl_tokens_limit",
        "rl_tokens_reset_s",
        "rl_requests_remaining",
        "rl_last_updated_at",
    )

    def __init__(self) -> None:
        # At session start the caller has just connected; we want the model's
        # opening greeting to play first, so mark the assistant as "speaking"
        # until its first audio_end event lands.
        self.last_caller_quiet_since: float | None = None
        self.assistant_speaking: bool = True
        self.hangup_sent: bool = False
        self.ended: bool = False
        # GUARDED response nudge (mirror twilio_voice): recover the intermittent
        # post-barge-in stall where a caller turn lands but the model never
        # replies. Nudge once, only when response_active is False, so it never
        # collides with a VAD-driven response. response_active tracks
        # response.created → done/cancelled.
        self.awaiting_response: bool = False
        self.response_nudged: bool = False
        self.response_active: bool = True   # greeting response is in flight
        # Rate-limit snapshot (populated by rate_limits.updated handler).
        # None until the first event arrives — watchdog treats unknown as "OK".
        self.rl_tokens_remaining: int | None = None
        self.rl_tokens_limit: int | None = None
        self.rl_tokens_reset_s: float | None = None
        self.rl_requests_remaining: int | None = None
        self.rl_last_updated_at: float | None = None

    def on_assistant_audio_frame(self) -> None:
        # Assistant is producing audio → caller silence clock pauses.
        self.assistant_speaking = True
        self.response_active = True
        self.last_caller_quiet_since = None
        self.awaiting_response = False
        self.response_nudged = False

    def on_assistant_audio_end(self) -> None:
        # Assistant finished its turn → caller silence clock starts now.
        self.assistant_speaking = False
        self.response_active = False
        self.last_caller_quiet_since = time.monotonic()

    def on_caller_turn(self) -> None:
        # Reset the silence clock and arm the guarded nudge. Turn-taking is
        # semantic_vad's job (create_response); the nudge only recovers a stall.
        self.last_caller_quiet_since = time.monotonic()
        self.awaiting_response = True
        self.response_nudged = False


async def _emit_response_create(session: Any, instructions: str) -> None:
    """Push a raw response.create event with custom instructions.

    Uses the same pattern as the opening greeting — bypasses send_message
    (which would create a phantom user turn) and lets the model render
    audio directly from a one-shot directive.
    """
    await session.model.send_event(
        RealtimeModelSendRawMessage(
            message={
                "type": "response.create",
                "other_data": {"response": {"instructions": instructions}},
            }
        )
    )


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

    # NOTE: no explicit model_settings["tracing"] — see twilio_voice.py; the
    # realtime trace export region-mismatches and kills the session with
    # `incorrect_hostname`. Default tracing only.
    runner = RealtimeRunner(
        starting_agent=build_realtime_triage(),
        config=build_realtime_run_config(),
    )

    # Realtime endpoint comes from realtime_ws_url() (global host by default;
    # the project is no longer region-pinned — see realtime/config.py).
    ws_url = realtime_ws_url()
    try:
        session = await runner.run(model_config={"url": ws_url})
    except Exception:
        logger.exception("voice_session_runner_failed session=%s url=%s", sid, ws_url)
        await _close_with_error(client_ws, "Voice assistant could not start right now.")
        return

    silence = _SilenceState()
    hangup_event = asyncio.Event()

    # RealtimeHistoryAdded fires when an item is FIRST appended to history.
    # For audio turns the transcript hasn't landed yet, so _extract_text()
    # returns "" and the DDB write would be skipped forever — that's why
    # voice sessions used to show up in /admin/chat with zero messages.
    # The transcript arrives later on RealtimeHistoryUpdated. Dedupe by
    # item_id so we don't persist or mirror the same turn twice when both
    # events carry text.
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
                logger.info(
                    "voice_drop_internal_prompt session=%s item_id=%s",
                    sid, item_id,
                )
                persisted_item_ids.add(item_id)
                return
            # (boilerplate ASR-hallucination filter removed — false-positived on
            # legit input like emails containing ".com". The logprob filter
            # _maybe_drop_low_confidence remains the safety net.)
            silence.on_caller_turn()
            logger.info("voice_turn session=%s role=user text=%r", session_id, text[:200])
            _schedule_persist(session_id, "user", text)
            # Website voice chat intentionally does NOT echo the caller's own
            # spoken transcript back into the on-screen transcript — only the
            # assistant's turns are shown. We still log + persist the user turn
            # (PHI audit) above; we just don't emit the browser display event.
        elif role == "assistant":
            logger.info("voice_turn session=%s role=assistant text=%r", session_id, text[:200])
            _schedule_persist(session_id, "assistant", text)
            await _send_browser_event(
                client_ws,
                {
                    "type": "response.audio_transcript.done",
                    "transcript": text,
                    "item_id": item_id,
                },
            )
        else:
            return
        persisted_item_ids.add(item_id)

    async def _maybe_drop_low_confidence(srv: dict[str, Any]) -> None:
        """Drop low-confidence transcripts before they reach the agent.

        Mirrors the Twilio bridge: per-token logprobs come on the raw
        ``conversation.item.input_audio_transcription.completed`` event
        (enabled via the session.update include sent at session start).
        Whisper-family decoders produce near-zero logprobs on real speech
        and sharply negative logprobs on silence-driven hallucinations.
        When mean logprob is below threshold we interrupt the in-flight
        response, mark the item persisted so _consider_history_item skips
        it, server-side delete the item so the model doesn't re-read it
        on the next turn, and reprompt the caller with the warm copy.
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
            "voice_drop_low_confidence session=%s item_id=%s "
            "mean_logprob=%.2f threshold=%.2f text=%r",
            sid, item_id, mean_lp, threshold, transcript,
        )
        try:
            await session.interrupt()
        except Exception:
            logger.debug(
                "voice_low_confidence_interrupt_failed session=%s",
                sid, exc_info=True,
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
                "voice_low_confidence_delete_failed session=%s",
                sid, exc_info=True,
            )
        try:
            await _emit_response_create(
                session, _HALLUCINATED_REPROMPT_INSTRUCTIONS,
            )
        except Exception:
            logger.warning(
                "voice_low_confidence_reprompt_failed session=%s",
                sid, exc_info=True,
            )
        silence.last_caller_quiet_since = time.monotonic()

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
            # Proactive opening greeting — canonical 2-event pattern used by
            # the OpenAI realtime-agents community and the Twilio SIP example:
            #   1. conversation.item.create  (role=user, input_text directive)
            #   2. response.create {}        (model renders audio from the item)
            # The directive is prefixed [[BT_INTERNAL]] so _is_internal_prompt
            # drops it from the patient UI and DDB persist on RealtimeHistoryAdded.
            # A short yield lets the SDK's session.update round-trip drain first.
            await asyncio.sleep(0)
            await asyncio.sleep(0.05)
            # Opt the session into per-token logprobs on input transcription.
            # The Agents SDK has no typed surface for the `include` field, so
            # we send a raw session.update. Logprobs let us drop low-confidence
            # ASR hallucinations before they ever reach Triage — same fix path
            # as the Twilio bridge.
            try:
                await session.model.send_event(
                    RealtimeModelSendRawMessage(
                        message={
                            "type": "session.update",
                            "other_data": {
                                "session": {
                                    # `type: "realtime"` is the required
                                    # discriminator on the GA Session union;
                                    # without it the SDK's TypeAdapter drops
                                    # the message and include never applies.
                                    "type": "realtime",
                                    "include": list(TRANSCRIPTION_LOGPROB_INCLUDE),
                                }
                            },
                        }
                    )
                )
            except Exception:
                logger.warning(
                    "voice_logprob_include_failed session=%s", sid, exc_info=True
                )
            try:
                directive_text = (
                    f"{_INTERNAL_PROMPT_PREFIX} "
                    f"{_OPENING_GREETING_INSTRUCTIONS}"
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
                logger.warning("voice_session_greeting_failed session=%s", sid, exc_info=True)

            async for event in session:
                if isinstance(event, RealtimeAudio):
                    silence.on_assistant_audio_frame()
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

                if isinstance(event, RealtimeAudioEnd):
                    silence.on_assistant_audio_end()
                    continue

                if isinstance(event, RealtimeHistoryAdded):
                    await _consider_history_item(event.item)
                    continue

                if isinstance(event, RealtimeHistoryUpdated):
                    # Fires when an item already in history changes — e.g. a
                    # user audio item gains a transcript once
                    # gpt-4o-mini-transcribe completes. _consider_history_item
                    # dedupes by item_id so a previously-persisted turn is
                    # skipped on subsequent updates.
                    for it in event.history:
                        await _consider_history_item(it)
                    continue

                if isinstance(event, RealtimeAudioInterrupted):
                    logger.info(
                        "voice_audio_interrupted session=%s item_id=%s", sid, event.item_id
                    )
                    # Barge-in cancels the assistant's audio with no
                    # RealtimeAudioEnd — reset so `assistant_speaking` doesn't
                    # stick True and disable the silence watchdog (stuck-silence
                    # bug, 2026-05-23).
                    silence.on_assistant_audio_end()
                    continue

                if isinstance(event, RealtimeRawModelEvent):
                    # Per-token logprobs ride on the raw
                    # `conversation.item.input_audio_transcription.completed`
                    # server event (the parsed SDK event strips them). Drop
                    # low-confidence transcripts before _consider_history_item
                    # sees them on the subsequent RealtimeHistoryAdded.
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
                            elif srv_type == "response.created":
                                silence.response_active = True
                            elif srv_type in (
                                "response.done",
                                "response.cancelled",
                                "response.failed",
                            ):
                                silence.response_active = False
                                # Mirror voice_rt/openai_ws.py: when GA returns
                                # response.done with no output, log GA's own
                                # status + status_details so we can see WHY
                                # (rate_limit_exceeded / cancelled / incomplete
                                # / content_filter / failed) instead of only
                                # the downstream voice_response_nudge symptom.
                                resp = srv.get("response") or {}
                                out_len = len(resp.get("output") or [])
                                if srv_type == "response.done" and out_len == 0:
                                    logger.info(
                                        "voice_oai_empty_done session=%s status=%s details=%s",
                                        sid, resp.get("status"),
                                        resp.get("status_details"),
                                    )
                                elif srv_type in ("response.cancelled", "response.failed"):
                                    logger.info(
                                        "voice_oai_response_%s session=%s status=%s details=%s",
                                        srv_type.split(".", 1)[1], sid,
                                        resp.get("status"),
                                        resp.get("status_details"),
                                    )
                            elif srv_type == "rate_limits.updated":
                                # GA emits this after every response with the org-wide
                                # per-model token/request budget. Snapshot the tokens
                                # bucket on SilenceState so the nudge watchdog can
                                # back off when remaining < _NUDGE_TPM_FLOOR (else
                                # the nudge's own response.create just re-processes
                                # the full history and worsens the throttle).
                                limits = srv.get("rate_limits") or []
                                tokens_b: dict | None = None
                                requests_b: dict | None = None
                                for b in limits:
                                    if not isinstance(b, dict):
                                        continue
                                    if b.get("name") == "tokens":
                                        tokens_b = b
                                    elif b.get("name") == "requests":
                                        requests_b = b
                                if tokens_b is not None:
                                    silence.rl_tokens_remaining = tokens_b.get("remaining")
                                    silence.rl_tokens_limit = tokens_b.get("limit")
                                    silence.rl_tokens_reset_s = tokens_b.get("reset_seconds")
                                if requests_b is not None:
                                    silence.rl_requests_remaining = requests_b.get("remaining")
                                silence.rl_last_updated_at = time.monotonic()
                                logger.info(
                                    "voice_rate_limits session=%s tokens_remaining=%s tokens_limit=%s tokens_reset_s=%s requests_remaining=%s",
                                    sid,
                                    silence.rl_tokens_remaining,
                                    silence.rl_tokens_limit,
                                    silence.rl_tokens_reset_s,
                                    silence.rl_requests_remaining,
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
                        "voice_tool_start session=%s tool=%s args=%s",
                        sid, getattr(event.tool, "name", "?"),
                        str(getattr(event, "arguments", ""))[:400],
                    )
                    continue

                if isinstance(event, RealtimeToolEnd):
                    tool_name = getattr(event.tool, "name", "?")
                    logger.info(
                        "voice_tool_end session=%s tool=%s output=%s",
                        sid, tool_name, str(getattr(event, "output", ""))[:400],
                    )
                    if tool_name == "end_call":
                        # Goodbye audio is still streaming. Give it a beat to
                        # finish playing in the browser, then close the WS so
                        # the patient isn't left listening to dead air.
                        silence.ended = True
                        logger.info("voice_end_call session=%s grace=2.0s", sid)
                        await asyncio.sleep(2.0)
                        try:
                            await client_ws.close(code=1000, reason="end_call")
                        except Exception:
                            logger.debug("voice_end_call_close_failed session=%s",
                                         sid, exc_info=True)
                        return
                    # A tool result owes a spoken reply; the SDK should
                    # auto-continue but intermittently stalls (mirror
                    # twilio_voice). Arm the guarded nudge so a stalled
                    # post-tool response is rescued within _RESPONSE_NUDGE_S;
                    # if the model auto-continues, its first audio frame
                    # disarms the nudge first.
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

    async def silence_watchdog() -> None:
        """Poll the silence clock; emit check-back at 45s, hang up at 120s.

        Time is measured from the assistant's last audio_end. Caller turns
        and any new assistant audio reset the clock. The hangup branch
        sets `hangup_event` after a short grace so the goodbye plays out
        before the WebSocket closes.
        """
        try:
            while not silence.ended:
                await asyncio.sleep(_SILENCE_TICK_S)
                if silence.ended:
                    return
                if silence.assistant_speaking or silence.last_caller_quiet_since is None:
                    continue
                idle = time.monotonic() - silence.last_caller_quiet_since
                # GUARDED response nudge (mirror twilio_voice): caller turn
                # landed but the model produced no reply (barge-in cancelled it
                # and create_response didn't re-fire). Nudge once, only when no
                # response is active, so we never collide with a VAD response.
                if (
                    silence.awaiting_response
                    and not silence.response_nudged
                    and not silence.response_active
                    and idle >= _RESPONSE_NUDGE_S
                ):
                    # Throttle gate: if OAI just told us we're near TPM zero,
                    # firing another response.create only deepens the throttle.
                    # Mark as nudged so we don't busy-loop, but skip the emit
                    # and log the reason so log forensics can confirm cause.
                    rl_rem = silence.rl_tokens_remaining
                    if rl_rem is not None and rl_rem < _NUDGE_TPM_FLOOR:
                        silence.response_nudged = True
                        logger.info(
                            "voice_nudge_skip_throttled session=%s waited_s=%.1f tokens_remaining=%s floor=%s reset_s=%s",
                            sid, idle, rl_rem, _NUDGE_TPM_FLOOR,
                            silence.rl_tokens_reset_s,
                        )
                        continue
                    silence.response_nudged = True
                    logger.info(
                        "voice_response_nudge session=%s waited_s=%.1f tokens_remaining=%s",
                        sid, idle, silence.rl_tokens_remaining,
                    )
                    try:
                        await _emit_response_create(session, _RESPONSE_NUDGE_INSTRUCTIONS)
                    except Exception:
                        logger.warning("voice_response_nudge_emit_failed session=%s", sid, exc_info=True)
                    continue
                if idle >= _SILENCE_HANGUP_S and not silence.hangup_sent:
                    silence.hangup_sent = True
                    logger.info(
                        "voice_silence_hangup session=%s idle_s=%.1f",
                        sid, idle,
                    )
                    try:
                        await _emit_response_create(session, _HANGUP_GOODBYE_INSTRUCTIONS)
                    except Exception:
                        logger.warning(
                            "voice_silence_hangup_emit_failed session=%s",
                            sid, exc_info=True,
                        )
                    # Give the farewell ~6s to play, then trigger session close.
                    await asyncio.sleep(6.0)
                    hangup_event.set()
                    return
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("silence_watchdog ended session=%s", sid, exc_info=True)

    async def wait_for_hangup() -> None:
        await hangup_event.wait()

    async with session:
        b2s = asyncio.ensure_future(browser_to_session())
        s2b = asyncio.ensure_future(session_to_browser())
        watchdog = asyncio.ensure_future(silence_watchdog())
        hangup = asyncio.ensure_future(wait_for_hangup())
        try:
            done, _ = await asyncio.wait(
                [b2s, s2b, hangup],
                timeout=_MAX_SESSION_SECONDS,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if not done:
                raise asyncio.TimeoutError
            if hangup in done:
                logger.info("voice_session_silence_ended session=%s", sid)
                try:
                    await client_ws.close(code=1000, reason="silence_timeout")
                except Exception:
                    logger.debug(
                        "voice_silence_close_failed session=%s",
                        sid, exc_info=True,
                    )
        except asyncio.TimeoutError:
            logger.warning(
                "voice_session_timeout session=%s max_s=%d",
                sid, _MAX_SESSION_SECONDS,
            )
        finally:
            silence.ended = True
            duration_s = asyncio.get_event_loop().time() - t_session_start
            logger.info(
                "voice_session_end session=%s duration_s=%.1f", sid, duration_s
            )
            for task in (b2s, s2b, watchdog, hangup):
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

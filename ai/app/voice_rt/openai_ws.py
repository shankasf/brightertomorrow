"""Raw ``websockets`` client for the OpenAI Realtime API (GA, gpt-realtime-2).

This is a thin, explicit-control client that the Twilio bridge drives. It does
NOT use the OpenAI Agents SDK — the goal is full control over the response
lifecycle so we never sit in the "active but silent" stall the SDK exhibits on
telephony.

Turn-taking contract (mirrors urackit_v2):
  * server_vad on the session owns normal turns: ``create_response: true``
    makes the model auto-reply when the caller stops speaking, and
    ``interrupt_response: true`` cancels the in-flight reply on barge-in.
  * The bridge sends an explicit ``response.create`` ONLY for:
      - the opening greeting (before the caller has said anything), and
      - after EVERY function-call result (this is the fix for post-tool
        stalls — server_vad does NOT auto-continue after a tool result).

Response state is tracked off ``response.created`` / ``response.done`` /
``response.cancelled`` / ``response.failed`` so we never send a second
``response.create`` while one is active (which yields a benign
"already has an active response" error we suppress).

GA wire-format notes (verified 2026-05-24 against the installed Agents SDK
``agents.realtime.openai_realtime`` and the OpenAI GA docs):
  * NO ``OpenAI-Beta`` header — GA removed it; the SDK sends only
    ``Authorization: Bearer``. (urackit_v2 used the old beta header; that was
    the beta API.)
  * ``session.update`` uses the nested ``audio.input`` / ``audio.output``
    structure with ``type: "realtime"`` discriminator. The g711_ulaw format is
    still passed as the legacy string ``"g711_ulaw"`` (GA accepts it).
  * Per-token transcription logprobs are opted in via top-level
    ``session.include`` = ``["item.input_audio_transcription.logprobs"]``.

PHI: the session prompt and audio carry PHI; OpenAI is covered by a signed
BAA. This module logs only event types, response/item ids, and tool names at
INFO — never raw transcripts or audio. Transcript persistence and logging live
in the bridge, matching the prior bridge's INFO level.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, Awaitable, Callable

import websockets

logger = logging.getLogger(__name__)

# Spoken instruction injected when a response comes back empty (created→done
# with no audio and no tool call). A blank re-create just re-produces the same
# silence — the model already CHOSE not to speak (it happens on garbled/foreign-
# rendered turns like a name spelled letter-by-letter on PSTN, call CAdecadf
# 2026-05-24: 4 empty responses → 16s dead air). Passing instructions overrides
# the session prompt for THIS response only (the full conversation history is
# still in context), which forces the model to actually produce audio. It self-
# heals: if it understood the caller it just continues; if not it asks to repeat.
EMPTY_RESPONSE_NUDGE = (
    "Respond out loud to the caller now in one short, warm sentence. "
    "If you understood their last message, continue naturally. If you could not "
    "make it out, say you didn't quite catch that and ask them to repeat it slowly."
)

# Callback type aliases — the bridge sets these after constructing the client.
AudioDeltaCb = Callable[[str], Awaitable[None]]            # base64 g711_ulaw
ResponseDoneCb = Callable[[], Awaitable[None]]
SpeechStartedCb = Callable[[], Awaitable[None]]
InputTranscriptionCb = Callable[[dict[str, Any]], Awaitable[None]]
FunctionCallCb = Callable[[str, str, str], Awaitable[None]]  # name, call_id, args
ResponseCreatedCb = Callable[[], Awaitable[None]]
ContentTranscriptCb = Callable[[str], Awaitable[None]]      # assistant text
AudioItemCb = Callable[[str], Awaitable[None]]              # assistant audio item_id


class OpenAIRealtimeClient:
    """Explicit-control Realtime WS client. One instance per phone call.

    Lifecycle:
        client = OpenAIRealtimeClient(instructions=..., tools=[...], ...)
        client.on_audio_delta = ...
        ... (set other callbacks) ...
        await client.connect()           # opens WS + sends session.update
        asyncio.ensure_future(client.recv_loop())  # pumps server events
        await client.start_greeting(caller_phone)
        ... append_audio / send_function_result / truncate / cancel_response ...
        await client.close()
    """

    def __init__(
        self,
        *,
        ws_url: str,
        model: str,
        instructions: str,
        tools: list[dict[str, Any]],
        voice: str,
        transcription: dict[str, Any],
        turn_detection: dict[str, Any],
        include: list[str] | None = None,
        noise_reduction: dict[str, Any] | None = None,
        greeting_instructions: str,
        max_output_tokens: int | None = None,
        call_sid: str = "",
    ) -> None:
        self._ws_url = ws_url
        self._model = model
        self._instructions = instructions
        self._tools = tools
        self._voice = voice
        self._transcription = transcription
        self._turn_detection = turn_detection
        self._include = list(include or [])
        self._noise_reduction = noise_reduction
        self._max_output_tokens = max_output_tokens
        self._greeting_instructions = greeting_instructions
        self._call_sid = call_sid

        self._ws: websockets.WebSocketClientProtocol | None = None
        self._closed = False
        self._send_lock = asyncio.Lock()

        # Response-state tracking. We drive every response explicitly
        # (create_response:false). A create requested while one is in flight is
        # DEFERRED (not dropped) and fired on the next terminal response event —
        # this is what keeps the agent replying to a turn the caller spoke while
        # we were still talking, or to a post-tool result.
        self._is_responding = False
        self._current_response_id: str | None = None
        self._pending_create = False
        self._pending_instructions: str | None = None
        # Empty-response recovery: GA occasionally returns a response with no
        # audio and no tool call (response.created → response.done instantly) on
        # garbled/rapid turns, leaving the caller's turn unanswered → dead air.
        # We track whether the in-flight response produced any output and retry
        # (capped) when it didn't.
        self._resp_had_output = False
        self._empty_retries = 0

        # Callbacks — set by the bridge. Defaults are no-ops so an unset
        # callback never crashes the recv loop.
        self.on_audio_delta: AudioDeltaCb | None = None
        self.on_response_done: ResponseDoneCb | None = None
        self.on_user_speech_started: SpeechStartedCb | None = None
        self.on_input_transcription: InputTranscriptionCb | None = None
        self.on_function_call: FunctionCallCb | None = None
        self.on_response_created: ResponseCreatedCb | None = None
        self.on_assistant_transcript: ContentTranscriptCb | None = None
        # Fires with the item_id of a newly-added assistant audio/message item
        # so the bridge can target conversation.item.truncate on barge-in.
        self.on_assistant_item: AudioItemCb | None = None

    # ------------------------------------------------------------------
    # Connection + session setup
    # ------------------------------------------------------------------
    async def connect(self) -> None:
        """Open the WS and send the initial session.update.

        GA: only an Authorization header is required (no OpenAI-Beta). We pass
        it via ``additional_headers`` (websockets>=13) and fall back to the
        legacy ``extra_headers`` kwarg name for older releases.
        """
        api_key = os.environ.get("OPENAI_API_KEY", "")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not set")
        headers = {"Authorization": f"Bearer {api_key}"}
        try:
            self._ws = await websockets.connect(
                self._ws_url,
                additional_headers=headers,
                max_size=None,           # realtime audio frames can be large
                ping_interval=20,
                ping_timeout=20,
            )
        except TypeError:
            # websockets < 14 used `extra_headers` instead of `additional_headers`.
            self._ws = await websockets.connect(
                self._ws_url,
                extra_headers=headers,   # type: ignore[call-arg]
                max_size=None,
                ping_interval=20,
                ping_timeout=20,
            )
        logger.info("oai_ws_connected call_sid=%s model=%s", self._call_sid, self._model)
        await self._send_session_update()

    @staticmethod
    def _ga_format(fmt: str) -> dict[str, Any]:
        """GA requires session.audio.{input,output}.format as an OBJECT, not a
        string (verified live 2026-05-24: passing "g711_ulaw" → invalid_type,
        expected object). Map our legacy format strings to the GA media-type
        objects. g711_ulaw = PCMU, g711_alaw = PCMA, pcm16 = 24 kHz PCM."""
        f = (fmt or "g711_ulaw").lower()
        if f in ("g711_ulaw", "pcmu", "audio/pcmu"):
            return {"type": "audio/pcmu"}
        if f in ("g711_alaw", "pcma", "audio/pcma"):
            return {"type": "audio/pcma"}
        return {"type": "audio/pcm", "rate": 24000}

    def _build_session(self) -> dict[str, Any]:
        """GA nested ``audio`` session object (mirrors the Agents SDK shape)."""
        _fmt = self._ga_format(self._transcription.get("_audio_format", "g711_ulaw"))
        audio_input: dict[str, Any] = {
            "format": _fmt,
            "transcription": {
                k: v for k, v in self._transcription.items()
                if not k.startswith("_")
            },
            "turn_detection": self._turn_detection,
        }
        if self._noise_reduction is not None:
            audio_input["noise_reduction"] = self._noise_reduction
        audio_output: dict[str, Any] = {
            "voice": self._voice,
            "format": _fmt,
        }
        session: dict[str, Any] = {
            "type": "realtime",
            "model": self._model,
            "output_modalities": ["audio"],
            "instructions": self._instructions,
            "audio": {"input": audio_input, "output": audio_output},
            "tools": self._tools,
            "tool_choice": "auto",
        }
        if self._max_output_tokens:
            # Runaway guard: replies are meant to be 1–2 sentences, so cap the
            # per-response output budget. Also shrinks the token RESERVATION the
            # rate limiter counts as "Requested", giving TPM headroom. Generous
            # (the agent is told to be brief) so verbatim insurance read-backs
            # are never truncated.
            session["max_output_tokens"] = self._max_output_tokens
        if self._include:
            # Top-level include opts the session into per-token transcription
            # logprobs so the bridge can drop low-confidence ASR hallucinations.
            session["include"] = self._include
        return session

    async def _send_session_update(self) -> None:
        await self._send({"type": "session.update", "session": self._build_session()})
        logger.info(
            "oai_session_update_sent call_sid=%s tools=%d voice=%s",
            self._call_sid, len(self._tools), self._voice,
        )

    # ------------------------------------------------------------------
    # Low-level send
    # ------------------------------------------------------------------
    async def _send(self, event: dict[str, Any]) -> None:
        if self._ws is None or self._closed:
            return
        data = json.dumps(event)
        async with self._send_lock:
            try:
                await self._ws.send(data)
            except Exception:
                if not self._closed:
                    logger.debug(
                        "oai_send_failed call_sid=%s type=%s",
                        self._call_sid, event.get("type"), exc_info=True,
                    )

    # ------------------------------------------------------------------
    # Audio in
    # ------------------------------------------------------------------
    async def append_audio(self, payload_b64: str) -> None:
        """Append one base64 g711_ulaw frame to the input buffer.

        We do NOT commit manually — server_vad owns turn boundaries and the
        commit. ``commit_if_needed`` exists for API symmetry but is a no-op.
        """
        await self._send({"type": "input_audio_buffer.append", "audio": payload_b64})

    async def commit_if_needed(self) -> None:
        """No-op: server_vad commits the input buffer for us. Kept for symmetry."""
        return None

    # ------------------------------------------------------------------
    # Response control
    # ------------------------------------------------------------------
    async def create_response(self, instructions: str | None = None) -> None:
        """Explicitly ask the model to produce a response.

        If a response is already in flight we DEFER (not drop): the caller's
        just-committed turn — or a tool result — still needs a reply, so we fire
        it the instant the current response ends (see the response.done handler).
        Dropping it here was the root cause of the "never replies until I say
        'are you there'" bug: a turn that committed while the assistant was
        still talking got no response and was never retried (2026-05-24).
        """
        if self._is_responding:
            self._pending_create = True
            self._pending_instructions = instructions
            logger.info(
                "oai_create_deferred call_sid=%s (response in flight)", self._call_sid,
            )
            return
        await self._emit_response_create(instructions)

    async def _emit_response_create(self, instructions: str | None) -> None:
        # Emitting now satisfies any deferral.
        self._pending_create = False
        self._pending_instructions = None
        evt: dict[str, Any] = {"type": "response.create"}
        if instructions:
            evt["response"] = {"instructions": instructions}
        logger.info("oai_create_emitted call_sid=%s", self._call_sid)
        await self._send(evt)

    async def cancel_response(self) -> None:
        """Cancel the in-flight response (barge-in). Benign if none active."""
        await self._send({"type": "response.cancel"})

    async def truncate(self, item_id: str, audio_end_ms: int) -> None:
        """Truncate the assistant audio item to what the caller actually heard.

        Called on barge-in so the model's context matches what was played
        before we cleared Twilio's buffer. ``content_index`` is 0 for the
        single audio part. Benign errors (item gone) are suppressed by recv.
        """
        if not item_id:
            return
        await self._send({
            "type": "conversation.item.truncate",
            "item_id": item_id,
            "content_index": 0,
            "audio_end_ms": max(0, int(audio_end_ms)),
        })

    # ------------------------------------------------------------------
    # Function call results
    # ------------------------------------------------------------------
    async def send_function_result(
        self, call_id: str, output: str, *, trigger_response: bool = True
    ) -> None:
        """Return a tool result and (by default) explicitly trigger the reply.

        The explicit post-tool ``response.create`` is the core fix: server_vad
        does NOT auto-continue after a function_call_output, so without this
        the model goes silent after every tool call.
        """
        await self._send({
            "type": "conversation.item.create",
            "item": {
                "type": "function_call_output",
                "call_id": call_id,
                "output": output,
            },
        })
        if trigger_response:
            await self.create_response()

    # ------------------------------------------------------------------
    # Greeting (speak first)
    # ------------------------------------------------------------------
    async def start_greeting(self, caller_phone: str | None = None) -> None:
        """Speak the opening HIPAA-secure greeting before the caller talks.

        Two-event pattern: seed a user-role directive item (carries the
        ``[[BT_INTERNAL]]`` prefix so it never surfaces in the admin
        transcript) then explicitly response.create. Relying on VAD here is
        unreliable — the caller has not spoken yet.
        """
        await self._send({
            "type": "conversation.item.create",
            "item": {
                "type": "message",
                "role": "user",
                "content": [
                    {"type": "input_text", "text": self._greeting_instructions}
                ],
            },
        })
        await self._send({"type": "response.create"})

    # ------------------------------------------------------------------
    # Item delete (low-confidence drop)
    # ------------------------------------------------------------------
    async def delete_item(self, item_id: str) -> None:
        """Server-side delete an item so the model doesn't re-read it."""
        if not item_id:
            return
        await self._send({
            "type": "conversation.item.delete",
            "item_id": item_id,
        })

    # ------------------------------------------------------------------
    # Receive loop
    # ------------------------------------------------------------------
    async def recv_loop(self) -> None:
        """Pump server events and dispatch to the bridge's callbacks.

        Runs until the WS closes. Exceptions other than a normal close are
        logged and end the loop, which the bridge treats as session end.
        """
        if self._ws is None:
            return
        try:
            async for raw in self._ws:
                try:
                    evt = json.loads(raw)
                except (json.JSONDecodeError, TypeError):
                    logger.debug("oai_invalid_json call_sid=%s", self._call_sid)
                    continue
                await self._dispatch(evt)
        except websockets.ConnectionClosed:
            logger.info("oai_ws_closed call_sid=%s", self._call_sid)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("oai_recv_loop_error call_sid=%s", self._call_sid, exc_info=True)
        finally:
            self._closed = True

    async def _dispatch(self, evt: dict[str, Any]) -> None:
        etype = evt.get("type", "")
        # Per-event turn-taking trace. DEBUG by default (set the logger to DEBUG
        # to replay the exact server event sequence on a live call); errors are
        # always surfaced at WARNING. Skip the high-volume audio delta.
        if etype == "error":
            logger.warning(
                "oai_evt_error call_sid=%s err=%s",
                self._call_sid, str((evt.get("error") or {}).get("message", ""))[:200],
            )
        elif etype not in ("response.output_audio.delta", "response.audio.delta") \
                and logger.isEnabledFor(logging.DEBUG):
            logger.debug(
                "oai_evt call_sid=%s type=%s responding=%s pending=%s",
                self._call_sid, etype, self._is_responding, self._pending_create,
            )

        # --- audio out ---------------------------------------------------
        # GA emits "response.output_audio.delta"; beta emitted
        # "response.audio.delta". Accept both.
        if etype in ("response.output_audio.delta", "response.audio.delta"):
            self._resp_had_output = True
            self._empty_retries = 0
            delta = evt.get("delta")
            if delta and self.on_audio_delta is not None:
                await self.on_audio_delta(delta)
            return

        # --- response lifecycle -----------------------------------------
        if etype == "response.created":
            resp = evt.get("response") or {}
            self._current_response_id = resp.get("id")
            self._is_responding = True
            self._resp_had_output = False
            if self.on_response_created is not None:
                await self.on_response_created()
            return

        if etype in ("response.done", "response.cancelled", "response.failed"):
            self._is_responding = False
            self._current_response_id = None
            # DIAGNOSTIC (2026-05-24): when a response ends with no audio, log GA's
            # OWN reason (response.status + status_details) — this tells us WHY it
            # was empty: cancelled/turn_detected (model heard echo/noise mid-reply
            # and aborted), incomplete (max tokens / content filter), or failed.
            if etype == "response.done" and not self._resp_had_output:
                resp = evt.get("response") or {}
                logger.info(
                    "oai_empty_done call_sid=%s status=%s details=%s output_len=%d",
                    self._call_sid, resp.get("status"),
                    resp.get("status_details"), len(resp.get("output") or []),
                )
            # On response.done, inspect output items for any function_call the
            # model emitted. GA delivers completed function calls as output
            # items on the response; we also handle the streamed
            # *.arguments.done event below, so guard with dedupe in the bridge.
            if etype == "response.done":
                await self._extract_function_calls(evt)
                if self.on_response_done is not None:
                    await self.on_response_done()
            # Floor is clear — fire any response deferred while this one was in
            # flight (a caller turn that committed mid-response, or a post-tool
            # reply). If on_response_done already emitted one (post-tool path),
            # _pending_create was cleared, so this won't double-fire.
            if self._pending_create and not self._is_responding:
                await self._emit_response_create(self._pending_instructions)
                return
            # Empty-response recovery: GA intermittently returns a response with
            # no audio AND no tool call (created→done instantly), leaving the
            # caller's turn unanswered → dead air. A BLANK re-create reproduces
            # the same silence (it did 3x in a row, call CAdecadf), so we re-fire
            # WITH a forcing instruction (EMPTY_RESPONSE_NUDGE) that makes the
            # model actually speak. Cap at 1 — the instructed retry produces
            # audio, so we never storm; if even that is empty, idle_timeout_ms
            # re-prompts. _empty_retries resets to 0 on any real audio delta.
            if (etype == "response.done" and not self._resp_had_output
                    and not self._is_responding and self._empty_retries < 1):
                self._empty_retries += 1
                logger.info(
                    "oai_empty_response_retry call_sid=%s n=%d (nudged)",
                    self._call_sid, self._empty_retries,
                )
                await self._emit_response_create(EMPTY_RESPONSE_NUDGE)
            return

        # --- new output item (capture assistant audio item id) ----------
        if etype == "response.output_item.added":
            item = evt.get("item") or {}
            if item.get("type") == "message" and self.on_assistant_item is not None:
                item_id = item.get("id")
                if item_id:
                    await self.on_assistant_item(item_id)
            return

        # --- function calls (streamed) ----------------------------------
        if etype in (
            "response.function_call_arguments.done",
            "response.output_item.done",
        ):
            await self._maybe_dispatch_function_call(evt, etype)
            return

        # --- assistant transcript (for persistence) ---------------------
        if etype in (
            "response.output_audio_transcript.done",
            "response.audio_transcript.done",
        ):
            transcript = evt.get("transcript") or ""
            if transcript and self.on_assistant_transcript is not None:
                await self.on_assistant_transcript(transcript)
            return

        # --- caller speech start (barge-in) -----------------------------
        if etype == "input_audio_buffer.speech_started":
            # Fresh caller turn → fresh empty-response nudge budget. (Reset here,
            # NOT on response.created — a nudge's own response.created must not
            # refill the budget or the empty-nudge would loop forever.)
            self._empty_retries = 0
            if self.on_user_speech_started is not None:
                await self.on_user_speech_started()
            return

        # --- caller turn committed --------------------------------------
        # We deliberately DO NOT create the reply here. With create_response:true
        # (server_vad owns turn-taking — see config.build_telephony_model_settings
        # and [[project_voice_turn_taking]]), VAD already created the response for
        # this committed turn. Creating again here would double-respond. The rare
        # empty response (created→done with no audio, e.g. a name spelled out and
        # rendered as foreign script on PSTN) is handled by the nudge-retry in the
        # response.done branch, not here.
        if etype == "input_audio_buffer.committed":
            return

        # --- caller transcription (with logprobs) -----------------------
        if etype == "conversation.item.input_audio_transcription.completed":
            if self.on_input_transcription is not None:
                await self.on_input_transcription(evt)
            return

        # --- errors ------------------------------------------------------
        if etype == "error":
            err = evt.get("error") or {}
            msg = str(err.get("message") or err)
            low = msg.lower()
            benign = (
                "no active response" in low
                or "already has an active response" in low
                or "cancellation failed" in low
                or "already cancelled" in low
                or "item does not exist" in low
                or "does not exist" in low
            )
            if benign:
                logger.debug("oai_benign_error call_sid=%s msg=%s", self._call_sid, msg)
            else:
                logger.error("oai_error call_sid=%s msg=%s", self._call_sid, msg)
            return

        # Everything else (session.updated, *.delta we don't use, etc.) —
        # silent. Uncomment for protocol debugging:
        # logger.debug("oai_event call_sid=%s type=%s", self._call_sid, etype)

    async def _maybe_dispatch_function_call(
        self, evt: dict[str, Any], etype: str
    ) -> None:
        """Dispatch a completed function call from a streamed event."""
        if etype == "response.function_call_arguments.done":
            name = evt.get("name") or ""
            call_id = evt.get("call_id") or ""
            args = evt.get("arguments") or "{}"
            # GA sometimes omits `name` on this event; the output_item.done
            # path below carries it. Only fire here if we have a name.
            if name and call_id and self.on_function_call is not None:
                self._resp_had_output = True  # a tool call IS output (not empty)
                await self.on_function_call(name, call_id, args)
            return
        # response.output_item.done — fires for every output item; only act on
        # function_call items. (We rely on the bridge to dedupe by call_id in
        # case both this and *.arguments.done carry the same call.)
        item = evt.get("item") or {}
        if item.get("type") == "function_call":
            name = item.get("name") or ""
            call_id = item.get("call_id") or ""
            args = item.get("arguments") or "{}"
            if name and call_id and self.on_function_call is not None:
                self._resp_had_output = True
                await self.on_function_call(name, call_id, args)

    async def _extract_function_calls(self, evt: dict[str, Any]) -> None:
        """Pull function_call items off response.done as a backstop."""
        resp = evt.get("response") or {}
        for item in resp.get("output") or []:
            if isinstance(item, dict) and item.get("type") == "function_call":
                self._resp_had_output = True  # tool call is output, not empty
                name = item.get("name") or ""
                call_id = item.get("call_id") or ""
                args = item.get("arguments") or "{}"
                if name and call_id and self.on_function_call is not None:
                    await self.on_function_call(name, call_id, args)

    # ------------------------------------------------------------------
    @property
    def is_responding(self) -> bool:
        return self._is_responding

    @property
    def current_response_id(self) -> str | None:
        return self._current_response_id

    async def close(self) -> None:
        self._closed = True
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass

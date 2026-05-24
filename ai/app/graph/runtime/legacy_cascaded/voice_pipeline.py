"""Cascaded voice pipeline: STT → LangGraph → TTS.

Uses LiveKit Agents' plugin classes (Deepgram STT, Cartesia TTS, Silero
VAD) as standalone components — we do NOT join a LiveKit Room. Audio
bytes are routed in/out through whichever FastAPI WebSocket transport
called us (browser PCM16 or Twilio mulaw).

Design:
  * Stateless per session — one ``VoicePipeline`` instance per call.
  * STT runs streaming; on each finalised user transcript we invoke
    the LangGraph and pipe the response text into the TTS streamer.
  * Audio in / out are kept on the transport side; the pipeline only
    sees PCM16 16kHz mono internally and lets the transports handle
    any resampling (mulaw 8kHz is trivially convertible).

Why this shape:
  * It mirrors the structure of LiveKit's ``AgentSession`` so a future
    move to actual LiveKit Rooms is a delete + replace, not a rewrite.
  * It keeps the LangGraph runtime channel-agnostic — the graph sees
    text messages, never audio.
"""
from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass

from langchain_core.messages import HumanMessage

from ...graph import get_app
from ...prompts._constants import (
    HIPAA_DISCLOSURE_VOICE,
    HIPAA_RESUME_VOICE,
)
from ...state import initial_state

logger = logging.getLogger(__name__)


# Sentinel user message that triggers the first-turn HIPAA disclosure
# inside the graph. The disclosure gate (in nodes/) recognises this and
# routes to the disclosure_prompt scene; respond emits the disclosure as
# a normal assistant turn — same persistence path as any other turn.
SESSION_OPEN_TOKEN = "__session_open__"


# Cartesia (and most general-purpose TTS) reads "HIPAA" as five letters
# because of the all-caps form. Audit text keeps the legal acronym; we
# rewrite to a phonetic respelling at the TTS boundary only.
_VOICE_REWRITES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\bHIPAA\b"), "Hippa"),
)


def _voiceify(text: str) -> str:
    for pat, repl in _VOICE_REWRITES:
        text = pat.sub(repl, text)
    return text


# ---------------------------------------------------------------------------
# Plugin imports — kept inside _build_pipeline so the chat-only deploy
# doesn't need to install Deepgram / Cartesia plugins.
# ---------------------------------------------------------------------------

@dataclass
class PluginBundle:
    stt: object
    tts: object


def _build_plugins() -> PluginBundle:
    """Construct LiveKit plugin instances. Raises ImportError if missing."""
    from livekit.plugins import deepgram, cartesia  # type: ignore

    stt = deepgram.STT(
        model="nova-3",
        language="en-US",
        interim_results=True,
        punctuate=True,
        smart_format=True,
        # LiveKit's default endpointing_ms is 25 — a 25ms silence gap
        # finalizes the utterance. That's tuned for chatbots expecting
        # short snappy replies; on a phone line it chops every natural
        # pause into its own turn, so a member ID / DOB / address spoken
        # with pauses arrives as useless single-character fragments
        # (2026-05-23 incident). Deepgram's documented value for
        # "speakers pause mid-thought" is 300-500ms; we use 500ms to be
        # safe for callers spelling structured data over PSTN. Costs ~½s
        # of extra latency per turn — an acceptable trade for healthcare
        # intake where a fragmented member ID can never be verified.
        endpointing_ms=500,
    )
    tts = cartesia.TTS(
        model="sonic-3",
        voice="248be419-c632-4f23-adf1-5324ed7dbf1d",  # warm, calm female
        sample_rate=16000,
    )
    return PluginBundle(stt=stt, tts=tts)


# ---------------------------------------------------------------------------
# Voice pipeline
# ---------------------------------------------------------------------------

class VoicePipeline:
    """One per call. Owns STT/TTS plugins and a thread_id."""

    def __init__(self, session_id: str, channel: str, agent_source: str,
                 caller_phone: str | None = None):
        self.session_id = session_id
        self.channel = channel
        self.agent_source = agent_source
        self.caller_phone = caller_phone   # Twilio ANI (E.164); None for browser
        self._plugins = _build_plugins()
        self._app = get_app()
        self._cfg = {"configurable": {"thread_id": session_id}}
        self._seeded = False

    # ---- STT --------------------------------------------------------

    async def transcribe_stream(self, audio_chunks: AsyncIterator[bytes]) -> AsyncIterator[str]:
        """Consume an async stream of PCM16 16kHz mono audio chunks; yield
        each finalised transcript text as soon as the STT plugin returns it.

        Two non-obvious LiveKit details (both were 2026-05-23 incidents):
          1. ``SpeechStream.push_frame`` is SYNCHRONOUS and expects an
             ``rtc.AudioFrame``, NOT raw bytes. Pushing bytes raises in
             the pump task; without instrumentation the failure is silent.
          2. The yielded events are ``SpeechEvent`` with a ``.type`` enum
             (``SpeechEventType``), NOT ``is_final``. Checking ``is_final``
             always returns False so transcripts never surface.

        We log every event type + a periodic frame counter so deafness
        becomes immediately visible in the bt-ai pod logs.
        """
        from livekit import rtc  # local import: keeps the chat-only deploy slim
        from livekit.agents.stt import SpeechEventType  # type: ignore

        stream = self._plugins.stt.stream()  # type: ignore[attr-defined]
        logger.info(
            "voice_pipeline_stt_stream_opened session=%s plugin=%s",
            self.session_id, type(self._plugins.stt).__module__,
        )

        async def _pump():
            n_frames = 0
            n_bytes = 0
            try:
                async for chunk in audio_chunks:
                    if not chunk:
                        continue
                    samples_per_channel = len(chunk) // 2  # PCM16 LE mono
                    if samples_per_channel <= 0:
                        continue
                    frame = rtc.AudioFrame(
                        data=chunk,
                        sample_rate=16000,
                        num_channels=1,
                        samples_per_channel=samples_per_channel,
                    )
                    stream.push_frame(frame)  # sync — do NOT await
                    n_frames += 1
                    n_bytes += len(chunk)
                    # ~50 frames/s for 20ms Twilio frames → log every ~5s.
                    if n_frames % 250 == 0:
                        logger.info(
                            "voice_pipeline_stt_pump session=%s frames=%d bytes=%d",
                            self.session_id, n_frames, n_bytes,
                        )
            except Exception:
                logger.exception(
                    "voice_pipeline_stt_pump_failed session=%s frames=%d",
                    self.session_id, n_frames,
                )
                raise
            finally:
                logger.info(
                    "voice_pipeline_stt_pump_end session=%s frames=%d bytes=%d",
                    self.session_id, n_frames, n_bytes,
                )
                # end_input() signals Deepgram we're done; without it the
                # SpeechStream waits forever for more audio.
                try:
                    stream.end_input()
                except Exception:
                    logger.exception(
                        "voice_pipeline_stt_end_input_failed session=%s",
                        self.session_id,
                    )

        pump_task = asyncio.create_task(_pump())
        n_events = 0
        try:
            async for event in stream:
                n_events += 1
                etype = getattr(event, "type", None)
                alts = getattr(event, "alternatives", None) or []
                text = alts[0].text if alts else ""
                if etype == SpeechEventType.START_OF_SPEECH:
                    logger.info(
                        "voice_pipeline_stt_event session=%s type=start_of_speech",
                        self.session_id,
                    )
                elif etype == SpeechEventType.INTERIM_TRANSCRIPT:
                    logger.info(
                        "voice_pipeline_stt_event session=%s type=interim text=%r",
                        self.session_id, text[:80],
                    )
                elif etype == SpeechEventType.FINAL_TRANSCRIPT:
                    logger.info(
                        "voice_pipeline_stt_event session=%s type=final text=%r",
                        self.session_id, text[:160],
                    )
                    final_text = text.strip()
                    if final_text:
                        yield final_text
                elif etype == SpeechEventType.END_OF_SPEECH:
                    logger.info(
                        "voice_pipeline_stt_event session=%s type=end_of_speech",
                        self.session_id,
                    )
                # RECOGNITION_USAGE / PREFLIGHT_TRANSCRIPT are noisy — skip.
        except Exception:
            logger.exception(
                "voice_pipeline_stt_consume_failed session=%s events_seen=%d",
                self.session_id, n_events,
            )
            raise
        finally:
            logger.info(
                "voice_pipeline_stt_consume_end session=%s events_seen=%d",
                self.session_id, n_events,
            )
            if not pump_task.done():
                pump_task.cancel()
            try:
                await pump_task
            except (asyncio.CancelledError, Exception):
                pass  # already logged inside _pump

    # ---- Graph invocation ------------------------------------------

    def _graph_input(self, user_text: str):
        """Build the per-turn graph input, seeding full state on first turn."""
        if not self._seeded:
            self._seeded = True
            seed = initial_state(self.channel, self.session_id, self.agent_source)
            if self.caller_phone:
                # Surface the Twilio ANI so the booking/contact flow can
                # offer it back ("I have your number as …") instead of
                # asking a caller for the number we already have.
                seed["caller_phone"] = self.caller_phone
            seed["messages"] = [HumanMessage(content=user_text)]
            return seed
        return {"messages": [HumanMessage(content=user_text)]}

    async def respond_to_text(self, user_text: str) -> str:
        """Send one user turn to the graph; return the full assistant reply.

        Non-streaming path — kept for callers that want the whole reply at
        once (and as the fallback inside ``respond_streaming``).
        """
        result = await self._app.ainvoke(self._graph_input(user_text), config=self._cfg)
        reply = result.get("last_reply_text") or ""
        logger.info(
            "voice_pipeline session=%s scene=%s chars=%d",
            self.session_id, result.get("_scene"), len(reply),
        )
        return reply

    async def respond_streaming(self, user_text: str) -> AsyncIterator[str]:
        """Yield the assistant reply as sentence-sized chunks AS the respond
        node's LLM generates them.

        Market-standard cascaded-voice latency fix: instead of waiting for
        the full reply (~5s) before any TTS starts, we pipe each completed
        sentence to the synthesizer the moment it forms, so first audio
        lands ~3.5s sooner.

        Implementation: ``astream_events(version="v2")`` and keep ONLY
        ``on_chat_model_stream`` deltas from the ``respond`` node. This is
        the correct token-stream API — unlike ``astream(stream_mode=
        "messages")`` it does NOT also emit the final aggregated message,
        so the text is never doubled (verified 2026-05-23). The ``extract``
        node's LLM tokens are filtered out by the node check.

        IMPORTANT for barge-in safety: the caller MUST fully drain this
        generator even after it stops using the output, so the underlying
        graph run finishes and checkpoints cleanly. Cancelling it mid-run
        can corrupt the thread's checkpoint.

        Falls back to the final ``last_reply_text`` if no respond-node
        tokens streamed (e.g. a constant-text handoff scene with no LLM).
        """
        sent_end = re.compile(r'(.+?[.!?]["\'\)\]]?)\s+', re.S)

        buf = ""
        streamed_any = False
        try:
            async for ev in self._app.astream_events(
                self._graph_input(user_text),
                config=self._cfg,
                version="v2",
            ):
                if ev.get("event") != "on_chat_model_stream":
                    continue
                if (ev.get("metadata") or {}).get("langgraph_node") != "respond":
                    continue
                chunk = (ev.get("data") or {}).get("chunk")
                token = getattr(chunk, "content", "") or ""
                if not isinstance(token, str) or not token:
                    continue
                buf += token
                while True:
                    m = sent_end.match(buf)
                    if not m:
                        break
                    sentence = m.group(1).strip()
                    buf = buf[m.end():]
                    if sentence:
                        streamed_any = True
                        yield sentence
        except Exception:
            logger.exception("voice_pipeline_stream_failed session=%s", self.session_id)

        tail = buf.strip()
        if tail:
            streamed_any = True
            yield tail

        if not streamed_any:
            # Constant-text scene (handoff/terminal) — no LLM tokens streamed.
            try:
                snap = await self._app.aget_state(self._cfg)
                reply = ((snap.values.get("last_reply_text") or "").strip()
                         if snap and snap.values else "")
            except Exception:
                logger.exception("voice_pipeline_stream_fallback_failed session=%s",
                                 self.session_id)
                reply = ""
            if reply:
                yield reply
        logger.info("voice_pipeline_stream_done session=%s", self.session_id)

    # ---- First-turn HIPAA disclosure -------------------------------

    async def is_disclosure_done(self) -> bool:
        """True if this thread has already delivered the HIPAA disclosure.

        Used by reconnect-resume logic in Twilio and browser voice
        transports — we don't replay the disclosure on reconnects (that
        would be annoying and erode trust). The disclosure gate sets
        ``gates.disclosure_done=True`` after respond runs the
        ``disclosure_prompt`` scene; we read that flag from the
        checkpointer snapshot.
        """
        try:
            snapshot = await self._app.aget_state(self._cfg)
        except Exception:
            logger.exception("voice_pipeline_snapshot_failed session=%s",
                             self.session_id)
            return False
        if snapshot is None or not snapshot.values:
            return False
        gates = (snapshot.values.get("gates") or {})
        return bool(gates.get("disclosure_done"))

    async def is_terminal(self) -> bool:
        """True if the conversation has reached a terminal handoff (e.g.
        out-of-state, ROI required). The transport uses this to end the
        call after the closing message plays, instead of looping the
        terminal_replay scene every time the caller says anything.
        """
        try:
            snapshot = await self._app.aget_state(self._cfg)
        except Exception:
            return False
        if snapshot is None or not snapshot.values:
            return False
        return bool((snapshot.values.get("gates") or {}).get("terminal"))

    async def emit_first_turn(self) -> str:
        """Return the text to speak as the very first AI turn — NO LLM call.

        Picks `HIPAA_RESUME_VOICE` if the disclosure_done gate is already
        set in the checkpointer (reconnect), otherwise `HIPAA_DISCLOSURE_VOICE`.

        Caller is responsible for:
          1. synthesising the returned text and streaming it to the
             transport (do this IMMEDIATELY — no LLM in the hot path),
          2. invoking ``seed_after_disclosure()`` in the background to
             write the audit row and flip the gate. We can't fold the
             graph call in here because doing so blocks the caller for
             3–6s of LLM latency and Twilio drops the WS for dead air.
        """
        if await self.is_disclosure_done():
            logger.info("voice_pipeline_resume session=%s", self.session_id)
            return HIPAA_RESUME_VOICE
        logger.info(
            "voice_pipeline_first_turn session=%s chars=%d",
            self.session_id, len(HIPAA_DISCLOSURE_VOICE),
        )
        return HIPAA_DISCLOSURE_VOICE

    async def seed_after_disclosure(self) -> None:
        """Run the graph with ``__session_open__`` to write the disclosure
        audit row and set ``gates.disclosure_done``. Safe to call in the
        background while the disclosure audio plays — by the time the
        caller speaks, the gate is set and ``respond_to_text`` will hit
        the ``else`` branch (no re-seed).
        """
        if self._seeded:
            return
        self._seeded = True
        seed = initial_state(self.channel, self.session_id, self.agent_source)
        seed["messages"] = [HumanMessage(content=SESSION_OPEN_TOKEN)]
        try:
            await self._app.ainvoke(seed, config=self._cfg)
        except Exception:
            logger.exception("voice_pipeline_seed_failed session=%s",
                             self.session_id)
            self._seeded = False  # let the next user turn retry the seed

    # ---- TTS --------------------------------------------------------

    async def synthesize(self, text: str) -> AsyncIterator[bytes]:
        """Yield PCM16 16kHz mono audio chunks for the given text."""
        stream = self._plugins.tts.synthesize(_voiceify(text))  # type: ignore[attr-defined]
        async for event in stream:
            audio = getattr(event, "frame", None) or getattr(event, "audio", None)
            if audio is None:
                continue
            data = getattr(audio, "data", None) or audio
            yield bytes(data)

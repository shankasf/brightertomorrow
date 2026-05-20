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
from collections.abc import AsyncIterator
from dataclasses import dataclass

from langchain_core.messages import HumanMessage

from ..graph import get_app
from ..state import initial_state

logger = logging.getLogger(__name__)


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

    def __init__(self, session_id: str, channel: str, agent_source: str):
        self.session_id = session_id
        self.channel = channel
        self.agent_source = agent_source
        self._plugins = _build_plugins()
        self._app = get_app()
        self._cfg = {"configurable": {"thread_id": session_id}}
        self._seeded = False

    # ---- STT --------------------------------------------------------

    async def transcribe_stream(self, audio_chunks: AsyncIterator[bytes]) -> AsyncIterator[str]:
        """Consume an async stream of PCM16 16kHz mono audio chunks; yield
        each finalised transcript text as soon as the STT plugin returns it.
        """
        stream = self._plugins.stt.stream()  # type: ignore[attr-defined]

        async def _pump():
            async for chunk in audio_chunks:
                await stream.push_frame(chunk)
            await stream.flush()

        pump_task = asyncio.create_task(_pump())
        try:
            async for event in stream:
                if getattr(event, "is_final", False) and event.alternatives:
                    text = event.alternatives[0].text.strip()
                    if text:
                        yield text
        finally:
            pump_task.cancel()

    # ---- Graph invocation ------------------------------------------

    async def respond_to_text(self, user_text: str) -> str:
        """Send one user turn to the graph; return the assistant reply text."""
        if not self._seeded:
            self._seeded = True
            seed = initial_state(self.channel, self.session_id, self.agent_source)
            seed["messages"] = [HumanMessage(content=user_text)]
            result = await self._app.ainvoke(seed, config=self._cfg)
        else:
            result = await self._app.ainvoke(
                {"messages": [HumanMessage(content=user_text)]},
                config=self._cfg,
            )
        reply = result.get("last_reply_text") or ""
        logger.info(
            "voice_pipeline session=%s scene=%s chars=%d",
            self.session_id, result.get("_scene"), len(reply),
        )
        return reply

    # ---- TTS --------------------------------------------------------

    async def synthesize(self, text: str) -> AsyncIterator[bytes]:
        """Yield PCM16 16kHz mono audio chunks for the given text."""
        stream = self._plugins.tts.synthesize(text)  # type: ignore[attr-defined]
        async for event in stream:
            audio = getattr(event, "frame", None) or getattr(event, "audio", None)
            if audio is None:
                continue
            data = getattr(audio, "data", None) or audio
            yield bytes(data)

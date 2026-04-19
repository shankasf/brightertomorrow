"""SDK-based Realtime voice session handler.

Uses openai-agents RealtimeRunner/RealtimeSession so the full multi-agent graph
(triage → crisis/info/matching/intake) is active for voice, with the same tools,
handoffs, and guardrails as the text path.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from typing import Any

from fastapi import WebSocket

from .bt_agents.realtime_graph import build_realtime_run_config, build_realtime_triage
from .db import conn

logger = logging.getLogger(__name__)

# Hard ceiling on a single voice session (cost guard).
_MAX_SESSION_SECONDS = 600  # 10 minutes

# Strong reference set so in-flight persist tasks are not GC'd.
_inflight_tasks: set[asyncio.Task] = set()  # type: ignore[type-arg]


# ---------------------------------------------------------------------------
# DB persistence (sync, runs in thread pool)
# ---------------------------------------------------------------------------


def _persist_message(session_id: str, role: str, content: str) -> None:
    try:
        with conn() as c, c.cursor() as cur:
            cur.execute(
                "INSERT INTO chat_messages (session_id, role, content) VALUES (%s, %s, %s)",
                (session_id, role, content),
            )
    except Exception:
        logger.exception(
            "Failed to persist voice message session=%s role=%s", session_id, role
        )


def _schedule_persist(session_id: str, role: str, content: str) -> None:
    if not session_id or not content:
        return
    # asyncio.get_running_loop() is correct here — we're inside an async coroutine.
    task = asyncio.create_task(
        asyncio.get_running_loop().run_in_executor(
            None, _persist_message, session_id, role, content
        )
    )
    _inflight_tasks.add(task)
    task.add_done_callback(_inflight_tasks.discard)


# ---------------------------------------------------------------------------
# Main session coroutine
# ---------------------------------------------------------------------------


async def run_voice_session(client_ws: WebSocket, session_id: str) -> None:
    """Run a full-duplex voice session between the browser client and the SDK realtime agent."""
    if not os.environ.get("OPENAI_API_KEY"):
        logger.error("OPENAI_API_KEY not set — cannot open Realtime session")
        await client_ws.close(code=1011, reason="Server not configured")
        return

    if not os.environ.get("REALTIME_MODEL"):
        logger.error("REALTIME_MODEL not set — cannot open Realtime session")
        await client_ws.close(code=1011, reason="Server not configured")
        return

    from agents.realtime import RealtimeRunner

    triage_agent = build_realtime_triage()
    run_config = build_realtime_run_config()
    runner = RealtimeRunner(starting_agent=triage_agent, config=run_config)

    sdk_session = await runner.run()
    await sdk_session.enter()

    # Per-turn transcript accumulators (reset on each turn end).
    user_transcript: str = ""
    assistant_transcript: str = ""

    async def client_to_sdk() -> None:
        """Read frames from the browser client and feed audio into the SDK session."""
        try:
            while True:
                raw = await client_ws.receive_text()
                try:
                    frame: dict[str, Any] = json.loads(raw)
                except json.JSONDecodeError:
                    logger.warning("Non-JSON frame from client session=%s", session_id)
                    continue

                ftype = frame.get("type", "")

                if ftype == "input_audio_buffer.append":
                    b64 = frame.get("audio", "")
                    if b64:
                        audio_bytes = base64.b64decode(b64)
                        await sdk_session.send_audio(audio_bytes, commit=False)

                # input_audio_buffer.commit is intentionally ignored: server VAD
                # handles commits automatically, so client commits are no-ops.

        except Exception:
            logger.warning("client_to_sdk ended session=%s", session_id, exc_info=True)

    async def sdk_to_client() -> None:
        """Consume SDK events and forward audio/transcript events to the browser."""
        nonlocal user_transcript, assistant_transcript

        from agents.realtime import (
            RealtimeHandoffEvent,
            RealtimeModelAudioDoneEvent,
            RealtimeModelAudioEvent,
            RealtimeModelInputAudioTranscriptionCompletedEvent,
            RealtimeModelTranscriptDeltaEvent,
            RealtimeModelTurnEndedEvent,
        )

        try:
            async for event in sdk_session:
                try:
                    # --- Transcript accumulation ---
                    if isinstance(event, RealtimeModelInputAudioTranscriptionCompletedEvent):
                        if event.transcript:
                            user_transcript = event.transcript

                    elif isinstance(event, RealtimeModelTranscriptDeltaEvent):
                        assistant_transcript += event.delta

                    elif isinstance(event, RealtimeModelTurnEndedEvent):
                        if user_transcript:
                            _schedule_persist(session_id, "user", user_transcript)
                        if assistant_transcript:
                            _schedule_persist(session_id, "assistant", assistant_transcript)
                        user_transcript = ""
                        assistant_transcript = ""

                    # --- Forward typed events to the browser ---
                    if isinstance(event, RealtimeModelAudioEvent):
                        payload = {
                            "type": "response.audio.delta",
                            "response_id": event.response_id,
                            "item_id": event.item_id,
                            "delta": base64.b64encode(event.data).decode(),
                        }
                        await client_ws.send_text(json.dumps(payload))

                    elif isinstance(event, RealtimeModelAudioDoneEvent):
                        await client_ws.send_text(
                            json.dumps({"type": "response.audio.done", "item_id": event.item_id})
                        )

                    elif isinstance(event, RealtimeModelTranscriptDeltaEvent):
                        await client_ws.send_text(
                            json.dumps({
                                "type": "response.audio_transcript.delta",
                                "item_id": event.item_id,
                                "delta": event.delta,
                            })
                        )

                    elif isinstance(event, RealtimeModelTurnEndedEvent):
                        await client_ws.send_text(json.dumps({"type": "response.done"}))

                    elif isinstance(event, RealtimeHandoffEvent):
                        # Inform the browser which agent is now active (UI can show it).
                        await client_ws.send_text(
                            json.dumps({
                                "type": "agent.handoff",
                                "from_agent": event.from_agent,
                                "to_agent": event.to_agent,
                            })
                        )

                    # RealtimeRawModelEvent is intentionally NOT forwarded.
                    # Raw events may contain bytes or internal SDK fields unsuitable
                    # for the browser. The typed events above cover all browser needs.

                except Exception:
                    logger.warning(
                        "Error handling SDK event session=%s", session_id, exc_info=True
                    )

        except Exception:
            logger.warning("sdk_to_client ended session=%s", session_id, exc_info=True)

    c2s = asyncio.ensure_future(client_to_sdk())
    s2c = asyncio.ensure_future(sdk_to_client())

    local_inflight: set[asyncio.Task] = set()  # type: ignore[type-arg]

    try:
        # Hard ceiling: close the session after _MAX_SESSION_SECONDS (cost guard).
        await asyncio.wait_for(
            asyncio.wait([c2s, s2c], return_when=asyncio.FIRST_COMPLETED),
            timeout=_MAX_SESSION_SECONDS,
        )
    except asyncio.TimeoutError:
        logger.info("voice session hit max duration, closing session=%s", session_id)
    finally:
        for task in (c2s, s2c):
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

        # Flush any in-flight DB persist tasks so transcripts survive disconnect.
        pending_persists = set(_inflight_tasks)
        if pending_persists:
            await asyncio.gather(*pending_persists, return_exceptions=True)

        try:
            sdk_session.close()
        except Exception:
            logger.debug("Error closing SDK session session=%s", session_id, exc_info=True)

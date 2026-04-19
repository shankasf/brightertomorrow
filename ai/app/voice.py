"""OpenAI Realtime API voice session handler."""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

import websockets
from agents import RunContextWrapper
from fastapi import WebSocket

from .db import conn
from .tools import ALL_TOOLS

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tool registry
# ---------------------------------------------------------------------------

_TOOL_MAP = {t.name: t for t in ALL_TOOLS}

_REALTIME_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": t.name,
        "description": t.description,
        "parameters": t.params_json_schema,
    }
    for t in ALL_TOOLS
]

# ---------------------------------------------------------------------------
# Voice instructions
# ---------------------------------------------------------------------------

_VOICE_INSTRUCTIONS = (
    "You are the Brighter Tomorrow Therapy assistant — warm, calm, concise. "
    "Las Vegas therapy practice. Also serves all of Nevada via telehealth. "
    "Keep responses SHORT and conversational — 2–3 sentences max. No bullet lists; speak naturally. "
    "Use tools to answer about services, therapists, hours, FAQs, and locations. "
    "To book a callback: gather full name, email, phone, reason → call request_intake_callback. "
    "NOT a clinician. For any crisis or safety concern → direct to 988 or 911."
)

# ---------------------------------------------------------------------------
# DB persistence (sync, runs in executor)
# ---------------------------------------------------------------------------


def _persist_message(session_id: str, role: str, content: str) -> None:
    try:
        with conn() as c, c.cursor() as cur:
            cur.execute(
                "INSERT INTO chat_messages (session_id, role, content) VALUES (%s, %s, %s)",
                (session_id, role, content),
            )
    except Exception:
        logger.exception("Failed to persist voice message session=%s role=%s", session_id, role)


def _schedule_persist(session_id: str, role: str, content: str) -> None:
    if not session_id or not content:
        return
    loop = asyncio.get_event_loop()
    asyncio.ensure_future(
        loop.run_in_executor(None, _persist_message, session_id, role, content)
    )


# ---------------------------------------------------------------------------
# Tool execution
# ---------------------------------------------------------------------------


async def _execute_tool(name: str, args: dict[str, Any]) -> str:
    tool = _TOOL_MAP.get(name)
    if tool is None:
        return json.dumps({"error": f"Unknown tool: {name}"})
    try:
        result = await tool.on_invoke_tool(RunContextWrapper(context=None), json.dumps(args))
        if isinstance(result, str):
            return result
        return json.dumps(result)
    except Exception as exc:
        logger.warning("Tool %s failed: %s", name, exc)
        return json.dumps({"error": str(exc)})


# ---------------------------------------------------------------------------
# Main session coroutine
# ---------------------------------------------------------------------------


async def run_voice_session(client_ws: WebSocket, session_id: str) -> None:
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        logger.error("OPENAI_API_KEY not set — cannot open Realtime session")
        await client_ws.close(code=1011, reason="Server not configured")
        return

    realtime_model = os.environ.get("REALTIME_MODEL")
    if not realtime_model:
        logger.error("REALTIME_MODEL not set — cannot open Realtime session")
        await client_ws.close(code=1011, reason="Server not configured")
        return
    openai_url = f"wss://api.openai.com/v1/realtime?model={realtime_model}"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "OpenAI-Beta": "realtime=v1",
    }

    session_update = {
        "type": "session.update",
        "session": {
            "modalities": ["text", "audio"],
            "instructions": _VOICE_INSTRUCTIONS,
            "voice": "alloy",
            "input_audio_format": "pcm16",
            "output_audio_format": "pcm16",
            "input_audio_transcription": {"model": "whisper-1"},
            "turn_detection": {
                "type": "server_vad",
                "threshold": 0.5,
                "prefix_padding_ms": 300,
                "silence_duration_ms": 500,
            },
            "tools": _REALTIME_TOOLS,
            "tool_choice": "auto",
            "temperature": 0.8,
        },
    }

    async with websockets.connect(
        openai_url,
        additional_headers=headers,
        max_size=10 * 1024 * 1024,
    ) as openai_ws:
        # Send session configuration immediately
        await openai_ws.send(json.dumps(session_update))

        # Per-turn transcript accumulators
        user_transcript: str = ""
        assistant_transcript: str = ""

        # In-flight tool call accumulation: {call_id: {"name": str, "args_buf": str}}
        pending_calls: dict[str, dict[str, str]] = {}

        async def client_to_openai() -> None:
            """Forward raw frames from the browser client to OpenAI."""
            try:
                while True:
                    data = await client_ws.receive_text()
                    await openai_ws.send(data)
            except Exception:
                # Client disconnected or errored — signal the other task to stop
                pass

        async def openai_to_client() -> None:
            """Handle OpenAI events; forward most to client, handle tool calls locally."""
            nonlocal user_transcript, assistant_transcript

            try:
                async for raw in openai_ws:
                    try:
                        event: dict[str, Any] = json.loads(raw)
                    except json.JSONDecodeError:
                        logger.warning("Received non-JSON frame from OpenAI Realtime")
                        continue

                    etype = event.get("type", "")

                    # --- Tool call argument streaming ---
                    if etype == "response.function_call_arguments.delta":
                        call_id: str = event.get("call_id", "")
                        name: str = event.get("name", "")
                        delta: str = event.get("delta", "")
                        if call_id not in pending_calls:
                            pending_calls[call_id] = {"name": name, "args_buf": ""}
                        pending_calls[call_id]["args_buf"] += delta
                        # Do NOT forward to client
                        continue

                    # --- Tool call complete — execute and return result ---
                    elif etype == "response.function_call_arguments.done":
                        call_id = event.get("call_id", "")
                        pending = pending_calls.pop(call_id, {})
                        tool_name = pending.get("name") or event.get("name", "")
                        # Prefer the args payload attached to done event; fall back to buffer
                        raw_args: str = event.get("arguments", "") or pending.get("args_buf", "")
                        try:
                            args = json.loads(raw_args) if raw_args else {}
                        except json.JSONDecodeError:
                            args = {}

                        output = await _execute_tool(tool_name, args)

                        # Return result to OpenAI
                        fc_output_event = {
                            "type": "conversation.item.create",
                            "item": {
                                "type": "function_call_output",
                                "call_id": call_id,
                                "output": output,
                            },
                        }
                        await openai_ws.send(json.dumps(fc_output_event))
                        await openai_ws.send(json.dumps({"type": "response.create"}))
                        # Do NOT forward to client
                        continue

                    # --- Transcription events ---
                    elif etype == "conversation.item.input_audio_transcription.completed":
                        transcript = event.get("transcript", "")
                        if transcript:
                            user_transcript = transcript

                    elif etype == "response.audio_transcript.done":
                        transcript = event.get("transcript", "")
                        if transcript:
                            assistant_transcript = transcript

                    # --- Turn complete — persist transcripts ---
                    elif etype == "response.done":
                        if user_transcript:
                            _schedule_persist(session_id, "user", user_transcript)
                        if assistant_transcript:
                            _schedule_persist(session_id, "assistant", assistant_transcript)
                        user_transcript = ""
                        assistant_transcript = ""

                    # --- Forward everything else to the client ---
                    try:
                        await client_ws.send_text(json.dumps(event))
                    except Exception:
                        logger.debug("Could not forward event type=%s to client", etype)
                        break

            except Exception:
                logger.debug("openai_to_client task ended", exc_info=True)

        # Run both directions concurrently; cancel the other when either finishes
        c2o = asyncio.ensure_future(client_to_openai())
        o2c = asyncio.ensure_future(openai_to_client())

        try:
            done, pending = await asyncio.wait(
                [c2o, o2c],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass
        finally:
            # Ensure OpenAI WS is closed (context manager handles it, but be explicit)
            if not openai_ws.closed:
                await openai_ws.close()

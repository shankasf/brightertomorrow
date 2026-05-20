"""Chat runtime — HTTP + SSE for the web widget.

Endpoints:
  * POST /v2/chat            — single request/response.
  * POST /v2/chat/stream     — SSE; emits the assistant text in one chunk
                                (the LangGraph respond node is a single
                                LLM call, so token streaming would require
                                a separate streaming responder; we keep
                                it simple here and reliable).

The session_id from the client becomes LangGraph's ``thread_id`` so the
checkpointer can resume mid-conversation across requests / pod restarts.
"""
from __future__ import annotations

import json
import logging
import time
from typing import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage
from pydantic import BaseModel, Field

from ..graph import get_app
from ..state import initial_state

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2")


class ChatRequest(BaseModel):
    session_id: str = Field(..., min_length=1, max_length=128)
    message: str


class ChatResponse(BaseModel):
    session_id: str
    reply: str
    scene: str | None = None


def _thread_config(session_id: str) -> dict:
    """Standard LangGraph thread config — drives checkpointer lookup."""
    return {"configurable": {"thread_id": session_id}}


async def _invoke(session_id: str, message: str) -> dict:
    app = get_app()
    cfg = _thread_config(session_id)
    # If this is a brand-new thread, seed initial state; otherwise the
    # checkpointer will resume the prior dict and we just append the new
    # HumanMessage.
    snapshot = await app.aget_state(cfg)
    if snapshot is None or snapshot.values == {}:
        seed = initial_state("chat", session_id, agent_source="chat-agent")
        seed["messages"] = [HumanMessage(content=message)]
        result = await app.ainvoke(seed, config=cfg)
    else:
        result = await app.ainvoke(
            {"messages": [HumanMessage(content=message)]},
            config=cfg,
        )
    return result


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    t0 = time.perf_counter()
    state = await _invoke(req.session_id, req.message)
    reply = state.get("last_reply_text") or ""
    scene = state.get("_scene")
    logger.info(
        "v2_chat session=%s scene=%s latency_ms=%.0f chars=%d",
        req.session_id, scene, (time.perf_counter() - t0) * 1000, len(reply),
    )
    return ChatResponse(session_id=req.session_id, reply=reply, scene=scene)


@router.post("/chat/stream")
async def chat_stream(req: ChatRequest) -> StreamingResponse:
    """Minimal SSE — one delta then done. Same brain, just streamed-shape."""

    async def gen() -> AsyncIterator[bytes]:
        yield b"event: session\ndata: {\"session_id\":\"" + req.session_id.encode() + b"\"}\n\n"
        try:
            state = await _invoke(req.session_id, req.message)
            reply = state.get("last_reply_text") or ""
            scene = state.get("_scene")
            payload = json.dumps({"text": reply})
            yield f"event: delta\ndata: {payload}\n\n".encode()
            done = json.dumps({
                "session_id": req.session_id,
                "reply": reply,
                "scene": scene,
            })
            yield f"event: done\ndata: {done}\n\n".encode()
        except Exception as exc:
            err = json.dumps({"message": str(exc)})
            yield f"event: error\ndata: {err}\n\n".encode()

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )

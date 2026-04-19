"""FastAPI service that fronts the OpenAI Agents SDK chatbot."""
from __future__ import annotations

import os
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .agent import build_agent
from .db import conn
from .voice import run_voice_session

load_dotenv()

app = FastAPI(title="Brighter Tomorrow AI", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_agent = build_agent()


class ChatRequest(BaseModel):
    session_id: str | None = Field(default=None)
    message: str


class ChatResponse(BaseModel):
    session_id: str
    reply: str


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok"}


def _load_history(session_id: str, limit: int = 20) -> list[dict[str, str]]:
    with conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT role, content FROM chat_messages
            WHERE session_id = %s
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (session_id, limit),
        )
        rows = list(reversed(cur.fetchall()))
    return [{"role": r, "content": c} for r, c in rows if r in ("user", "assistant")]


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    if not os.environ.get("OPENAI_API_KEY"):
        return ChatResponse(
            session_id=req.session_id or "",
            reply=(
                "The AI assistant is not configured yet (missing OPENAI_API_KEY). "
                "For immediate help, call 725-238-6990 or use our contact form."
            ),
        )

    session_id = req.session_id or ""
    history = _load_history(session_id) if session_id else []
    history.append({"role": "user", "content": req.message})

    # Late import so the service still boots if openai-agents is not installed
    from agents import Runner

    result = await Runner.run(_agent, history)
    reply = (result.final_output or "").strip() or "I'm here — could you tell me a bit more?"
    return ChatResponse(session_id=session_id, reply=reply)


@app.websocket("/ws/voice")
async def voice_ws(ws: WebSocket, session_id: str = "") -> None:
    await ws.accept()
    try:
        await run_voice_session(ws, session_id)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("voice_ws error: %s", e)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=int(os.environ.get("PORT", "8001")),
        reload=False,
    )

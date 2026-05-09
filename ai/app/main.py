"""FastAPI service that fronts the OpenAI Agents SDK chatbot."""
from __future__ import annotations

import logging
import os
import time
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .logging_config import configure_logging

load_dotenv()
configure_logging()

from .agent import build_agent  # noqa: E402 — must come after configure_logging
from .aws_signer import signed_post
from .data.payers import resolve_payer_id
from .db import conn
from .embed_faqs import embed_all_faqs
from .tools import _ELIGIBLE_STATES, _validate_dob
from .voice import run_voice_session

logger = logging.getLogger(__name__)

app = FastAPI(title="Brighter Tomorrow AI", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logger.info("startup: building agent graph")
_agent = build_agent()
logger.info("startup: agent graph ready")


class ChatRequest(BaseModel):
    session_id: str | None = Field(default=None)
    message: str


class ChatResponse(BaseModel):
    session_id: str
    reply: str


class CoverageCheckRequest(BaseModel):
    patient_id: str = Field(min_length=1, max_length=200)
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    dob: str
    payer_name: str = Field(min_length=1, max_length=200)
    member_id: str = Field(min_length=1, max_length=100)


class CoverageCheckResponse(BaseModel):
    ok: bool = True
    payer: str
    eligible: bool
    coverage: dict[str, Any]


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
    session_id = req.session_id or ""
    logger.info(
        "chat_request session=%s history_limit=20 msg_len=%d",
        session_id or "anon", len(req.message),
    )

    if not os.environ.get("OPENAI_API_KEY"):
        logger.warning("chat_abort reason=missing_OPENAI_API_KEY session=%s", session_id or "anon")
        return ChatResponse(
            session_id=session_id,
            reply=(
                "The AI assistant is not configured yet (missing OPENAI_API_KEY). "
                "For immediate help, call 725-238-6990 or use our contact form."
            ),
        )

    GREET_MARKER = "__BT_GREET__"
    is_greet = req.message.strip() == GREET_MARKER

    history = _load_history(session_id) if session_id and not is_greet else []
    logger.debug("chat_history session=%s loaded=%d", session_id or "anon", len(history))

    if is_greet:
        turn_content = (
            "[Visitor just opened the chat widget; they haven't said anything yet. "
            "This is a system prompt — do NOT echo it back.] Greet the visitor "
            "warmly and naturally in 1-2 short sentences. Vary the wording every "
            "time — do not reuse the same opener. Briefly invite them to ask about "
            "services, getting matched with a therapist, or practice questions. If "
            "they want to book or check coverage, point them to /get-started or "
            "/check-coverage. No bullet lists, no bold markdown, no emojis."
        )
        logger.info("chat_greet session=%s", session_id or "anon")
    else:
        turn_content = req.message
    history.append({"role": "user", "content": turn_content})

    # Late import so the service still boots if openai-agents is not installed
    from agents import Runner

    t0 = time.perf_counter()
    try:
        result = await Runner.run(_agent, history)
        latency_ms = (time.perf_counter() - t0) * 1000
        reply = (result.final_output or "").strip() or "I'm here — could you tell me a bit more?"
        logger.info(
            "chat_ok session=%s latency_ms=%.1f reply_len=%d",
            session_id or "anon", latency_ms, len(reply),
        )
    except Exception:
        latency_ms = (time.perf_counter() - t0) * 1000
        logger.exception(
            "chat_error session=%s latency_ms=%.1f",
            session_id or "anon", latency_ms,
        )
        raise

    return ChatResponse(session_id=session_id, reply=reply)


@app.post("/internal/embed-faqs")
async def internal_embed_faqs() -> dict[str, Any]:
    """Re-embed all published FAQs. Called by the Go gateway after any FAQ write.

    Cluster-internal only — not exposed through Traefik (/internal/* has no ingress rule).
    Returns the number of FAQs embedded or an error dict.
    """
    import asyncio

    logger.info("embed_faqs_start")
    t0 = time.perf_counter()
    try:
        count = await asyncio.get_running_loop().run_in_executor(None, embed_all_faqs)
        latency_ms = (time.perf_counter() - t0) * 1000
        logger.info("embed_faqs_ok count=%d latency_ms=%.1f", count, latency_ms)
        return {"ok": True, "embedded": count}
    except Exception as exc:
        latency_ms = (time.perf_counter() - t0) * 1000
        logger.exception("embed_faqs_error latency_ms=%.1f error=%s", latency_ms, exc)
        return {"ok": False, "error": str(exc)}


@app.post("/internal/intake/check-coverage", response_model=CoverageCheckResponse)
async def internal_check_coverage(req: CoverageCheckRequest) -> CoverageCheckResponse:
    valid_dob = _validate_dob(req.dob)
    if not valid_dob:
        raise HTTPException(status_code=400, detail="dob must be a valid YYYYMMDD date")

    payer = resolve_payer_id(req.payer_name)
    if payer is None or payer.id == "SELF":
        raise HTTPException(status_code=400, detail="payer_name must be a supported insurance plan")

    t0 = time.perf_counter()
    try:
        coverage = signed_post("/internal/insurance/verify", {
            "patient_id": req.patient_id.strip().lower(),
            "first_name": req.first_name.strip(),
            "last_name": req.last_name.strip(),
            "dob": valid_dob,
            "payer_id": payer.id,
            "member_id": req.member_id.strip(),
        })
    except Exception as exc:
        logger.exception("coverage_check_error payer=%s patient_id=%s", payer.id, req.patient_id)
        raise HTTPException(status_code=502, detail=f"coverage verification failed: {exc}") from exc

    latency_ms = (time.perf_counter() - t0) * 1000
    status = str(coverage.get("status") or "").strip().lower()
    eligible = status in _ELIGIBLE_STATES
    logger.info(
        "coverage_check_ok payer=%s patient_id=%s eligible=%s latency_ms=%.1f",
        payer.id,
        req.patient_id.strip().lower(),
        eligible,
        latency_ms,
    )
    return CoverageCheckResponse(
        payer=payer.name,
        eligible=eligible,
        coverage=coverage,
    )


@app.websocket("/ws/voice")
async def voice_ws(ws: WebSocket, session_id: str = "") -> None:
    logger.info("voice_ws_connect session=%s", session_id or "anon")
    await ws.accept()
    t0 = time.perf_counter()
    try:
        await run_voice_session(ws, session_id)
    except WebSocketDisconnect:
        logger.info(
            "voice_ws_disconnect session=%s duration_s=%.1f",
            session_id or "anon", time.perf_counter() - t0,
        )
    except Exception:
        logger.warning(
            "voice_ws_error session=%s duration_s=%.1f",
            session_id or "anon", time.perf_counter() - t0,
            exc_info=True,
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=int(os.environ.get("PORT", "8001")),
        reload=False,
    )

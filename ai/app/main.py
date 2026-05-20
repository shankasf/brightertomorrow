"""FastAPI service fronting the LangGraph-backed Brighter Tomorrow agent."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any, AsyncIterator

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .core.log_stream import broadcaster as log_broadcaster, install as install_log_broadcast
from .core.logging_config import configure_logging

load_dotenv()
configure_logging()
install_log_broadcast()

from .integrations.aws_signer import signed_post
from .data.payers import resolve_payer_id
from .core.db import conn
from .ingestion.embed_faqs import embed_all_faqs
from .caching.info_cache import detect_intent, get_cached_reply, cache_stats
from .integrations.tools import _ELIGIBLE_STATES, _validate_dob

from .graph.graph import get_app as get_langgraph_app
from .graph.state import initial_state as graph_initial_state
from .graph.tracing import configure_tracing as configure_langsmith
from langchain_core.messages import HumanMessage as _LCHumanMessage
configure_langsmith()

logger = logging.getLogger(__name__)

app = FastAPI(title="Brighter Tomorrow AI", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logger.info("startup: compiling LangGraph stack")
_lg_app = get_langgraph_app()
logger.info("startup: LangGraph compiled — agent is bt-prod (langsmith project)")


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


async def _invoke_langgraph(session_id: str, user_text: str, channel: str = "chat") -> dict:
    """Run one turn through the compiled LangGraph for `session_id`."""
    cfg = {"configurable": {"thread_id": session_id or "anon"}}
    # If this thread already has state in the checkpointer, only append the
    # new user message; otherwise seed a fresh state.
    snapshot = await _lg_app.aget_state(cfg)
    has_prior = bool(snapshot and getattr(snapshot, "values", None))
    if has_prior:
        return await _lg_app.ainvoke(
            {"messages": [_LCHumanMessage(content=user_text)]},
            config=cfg,
        )
    seed = graph_initial_state(channel, session_id or "anon", "chat-agent")
    seed["messages"] = [_LCHumanMessage(content=user_text)]
    return await _lg_app.ainvoke(seed, config=cfg)


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    """Single-shot chat endpoint backed by the LangGraph agent.

    Wire protocol unchanged from the legacy openai-agents handler so the
    Go gateway's ChatHandler keeps working as-is.
    """
    session_id = req.session_id or ""
    from .integrations.tools import agent_source
    agent_source.set("chat-agent")

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
    user_text = (
        "Hi"  # synthetic kickoff; respond's greeting scene fires when state is fresh
        if is_greet
        else req.message
    )

    t0 = time.perf_counter()
    try:
        result = await _invoke_langgraph(session_id, user_text, channel="chat")
        reply = (result.get("last_reply_text") or "").strip() or "I'm here — could you tell me a bit more?"
        latency_ms = (time.perf_counter() - t0) * 1000
        logger.info(
            "chat_ok session=%s scene=%s latency_ms=%.1f reply_len=%d",
            session_id or "anon", result.get("_scene"), latency_ms, len(reply),
        )
    except Exception:
        latency_ms = (time.perf_counter() - t0) * 1000
        logger.exception("chat_error session=%s latency_ms=%.1f", session_id or "anon", latency_ms)
        raise

    return ChatResponse(session_id=session_id, reply=reply)


def _sse_event(event: str, data: dict[str, Any]) -> bytes:
    """Format a single Server-Sent Event frame."""
    return f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n".encode("utf-8")


async def _stream_cached(
    session_id: str, intent: str, reply: str, cache_meta: dict[str, Any], t0: float,
) -> AsyncIterator[bytes]:
    """Emit the cache-hit SSE flow: session → single delta → done. No LLM call."""
    yield _sse_event("session", {"session_id": session_id})
    yield _sse_event("delta", {"text": reply})
    total_ms = (time.perf_counter() - t0) * 1000
    yield _sse_event("done", {
        "session_id": session_id,
        "reply": reply,
        "cached": True,
        "intent": intent,
        "version": cache_meta["version_key"],
        "cache_hit": cache_meta["hit"],
        "total_ms": round(total_ms, 1),
        "chars": len(reply),
    })
    logger.info(
        "chat_stream_done session=%s path=cached intent=%s cache_hit=%s "
        "version=%s total_ms=%.1f chars=%d",
        session_id or "anon", intent, cache_meta["hit"],
        cache_meta["version_key"], total_ms, len(reply),
    )


@app.post("/chat/stream")
async def chat_stream(req: ChatRequest, request: Request) -> StreamingResponse:
    """SSE streaming variant of /chat — now backed by LangGraph.

    Wire protocol preserved for the gateway and the React widget:
        `session` -> `delta` (one) -> `done`

    We don't stream tokens here — the LangGraph respond node is a single
    LLM call that returns a complete reply. Sending it as one `delta`
    keeps the frontend code unchanged while we move to the new agent.
    A real token-streaming responder is a follow-up.
    """
    session_id = req.session_id or ""
    msg = req.message or ""
    t0 = time.perf_counter()
    from .integrations.tools import agent_source
    agent_source.set("chat-agent")

    if not os.environ.get("OPENAI_API_KEY"):
        async def _missing_key_stream() -> AsyncIterator[bytes]:
            reply = (
                "The AI assistant is not configured yet (missing OPENAI_API_KEY). "
                "For immediate help, call 725-238-6990 or use our contact form."
            )
            yield _sse_event("session", {"session_id": session_id})
            yield _sse_event("delta", {"text": reply})
            yield _sse_event("done", {
                "session_id": session_id, "reply": reply, "cached": False,
                "error": "missing_OPENAI_API_KEY", "total_ms": 0, "chars": len(reply),
            })
        return StreamingResponse(_missing_key_stream(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"})

    is_greet = msg.strip() == "__BT_GREET__"
    user_text = "Hi" if is_greet else msg

    # Canned-reply cache — still useful for common questions. Bypassed
    # for the greeting (always render fresh) and obviously when no
    # intent matches.
    if not is_greet:
        intent = detect_intent(msg)
        if intent is not None:
            cached = get_cached_reply(intent)
            if cached is not None:
                meta = {"version_key": cached.version_key, "hit": cached.hit}
                logger.info(
                    "chat_stream_cached_path session=%s intent=%s cache_hit=%s chars=%d",
                    session_id or "anon", intent, cached.hit, cached.chars,
                )
                return StreamingResponse(
                    _stream_cached(session_id, intent, cached.reply, meta, t0),
                    media_type="text/event-stream",
                    headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
                )

    async def _stream_graph() -> AsyncIterator[bytes]:
        yield _sse_event("session", {"session_id": session_id})
        try:
            result = await _invoke_langgraph(session_id, user_text, channel="chat")
            reply = (result.get("last_reply_text") or "").strip()
            if not reply:
                reply = "I'm here — could you tell me a bit more?"
            yield _sse_event("delta", {"text": reply})
            total_ms = (time.perf_counter() - t0) * 1000
            yield _sse_event("done", {
                "session_id": session_id,
                "reply": reply,
                "cached": False,
                "scene": result.get("_scene"),
                "agent": "langgraph",
                "total_ms": round(total_ms, 1),
                "chars": len(reply),
            })
            logger.info(
                "chat_stream_ok session=%s scene=%s latency_ms=%.1f chars=%d",
                session_id or "anon", result.get("_scene"), total_ms, len(reply),
            )
        except Exception as exc:
            logger.exception("chat_stream_error session=%s", session_id or "anon")
            yield _sse_event("error", {"message": str(exc)})
            yield _sse_event("done", {
                "session_id": session_id, "reply": "", "cached": False,
                "error": str(exc), "total_ms": (time.perf_counter() - t0) * 1000, "chars": 0,
            })

    return StreamingResponse(
        _stream_graph(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


@app.get("/internal/cache/stats")
def internal_cache_stats() -> dict[str, Any]:
    """Snapshot of the canned-reply cache. Cluster-internal — for ops/debug."""
    return cache_stats()


@app.get("/internal/logs/stream")
async def internal_logs_stream(request: Request) -> StreamingResponse:
    """SSE stream of live log records (INFO and above).

    Cluster-internal endpoint — the gateway proxies this under
    superadmin auth and audits each viewer in admin_access_log. Records
    are produced by the app.log_stream broadcaster, which buffers the
    last 500 lines so a fresh subscriber sees recent history before
    going live. Records may contain operational PHI (patient_id,
    payer_id, tool latencies) — do NOT expose without auth.
    """
    async def gen() -> AsyncIterator[bytes]:
        q = log_broadcaster.subscribe()
        try:
            # Hello so the client knows the stream is up.
            yield b': connected\n\n'
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    # Keep-alive comment — keeps proxies from closing
                    # an idle SSE connection.
                    yield b': keep-alive\n\n'
                    continue
                payload = json.dumps(msg, separators=(",", ":"))
                yield f"data: {payload}\n\n".encode("utf-8")
        finally:
            log_broadcaster.unsubscribe(q)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


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
        # signed_post is sync (httpx + botocore.SigV4Auth) — offload to a thread
        # so we don't block the uvicorn event loop for the CLAIM.MD round-trip
        # (up to 20s). asyncio.to_thread propagates ContextVars too.
        coverage = await asyncio.to_thread(
            signed_post,
            "/internal/insurance/verify",
            {
                "patient_id": req.patient_id.strip().lower(),
                "first_name": req.first_name.strip(),
                "last_name": req.last_name.strip(),
                "dob": valid_dob,
                "payer_id": payer.id,
                "member_id": req.member_id.strip(),
            },
        )
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
    # Stamp this connection as voice so tools invoked by the realtime agents
    # (e.g. book_with_insurance) record source=voice-agent on the intake.
    from .integrations.tools import agent_source
    agent_source.set("voice-agent")
    # New: route to the LangGraph-backed voice bridge (Deepgram STT,
    # LangGraph brain, Cartesia TTS). Same wire protocol as the legacy
    # bridge so the React widget needs no changes.
    from .graph.runtime.voice_browser import voice_ws as _graph_voice_ws
    try:
        # The router decorator's accept() is skipped because we already
        # accepted above — call the inner function directly.
        await _graph_voice_ws.__wrapped__(ws, session_id) if hasattr(_graph_voice_ws, "__wrapped__") else await _graph_voice_ws(ws, session_id)
    except WebSocketDisconnect:
        logger.info("voice_ws_disconnect session=%s duration_s=%.1f", session_id or "anon", time.perf_counter() - t0)
    except Exception:
        logger.warning("voice_ws_error session=%s duration_s=%.1f", session_id or "anon", time.perf_counter() - t0, exc_info=True)


# ---------------------------------------------------------------------------
# Twilio Voice — phone callers reach the same realtime agent graph.
# ---------------------------------------------------------------------------
#
# Twilio configuration (per number):
#   * "A CALL COMES IN" webhook (HTTP POST)
#       https://brightertomorrowtherapy.cloud/v1/twilio/voice
#   * The TwiML response opens a bidirectional Media Stream to
#       wss://brightertomorrowtherapy.cloud/v1/twilio/media
#   * Recording MUST be disabled on the number (HIPAA / BAA scope).
#
# The gateway terminates TLS and verifies the X-Twilio-Signature header
# before proxying to these endpoints (see gateway/internal/handlers/twilio.go).


@app.post("/twilio/voice")
async def twilio_voice() -> Any:
    """Return TwiML that opens a Media Stream back to /twilio/media.

    The gateway sets the public host explicitly via the ``BT_PUBLIC_WS_BASE``
    env so we don't accidentally point Twilio at a stale staging host.
    """
    from fastapi.responses import Response

    ws_base = (
        os.environ.get("BT_PUBLIC_WS_BASE")
        or "wss://brightertomorrowtherapy.cloud"
    ).rstrip("/")
    stream_url = f"{ws_base}/v1/twilio/media"
    twiml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        "<Connect>"
        f'<Stream url="{stream_url}" />'
        "</Connect>"
        "</Response>"
    )
    return Response(content=twiml, media_type="application/xml")


@app.websocket("/twilio/media")
async def twilio_media_ws(ws: WebSocket) -> None:
    """Twilio Media Stream → LangGraph (μ-law 8 kHz ↔ PCM16 16 kHz)."""
    logger.info("twilio_ws_connect")
    from .integrations.tools import agent_source
    agent_source.set("voice-phone")
    t0 = time.perf_counter()
    # Delegate to the new LangGraph-backed Twilio bridge. It owns the
    # WS accept() (with audio.twilio.com subprotocol) so we don't
    # double-accept here.
    from .graph.runtime.voice_twilio import twilio_media as _graph_twilio_media
    try:
        await _graph_twilio_media.__wrapped__(ws) if hasattr(_graph_twilio_media, "__wrapped__") else await _graph_twilio_media(ws)
    except WebSocketDisconnect:
        logger.info("twilio_ws_disconnect duration_s=%.1f", time.perf_counter() - t0)
    except Exception:
        logger.warning("twilio_ws_error duration_s=%.1f", time.perf_counter() - t0, exc_info=True)


# The /v2/* aliases stay mounted for ad-hoc testing, but the canonical
# /chat, /chat/stream, /ws/voice, /twilio/* routes above are now the
# LangGraph stack — no toggle, no feature flag.
try:
    from .graph.runtime.chat import router as _v2_chat_router
    app.include_router(_v2_chat_router)
    logger.info("v2 alias routes mounted at /v2/chat")
except Exception:
    logger.exception("v2 alias mount failed (non-fatal)")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=int(os.environ.get("PORT", "8001")),
        reload=False,
    )

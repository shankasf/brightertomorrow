"""FastAPI service that fronts the OpenAI Agents SDK chatbot."""
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

from .logging_config import configure_logging

load_dotenv()
configure_logging()

from .agent import build_agent  # noqa: E402 — must come after configure_logging
from .aws_signer import signed_post
from .data.payers import resolve_payer_id
from .db import conn
from .embed_faqs import embed_all_faqs
from .info_cache import detect_intent, get_cached_reply, cache_stats
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

# Stable prompt_cache_key for OpenAI prompt caching. Per docs: "Use the
# prompt_cache_key parameter consistently across requests that share common
# prefixes." Our agent instructions + tool schemas are the shared prefix, so a
# single global key per service version maximizes cache routing affinity while
# staying well below the 15 RPM/key threshold at our scale. Bump on any change
# that would invalidate the cached prefix (instruction edits, tool surface).
_PROMPT_CACHE_KEY = os.environ.get("BT_PROMPT_CACHE_KEY", "bt-chat-v1")


def _run_config() -> Any:
    """Build a RunConfig that maximizes prompt-cache hits and surfaces usage.

    Late-imported so the service still boots if openai-agents is missing.
    """
    from agents import ModelSettings, RunConfig
    return RunConfig(
        model_settings=ModelSettings(
            include_usage=True,
            extra_args={"prompt_cache_key": _PROMPT_CACHE_KEY},
        ),
        workflow_name="bt-chat",
    )


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
    # Mark this request as text-chat so any tools called downstream (e.g.
    # book_with_insurance) stamp source=chat-agent on the intake payload.
    from .tools import agent_source
    agent_source.set("chat-agent")
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

    turn_content = (
        "[Visitor just opened the chat widget; they haven't said anything yet. "
        "This is a system prompt — do NOT echo it back.] Greet the visitor "
        "warmly and naturally in 1-2 short sentences. Vary the wording every "
        "time — do not reuse the same opener. Briefly invite them to ask about "
        "booking, getting matched with a therapist, checking insurance, or "
        "practice questions. No bullet lists, no bold markdown, no emojis."
    ) if is_greet else req.message
    if is_greet:
        logger.info("chat_greet session=%s", session_id or "anon")
    history.append({"role": "user", "content": turn_content})

    # Late import so the service still boots if openai-agents is not installed
    from agents import Runner

    t0 = time.perf_counter()
    try:
        result = await Runner.run(_agent, history, run_config=_run_config())
        latency_ms = (time.perf_counter() - t0) * 1000
        reply = (result.final_output or "").strip() or "I'm here — could you tell me a bit more?"
        logger.info(
            "chat_ok session=%s latency_ms=%.1f reply_len=%d cache_key=%s",
            session_id or "anon", latency_ms, len(reply), _PROMPT_CACHE_KEY,
        )
    except Exception:
        latency_ms = (time.perf_counter() - t0) * 1000
        logger.exception(
            "chat_error session=%s latency_ms=%.1f",
            session_id or "anon", latency_ms,
        )
        raise

    return ChatResponse(session_id=session_id, reply=reply)


def _sse_event(event: str, data: dict[str, Any]) -> bytes:
    """Format a single Server-Sent Event frame."""
    return f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n".encode("utf-8")


# Greet prompt is the same content the non-streaming /chat endpoint uses.
_GREET_TURN = (
    "[Visitor just opened the chat widget; they haven't said anything yet. "
    "This is a system prompt — do NOT echo it back.] Greet the visitor "
    "warmly and naturally in 1-2 short sentences. Vary the wording every "
    "time — do not reuse the same opener. Briefly invite them to ask about "
    "booking, getting matched with a therapist, checking insurance, or "
    "practice questions. No bullet lists, no bold markdown, no emojis."
)


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


async def _stream_llm(session_id: str, history: list[dict[str, str]], t0: float) -> AsyncIterator[bytes]:
    """Emit the LLM SSE flow: session → many deltas → done.

    Uses the canonical Agents SDK streaming pattern:
        result = Runner.run_streamed(agent, input)
        async for event in result.stream_events():
            if event.type == "raw_response_event" and isinstance(event.data, ResponseTextDeltaEvent):
                yield event.data.delta

    `RunItemStreamEvent`s (tool_called, tool_output, handoff_occured) are logged
    for observability but not forwarded to the client — the widget only renders
    the final assistant text.
    """
    # Late imports so the service can boot if openai-agents isn't installed yet.
    from agents import Runner
    from openai.types.responses import ResponseCompletedEvent, ResponseTextDeltaEvent

    yield _sse_event("session", {"session_id": session_id})

    first_token_ms: float | None = None
    delta_count = 0
    full_text_parts: list[str] = []
    last_agent_name: str | None = None
    tool_calls: list[str] = []
    # Aggregated across all model calls in the run (one call per agent hop).
    prompt_tokens = 0
    cached_tokens = 0
    completion_tokens = 0
    response_count = 0

    try:
        result = Runner.run_streamed(_agent, history, run_config=_run_config())
    except Exception as exc:
        total_ms = (time.perf_counter() - t0) * 1000
        logger.exception(
            "chat_stream_error session=%s stage=run_start total_ms=%.1f",
            session_id or "anon", total_ms,
        )
        yield _sse_event("error", {"message": "ai service unavailable"})
        yield _sse_event("done", {
            "session_id": session_id, "reply": "", "cached": False,
            "error": str(exc), "total_ms": round(total_ms, 1), "chars": 0,
        })
        return

    try:
        async for event in result.stream_events():
            if event.type == "raw_response_event":
                if isinstance(event.data, ResponseTextDeltaEvent):
                    delta = event.data.delta
                    if not delta:
                        continue
                    if first_token_ms is None:
                        first_token_ms = (time.perf_counter() - t0) * 1000
                        logger.info(
                            "chat_stream_first_token session=%s ttft_ms=%.1f agent=%s",
                            session_id or "anon", first_token_ms, last_agent_name or "?",
                        )
                    delta_count += 1
                    full_text_parts.append(delta)
                    yield _sse_event("delta", {"text": delta})
                    continue
                if isinstance(event.data, ResponseCompletedEvent):
                    # One ResponseCompleted per LLM call in the run (triage,
                    # handoff target, etc.). Aggregate usage and log per-hop
                    # cache hit-rate so we can verify OpenAI prompt caching is
                    # working as expected.
                    usage = getattr(event.data.response, "usage", None)
                    if usage is not None:
                        response_count += 1
                        ip = int(getattr(usage, "input_tokens", 0) or 0)
                        op = int(getattr(usage, "output_tokens", 0) or 0)
                        details = getattr(usage, "input_tokens_details", None)
                        ct = int(getattr(details, "cached_tokens", 0) or 0) if details else 0
                        prompt_tokens += ip
                        completion_tokens += op
                        cached_tokens += ct
                        hit_pct = (ct / ip * 100) if ip > 0 else 0.0
                        logger.info(
                            "chat_stream_response_done session=%s hop=%d agent=%s "
                            "input_tok=%d cached_tok=%d cache_hit_pct=%.1f output_tok=%d",
                            session_id or "anon", response_count,
                            last_agent_name or "?", ip, ct, hit_pct, op,
                        )
                    continue
                continue

            if event.type == "agent_updated_stream_event":
                last_agent_name = getattr(event.new_agent, "name", None)
                logger.info(
                    "chat_stream_agent session=%s agent=%s",
                    session_id or "anon", last_agent_name,
                )
                continue

            if event.type == "run_item_stream_event":
                if event.name == "tool_called":
                    tool_name = getattr(getattr(event.item, "raw_item", None), "name", None) or "?"
                    tool_calls.append(tool_name)
                    logger.info(
                        "chat_stream_tool_call session=%s tool=%s agent=%s",
                        session_id or "anon", tool_name, last_agent_name or "?",
                    )
                elif event.name == "handoff_occured":
                    logger.info("chat_stream_handoff session=%s", session_id or "anon")

    except Exception as exc:
        total_ms = (time.perf_counter() - t0) * 1000
        partial = "".join(full_text_parts)
        logger.exception(
            "chat_stream_error session=%s stage=stream total_ms=%.1f partial_chars=%d",
            session_id or "anon", total_ms, len(partial),
        )
        yield _sse_event("error", {"message": "stream interrupted"})
        yield _sse_event("done", {
            "session_id": session_id, "reply": partial, "cached": False,
            "error": str(exc), "total_ms": round(total_ms, 1), "chars": len(partial),
        })
        return

    full_reply = ("".join(full_text_parts)).strip() or "I'm here — could you tell me a bit more?"
    total_ms = (time.perf_counter() - t0) * 1000
    overall_hit_pct = (cached_tokens / prompt_tokens * 100) if prompt_tokens > 0 else 0.0

    yield _sse_event("done", {
        "session_id": session_id,
        "reply": full_reply,
        "cached": False,
        "agent": last_agent_name,
        "tool_calls": tool_calls,
        "deltas": delta_count,
        "ttft_ms": round(first_token_ms, 1) if first_token_ms is not None else None,
        "total_ms": round(total_ms, 1),
        "chars": len(full_reply),
        "usage": {
            "prompt_tokens": prompt_tokens,
            "cached_tokens": cached_tokens,
            "completion_tokens": completion_tokens,
            "cache_hit_pct": round(overall_hit_pct, 1),
            "responses": response_count,
        },
    })

    logger.info(
        "chat_stream_done session=%s path=llm agent=%s tools=%s deltas=%d "
        "ttft_ms=%s total_ms=%.1f chars=%d "
        "prompt_tok=%d cached_tok=%d cache_hit_pct=%.1f completion_tok=%d hops=%d "
        "cache_key=%s",
        session_id or "anon", last_agent_name or "?", ",".join(tool_calls) or "-",
        delta_count,
        f"{first_token_ms:.1f}" if first_token_ms is not None else "n/a",
        total_ms, len(full_reply),
        prompt_tokens, cached_tokens, overall_hit_pct, completion_tokens, response_count,
        _PROMPT_CACHE_KEY,
    )


@app.post("/chat/stream")
async def chat_stream(req: ChatRequest, request: Request) -> StreamingResponse:
    """SSE streaming variant of /chat.

    Flow:
        1. Cache pre-check via info_cache.detect_intent — if a canned intent
           matches AND the cached version is fresh, serve immediately (no LLM).
        2. Otherwise stream tokens from Runner.run_streamed.

    Emits SSE events: `session` → `delta` (one-or-many) → `done` (terminal).
    `error` may precede a terminal `done` if the upstream LLM fails.
    """
    session_id = req.session_id or ""
    msg = req.message or ""
    t0 = time.perf_counter()
    # Tag this request as text-chat (vs. voice) so tools called inside the
    # agent stream stamp source=chat-agent on any intake/coverage submissions.
    from .tools import agent_source
    agent_source.set("chat-agent")

    logger.info(
        "chat_stream_request session=%s msg_len=%d client=%s",
        session_id or "anon", len(msg), request.client.host if request.client else "?",
    )

    if not os.environ.get("OPENAI_API_KEY"):
        logger.warning("chat_stream_abort reason=missing_OPENAI_API_KEY session=%s", session_id or "anon")

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

    # Cache check — only for real user messages, never for the synthetic greeting.
    if not is_greet:
        intent = detect_intent(msg)
        if intent is not None:
            logger.info(
                "chat_stream_intent session=%s intent=%s msg_preview=%r",
                session_id or "anon", intent, msg[:80],
            )
            cached = get_cached_reply(intent)
            if cached is not None:
                # Cache hit OR fresh render — both bypass the LLM.
                meta = {"version_key": cached.version_key, "hit": cached.hit}
                logger.info(
                    "chat_stream_cached_path session=%s intent=%s cache_hit=%s "
                    "lookup_ms=%.1f chars=%d",
                    session_id or "anon", intent, cached.hit,
                    cached.latency_ms, cached.chars,
                )
                return StreamingResponse(
                    _stream_cached(session_id, intent, cached.reply, meta, t0),
                    media_type="text/event-stream",
                    headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
                )

    history = _load_history(session_id) if session_id and not is_greet else []
    logger.debug("chat_stream_history session=%s loaded=%d", session_id or "anon", len(history))

    if is_greet:
        logger.info("chat_stream_greet session=%s", session_id or "anon")
        history.append({"role": "user", "content": _GREET_TURN})
    else:
        history.append({"role": "user", "content": msg})

    return StreamingResponse(
        _stream_llm(session_id, history, t0),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


@app.get("/internal/cache/stats")
def internal_cache_stats() -> dict[str, Any]:
    """Snapshot of the canned-reply cache. Cluster-internal — for ops/debug."""
    return cache_stats()


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
    # Stamp this connection as voice so tools invoked by the realtime agents
    # (e.g. book_with_insurance) record source=voice-agent on the intake.
    from .tools import agent_source
    agent_source.set("voice-agent")
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

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

from .log_stream import broadcaster as log_broadcaster, install as install_log_broadcast
from .logging_config import configure_logging

load_dotenv()
configure_logging()
install_log_broadcast()

# Disable the OpenAI Agents SDK tracing client. It posts spans to
# api.openai.com (global), which our US-region-only project rejects with
# 401 `incorrect_hostname` — non-fatal but pollutes the log stream on
# every tool call. Production tracing belongs in CloudWatch + slog, not
# OpenAI's hosted spans. Override with BT_AGENTS_TRACING=1 if needed.
import os  # noqa: E402
if os.environ.get("BT_AGENTS_TRACING", "0") != "1":
    from agents import set_tracing_disabled  # noqa: E402
    set_tracing_disabled(True)

from .aws_signer import signed_post
from .data.payers import resolve_payer_id
from .db import conn
from .embed_faqs import embed_all_faqs
from .info_cache import detect_intent, get_cached_reply, cache_stats
from .tools import _ELIGIBLE_STATES, _validate_dob

# --- NEW: LangGraph runtime is now the primary agent (replaces openai-agents)
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
    """Pull recent turns from the gateway's PHI-backed history endpoint.

    Postgres no longer holds chat content — message bodies live in DynamoDB
    so Hostinger never sees PHI. The gateway's /internal/chat/history call
    fans out to DDB on our behalf.
    """
    if not session_id:
        return []
    import urllib.parse, urllib.request, json as _json
    base = os.environ.get("BT_GATEWAY_URL", "http://bt-gateway")
    url = f"{base}/internal/chat/history?" + urllib.parse.urlencode({
        "session_id": session_id, "limit": str(limit),
    })
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            data = _json.loads(r.read().decode("utf-8"))
    except Exception:
        logger.exception("load_history_failed session=%s", session_id)
        return []
    return [
        {"role": m["role"], "content": m["content"]}
        for m in data.get("messages", [])
        if m.get("role") in ("user", "assistant")
    ]


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
    from .tools import agent_source
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
    from .tools import agent_source
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
    from .tools import agent_source
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
    from .tools import agent_source
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

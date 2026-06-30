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
from .data.identifiers import normalize_member_id
from .core.db import conn
from .ingestion.embed_faqs import embed_all_faqs
from .ingestion.embed_blogs import embed_blog
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

# Pre-warm the phone voice bridge at startup. The realtime stack
# (bt_agents.realtime) costs ~4.5s to import cold; doing it lazily inside the
# /twilio/media handler made the FIRST caller after every pod restart wait ~4.5s
# before the OpenAI session even opened (≈7s to first audio). Importing it here
# moves that cost to boot, so every call — including the first — connects fast.
try:
    _vb = (os.environ.get("VOICE_BRIDGE") or "sdk").strip().lower()
    _t0 = time.perf_counter()
    if _vb == "hc":
        from .voice_hc.bridge import run_twilio_session as _warm_bridge  # noqa: F401
    elif _vb == "raw_ws":
        from .voice_rt.twilio_bridge import run_twilio_session as _warm_bridge  # noqa: F401
    else:
        from .twilio_voice import run_twilio_session as _warm_bridge  # noqa: F401
    logger.info("startup: voice bridge '%s' pre-warmed in %.2fs", _vb, time.perf_counter() - _t0)
except Exception:
    logger.warning("startup: voice bridge pre-warm failed (will lazy-import on first call)", exc_info=True)


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


async def _stream_langgraph_respond_tokens(
    session_id: str, user_text: str, channel: str = "chat"
) -> AsyncIterator[dict]:
    """Stream the graph for one turn; yield respond-node token chunks.

    Yields:
      * {"type": "token", "text": <chunk>}  — partial respond text. Multiple
        chunks per turn. ONLY from the respond node — extract's structured
        output is not streamed (it would pollute the user-facing reply).
      * {"type": "final", "result": <dict>} — once at the end, with the
        complete state dict so callers can read last_reply_text, _scene, etc.

    Mirrors the resume-offer flag injection in _invoke_langgraph so the
    streaming path stays behaviourally identical to the non-streaming one.
    """
    cfg = {"configurable": {"thread_id": session_id or "anon"}}
    snapshot = await _lg_app.aget_state(cfg)
    has_prior = bool(snapshot and getattr(snapshot, "values", None))
    is_greet = user_text.strip() == "Hi"

    # GREET-on-prior-state short-circuit (stray-greeting defense).
    # A remount / refresh fires a second __BT_GREET__ against an established
    # thread. Without this guard, the graph runs and emits a generic
    # "open_question" or "greeting" reply, producing two consecutive
    # assistant turns with no user turn between (DDB pollution + audit-
    # trail concern). Yield the verbatim HIPAA_RESUME_CHAT (or _VOICE) as a
    # single token then short-circuit; no graph invocation, no LLM call.
    if has_prior and is_greet:
        from .graph.prompts._constants import HIPAA_RESUME_CHAT, HIPAA_RESUME_VOICE
        resume_text = HIPAA_RESUME_VOICE if str(channel).startswith("voice") else HIPAA_RESUME_CHAT
        logger.info(
            "greet_on_prior_short_circuit session=%s channel=%s chars=%d",
            session_id or "anon", channel, len(resume_text),
        )
        yield {"type": "token", "text": resume_text}
        yield {"type": "final", "result": {"last_reply_text": resume_text, "_scene": "resume_opener"}}
        return

    if has_prior:
        graph_input: Any = {"messages": [_LCHumanMessage(content=user_text)]}
    else:
        seed = graph_initial_state(channel, session_id or "anon", "chat-agent")
        seed["messages"] = [_LCHumanMessage(content=user_text)]
        graph_input = seed

    final_state: dict | None = None
    async for event in _lg_app.astream_events(graph_input, config=cfg, version="v2"):
        kind = event.get("event")
        if kind == "on_chat_model_stream":
            metadata = event.get("metadata") or {}
            # Only stream tokens from the respond node — extract's structured
            # output would otherwise show up as JSON in the user-facing reply.
            if metadata.get("langgraph_node") != "respond":
                continue
            data = event.get("data") or {}
            chunk = data.get("chunk")
            text = getattr(chunk, "content", "") if chunk is not None else ""
            if isinstance(text, list):
                # Some LC versions emit list-of-blocks for content; flatten.
                text = "".join(
                    (b.get("text", "") if isinstance(b, dict) else str(b))
                    for b in text
                )
            if text:
                yield {"type": "token", "text": text}
        elif kind == "on_chain_end":
            # Capture the top-level graph output (the only on_chain_end with
            # no parent_run_ids points at the graph root).
            name = event.get("name")
            if name == "LangGraph":
                data = event.get("data") or {}
                output = data.get("output")
                if isinstance(output, dict):
                    final_state = output

    yield {"type": "final", "result": final_state or {}}


def _strip_picker_marker_streaming(buf: str) -> tuple[str, str]:
    """Pull emittable text out of a token buffer while keeping [[...]] markers intact.

    Returns (emit, remaining_buffer). The remaining buffer holds back any
    open "[[" sequence until we know whether it closes with "]]" (marker
    to swallow) or is a false-positive (emit literally on flush).
    """
    if "[[" not in buf:
        return buf, ""
    pre, _, rest = buf.partition("[[")
    if "]]" in rest:
        # Complete marker found — swallow it.
        _marker, _, after = rest.partition("]]")
        # Continue scanning `after` for further markers.
        sub_emit, sub_rest = _strip_picker_marker_streaming(after)
        return pre + sub_emit, sub_rest
    # Incomplete marker — hold the buffer until more tokens arrive.
    return pre, "[[" + rest


async def _invoke_langgraph(session_id: str, user_text: str, channel: str = "chat") -> dict:
    """Run one turn through the compiled LangGraph for `session_id`."""
    cfg = {"configurable": {"thread_id": session_id or "anon"}}
    snapshot = await _lg_app.aget_state(cfg)
    has_prior = bool(snapshot and getattr(snapshot, "values", None))
    is_greet = user_text.strip() == "Hi"
    if has_prior:
        # GREET-on-prior-state short-circuit (stray-greeting defense). Same
        # invariant as _stream_langgraph_respond_tokens — never let the
        # graph emit a generic re-greeting against an existing thread.
        if is_greet:
            from .graph.prompts._constants import (
                HIPAA_RESUME_CHAT,
                HIPAA_RESUME_VOICE,
            )
            resume_text = (
                HIPAA_RESUME_VOICE if str(channel).startswith("voice") else HIPAA_RESUME_CHAT
            )
            logger.info(
                "greet_on_prior_short_circuit session=%s channel=%s chars=%d",
                session_id or "anon", channel, len(resume_text),
            )
            return {"last_reply_text": resume_text, "_scene": "resume_opener"}
        return await _lg_app.ainvoke(
            {"messages": [_LCHumanMessage(content=user_text)]},
            config=cfg,
        )
    seed = graph_initial_state(channel, session_id or "anon", "chat-agent")
    seed["messages"] = [_LCHumanMessage(content=user_text)]
    return await _lg_app.ainvoke(seed, config=cfg)


# Per-session de-dupe for graph audit events. `audit_event` is a plain (sticky)
# state key: it lingers in the checkpoint across turns until a later node
# overwrites it, so the merged final state re-presents the same event every
# turn. We log each distinct event (keyed by its creation ts + action) once.
# Bounded to avoid unbounded growth on a long-lived process.
_last_audit_seen: dict[str, str] = {}
_LAST_AUDIT_CAP = 2000


def _log_graph_audit(result: dict[str, Any] | None, session_id: str) -> None:
    """Emit the graph's terminal audit_event to structured logs (once per event).

    The graph nodes build a NON-PHI `audit_event` dict (action/session_id/ts/
    outcome — see _build_audit_event). PHI-mutation events (booking, verify,
    cancel) are already audited gateway-side at the data endpoints; this gives
    the conversational/safety events (crisis, ROI, mandatory-report, gate
    decisions) a real, grep-able destination in the log lake instead of being
    silently dropped. Only the merged final-state event is logged — terminal
    handoffs are last-node, so the compliance-relevant ones land here.
    """
    if not result:
        return
    ev = result.get("audit_event")
    if not isinstance(ev, dict) or not ev:
        return
    # Skip if we've already logged this exact event for this session (the
    # sticky-key replay described above).
    sid = session_id or "anon"
    fingerprint = f"{ev.get('ts','')}|{ev.get('action') or ev.get('type','')}"
    if _last_audit_seen.get(sid) == fingerprint:
        return
    if len(_last_audit_seen) >= _LAST_AUDIT_CAP:
        _last_audit_seen.clear()
    _last_audit_seen[sid] = fingerprint
    try:
        logger.info("graph_audit_event session=%s event=%s", sid, json.dumps(ev, separators=(",", ":")))
    except Exception:
        logger.info("graph_audit_event session=%s event=%r", sid, ev)


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
        _log_graph_audit(result, session_id)
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
            # get_cached_reply does a blocking psycopg connect on a cache miss;
            # off-load to a thread so a miss never stalls the event loop (and
            # every other in-flight SSE/WS connection) during the DB round-trip.
            cached = await asyncio.to_thread(get_cached_reply, intent)
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
        accumulated = ""
        result: dict[str, Any] = {}
        marker_buf = ""
        first_token_ms: float | None = None
        try:
            async for ev in _stream_langgraph_respond_tokens(
                session_id, user_text, channel="chat"
            ):
                if ev["type"] == "token":
                    marker_buf += ev["text"]
                    accumulated += ev["text"]
                    emit, marker_buf = _strip_picker_marker_streaming(marker_buf)
                    if emit:
                        if first_token_ms is None:
                            first_token_ms = (time.perf_counter() - t0) * 1000
                        yield _sse_event("delta", {"text": emit})
                elif ev["type"] == "final":
                    result = ev["result"] or {}
            _log_graph_audit(result, session_id)
            # Flush any leftover buffer (e.g. a stray "[[" that never closed).
            if marker_buf:
                yield _sse_event("delta", {"text": marker_buf})
                marker_buf = ""
            reply = (result.get("last_reply_text") or accumulated).strip()
            # Non-streaming scenes (disclosure_prompt, resume_opener, static
            # actions) set last_reply_text directly without emitting any
            # on_chat_model_stream events, so `accumulated` is empty. We must
            # still ship the text as a delta so the gateway's SSE parser
            # accumulates it — otherwise gateway sees an empty stream and
            # persists the chatFallback string instead of the real reply.
            if reply and not accumulated:
                if first_token_ms is None:
                    first_token_ms = (time.perf_counter() - t0) * 1000
                yield _sse_event("delta", {"text": reply})
                accumulated = reply
            if not reply:
                reply = "I'm here — could you tell me a bit more?"
                yield _sse_event("delta", {"text": reply})
            # Strip any markers from the final reply we report back to the
            # client / persistence layer so the widget never sees them.
            clean_reply = reply
            while "[[" in clean_reply and "]]" in clean_reply:
                pre, _, rest = clean_reply.partition("[[")
                _marker, _, after = rest.partition("]]")
                clean_reply = pre + after
            total_ms = (time.perf_counter() - t0) * 1000
            yield _sse_event("done", {
                "session_id": session_id,
                "reply": reply,  # raw, including marker, so widget can render picker
                "cached": False,
                "scene": result.get("_scene"),
                "agent": "langgraph",
                "total_ms": round(total_ms, 1),
                "first_token_ms": round(first_token_ms, 1) if first_token_ms else None,
                "chars": len(clean_reply),
            })
            logger.info(
                "chat_stream_ok session=%s scene=%s latency_ms=%.1f first_token_ms=%s chars=%d",
                session_id or "anon", result.get("_scene"), total_ms,
                f"{first_token_ms:.1f}" if first_token_ms else "-",
                len(clean_reply),
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


@app.post("/internal/evals/trigger")
async def internal_evals_trigger(request: Request) -> dict[str, Any]:
    """Trigger an eval run asynchronously.

    Body: {"kind": "offline"|"online", "sample": int (online only)}
    Returns: {"run_id": str, "status": "started"} immediately.

    The eval runs in a background task and POSTs results to the gateway
    when complete. This endpoint is internal-network only (same as other
    /internal/* — no admin auth; the gateway calls it server-side).
    """
    from uuid import uuid4 as _uuid4
    body: dict[str, Any] = {}
    try:
        body = await request.json()
    except Exception:
        pass

    kind = str(body.get("kind") or "offline").strip().lower()
    if kind not in ("offline", "online"):
        kind = "offline"
    channel = str(body.get("channel") or "chat").strip().lower()
    if channel not in ("chat", "voice", "phone"):
        channel = "chat"

    def _as_int(value: Any, default: int) -> int:
        try:
            return int(value) if value not in (None, "") else default
        except (TypeError, ValueError):
            return default

    sample = _as_int(body.get("sample"), 20)
    hours = _as_int(body.get("hours"), 24)
    run_id = str(_uuid4())

    async def _bg_run() -> None:
        try:
            if kind == "offline":
                from .graph.evals.run_evals import run_offline
                await run_offline(run_id=run_id, channel=channel)
            else:
                from .graph.evals.run_evals import run_online
                await run_online(run_id=run_id, sample=sample, hours=hours, channel=channel)
        except Exception:
            logger.exception("evals_trigger_bg_error run_id=%s kind=%s channel=%s", run_id, kind, channel)

    asyncio.create_task(_bg_run())
    logger.info("evals_trigger_started run_id=%s kind=%s channel=%s sample=%d", run_id, kind, channel, sample)
    return {"run_id": run_id, "status": "started"}


@app.post("/internal/evals/promote")
async def internal_evals_promote(request: Request) -> dict[str, Any]:
    """De-identify a raw eval turn/transcript blob and return the scrubbed fixture.

    Body: any JSON object — typically one eval turn or a partial transcript:
        {
            "transcript": [...],   # optional list of turn dicts
            "user_says": "...",    # optional free-text field
            "reply": "...",        # optional
            "intent": "...",       # optional
            ...                    # any other fields are scrubbed in-place
        }

    Response:
        { "scrubbed_fixture": <PHI-free copy of the input dict> }

    This endpoint DOES NOT write to datasets.py or any storage. The caller
    receives a proposal they must eyeball for residual PHI before use.
    PHI stays on OpenAI (BAA covered) — no data leaves the AI service.
    """
    body: dict[str, Any] = {}
    try:
        body = await request.json()
    except Exception:
        pass

    from .graph.evals.promote import scrub_dict
    scrubbed = scrub_dict(body)
    return {"scrubbed_fixture": scrubbed}


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


@app.post("/internal/embed-blog")
async def internal_embed_blog(request: Request) -> dict[str, Any]:
    """Embed a single blog post by id. Called by the Go gateway after any blog
    create/update so the post joins the semantic-dedup corpus immediately.

    Cluster-internal only — not exposed through Traefik (/internal/* has no ingress rule).
    Body: {"id": <int>}.
    """
    import asyncio

    try:
        body = await request.json()
        post_id = int(body.get("id"))
    except Exception:
        return {"ok": False, "error": "id (int) required"}

    t0 = time.perf_counter()
    try:
        ok = await asyncio.get_running_loop().run_in_executor(None, embed_blog, post_id)
        latency_ms = (time.perf_counter() - t0) * 1000
        logger.info("embed_blog_ok id=%d updated=%s latency_ms=%.1f", post_id, ok, latency_ms)
        return {"ok": ok, "id": post_id}
    except Exception as exc:
        latency_ms = (time.perf_counter() - t0) * 1000
        logger.exception("embed_blog_error id=%d latency_ms=%.1f error=%s", post_id, latency_ms, exc)
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
                "member_id": normalize_member_id(req.member_id),
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
    # Speech-to-speech realtime voice (gpt-realtime-2 via OpenAI Agents SDK).
    # run_voice_session expects the caller to have accepted the WS (done above).
    from .voice import run_voice_session
    try:
        await run_voice_session(ws, session_id)
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
        or "wss://brightertomorrowtherapy.com"
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
    """Twilio Media Stream → OpenAI Realtime (μ-law 8 kHz ↔ PCM16 24 kHz).

    Speech-to-speech via the realtime multi-agent graph. We accept the WS here
    (with the audio.twilio.com subprotocol the gateway proxy forwards), then
    hand the accepted socket to run_twilio_session, which expects it pre-accepted.
    """
    logger.info("twilio_ws_connect")
    await ws.accept(subprotocol="audio.twilio.com")
    from .integrations.tools import agent_source
    agent_source.set("voice-phone")
    t0 = time.perf_counter()
    # VOICE_BRIDGE selects the phone bridge implementation:
    #   * "raw_ws" → app.voice_rt.twilio_bridge (raw OpenAI Realtime WS, explicit
    #     response control — fixes server-VAD create_response misfires + post-tool
    #     silent stalls).
    #   * "sdk" (default) → app.twilio_voice (OpenAI Agents SDK RealtimeRunner).
    # Default to "sdk" so prod is unchanged until we flip the env.
    bridge = (os.environ.get("VOICE_BRIDGE") or "sdk").strip().lower()
    if bridge == "hc":
        # Healthcare-style lean raw-WS bridge (port of healthcare_prior_auth).
        # Self-contained in app.voice_hc; sdk/raw_ws paths are untouched, so
        # setting VOICE_BRIDGE back to raw_ws rolls this out instantly.
        from .voice_hc.bridge import run_twilio_session
        logger.info("twilio_bridge_selected bridge=hc")
    elif bridge == "raw_ws":
        from .voice_rt.twilio_bridge import run_twilio_session
        logger.info("twilio_bridge_selected bridge=raw_ws")
    else:
        from .twilio_voice import run_twilio_session
        logger.info("twilio_bridge_selected bridge=sdk")
    try:
        await run_twilio_session(ws)
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

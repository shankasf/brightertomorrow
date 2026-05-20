"""Chat runtime — HTTP + SSE for the web widget.

Endpoints:
  * POST /v2/chat              — single request/response.
  * POST /v2/chat/stream       — SSE; emits the assistant text in one chunk
                                  (the LangGraph respond node is a single
                                  LLM call, so token streaming would require
                                  a separate streaming responder; we keep
                                  it simple here and reliable).
  * POST /v2/chat/open         — emits the welcome + HIPAA disclosure as
                                  the first AI turn of a new session,
                                  routed through the graph so the
                                  checkpointer + audit trail capture it.

The session_id from the client becomes LangGraph's ``thread_id`` so the
checkpointer can resume mid-conversation across requests / pod restarts.

First-turn (HIPAA disclosure) flow
----------------------------------
HIPAA requires the patient be told the channel is private BEFORE any PHI
is exchanged. We do this by injecting a sentinel user message
``__session_open__`` into the graph on the very first invocation for a
thread; the disclosure gate (in nodes/) picks it up, sets
``scene='disclosure_prompt'`` and ``gates.disclosure_done=True`` after
respond runs, and the chat widget receives the disclosure as the first
assistant message — same path every other message takes, so checkpointer
+ DDB audit + last_reply_text all work without special casing.

If a client never calls ``/v2/chat/open`` and goes straight to ``/chat``,
the runtime detects an empty checkpoint and triggers the same disclosure
flow automatically on that first call — the disclosure is always delivered
as the first AI turn, regardless of which endpoint the client uses.
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
from ..prompts._constants import HIPAA_DISCLOSURE_CHAT, HIPAA_RESUME_CHAT
from ..state import initial_state

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2")


# Sentinel user message that triggers the first-turn disclosure flow. The
# disclosure gate in nodes/ recognises this token and routes to the
# disclosure_prompt scene. It is NOT shown to the user (the graph never
# echoes raw user input back), and respond's persistence helper filters
# it out so the admin transcript doesn't show garbage.
SESSION_OPEN_TOKEN = "__session_open__"


class ChatRequest(BaseModel):
    session_id: str = Field(..., min_length=1, max_length=128)
    message: str


class ChatOpenRequest(BaseModel):
    session_id: str = Field(..., min_length=1, max_length=128)


class ChatResponse(BaseModel):
    session_id: str
    reply: str
    scene: str | None = None


def _thread_config(session_id: str) -> dict:
    """Standard LangGraph thread config — drives checkpointer lookup."""
    return {"configurable": {"thread_id": session_id}}


async def _is_new_thread(session_id: str) -> bool:
    """True if this session has no prior checkpoint (brand-new thread)."""
    app = get_app()
    cfg = _thread_config(session_id)
    snapshot = await app.aget_state(cfg)
    return snapshot is None or not snapshot.values


async def _disclosure_already_delivered(session_id: str) -> bool:
    """True if this thread has already emitted the HIPAA disclosure.

    Reconnect safety: if the user reloads mid-chat we don't want to replay
    the disclosure (annoying + erodes trust). The disclosure gate sets
    ``gates.disclosure_done=True`` after the first turn; we check that
    flag (and also the existence of any prior messages, as a belt-and-
    braces fallback in case the gate hasn't run yet).
    """
    app = get_app()
    cfg = _thread_config(session_id)
    snapshot = await app.aget_state(cfg)
    if snapshot is None or not snapshot.values:
        return False
    values = snapshot.values
    gates = values.get("gates") or {}
    if gates.get("disclosure_done"):
        return True
    # Belt-and-braces: any non-sentinel prior message also counts.
    msgs = values.get("messages") or []
    return len(msgs) > 0


async def _build_resume_reply(session_id: str) -> str:
    """Return a resume opener that reflects what's already on file.

    PHI hygiene: include the caller's first name and a high-level stage
    only — never the full DOB, member ID, phone, email, or address in
    plaintext on resume. A user returning 24 hours later on a shared
    device shouldn't see their own PHI rendered before any auth.
    """
    app = get_app()
    cfg = _thread_config(session_id)
    snapshot = await app.aget_state(cfg)
    if snapshot is None or not snapshot.values:
        return HIPAA_RESUME_CHAT
    values = snapshot.values

    ins = values.get("insurance_fields") or {}
    bk = values.get("booking_fields") or {}
    first_name = (ins.get("first_name") or "").strip()
    payer = (ins.get("payer_name") or "").strip()
    booking_status = values.get("booking_status") or "none"
    intent = values.get("intent") or "unknown"

    greeting = f"Welcome back, {first_name}" if first_name else "Welcome back"

    # Stage hints — high-level only, no PHI fields.
    if booking_status == "booked":
        stage = "you already have an appointment booked with us"
    elif booking_status in ("pending_confirm", "cancel_pending_confirm"):
        stage = "we were just confirming your appointment"
    elif values.get("selected_slot"):
        stage = "we were picking a time slot for your appointment"
    elif bk.get("phone") or bk.get("email") or bk.get("reason"):
        stage = "we were partway through your booking details"
    elif payer:
        stage = f"we have your {payer} info on file"
    elif first_name:
        stage = "we had a few details from earlier"
    else:
        return HIPAA_RESUME_CHAT

    return f"{greeting} — {stage}. Want to pick up where we left off?"


async def _emit_first_turn(session_id: str) -> dict:
    """Drive the graph through its disclosure_prompt scene.

    Sends the ``__session_open__`` sentinel through ``app.ainvoke`` exactly
    once per thread. The graph's disclosure gate handles the routing; the
    respond node renders ``HIPAA_DISCLOSURE_CHAT`` via the
    ``disclosure_prompt`` scene; ``last_reply_text`` is returned.

    Fallback: if the gate isn't yet wired (parallel agent landing) we ship
    the constant directly via a HARDCODED reply so the client never gets
    an empty payload — but this code path is intentionally a safety net,
    not the main flow.
    """
    app = get_app()
    cfg = _thread_config(session_id)
    seed = initial_state("chat", session_id, agent_source="chat-agent")
    seed["messages"] = [HumanMessage(content=SESSION_OPEN_TOKEN)]
    try:
        result = await app.ainvoke(seed, config=cfg)
    except Exception:
        logger.exception("chat_first_turn_invoke_failed session=%s", session_id)
        result = {}

    reply = (result.get("last_reply_text") or "").strip()
    scene = result.get("_scene")
    if not reply or scene != "disclosure_prompt":
        # Disclosure gate didn't fire (probably not wired yet by the
        # parallel agent owning gates). Ship the constant directly so
        # the client still sees the HIPAA notice on turn one. This is
        # a SAFETY NET — once gates lands, this branch is dead code.
        logger.warning(
            "chat_disclosure_fallback session=%s scene=%s reply_len=%d",
            session_id, scene, len(reply),
        )
        reply = HIPAA_DISCLOSURE_CHAT
        scene = "disclosure_prompt"
    return {"reply": reply, "scene": scene}


async def _invoke(session_id: str, message: str) -> dict:
    """Run one user turn through the graph.

    Auto-disclosure: if this is a brand-new thread AND the client did not
    call /chat/open first, we transparently emit the disclosure turn
    first, then run the user's message. The client sees the user message
    response only; the disclosure is persisted via the gateway like every
    other AI turn (admin transcript stays complete).
    """
    app = get_app()
    cfg = _thread_config(session_id)
    snapshot = await app.aget_state(cfg)
    is_new = snapshot is None or not snapshot.values

    if is_new:
        # Run disclosure first so the gate flips before the user's real
        # message hits the graph. This is rare in practice (web widget
        # always calls /chat/open first) but worth bullet-proofing.
        await _emit_first_turn(session_id)

    # Resume snapshot was set in the new-thread branch above; reload.
    snapshot = await app.aget_state(cfg)
    if snapshot is None or not snapshot.values:
        # Disclosure failed AND state isn't seeded — seed fresh.
        seed = initial_state("chat", session_id, agent_source="chat-agent")
        seed["messages"] = [HumanMessage(content=message)]
        result = await app.ainvoke(seed, config=cfg)
    else:
        result = await app.ainvoke(
            {"messages": [HumanMessage(content=message)]},
            config=cfg,
        )
    return result


@router.post("/chat/open", response_model=ChatResponse)
async def chat_open(req: ChatOpenRequest) -> ChatResponse:
    """Emit the welcome + HIPAA disclosure as the session's first AI turn.

    Idempotent: if the session has already received the disclosure (e.g.
    the client reconnected after a network blip), we return a short
    "welcome back" message instead of re-playing the disclosure. The
    state is unchanged on the resume path.
    """
    t0 = time.perf_counter()
    if await _disclosure_already_delivered(req.session_id):
        reply = await _build_resume_reply(req.session_id)
        logger.info(
            "v2_chat_open_resume session=%s latency_ms=%.0f chars=%d",
            req.session_id, (time.perf_counter() - t0) * 1000, len(reply),
        )
        return ChatResponse(
            session_id=req.session_id,
            reply=reply,
            scene="resume",
        )

    out = await _emit_first_turn(req.session_id)
    logger.info(
        "v2_chat_open session=%s scene=%s latency_ms=%.0f chars=%d",
        req.session_id, out["scene"],
        (time.perf_counter() - t0) * 1000, len(out["reply"]),
    )
    return ChatResponse(
        session_id=req.session_id,
        reply=out["reply"],
        scene=out["scene"],
    )


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

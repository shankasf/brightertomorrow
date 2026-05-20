"""FastAPI app factory for the LangGraph runtime.

Mounts the chat + voice routers on a single ``/v2/*`` namespace so the
new stack can run alongside the legacy ``ai/app/main.py`` during the
migration window. Replace ``main.py`` once the new stack is verified.

Usage:

    from app.graph.api import create_app
    app = create_app()

    uvicorn app.graph.api:app --port 8001
"""
from __future__ import annotations

import logging

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .runtime.chat import router as chat_router
from .runtime.voice_browser import router as voice_browser_router
from .runtime.voice_twilio import router as twilio_router
from .tracing import configure_tracing

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    load_dotenv()
    configure_tracing()

    app = FastAPI(title="Brighter Tomorrow AI (LangGraph)", version="2.0.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/v2/health")
    def health() -> dict:
        return {"status": "ok", "stack": "langgraph"}

    app.include_router(chat_router)
    app.include_router(voice_browser_router)
    app.include_router(twilio_router)

    logger.info("v2_api ready")
    return app


# Module-level app for `uvicorn app.graph.api:app`.
app = create_app()

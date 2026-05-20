"""LangSmith tracing + evaluation setup.

LangGraph and LangChain auto-emit OTEL-style spans to LangSmith when
the following env vars are present:

    LANGSMITH_TRACING=true
    LANGSMITH_API_KEY=lsv2_...
    LANGSMITH_PROJECT=bt-langgraph              (any project name)
    LANGSMITH_ENDPOINT=https://api.smith.langchain.com   (default)

With those set, every node invocation, every ChatOpenAI call, every
`@traceable` function, and every tool call appears as a span in the
LangSmith UI — no code changes required at the call sites.

This module:
  * Reads env once at import and sets sensible defaults.
  * Exposes ``traced`` — a no-op-safe alias for ``langsmith.traceable``
    so we can decorate helpers (action wrappers, the planner) without
    crashing when LangSmith isn't installed in dev.
  * Exposes ``configure_tracing()`` — call once at service startup to
    log a banner and confirm wiring.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Callable, TypeVar

logger = logging.getLogger(__name__)

_F = TypeVar("_F", bound=Callable[..., Any])

DEFAULT_PROJECT = "bt-langgraph"


# ---------------------------------------------------------------------------
# Optional import — never crash the service if langsmith is missing.
# ---------------------------------------------------------------------------
try:
    from langsmith import traceable as _ls_traceable  # type: ignore
    from langsmith import Client as _LsClient  # type: ignore
    _HAS_LANGSMITH = True
except Exception:  # pragma: no cover
    _ls_traceable = None  # type: ignore
    _LsClient = None  # type: ignore
    _HAS_LANGSMITH = False


def tracing_enabled() -> bool:
    return os.environ.get("LANGSMITH_TRACING", "").lower() in ("1", "true", "yes")


def configure_tracing() -> None:
    """Set sane defaults and log status. Idempotent."""
    if not os.environ.get("LANGSMITH_PROJECT"):
        os.environ["LANGSMITH_PROJECT"] = DEFAULT_PROJECT

    if not tracing_enabled():
        logger.info("langsmith_tracing disabled (set LANGSMITH_TRACING=true to enable)")
        return

    if not _HAS_LANGSMITH:
        logger.warning("LANGSMITH_TRACING=true but the langsmith package is not installed")
        return

    if not os.environ.get("LANGSMITH_API_KEY"):
        logger.warning("LANGSMITH_TRACING=true but LANGSMITH_API_KEY is not set — spans will be dropped")
        return

    logger.info(
        "langsmith_tracing enabled project=%s endpoint=%s",
        os.environ.get("LANGSMITH_PROJECT", DEFAULT_PROJECT),
        os.environ.get("LANGSMITH_ENDPOINT", "https://api.smith.langchain.com"),
    )


def traced(run_type: str = "chain", name: str | None = None) -> Callable[[_F], _F]:
    """Decorator: emit a LangSmith span for the wrapped function.

    Safe no-op when langsmith isn't installed or tracing is off — the
    function is returned unchanged.

    Usage:

        @traced(run_type="tool", name="verify_insurance")
        def verify_insurance(state): ...
    """
    def deco(fn: _F) -> _F:
        if not _HAS_LANGSMITH:
            return fn
        return _ls_traceable(run_type=run_type, name=name or fn.__name__)(fn)  # type: ignore
    return deco


def langsmith_client():
    """Return a LangSmith client, or None if tracing is disabled / missing."""
    if not _HAS_LANGSMITH or not os.environ.get("LANGSMITH_API_KEY"):
        return None
    return _LsClient()  # type: ignore

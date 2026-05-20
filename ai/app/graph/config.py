"""Runtime configuration for the LangGraph implementation.

All env vars are read once at module import. Defaults match the existing
``bt_agents`` configuration so the two stacks behave identically when the
feature flag is flipped.

Env vars consumed:
  * OPENAI_API_KEY                — required for LLM calls.
  * OPENAI_MODEL                  — text model for extract + respond
                                    (default ``gpt-4o-mini`` for cost,
                                    falls back to the existing chat pin).
  * OPENAI_EXTRACT_MODEL          — override JUST the extract model (small
                                    fast model; defaults to OPENAI_MODEL).
  * OPENAI_RESPOND_MODEL          — override JUST the respond model;
                                    defaults to OPENAI_MODEL.
  * REALTIME_MODEL                — realtime voice model (default
                                    ``gpt-realtime-2``).
  * REALTIME_VOICE                — TTS voice id (default ``marin``).
  * REALTIME_BASE_URL             — realtime API ws base url. OpenAI pins
                                    BT to us.api.openai.com.
  * BT_GATEWAY_URL                — gateway base URL (used by the
                                    checkpointer for DDB persistence
                                    via the same /internal/chat endpoints
                                    the old stack uses).
  * BT_LANGGRAPH_CHECKPOINT       — ``memory`` (default) or ``ddb``. Memory
                                    is fine for dev; production should
                                    use ddb so state survives restarts.
"""
from __future__ import annotations

import os
from dataclasses import dataclass


# ---------------------------------------------------------------------------
# Model selection
# ---------------------------------------------------------------------------

DEFAULT_TEXT_MODEL = "gpt-4o-mini"
DEFAULT_REALTIME_MODEL = "gpt-realtime-2"
DEFAULT_REALTIME_VOICE = "marin"
DEFAULT_REALTIME_BASE_URL = "wss://us.api.openai.com/v1/realtime"


def text_model_name() -> str:
    """Primary text model used for extract + respond unless overridden."""
    return os.environ.get("OPENAI_MODEL") or DEFAULT_TEXT_MODEL


def extract_model_name() -> str:
    """Model used by the `extract` node.

    This is a structured-output call — a small fast model is the right
    choice (cheaper, faster, and equally accurate for short turns).
    """
    return os.environ.get("OPENAI_EXTRACT_MODEL") or text_model_name()


def respond_model_name() -> str:
    """Model used by the `respond` node.

    The respond node generates the patient-facing reply, so we keep the
    primary text model here for warmth / fluency.
    """
    return os.environ.get("OPENAI_RESPOND_MODEL") or text_model_name()


def realtime_model_name() -> str:
    return os.environ.get("REALTIME_MODEL") or DEFAULT_REALTIME_MODEL


def realtime_voice_name() -> str:
    return os.environ.get("REALTIME_VOICE") or DEFAULT_REALTIME_VOICE


def realtime_ws_url() -> str:
    base = (os.environ.get("REALTIME_BASE_URL") or DEFAULT_REALTIME_BASE_URL).rstrip("?")
    return f"{base}?model={realtime_model_name()}"


# ---------------------------------------------------------------------------
# Storage / persistence
# ---------------------------------------------------------------------------

def checkpointer_kind() -> str:
    """``ddb`` (DynamoDB, HIPAA-safe) or ``memory`` (in-process, dev only).

    Default: ``ddb`` when AWS_ACCESS_KEY_ID is set (i.e. in-cluster),
    ``memory`` otherwise. Override with ``BT_LANGGRAPH_CHECKPOINT=memory``
    or ``ddb``.
    """
    raw = os.environ.get("BT_LANGGRAPH_CHECKPOINT", "").strip().lower()
    if raw:
        return raw
    return "ddb" if os.environ.get("AWS_ACCESS_KEY_ID") else "memory"


def gateway_base_url() -> str:
    return os.environ.get("BT_GATEWAY_URL", "http://bt-gateway").rstrip("/")


# ---------------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class FeatureFlags:
    """Toggles that the runtime layer reads.

    Kept as a single frozen object so callers can grab a coherent
    snapshot per request instead of re-reading env on every check.
    """
    runtime: str            # "sdk" | "langgraph"  — which stack to use
    checkpoint: str         # "memory" | "ddb"

    @classmethod
    def from_env(cls) -> "FeatureFlags":
        return cls(
            runtime=os.environ.get("BT_AGENT_RUNTIME", "sdk").strip().lower(),
            checkpoint=checkpointer_kind(),
        )

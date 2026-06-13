"""Gateway client for the eval pipeline.

Mirrors the fire-and-forget urllib pattern from graph/nodes/respond.py.
All endpoints are cluster-internal; no auth header needed.

Endpoints (gateway team is building to this exact shape):
  POST /internal/evals/run          — publish a completed eval run payload
  GET  /internal/chat/recent        — list recent sessions
  GET  /internal/chat/history       — fetch turns for a session
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from ..config import gateway_base_url

logger = logging.getLogger(__name__)

_DEFAULT_TIMEOUT = 10  # seconds


# ---------------------------------------------------------------------------
# POST /internal/evals/run
# ---------------------------------------------------------------------------

def post_run(run_payload: dict[str, Any]) -> None:
    """POST the completed eval run payload to the gateway.

    Fire-and-forget: logs a warning on failure but never raises.
    The caller can proceed; the gateway stores the row for the admin dashboard.
    """
    base = gateway_base_url()
    url = f"{base}/internal/evals/run"
    data = json.dumps(run_payload, default=str).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=_DEFAULT_TIMEOUT) as resp:
            if resp.status >= 400:
                logger.warning(
                    "evals_run_post_status run_id=%s status=%d url=%s",
                    run_payload.get("run_id", "?"),
                    resp.status,
                    url,
                )
            else:
                logger.info(
                    "evals_run_post_ok run_id=%s status=%d",
                    run_payload.get("run_id", "?"),
                    resp.status,
                )
    except urllib.error.URLError as exc:
        logger.warning(
            "evals_run_post_failed run_id=%s url=%s error=%s",
            run_payload.get("run_id", "?"),
            url,
            exc,
        )
    except Exception:
        logger.exception(
            "evals_run_post_unexpected run_id=%s",
            run_payload.get("run_id", "?"),
        )


# ---------------------------------------------------------------------------
# GET /internal/evals/runs  — light run summaries for baseline comparison
# ---------------------------------------------------------------------------

def list_recent_runs(
    kind: str = "offline", limit: int = 10, channel: str | None = None
) -> list[dict[str, Any]]:
    """Return recent eval-run summaries (no transcripts) for regression compare.

    Each item: {run_id, kind, channel, model, prompt_version, dataset_version,
                created_at, counts, metrics}. Newest-first. Empty on any error.
    When ``channel`` is given the gateway returns only that channel's runs.
    """
    base = gateway_base_url()
    url = f"{base}/internal/evals/runs?kind={kind}&limit={limit}"
    if channel:
        url += f"&channel={urllib.parse.quote(channel)}"
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=_DEFAULT_TIMEOUT) as resp:
            body = resp.read().decode("utf-8")
            parsed = json.loads(body)
            runs: list[dict[str, Any]] = (
                parsed.get("runs", []) if isinstance(parsed, dict) else parsed
            )
            logger.info("list_recent_runs ok kind=%s channel=%s count=%d", kind, channel, len(runs))
            return runs
    except urllib.error.URLError as exc:
        logger.warning("list_recent_runs_failed url=%s error=%s", url, exc)
        return []
    except Exception:
        logger.exception("list_recent_runs_unexpected")
        return []


# ---------------------------------------------------------------------------
# GET /internal/chat/recent
# ---------------------------------------------------------------------------

def list_recent_sessions(
    limit: int = 20, hours: int = 24, source: str | None = None
) -> list[dict[str, Any]]:
    """Return a list of recent chat sessions from the gateway.

    Args:
        source: optional exact chat_sessions.source filter
                (chat-agent | voice-agent | voice-phone) so per-channel online
                evals only sample that channel's sessions.

    Returns:
        list of {session_id, source, started_at, message_count}
        Empty list on any error.
    """
    base = gateway_base_url()
    url = f"{base}/internal/chat/recent?limit={limit}&hours={hours}"
    if source:
        url += f"&source={urllib.parse.quote(source)}"
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=_DEFAULT_TIMEOUT) as resp:
            body = resp.read().decode("utf-8")
            sessions: list[dict[str, Any]] = json.loads(body)
            logger.info(
                "list_recent_sessions ok count=%d limit=%d hours=%d source=%s",
                len(sessions),
                limit,
                hours,
                source,
            )
            return sessions
    except urllib.error.URLError as exc:
        logger.warning("list_recent_sessions_failed url=%s error=%s", url, exc)
        return []
    except Exception:
        logger.exception("list_recent_sessions_unexpected")
        return []


# ---------------------------------------------------------------------------
# GET /internal/chat/history
# ---------------------------------------------------------------------------

def get_session_turns(session_id: str) -> list[dict[str, Any]]:
    """Return the turn history for a single session.

    Returns:
        list of {role, content, created_at}
        Empty list on any error.
    """
    base = gateway_base_url()
    url = f"{base}/internal/chat/history?session_id={session_id}"
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=_DEFAULT_TIMEOUT) as resp:
            body = resp.read().decode("utf-8")
            # Gateway wraps the turns: {"messages": [{role, content, created_at}]}
            parsed = json.loads(body)
            turns: list[dict[str, Any]] = (
                parsed.get("messages", []) if isinstance(parsed, dict) else parsed
            )
            logger.info(
                "get_session_turns ok session_id=%s count=%d",
                session_id,
                len(turns),
            )
            return turns
    except urllib.error.URLError as exc:
        logger.warning(
            "get_session_turns_failed session_id=%s url=%s error=%s",
            session_id,
            url,
            exc,
        )
        return []
    except Exception:
        logger.exception("get_session_turns_unexpected session_id=%s", session_id)
        return []

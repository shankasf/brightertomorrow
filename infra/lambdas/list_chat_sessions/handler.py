"""
listChatSessions — enumerate chat sessions for the admin transcript browser.

Output: { sessions: [{ patient_id, last_message_at, first_message_at,
                       turn_count, preview }] }
Auth:   Cognito JWT (enforced at API Gateway).

Implementation: query GSI1 ENTITY#CHAT for the most recent turns, group by PK
(patient), derive per-session metadata.
"""
from __future__ import annotations

import time
from typing import Any, Dict

from bt_common.ddb import query_entity
from bt_common.http import ok
from bt_common.phi_safe_logger import get_logger

log = get_logger("list_chat_sessions")

# Sessions older than the N-th newest turn won't appear. Tune if the archive grows.
_TURN_FETCH_LIMIT = 1000
_PREVIEW_MAX_CHARS = 140


def handler(event: Dict[str, Any], ctx: Any) -> Dict[str, Any]:
    t0 = time.monotonic()

    qs = event.get("queryStringParameters") or {}
    try:
        limit = max(1, min(int(qs.get("limit", "50")), 200))
    except (TypeError, ValueError):
        limit = 50

    turns = list(query_entity("CHAT", limit=_TURN_FETCH_LIMIT))

    sessions: Dict[str, Dict[str, Any]] = {}
    for t in turns:
        pk = t.get("PK", "")
        if not pk.startswith("PATIENT#"):
            continue
        patient_id = pk[len("PATIENT#"):]
        sk = t.get("SK", "")
        ts = sk[len("CHAT#"):] if sk.startswith("CHAT#") else t.get("GSI1SK", "")
        text = (t.get("text") or "")[:_PREVIEW_MAX_CHARS]
        role = t.get("role", "")

        s = sessions.get(patient_id)
        if s is None:
            # GSI1 query is DESC by timestamp, so the first turn we see per
            # session is the latest.
            s = {
                "patient_id": patient_id,
                "last_message_at": ts,
                "first_message_at": ts,
                "turn_count": 0,
                "preview": text if role == "user" else "",
            }
            sessions[patient_id] = s
        s["turn_count"] += 1
        if ts and ts < s["first_message_at"]:
            s["first_message_at"] = ts
        if role == "user" and not s["preview"]:
            s["preview"] = text

    ordered = sorted(
        sessions.values(),
        key=lambda s: s.get("last_message_at", ""),
        reverse=True,
    )[:limit]

    log.info("list_chat_sessions_ok", extra={
        "request_id": ctx.aws_request_id,
        "route": "GET /chats",
        "status": 200,
        "duration_ms": int((time.monotonic() - t0) * 1000),
        "session_count": len(ordered),
    })
    return ok({"sessions": ordered})

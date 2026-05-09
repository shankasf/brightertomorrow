"""
handleChat — persists a single chat/voice turn in DynamoDB.

The voice/text LLM call happens in bt-ai (OpenAI Realtime + chat). This
Lambda is the durable persistence path — bt-ai (or the SPA) POSTs each
finalized turn here so we have a DynamoDB-backed transcript.

Input:  { patient_id, session_id, role: 'user'|'assistant', text, ts? }
Output: { stored_at }
"""
from __future__ import annotations

import time
from typing import Any, Dict

from bt_common.ddb import put, now_iso
from bt_common.http import err, ok, parse_body
from bt_common.phi_safe_logger import get_logger

log = get_logger("handle_chat")

ALLOWED_ROLES = {"user", "assistant", "system"}


def handler(event: Dict[str, Any], ctx: Any) -> Dict[str, Any]:
    t0 = time.monotonic()
    body = parse_body(event)

    patient_id = body.get("patient_id")
    session_id = body.get("session_id")
    role = body.get("role")
    text = body.get("text")

    if not (patient_id and session_id and role in ALLOWED_ROLES and isinstance(text, str)):
        return err(400, "invalid_payload")

    ts = body.get("ts") or now_iso()
    put({
        "PK": f"PATIENT#{patient_id}",
        "SK": f"CHAT#{ts}",
        "GSI1PK": "ENTITY#CHAT",
        "GSI1SK": ts,
        "session_id": session_id,
        "role": role,
        "text": text,
    })

    log.info("handle_chat_ok", extra={
        "request_id": ctx.aws_request_id,
        "route": "POST /chat/turn",
        "status": 200,
        "duration_ms": int((time.monotonic() - t0) * 1000),
    })
    return ok({"stored_at": ts})

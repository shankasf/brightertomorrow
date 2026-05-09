"""Minimal API Gateway REST helpers — keeps handlers free of boilerplate."""
from __future__ import annotations

import json
from typing import Any, Dict

_HEADERS = {
    "Content-Type": "application/json",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Access-Control-Allow-Origin": "https://admin.brightertomorrowtherapy.cloud",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
}


def ok(body: Any, status: int = 200) -> Dict[str, Any]:
    return {
        "statusCode": status,
        "headers": _HEADERS,
        "body": json.dumps(body, default=str),
    }


def err(status: int, code: str, message: str = "") -> Dict[str, Any]:
    return {
        "statusCode": status,
        "headers": _HEADERS,
        "body": json.dumps({"error": code, "message": message}),
    }


def parse_body(event: Dict[str, Any]) -> Dict[str, Any]:
    raw = event.get("body")
    if not raw:
        return {}
    if event.get("isBase64Encoded"):
        import base64
        raw = base64.b64decode(raw).decode("utf-8")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {}

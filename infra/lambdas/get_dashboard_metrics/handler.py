"""
getDashboardMetrics — aggregate dashboard KPIs for the admin SPA.

Query:  ?month=YYYY-MM (optional, default = current month)
Output: { calls, approved, denied, appointments, approval_rate }
Auth:   Cognito JWT (enforced at API Gateway).

Implementation: reads pre-aggregated METRICS#{YYYY-MM}/SUMMARY row if present,
otherwise computes live via GSI1 entity scans.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any, Dict

from bt_common.ddb import get, query_entity
from bt_common.http import ok
from bt_common.phi_safe_logger import get_logger

log = get_logger("get_dashboard_metrics")


def _live_metrics(month: str) -> Dict[str, Any]:
    since = f"{month}-01T00:00:00Z"
    insurance = list(query_entity("INSURANCE", since=since, limit=500))
    appts = list(query_entity("APPOINTMENT", since=since, limit=500))
    chat = list(query_entity("CHAT", since=since, limit=500))

    approved = sum(1 for i in insurance if i.get("status") in ("active", "approved", "eligible"))
    denied = sum(1 for i in insurance if i.get("status") in ("denied", "inactive", "ineligible"))
    checks = len(insurance)

    return {
        "calls": len(chat),
        "approved": approved,
        "denied": denied,
        "appointments": len(appts),
        "approval_rate": (approved / checks) if checks else 0.0,
    }


def handler(event: Dict[str, Any], ctx: Any) -> Dict[str, Any]:
    t0 = time.monotonic()

    qs = event.get("queryStringParameters") or {}
    month = qs.get("month") or datetime.now(timezone.utc).strftime("%Y-%m")

    cached = get(f"METRICS#{month}", "SUMMARY")
    body = cached if cached else _live_metrics(month)

    log.info("get_dashboard_metrics_ok", extra={
        "request_id": ctx.aws_request_id,
        "route": "GET /dashboard/metrics",
        "status": 200,
        "duration_ms": int((time.monotonic() - t0) * 1000),
    })
    return ok(body)

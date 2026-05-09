"""
getPatientData — returns patient profile + recent activity.

Input (path):  { patient_id }
Output: { profile, insurance: [...], appointments: [...], chat: [...] }
Auth:   Cognito JWT (enforced at API Gateway).
"""
from __future__ import annotations

import time
from typing import Any, Dict, List

from bt_common.ddb import query_pk
from bt_common.http import err, ok
from bt_common.phi_safe_logger import get_logger

log = get_logger("get_patient_data")


def handler(event: Dict[str, Any], ctx: Any) -> Dict[str, Any]:
    t0 = time.monotonic()

    path_params = event.get("pathParameters") or {}
    patient_id = path_params.get("patient_id")
    if not patient_id:
        return err(400, "missing_patient_id")

    items = list(query_pk(f"PATIENT#{patient_id}"))
    if not items:
        return err(404, "not_found")

    profile: Dict[str, Any] = {}
    insurance: List[Dict[str, Any]] = []
    appointments: List[Dict[str, Any]] = []
    chat: List[Dict[str, Any]] = []

    for it in items:
        sk = it.get("SK", "")
        if sk == "PROFILE":
            profile = it
        elif sk.startswith("INSURANCE#"):
            insurance.append(it)
        elif sk.startswith("APPOINTMENT#"):
            appointments.append(it)
        elif sk.startswith("CHAT#"):
            chat.append(it)

    log.info("get_patient_data_ok", extra={
        "request_id": ctx.aws_request_id,
        "route": "GET /patients/{id}",
        "status": 200,
        "duration_ms": int((time.monotonic() - t0) * 1000),
    })
    return ok({
        "profile": profile,
        "insurance": insurance,
        "appointments": appointments,
        "chat": chat,
    })

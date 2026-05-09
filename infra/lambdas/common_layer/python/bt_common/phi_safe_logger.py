"""
Structured JSON logger that drops PHI fields before emitting.

HIPAA rule: no PHI in CloudWatch logs. We redact known fields everywhere and
log only request IDs, status codes, durations, and error classes.
"""
from __future__ import annotations

import json
import logging
import os
import re
import sys
from typing import Any, Mapping

_PHI_KEYS = {
    "dob", "date_of_birth", "birthdate",
    "ssn", "social_security_number",
    "member_id", "memberid", "subscriber_id",
    "policy_number",
    "patient_name", "full_name", "first_name", "last_name",
    "email", "phone", "address",
    "content", "message", "transcript", "text",
    "diagnosis", "medication",
}

_EMAIL_RE = re.compile(r"[\w\.-]+@[\w\.-]+\.\w+")
_PHONE_RE = re.compile(r"\+?\d[\d\s\-().]{7,}\d")


def _redact(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {k: ("[REDACTED]" if k.lower() in _PHI_KEYS else _redact(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact(v) for v in value]
    if isinstance(value, str):
        s = _EMAIL_RE.sub("[EMAIL]", value)
        s = _PHONE_RE.sub("[PHONE]", s)
        return s
    return value


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "msg": record.getMessage(),
            "logger": record.name,
        }
        for key in ("request_id", "route", "status", "duration_ms", "error_class"):
            v = getattr(record, key, None)
            if v is not None:
                payload[key] = v
        if record.exc_info:
            payload["error_class"] = record.exc_info[0].__name__ if record.exc_info[0] else None
        return json.dumps(_redact(payload), separators=(",", ":"))


def get_logger(name: str = "bt") -> logging.Logger:
    log = logging.getLogger(name)
    if getattr(log, "_bt_configured", False):
        return log
    log.handlers.clear()
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(JsonFormatter())
    log.addHandler(h)
    log.setLevel(os.environ.get("LOG_LEVEL", "INFO"))
    log.propagate = False
    setattr(log, "_bt_configured", True)
    return log

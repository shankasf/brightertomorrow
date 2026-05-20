"""
senders.py — per-channel send implementations for the notifications-retry Lambda.

Each function receives a fully-loaded outbox row (dict) and the decrypted
payload string.  It raises on retryable errors and raises TerminalError on
permanent failures so handler.py can branch correctly.

HIPAA note: NO PHI logged here.  Log only notification_id, channel, status.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict

import boto3

# NOTE: `requests` is imported lazily inside send_sms() instead of at module
# load. Reason: CDK's lambda.Code.fromAsset() doesn't run pip install, so
# the deployed zip is missing third-party deps. While Twilio is disabled
# (DISABLE_TWILIO=true), send_sms() short-circuits before the import, so
# the Lambda boots cleanly. When Twilio is re-enabled, fix bundling by
# adding BundlingOptions to notifications-retry-stack.ts OR pre-vendoring
# requests under this directory.

log = logging.getLogger(__name__)

_ses = boto3.client("ses")
_s3 = boto3.client("s3")

# Injected via Lambda environment
TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_SECRET_ARN = os.environ.get("TWILIO_SECRET_ARN", "")
TWILIO_FROM_NUMBER = os.environ.get("TWILIO_FROM_NUMBER", "")
SES_FROM_EMAIL = os.environ.get("SES_FROM_EMAIL", "")
PHI_BUCKET = os.environ.get("PHI_BUCKET", "bt-phi-logs")
KMS_KEY_ID = os.environ.get("KMS_KEY_ID", "")


def _env_flag(name: str, default: str) -> bool:
    """Truthy parse for env flags: 1/true/yes/on (case-insensitive)."""
    return os.environ.get(name, default).strip().lower() in ("1", "true", "yes", "on")


# Per-channel kill switches. Default DISABLED — flip to "false" via Lambda
# env once Twilio + SES are provisioned. While disabled the corresponding
# outbox rows are marked status="service_unavailable" so the admin dashboard
# can list them for manual follow-up. NO real send is attempted.
TWILIO_DISABLED = _env_flag("DISABLE_TWILIO", "true")
SES_DISABLED = _env_flag("DISABLE_SES", "true")

_twilio_token: str | None = None  # lazily fetched; cached warm-start


def _get_twilio_auth_token() -> str:
    """Fetch Twilio auth token from Secrets Manager once per cold start."""
    global _twilio_token
    if _twilio_token is None:
        sm = boto3.client("secretsmanager")
        resp = sm.get_secret_value(SecretId=TWILIO_SECRET_ARN)
        secret = json.loads(resp["SecretString"])
        _twilio_token = secret["auth_token"]
    return _twilio_token


# Twilio error codes that are terminal (don't retry).
# https://www.twilio.com/docs/api/errors
_TWILIO_TERMINAL_CODES = {
    21211,  # Invalid 'To' phone number
    21212,  # Invalid 'From' phone number
    21214,  # 'To' phone number cannot receive SMS
    21610,  # Message cannot be sent to landlines
    21211,  # Invalid phone number
    30006,  # Landline or unreachable carrier
}


class TerminalError(Exception):
    """Non-retryable failure — mark row as dead."""


class ServiceUnavailableError(Exception):
    """Channel is intentionally disabled — mark row as service_unavailable.

    Distinct from TerminalError so that admins can distinguish "we tried and
    the provider permanently rejected" (dead) from "we never tried because
    the channel is off" (service_unavailable, eligible for manual follow-up
    or re-queue once the channel is re-enabled).
    """


def send_sms(row: Dict[str, Any], decrypted_payload: str) -> None:
    """
    POST to Twilio Programmable SMS via signed HTTP (no heavy SDK).
    Raises TerminalError on permanent Twilio codes, plain Exception on transient.
    """
    if TWILIO_DISABLED:
        raise ServiceUnavailableError("twilio_disabled")

    # Lazy import — see top-of-file note about CDK asset bundling.
    import requests  # noqa: PLC0415

    to_number: str = row["recipient"]  # E.164 format; never logged
    url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json"

    resp = requests.post(
        url,
        data={"To": to_number, "From": TWILIO_FROM_NUMBER, "Body": decrypted_payload},
        auth=(TWILIO_ACCOUNT_SID, _get_twilio_auth_token()),
        timeout=15,
    )

    if resp.status_code == 201:
        return  # success

    body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
    code = body.get("code", 0)

    if resp.status_code >= 500 or resp.status_code == 429:
        # Transient — let retry logic handle
        raise Exception(f"Twilio {resp.status_code} code={code}")

    if code in _TWILIO_TERMINAL_CODES or resp.status_code in (400, 401, 403):
        raise TerminalError(f"Twilio terminal {resp.status_code} code={code}")

    # Default: treat unexpected 4xx as terminal
    raise TerminalError(f"Twilio unexpected {resp.status_code}")


def send_email(row: Dict[str, Any], decrypted_payload: str) -> None:
    """
    Send via SES.  payload JSON must include 'subject' and 'html_body'.
    Raises TerminalError on permanent bounces (MessageRejected).
    """
    if SES_DISABLED:
        raise ServiceUnavailableError("ses_disabled")

    to_email: str = row["recipient"]  # never logged

    try:
        body = json.loads(decrypted_payload)
    except json.JSONDecodeError as exc:
        raise TerminalError(f"email payload not valid JSON: {exc}") from exc

    subject = body.get("subject", "Message from BrighterTomorrow Therapy")
    html_body = body.get("html_body", "")
    text_body = body.get("text_body", html_body)

    try:
        _ses.send_email(
            Source=SES_FROM_EMAIL,
            Destination={"ToAddresses": [to_email]},
            Message={
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {
                    "Html": {"Data": html_body, "Charset": "UTF-8"},
                    "Text": {"Data": text_body, "Charset": "UTF-8"},
                },
            },
        )
    except _ses.exceptions.MessageRejected as exc:
        raise TerminalError(f"SES MessageRejected: {exc}") from exc
    except _ses.exceptions.MailFromDomainNotVerifiedException as exc:
        raise TerminalError(f"SES domain not verified: {exc}") from exc


def send_s3_phi(row: Dict[str, Any], decrypted_payload: str) -> None:
    """
    Write a PHI log object to the bt-phi-logs S3 bucket.
    Key pattern: phi/{session_id}/{turn_id}.json
    SSE-KMS with the bt CMK.  Raises on any S3 error (all retryable by default).
    """
    session_id: str = row.get("session_id", "unknown")
    turn_id: str = row.get("turn_id", row["notification_id"])
    key = f"phi/{session_id}/{turn_id}.json"

    try:
        _s3.put_object(
            Bucket=PHI_BUCKET,
            Key=key,
            Body=decrypted_payload.encode("utf-8"),
            ContentType="application/json",
            ServerSideEncryption="aws:kms",
            SSEKMSKeyId=KMS_KEY_ID,
        )
    except _s3.exceptions.from_code("AccessDenied") as exc:
        # KMS-denied or bucket policy denial — terminal
        raise TerminalError(f"S3 PutObject access denied: {exc}") from exc

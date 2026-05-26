"""
senders.py — per-channel send implementations for the notifications-retry Lambda.

Each function receives a fully-loaded outbox row (dict) and the decrypted
payload string.  It raises on retryable errors and raises TerminalError on
permanent failures so handler.py can branch correctly.

Supported channels: email, sms.
s3_phi is retired; handler.py marks such rows dead before reaching this module.

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

# Injected via Lambda environment
TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_SECRET_ARN = os.environ.get("TWILIO_SECRET_ARN", "")
TWILIO_FROM_NUMBER = os.environ.get("TWILIO_FROM_NUMBER", "")
SES_FROM_EMAIL = os.environ.get("SES_FROM_EMAIL", "")
# Practice/admin address BCC'd on EVERY patient email so staff retain a copy of
# every confirmation (booking, reschedule, cancel, status changes). Internal
# disclosure to the covered entity — permitted, minimum-necessary content only.
# Empty disables the BCC. BCC (not CC) keeps the admin address off the patient's
# copy.
ADMIN_BCC_EMAIL = os.environ.get("ADMIN_BCC_EMAIL", "").strip()


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

    # handler.py Guard 3 guarantees recipient is present and non-empty before
    # any sender is invoked, so bracket-access is safe here.
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
    Send via SES. payload JSON carries STRUCTURED content
    ({subject, heading, paragraphs[], details[]}); the one central branded
    template in email_template.py renders the HTML + text. A legacy
    pre-rendered {subject, html_body, text_body} payload is also accepted.
    Raises TerminalError on permanent bounces (MessageRejected).
    """
    if SES_DISABLED:
        raise ServiceUnavailableError("ses_disabled")

    # handler.py Guard 3 guarantees recipient is present and non-empty before
    # any sender is invoked, so bracket-access is safe here.
    to_email: str = row["recipient"]  # never logged

    try:
        body = json.loads(decrypted_payload)
    except json.JSONDecodeError as exc:
        raise TerminalError(f"email payload not valid JSON: {exc}") from exc

    # Central template renders the single branded look from structured content.
    from email_template import render_from_payload  # noqa: PLC0415
    subject, html_body, text_body = render_from_payload(body)

    # BCC the practice/admin inbox so staff get a copy of every patient email.
    # Skip if it equals the recipient (avoid a duplicate to the same address).
    destination: Dict[str, Any] = {"ToAddresses": [to_email]}
    if ADMIN_BCC_EMAIL and ADMIN_BCC_EMAIL.lower() != to_email.strip().lower():
        destination["BccAddresses"] = [ADMIN_BCC_EMAIL]

    try:
        _ses.send_email(
            Source=SES_FROM_EMAIL,
            Destination=destination,
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

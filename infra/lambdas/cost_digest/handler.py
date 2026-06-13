"""
cost_digest/handler.py — daily AWS shadow-cost summary email.

Pulls yesterday's UsageQuantity from Cost Explorer (grouped by SERVICE +
USAGE_TYPE), multiplies each (service, normalized_usage_type) by our local
us-east-1 on-demand list price, and emails a short plain-text summary.

Why shadow cost, not Cost Explorer's UnblendedCost?  The account currently
has AWS credits/free-tier masking the actual billed amount to ~$0, but the
underlying USAGE is real and is what we want to monitor.  This shows what
the workload would cost on standard list prices — an early-warning view.

No PHI — billing/usage data only.
"""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Tuple

import boto3

_ce = boto3.client("ce", region_name="us-east-1")
_ses = boto3.client("sesv2", region_name="us-east-1")
_ddb = boto3.resource("dynamodb", region_name="us-east-1")

# ── Agent-eval LLM cost estimate (OpenAI + Anthropic — NOT on the AWS bill) ──
# The nightly bt-ai-evals CronJob spends real money on OpenAI (agent + flex
# judge) and Anthropic (offline Opus judge). Those vendors don't appear in Cost
# Explorer, so we estimate them here from yesterday's EVALRUN rows and surface
# them in the same email. Rough per-turn averages (verified 2026-06-10):
#   offline turn  ≈ gpt-5.5 agent (~3 calls) $0.033 + Opus judge $0.015 = $0.048
#   offline run   adds 8-case Opus calibration ≈ $0.12 once per run
#   online turn   ≈ gpt-5.5 FLEX judge only ($2.50/$15) ≈ $0.008
EVAL_TABLE = os.environ.get("EVAL_TABLE", "bt-main")
OFFLINE_USD_PER_TURN = 0.048
OFFLINE_USD_PER_RUN = 0.12   # calibration
ONLINE_USD_PER_TURN = 0.008

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(message)s")
log = logging.getLogger("cost_digest")

RECIPIENT = os.environ["RECIPIENT_EMAIL"]
FROM_ADDRESS = os.environ["FROM_EMAIL"]
ACCOUNT_LABEL = os.environ.get("ACCOUNT_LABEL", "BT")
MIN_DISPLAY_USD = float(os.environ.get("MIN_DISPLAY_USD", "0.001"))

# us-east-1 on-demand list prices, last verified 2026-05-22.
# Keyed by (Cost Explorer SERVICE name, normalized usage_type after region-strip).
# Unknown (service, usage_type) tuples contribute $0 and are logged so the
# table can be expanded.
PRICES: Dict[Tuple[str, str], Tuple[float, str]] = {
    # ── DynamoDB (on-demand) ────────────────────────────────────────────────
    ("Amazon DynamoDB", "WriteRequestUnits"):           (1.25e-6,            "WRU"),
    ("Amazon DynamoDB", "ReadRequestUnits"):            (0.25e-6,            "RRU"),
    # Cost Explorer reports storage in GB-Mo despite the "ByteHrs" suffix.
    ("Amazon DynamoDB", "TimedStorage-ByteHrs"):        (0.25,               "GB-month"),
    ("Amazon DynamoDB", "TimedPITRStorage-ByteHrs"):    (0.20,               "GB-month"),

    # ── Lambda ──────────────────────────────────────────────────────────────
    ("AWS Lambda", "Lambda-GB-Second"):                 (0.0000166667,       "GB-s"),
    ("AWS Lambda", "Request"):                          (0.20e-6,            "request"),
    # Inter-region data transfer — small bytes; price varies by destination.
    # Treat all as $0.02/GB (us-east-1 → other US region).
    ("AWS Lambda", "AWS-In-Bytes"):                     (0.02,               "GB"),
    ("AWS Lambda", "AWS-Out-Bytes"):                    (0.02,               "GB"),

    # ── KMS ─────────────────────────────────────────────────────────────────
    ("AWS Key Management Service", "KMS-Requests"):     (0.03 / 10_000,      "request"),
    ("AWS Key Management Service", "KMS-Keys"):         (1.00,               "key-month"),

    # ── Secrets Manager ─────────────────────────────────────────────────────
    ("AWS Secrets Manager", "AWSSecretsManagerAPIRequest"): (0.05 / 10_000,  "request"),
    ("AWS Secrets Manager", "AWSSecretsManager-Secrets"):   (0.40,           "secret-month"),

    # ── CloudWatch ──────────────────────────────────────────────────────────
    ("AmazonCloudWatch", "CW:MetricMonitorUsage"):      (0.30,               "metric-month"),
    ("AmazonCloudWatch", "CW:AlarmMonitorUsage"):       (0.10,               "alarm-month"),
    ("AmazonCloudWatch", "TimedStorage-ByteHrs"):       (0.03,               "GB-month"),
    ("AmazonCloudWatch", "DataProcessing-Bytes"):       (0.50,               "GB ingested"),
    ("AmazonCloudWatch", "VendedLog-Bytes"):            (0.50,               "GB ingested"),

    # ── X-Ray ───────────────────────────────────────────────────────────────
    ("AWS X-Ray", "XRay-TracesStored"):                 (5.00e-6,            "trace"),

    # ── API Gateway (REST) ──────────────────────────────────────────────────
    ("Amazon API Gateway", "ApiGatewayRequest"):        (3.50e-6,            "request"),
    ("Amazon API Gateway", "DataTransfer-Out-Bytes"):   (0.09,               "GB"),

    # ── SES ─────────────────────────────────────────────────────────────────
    # SES out-of-EC2 pricing — $0.10 per 1,000 emails sent.
    ("Amazon Simple Email Service", "Recipients"):              (0.10 / 1_000, "recipient"),
    ("Amazon Simple Email Service", "Recipients-VirtDelivMgr"): (0.0,          "internal"),  # counted under Recipients
    ("Amazon Simple Email Service", "Tenant-Count"):            (0.0,          "tenant"),
    ("Amazon Simple Email Service", "DataTransfer-Out-Bytes"):  (0.12,         "GB"),
    ("Amazon Simple Email Service", "DataTransfer-In-Bytes"):   (0.0,          "GB"),
    ("Amazon Simple Email Service", "AttachmentsSize-Bytes"):   (0.0,          "GB"),

    # ── SNS ─────────────────────────────────────────────────────────────────
    ("Amazon Simple Notification Service", "Requests-Tier1"):       (0.50e-6, "request"),
    ("Amazon Simple Notification Service", "DeliveryAttempts-HTTP"): (0.60e-6, "delivery"),
    ("Amazon Simple Notification Service", "DataTransfer-In-Bytes"):  (0.0,    "GB"),
    ("Amazon Simple Notification Service", "DataTransfer-Out-Bytes"): (0.09,   "GB"),

    # ── S3 ──────────────────────────────────────────────────────────────────
    ("Amazon Simple Storage Service", "Requests-Tier1"):        (0.005 / 1_000,  "PUT/COPY/POST"),
    ("Amazon Simple Storage Service", "Requests-Tier2"):        (0.0004 / 1_000, "GET/HEAD"),
    # Inter-region transfer — treat all bytes as $0.02/GB approximation.
    ("Amazon Simple Storage Service", "AWS-In-Bytes"):          (0.0,             "GB"),
    ("Amazon Simple Storage Service", "AWS-Out-Bytes"):         (0.02,            "GB"),

    # ── CloudTrail (management events are free) ─────────────────────────────
    ("AWS CloudTrail", "FreeEventsRecorded"):           (0.0,                "event"),

    # ── Glue (catalog requests — first 1M/mo free) ──────────────────────────
    ("AWS Glue", "Catalog-Request"):                    (0.0,                "request"),
}

# Strip leading region codes from usage_type so the lookup is region-agnostic.
# Examples: USE1-, USE2-, USW1-, USW2-, EUC1-, APN1-, SAE1-, CAN1-,
# us-east-1-, us-east-2-, plus inter-region pairs like USE1-USW2-, USE1-EUC1-.
# Pattern: any 3-4 uppercase letters + digit + dash, OR lowercase region.
_REGION_PREFIX_RE = re.compile(
    r"^(?:[A-Z]{3,4}\d-|[a-z]{2}-[a-z]+-\d-)+"
)


def _normalize_usage_type(usage_type: str) -> str:
    return _REGION_PREFIX_RE.sub("", usage_type)


def _yesterday_utc() -> Tuple[str, str]:
    today = datetime.now(timezone.utc).date()
    return (today - timedelta(days=1)).isoformat(), today.isoformat()


def _fetch_usage(start: str, end: str) -> List[Tuple[str, str, float]]:
    """Return [(service, usage_type, quantity), ...]."""
    out: List[Tuple[str, str, float]] = []
    next_token = None
    while True:
        kwargs: Dict[str, Any] = {
            "TimePeriod": {"Start": start, "End": end},
            "Granularity": "DAILY",
            "Metrics": ["UsageQuantity"],
            "GroupBy": [
                {"Type": "DIMENSION", "Key": "SERVICE"},
                {"Type": "DIMENSION", "Key": "USAGE_TYPE"},
            ],
        }
        if next_token:
            kwargs["NextPageToken"] = next_token
        resp = _ce.get_cost_and_usage(**kwargs)
        for g in resp.get("ResultsByTime", [{}])[0].get("Groups", []):
            service, usage_type = g["Keys"]
            qty = float(g["Metrics"]["UsageQuantity"]["Amount"])
            if qty > 0:
                out.append((service, usage_type, qty))
        next_token = resp.get("NextPageToken")
        if not next_token:
            break
    return out


def _price_usage(
    rows: List[Tuple[str, str, float]],
) -> Tuple[Dict[str, float], List[Tuple[str, str, float]]]:
    """Return (cost_by_service, unpriced_rows).

    cost_by_service[service] = sum of priced cost
    unpriced_rows = [(service, usage_type, qty), ...] for entries we couldn't price
    """
    cost_by_service: Dict[str, float] = {}
    unpriced: List[Tuple[str, str, float]] = []
    for service, usage_type, qty in rows:
        norm = _normalize_usage_type(usage_type)
        price = PRICES.get((service, norm))
        if price is None:
            unpriced.append((service, usage_type, qty))
            continue
        unit_price, _unit = price
        cost_by_service[service] = cost_by_service.get(service, 0.0) + qty * unit_price
    return cost_by_service, unpriced


def _estimate_eval_cost(date_str: str) -> Dict[str, Any]:
    """Estimate yesterday's agent-eval LLM spend from EVALRUN rows.

    Queries the EVALRUNS partition (tiny — ~1-2 rows/day), keeps runs whose
    createdAt falls on date_str, and applies the per-turn/per-run estimates.
    Returns {} on any error so a billing email never fails over eval data.
    """
    try:
        from boto3.dynamodb.conditions import Key
        table = _ddb.Table(EVAL_TABLE)
        resp = table.query(
            KeyConditionExpression=Key("PK").eq("EVALRUNS") & Key("SK").begins_with("RUN#"),
        )
        offline_runs = offline_turns = online_runs = online_turns = 0
        for it in resp.get("Items", []):
            created = str(it.get("createdAt", ""))
            if not created.startswith(date_str):
                continue
            counts = it.get("counts") or {}
            turns = int(counts.get("turns", 0) or 0)
            if it.get("kind") == "offline":
                offline_runs += 1
                offline_turns += turns
            elif it.get("kind") == "online":
                online_runs += 1
                online_turns += turns
        est = (
            offline_turns * OFFLINE_USD_PER_TURN
            + offline_runs * OFFLINE_USD_PER_RUN
            + online_turns * ONLINE_USD_PER_TURN
        )
        return {
            "offline_runs": offline_runs, "offline_turns": offline_turns,
            "online_runs": online_runs, "online_turns": online_turns,
            "est_usd": round(est, 4),
        }
    except Exception as exc:  # pragma: no cover
        log.info(json.dumps({"event": "eval_cost_estimate_failed", "error": str(exc)}))
        return {}


def _format_email(
    date_str: str,
    cost_by_service: Dict[str, float],
    unpriced: List[Tuple[str, str, float]],
    eval_cost: Dict[str, Any],
) -> Tuple[str, str]:
    items = sorted(cost_by_service.items(), key=lambda t: -t[1])
    total = sum(c for _, c in items)
    shown = [(s, c) for s, c in items if c >= MIN_DISPLAY_USD]
    hidden = [(s, c) for s, c in items if c < MIN_DISPLAY_USD]

    subject = f"{ACCOUNT_LABEL} AWS daily charges (shadow) — {date_str} (${total:.2f})"

    name_w = max((len(s) for s, _ in shown), default=20)
    name_w = min(max(name_w, 24), 40)
    lines = [
        f"Estimated charges by service ({date_str} UTC):",
        "",
        f"  This is shadow cost = your usage × us-east-1 on-demand list price.",
        f"  Actual AWS bill may be lower due to credits or Free Tier.",
        "",
    ]
    for service, cost in shown:
        lines.append(f"  {service:<{name_w}}  ${cost:>9.4f}")
    if hidden:
        label = f"({len(hidden)} services < ${MIN_DISPLAY_USD:.3f})"
        lines.append(f"  {label:<{name_w}}  ${sum(c for _, c in hidden):>9.4f}")
    lines.append(f"  {'-' * name_w}  {'-' * 10}")
    lines.append(f"  {'TOTAL':<{name_w}}  ${total:>9.4f}")
    lines.append("")

    if unpriced:
        unpriced_qty_total = sum(q for _, _, q in unpriced)
        lines.append(
            f"Note: {len(unpriced)} (service, usage_type) tuples were not in the "
            f"price table (total usage units: {unpriced_qty_total:,.2f}). "
            f"They contribute $0 to the total above. Top unpriced:"
        )
        for service, ut, qty in sorted(unpriced, key=lambda t: -t[2])[:5]:
            lines.append(f"  - {service} / {ut}: {qty:,.2f} units")
        lines.append("")

    # ── External AI eval spend (OpenAI + Anthropic — NOT on the AWS bill) ──
    if eval_cost:
        e = eval_cost
        lines.append("External AI eval spend (estimated — billed by OpenAI/Anthropic, not AWS):")
        lines.append(
            f"  Offline: {e.get('offline_runs',0)} run(s), {e.get('offline_turns',0)} turns "
            f"(gpt-5.5 agent + Opus judge)"
        )
        lines.append(
            f"  Online:  {e.get('online_runs',0)} run(s), {e.get('online_turns',0)} turns "
            f"(gpt-5.5 flex judge)"
        )
        lines.append(f"  {'AI eval est.':<{name_w}}  ${e.get('est_usd',0.0):>9.4f}")
        lines.append(f"  {'AWS + AI eval (est.)':<{name_w}}  ${total + e.get('est_usd',0.0):>9.4f}")
        lines.append("")

    lines.append(
        "Source: Cost Explorer get_cost_and_usage(UsageQuantity) × hardcoded "
        "us-east-1 list prices (verified 2026-05-22). AI eval = estimated from "
        "EVALRUN turn counts × per-turn token prices. Generated by bt-cost-digest."
    )
    return subject, "\n".join(lines)


def _send_email(subject: str, body: str) -> str:
    resp = _ses.send_email(
        FromEmailAddress=FROM_ADDRESS,
        Destination={"ToAddresses": [RECIPIENT]},
        Content={
            "Simple": {
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {"Text": {"Data": body, "Charset": "UTF-8"}},
            }
        },
    )
    return resp["MessageId"]


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    start, end = _yesterday_utc()
    rows = _fetch_usage(start, end)
    cost_by_service, unpriced = _price_usage(rows)
    eval_cost = _estimate_eval_cost(start)
    subject, body = _format_email(start, cost_by_service, unpriced, eval_cost)
    message_id = _send_email(subject, body)
    total = sum(cost_by_service.values())

    log.info(json.dumps({
        "event": "cost_digest_sent",
        "date": start,
        "shadow_total_usd": round(total, 4),
        "service_count": len(cost_by_service),
        "unpriced_count": len(unpriced),
        "ses_message_id": message_id,
    }))
    # Log unpriced rows for visibility — they're hints to expand PRICES.
    for service, usage_type, qty in unpriced:
        log.info(json.dumps({
            "event": "unpriced_usage",
            "service": service,
            "usage_type": usage_type,
            "quantity": qty,
        }))
    return {
        "statusCode": 200,
        "date": start,
        "shadow_total_usd": round(total, 4),
        "unpriced_count": len(unpriced),
        "ses_message_id": message_id,
    }

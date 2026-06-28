"""
verifyInsurance — CLAIM.MD real-time eligibility check.

CLAIM.MD spec: POST https://svc.claim.md/services/eligdata/
  AccountKey, ins_name_f, ins_name_l, ins_dob (YYYYMMDD), payerid,
  ins_number, pat_rel ("18"=self), fdos (YYYYMMDD), prov_npi, prov_taxid

Input (from API Gateway / bt-ai):
  { patient_id, first_name, last_name, dob, payer_id, member_id }
Output:
  { status, copay, plan, raw }
Side-effect:
  Writes INSURANCE#{date} item under PATIENT#{patient_id}.
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any, Dict

from bt_common.ddb import put, now_iso
from bt_common.http import err, ok, parse_body
from bt_common.phi_safe_logger import get_logger
from bt_common.secrets import get_secret

log = get_logger("verify_insurance")

CLAIM_MD_URL = os.environ.get("CLAIM_MD_URL", "https://svc.claim.md/services/eligdata/")
TIMEOUT_SEC = int(os.environ.get("CLAIM_MD_TIMEOUT", "20"))


def _today_yyyymmdd() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d")


def _call_claim_md(account_key: str, params: Dict[str, str]) -> Dict[str, Any]:
    body = urllib.parse.urlencode({"AccountKey": account_key, **params}).encode()
    req = urllib.request.Request(
        url=CLAIM_MD_URL,
        method="POST",
        data=body,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            # Some upstreams 403 on default Python UA. Same lesson as the
            # Hostinger custom resource — use a realistic UA.
            "User-Agent": "BrighterTomorrowTherapy/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SEC) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        # Surface the upstream payload so the agent can see the real reason.
        body_text = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"claim_md_http_{e.code}: {body_text[:500]}") from e


def handler(event: Dict[str, Any], ctx: Any) -> Dict[str, Any]:
    t0 = time.monotonic()
    body = parse_body(event)

    required = ("patient_id", "first_name", "last_name", "dob", "payer_id", "member_id")
    missing = [k for k in required if not body.get(k)]
    if missing:
        return err(400, "missing_fields", ",".join(missing))

    # Provider NPI + Tax ID — fetched from Secrets Manager (cached per
    # execution env). Falls back to PROV_NPI / PROV_TAXID env vars for
    # backward compat if the secret isn't populated yet.
    prov_npi, prov_taxid = "", ""
    secret_arn = os.environ.get("PROV_CREDS_SECRET_ARN", "")
    if secret_arn:
        try:
            creds = json.loads(get_secret(secret_arn))
            prov_npi = str(creds.get("npi", "")).strip()
            prov_taxid = str(creds.get("taxid", "")).strip()
        except Exception:
            log.exception("provider_creds_fetch_error", extra={"request_id": ctx.aws_request_id})
    if not prov_npi:
        prov_npi = os.environ.get("PROV_NPI", "").strip()
    if not prov_taxid:
        prov_taxid = os.environ.get("PROV_TAXID", "").strip()
    if not prov_npi or not prov_taxid:
        log.error("missing_provider_credentials", extra={"request_id": ctx.aws_request_id})
        return err(500, "provider_not_configured", "populate Secrets Manager secret bt/claim-md/provider with {npi, taxid}")

    try:
        account_key = get_secret(os.environ["CLAIM_MD_SECRET_ARN"])
        raw = _call_claim_md(account_key, {
            "ins_name_f": body["first_name"],
            "ins_name_l": body["last_name"],
            "ins_dob": body["dob"],
            "payerid": body["payer_id"],
            "ins_number": body["member_id"],
            "pat_rel": "18",          # self
            "fdos": _today_yyyymmdd(),
            "prov_npi": prov_npi,
            "prov_taxid": prov_taxid,
        })
    except urllib.error.URLError:
        log.exception("claim_md_network_error", extra={"request_id": ctx.aws_request_id})
        return err(504, "upstream_timeout")
    except RuntimeError as e:
        # Real CLAIM.MD error — return its short tag to the caller (no PHI).
        msg = str(e).split(":", 1)[0]
        log.error("claim_md_http_error", extra={"request_id": ctx.aws_request_id, "error_class": msg})
        return err(502, "upstream_error", msg)
    except Exception:
        log.exception("claim_md_error", extra={"request_id": ctx.aws_request_id})
        return err(502, "upstream_error")

    # CLAIM.MD's real shape: { "elig": { "eligid", "benefit": [...] } }.
    # Each benefit row has benefit_code (30=Health Plan, 35=Dental, AL=Vision, ...)
    # and benefit_coverage_code (1=active, A=co-insurance, B=co-pay, C=deductible,
    # D=description, etc.). We treat eligibility as "active" if any Health Benefit
    # Plan Coverage row is coverage_code "1".
    elig = raw.get("elig") if isinstance(raw, dict) else None
    benefits = (elig or {}).get("benefit", []) if isinstance(elig, dict) else []

    def _find(predicate):
        return next((b for b in benefits if isinstance(b, dict) and predicate(b)), None)

    hbp = _find(lambda b: b.get("benefit_code") == "30" and b.get("benefit_coverage_code") == "1")
    status = "active" if hbp else "inactive" if benefits else "unknown"
    plan = (hbp or {}).get("insurance_plan") or (hbp or {}).get("benefit_description")

    copay_row = _find(
        lambda b: b.get("benefit_coverage_code") == "B" and b.get("benefit_code") in ("30", "98", "BZ")
    )
    copay = (copay_row or {}).get("benefit_amount")

    date = now_iso()[:10]

    eligid = (elig or {}).get("eligid")
    put({
        "PK": f"PATIENT#{body['patient_id']}",
        "SK": f"INSURANCE#{date}",
        # This is the raw CLAIM.MD eligibility *cache* row, not the patient-facing
        # PHI record (that is written separately by the gateway as the full
        # InsuranceCheckRecord). It carries none of the admin display fields
        # (firstName/lastName/payerName/...), so it MUST NOT share the admin
        # list's GSI1PK ("ENTITY#INSURANCE") or it renders as a blank row in
        # /admin/insurance-checks. Use a distinct entity tag.
        "GSI1PK": "ENTITY#INSURANCE_CACHE",
        "GSI1SK": now_iso(),
        "status": status,
        "copay": copay,
        "plan": plan,
        "payer_id": body["payer_id"],
        "eligid": eligid,
        "checked_at": now_iso(),
    })

    log.info("verify_insurance_ok", extra={
        "request_id": ctx.aws_request_id,
        "route": "POST /insurance/verify",
        "status": 200,
        "duration_ms": int((time.monotonic() - t0) * 1000),
    })
    return ok({"status": status, "copay": copay, "plan": plan, "raw": raw})

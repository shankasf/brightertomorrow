#!/usr/bin/env bash
# Provisions an ACM certificate in us-east-1 with DNS validation via Hostinger.
#
# Usage: ./provision_cert.sh <fqdn>
# Example: ./provision_cert.sh api.brightertomorrowtherapy.cloud
#
# Emits the certificate ARN on stdout when ISSUED. Idempotent — reuses an
# existing ISSUED cert for the same domain if present.
set -euo pipefail

FQDN="${1:?usage: $0 <fqdn>}"
ROOT_DOMAIN="brightertomorrowtherapy.cloud"
REGION="us-east-1"

HOSTINGER_TOKEN="$(kubectl -n bt get secret bt-config -o jsonpath='{.data.HOSTINGER_API_TOKEN}' | base64 -d)"

log() { echo "[provision_cert:$FQDN] $*" >&2; }

# 1. Look for an existing ISSUED cert for this domain.
EXISTING="$(aws acm list-certificates --region "$REGION" \
  --includes keyTypes=RSA_2048 \
  --query "CertificateSummaryList[?DomainName=='$FQDN' && Status=='ISSUED'] | [0].CertificateArn" \
  --output text 2>/dev/null || true)"

if [[ -n "$EXISTING" && "$EXISTING" != "None" ]]; then
  log "reusing existing ISSUED cert: $EXISTING"
  echo "$EXISTING"
  exit 0
fi

# 2. Look for PENDING_VALIDATION cert we already requested (resume).
PENDING="$(aws acm list-certificates --region "$REGION" \
  --certificate-statuses PENDING_VALIDATION \
  --query "CertificateSummaryList[?DomainName=='$FQDN'] | [0].CertificateArn" \
  --output text 2>/dev/null || true)"

if [[ -n "$PENDING" && "$PENDING" != "None" ]]; then
  CERT_ARN="$PENDING"
  log "resuming pending cert: $CERT_ARN"
else
  log "requesting new cert"
  CERT_ARN="$(aws acm request-certificate \
    --region "$REGION" \
    --domain-name "$FQDN" \
    --validation-method DNS \
    --key-algorithm RSA_2048 \
    --query CertificateArn --output text)"
  log "cert requested: $CERT_ARN"
  sleep 5
fi

# 3. Fetch the validation record.
for i in {1..20}; do
  VAL_JSON="$(aws acm describe-certificate --region "$REGION" --certificate-arn "$CERT_ARN" \
    --query "Certificate.DomainValidationOptions[0]" --output json)"
  RR_NAME="$(echo "$VAL_JSON" | python3 -c 'import sys,json;d=json.load(sys.stdin);r=d.get("ResourceRecord") or {};print(r.get("Name",""))')"
  RR_VALUE="$(echo "$VAL_JSON" | python3 -c 'import sys,json;d=json.load(sys.stdin);r=d.get("ResourceRecord") or {};print(r.get("Value",""))')"
  if [[ -n "$RR_NAME" && -n "$RR_VALUE" ]]; then
    break
  fi
  log "waiting for validation record... ($i/20)"
  sleep 3
done

if [[ -z "$RR_NAME" || -z "$RR_VALUE" ]]; then
  log "ERROR: no validation record after 60s"
  exit 1
fi

# Hostinger expects the subdomain portion only (strip trailing dot + root).
# e.g. _abcd.api.brightertomorrowtherapy.cloud. -> _abcd.api
SUB="${RR_NAME%.}"
SUB="${SUB%.$ROOT_DOMAIN}"
VAL="${RR_VALUE%.}"

log "validation record: CNAME $SUB -> $VAL"

# 4. Upsert validation CNAME at Hostinger.
ZONE_JSON="$(curl -sS -H "Authorization: Bearer $HOSTINGER_TOKEN" \
  "https://developers.hostinger.com/api/dns/v1/zones/$ROOT_DOMAIN")"

NEW_ZONE="$(SUB="$SUB" VAL="$VAL" python3 -c "
import json, sys, os
z = json.load(sys.stdin)
sub = os.environ['SUB']; val = os.environ['VAL']
z = [g for g in z if not (g.get('name') == sub and g.get('type') == 'CNAME')]
z.append({'name': sub, 'type': 'CNAME', 'ttl': 300,
          'records': [{'content': val, 'is_disabled': False}]})
print(json.dumps({'zone': z, 'overwrite': True}))
" <<<"$ZONE_JSON")"

curl -sS -X PUT -H "Authorization: Bearer $HOSTINGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$NEW_ZONE" \
  "https://developers.hostinger.com/api/dns/v1/zones/$ROOT_DOMAIN" \
  | python3 -c 'import sys,json;sys.stderr.write(sys.stdin.read()[:300]+"\n")'

log "wrote validation CNAME to Hostinger"

# 5. Wait for ACM to see the record and flip to ISSUED.
for i in {1..40}; do
  STATUS="$(aws acm describe-certificate --region "$REGION" --certificate-arn "$CERT_ARN" \
    --query "Certificate.Status" --output text)"
  if [[ "$STATUS" == "ISSUED" ]]; then
    log "ISSUED after $((i*15))s"
    echo "$CERT_ARN"
    exit 0
  fi
  log "status=$STATUS ($i/40)"
  sleep 15
done

log "ERROR: cert did not ISSUE within 10 min"
exit 1

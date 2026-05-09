#!/usr/bin/env bash
# Upserts a CNAME record at Hostinger. Works from a non-Lambda source
# (Cloudflare blocks Lambda IP ranges for developers.hostinger.com).
#
# Usage: set_dns.sh <subdomain> <target>
# Example: set_dns.sh api d-abc123.execute-api.us-east-1.amazonaws.com
set -euo pipefail

SUB="${1:?usage: $0 <sub> <target>}"
TARGET="${2:?usage: $0 <sub> <target>}"
ROOT_DOMAIN="brightertomorrowtherapy.cloud"

TOKEN="$(kubectl -n bt get secret bt-config -o jsonpath='{.data.HOSTINGER_API_TOKEN}' | base64 -d)"

echo "[set_dns] $SUB.$ROOT_DOMAIN -> $TARGET"

ZONE_JSON="$(curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://developers.hostinger.com/api/dns/v1/zones/$ROOT_DOMAIN")"

NEW_ZONE="$(SUB="$SUB" TARGET="$TARGET" python3 -c "
import json, os, sys
z = json.load(sys.stdin)
sub = os.environ['SUB']; target = os.environ['TARGET']
z = [g for g in z if not (g.get('name') == sub and g.get('type') == 'CNAME')]
z.append({'name': sub, 'type': 'CNAME', 'ttl': 300,
          'records': [{'content': target, 'is_disabled': False}]})
print(json.dumps({'zone': z, 'overwrite': True}))
" <<<"$ZONE_JSON")"

curl -sS -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$NEW_ZONE" \
  "https://developers.hostinger.com/api/dns/v1/zones/$ROOT_DOMAIN" | head -c 200
echo

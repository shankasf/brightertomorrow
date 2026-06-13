#!/usr/bin/env bash
# On-demand SEO / discovery submission. Run this "when you say" — e.g. after a
# content change you want the search engines + AI assistants to pick up.
#
# What it does:
#   1. Health-checks the three discovery files on the live site:
#        /robots.txt   /sitemap.xml   /llms.txt
#   2. (Optional) Submits the sitemap to Google Search Console via the API,
#      IF a service-account key is available. Google retired the old anonymous
#      "ping" endpoint in 2023, so programmatic submit now REQUIRES an
#      authenticated Search Console API call against a verified property.
#
# Usage:
#   ops/seo-submit.sh                      # health-check only (no creds needed)
#   GSC_SA_JSON=/path/key.json ops/seo-submit.sh   # also resubmit to Google
#
# One-time setup to enable the Google resubmit (step 2):
#   a. Verify https://brightertomorrowtherapy.com in Google Search Console.
#   b. Create a GCP service account, enable the "Search Console API", download
#      its JSON key.
#   c. In Search Console → Settings → Users and permissions, add the service
#      account's email as an Owner.
#   d. Pass the key path as GSC_SA_JSON (or store it in Secrets Manager and
#      export it here). Nothing else changes — the sitemap itself already
#      auto-updates (web/src/app/sitemap.ts is force-dynamic).
#
# Note on "submitting" the sitemap: once registered in Search Console, Google
# re-reads /sitemap.xml on its own schedule. Re-submitting only nudges a faster
# re-crawl — it is not required for ongoing indexing.

set -euo pipefail

HOST="${SITE_HOST:-https://brightertomorrowtherapy.com}"
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"
SITEMAP="$HOST/sitemap.xml"

pass=0; fail=0
ok()   { echo "  PASS: $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL: $1"; fail=$((fail+1)); }

echo "==> Discovery health check ($HOST)"

# robots.txt — must allow crawl + advertise the sitemap.
R=$(curl -fsS -A "$UA" "$HOST/robots.txt" 2>/dev/null || true)
grep -qi "Sitemap: $SITEMAP" <<<"$R" && ok "robots.txt advertises sitemap" \
  || bad "robots.txt missing 'Sitemap: $SITEMAP' line"

# sitemap.xml — must be 200 with a healthy number of <loc> entries.
S=$(curl -fsS -A "$UA" "$SITEMAP" 2>/dev/null || true)
N=$(grep -o "<loc>" <<<"$S" | wc -l | tr -d ' ')
[ "${N:-0}" -ge 100 ] && ok "sitemap.xml has $N urls" || bad "sitemap.xml only $N urls (expected >=100)"

# llms.txt — the AI-assistant discovery file.
L=$(curl -fsS -A "$UA" "$HOST/llms.txt" 2>/dev/null || true)
grep -q "^# " <<<"$L" && ok "llms.txt is live ($(grep -c '^- ' <<<"$L") entries)" \
  || bad "llms.txt missing or not markdown"

echo "    ($pass passed, $fail failed)"

# ── Google Search Console resubmit ──────────────────────────────────────────
# Key resolution order: $GSC_SA_JSON → local /home/ubuntu/bt-config/gsc-sa.json
# → Secrets Manager (bt/gsc/service-account). Uses a lightweight PyJWT→token→PUT
# flow (no google-api-python-client dependency).
SA_JSON="${GSC_SA_JSON:-}"
TMP_SA=""
cleanup() { [ -n "$TMP_SA" ] && rm -f "$TMP_SA"; }
trap cleanup EXIT

if [ -z "$SA_JSON" ] && [ -f /home/ubuntu/bt-config/gsc-sa.json ]; then
  SA_JSON="/home/ubuntu/bt-config/gsc-sa.json"
fi
if [ -z "$SA_JSON" ]; then
  # Pull from Secrets Manager into a locked-down temp file.
  if command -v aws >/dev/null 2>&1; then
    TMP_SA="$(mktemp)"; chmod 600 "$TMP_SA"
    if aws secretsmanager get-secret-value --secret-id bt/gsc/service-account \
         --query SecretString --output text > "$TMP_SA" 2>/dev/null && [ -s "$TMP_SA" ]; then
      SA_JSON="$TMP_SA"
    fi
  fi
fi

if [ -z "$SA_JSON" ] || [ ! -s "$SA_JSON" ]; then
  echo
  echo "==> Skipping Google resubmit: no service-account key found."
  echo "    Provide one of: GSC_SA_JSON=/path/key.json, /home/ubuntu/bt-config/gsc-sa.json,"
  echo "    or Secrets Manager secret bt/gsc/service-account. (See header for setup.)"
  [ "$fail" -eq 0 ] && exit 0 || exit 1
fi

# Domain property by default (sc-domain:); override with GSC_SITE_URL for a
# URL-prefix property (e.g. https://brightertomorrowtherapy.com/).
DOMAIN="${HOST#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%%/*}"
SITE_PROPERTY="${GSC_SITE_URL:-sc-domain:$DOMAIN}"

echo
echo "==> Submitting sitemap to Google Search Console"
echo "    property: $SITE_PROPERTY"
echo "    sitemap:  $SITEMAP"
python3 - "$SA_JSON" "$SITE_PROPERTY" "$SITEMAP" <<'PY'
import sys, json, time, urllib.parse
sa_path, site_property, sitemap = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    import jwt          # PyJWT
    import requests
except ImportError as e:
    sys.exit(f"  ERROR: missing dependency ({e}); need PyJWT + requests")

with open(sa_path) as f:
    sa = json.load(f)

TOKEN_URI = sa.get("token_uri", "https://oauth2.googleapis.com/token")
SCOPE = "https://www.googleapis.com/auth/webmasters"
now = int(time.time())
assertion = jwt.encode(
    {
        "iss": sa["client_email"],
        "scope": SCOPE,
        "aud": TOKEN_URI,
        "iat": now,
        "exp": now + 3600,
    },
    sa["private_key"],
    algorithm="RS256",
)

# 1. Exchange the signed JWT for an access token.
tok = requests.post(TOKEN_URI, data={
    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
    "assertion": assertion,
}, timeout=20)
if tok.status_code != 200:
    sys.exit(f"  ERROR: token exchange failed ({tok.status_code}): {tok.text}")
access_token = tok.json()["access_token"]

# 2. PUT the sitemap onto the property.
sp = urllib.parse.quote(site_property, safe="")
fp = urllib.parse.quote(sitemap, safe="")
url = f"https://www.googleapis.com/webmasters/v3/sites/{sp}/sitemaps/{fp}"
r = requests.put(url, headers={"Authorization": f"Bearer {access_token}"}, timeout=20)
if r.status_code in (200, 204):
    print(f"  OK: submitted to {site_property}")
elif r.status_code == 403:
    body = r.text
    if "SERVICE_DISABLED" in body or "has not been used in project" in body:
        sys.exit("  ERROR 403: the Search Console API is DISABLED in the GCP project. "
                 "Enable it: https://console.cloud.google.com/apis/library/"
                 f"searchconsole.googleapis.com?project={sa.get('project_id','')} "
                 "then wait ~1-2 min and re-run.")
    sys.exit("  ERROR 403: service account is not an Owner of this property, OR the "
             f"property isn't verified. Add {sa['client_email']} as an Owner in "
             f"Search Console → Settings → Users.\n  Raw: {body}")
elif r.status_code == 404:
    sys.exit(f"  ERROR 404: property {site_property} not found in Search Console. "
             "Verify it first (try GSC_SITE_URL=https://<host>/ for a URL-prefix property).")
else:
    sys.exit(f"  ERROR {r.status_code}: {r.text}")
PY
echo "==> Done."

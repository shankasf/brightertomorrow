#!/usr/bin/env bash
# Build the admin SPA, pin inline-script CSP hashes, sync to S3, invalidate.
# Requires: AWS creds in env, BtSpa stack already deployed once.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BUCKET=$(aws cloudformation describe-stacks --region us-east-1 --stack-name BtSpa \
  --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" --output text)
DIST=$(aws cloudformation describe-stacks --region us-east-1 --stack-name BtSpa \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" --output text)
USER_POOL_ID=$(aws cloudformation describe-stacks --region us-east-1 --stack-name BtAuth \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)
USER_POOL_CLIENT_ID=$(aws cloudformation describe-stacks --region us-east-1 --stack-name BtAuth \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" --output text)
SPA_CERT_ARN=$(aws cloudfront get-distribution --id "$DIST" \
  --query 'Distribution.DistributionConfig.ViewerCertificate.ACMCertificateArn' --output text)

[[ -z "$BUCKET" || -z "$DIST" || -z "$USER_POOL_ID" || -z "$SPA_CERT_ARN" ]] && { echo "missing stack outputs"; exit 1; }

echo "[deploy] bucket=$BUCKET dist=$DIST pool=$USER_POOL_ID"

export NEXT_PUBLIC_API_URL="https://api.brightertomorrowtherapy.cloud"
export NEXT_PUBLIC_AWS_REGION="us-east-1"
export NEXT_PUBLIC_COGNITO_USER_POOL_ID="$USER_POOL_ID"
export NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID="$USER_POOL_CLIENT_ID"

npm ci --silent
npm run build

# Hash every inline <script> in the built HTML so the CloudFront CSP can pin
# them. Hashes shift every build, so we recompute + redeploy BtSpa each time.
HASHES=$(python3 - <<'PY'
import base64, glob, hashlib, re
seen = set()
pat = re.compile(r'<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)</script>')
for path in sorted(glob.iglob("out/**/*.html", recursive=True)):
    with open(path, "r", encoding="utf-8") as f:
        html = f.read()
    for m in pat.finditer(html):
        digest = hashlib.sha256(m.group(1).encode("utf-8")).digest()
        seen.add("sha256-" + base64.b64encode(digest).decode())
print(",".join(sorted(seen)))
PY
)
[[ -z "$HASHES" ]] && { echo "no inline script hashes extracted"; exit 1; }
echo "[deploy] pinned $(echo "$HASHES" | tr ',' '\n' | wc -l) inline-script hashes in CSP"

(cd "$ROOT/../infra" && npx --yes cdk deploy BtSpa --require-approval never \
  --context spaCertArn="$SPA_CERT_ARN" \
  --context spaInlineScriptHashes="$HASHES")

aws s3 sync ./out "s3://$BUCKET/" --delete \
  --cache-control "public, max-age=31536000, immutable" \
  --exclude "*.html" --exclude "index.html"
aws s3 sync ./out "s3://$BUCKET/" \
  --cache-control "public, max-age=60, must-revalidate" \
  --exclude "*" --include "*.html"

aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" \
  --query 'Invalidation.Id' --output text

echo "[deploy] done"

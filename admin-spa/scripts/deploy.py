#!/usr/bin/env python3
"""
Atomic deploy for the BT Admin SPA.

Pipeline (all via boto3, no aws/cdk CLI required):
  1. npm run build             — produces ./out
  2. hash inline scripts       — sha256 of every <script> without src= in out/**/*.html
  3. write csp-hashes.json     — committed alongside the SPA source so CDK reads
                                 the same list at synth time (no drift between
                                 cdk deploy and the live ResponseHeadersPolicy)
  4. update CloudFront CSP     — overwrite script-src on the existing
                                 bt-admin-security-headers ResponseHeadersPolicy
  5. sync ./out → S3           — HTML cached 60s, hashed Next chunks 1y immutable
  6. invalidate CloudFront     — /*  so stale HTML / headers are evicted

Run from admin-spa/:
    python3 scripts/deploy.py

Env knobs (defaults baked in for the live BT stack):
    SPA_BUCKET, SPA_DIST_ID, CSP_POLICY_NAME,
    USER_POOL_ID, USER_POOL_CLIENT_ID, NEXT_PUBLIC_API_URL.
"""
from __future__ import annotations

import base64
import glob
import hashlib
import json
import mimetypes
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import boto3

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
HASHES_FILE = ROOT / "csp-hashes.json"

ROOT_DOMAIN = "brightertomorrowtherapy.cloud"
SPA_BUCKET = os.environ.get("SPA_BUCKET", "bt-admin-spa-689517798275-us-east-1")
SPA_DIST_ID = os.environ.get("SPA_DIST_ID", "EFCT80PSQ5TTZ")
CSP_POLICY_NAME = os.environ.get("CSP_POLICY_NAME", "bt-admin-security-headers")

# Build-time env. Cognito IDs are public — they're injected into the bundle.
BUILD_ENV = {
    "NEXT_PUBLIC_API_URL": os.environ.get(
        "NEXT_PUBLIC_API_URL", f"https://api.{ROOT_DOMAIN}"
    ),
    "NEXT_PUBLIC_AWS_REGION": os.environ.get("NEXT_PUBLIC_AWS_REGION", "us-east-1"),
    "NEXT_PUBLIC_COGNITO_USER_POOL_ID": os.environ.get(
        "NEXT_PUBLIC_COGNITO_USER_POOL_ID", "us-east-1_woNoABtvv"
    ),
    "NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID": os.environ.get(
        "NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID", "6ph1vlr8m750uc6vpqegkrgt6v"
    ),
}

# Matches <script>…</script> only when there is no src=… attribute.
INLINE_SCRIPT_RE = re.compile(r"<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)</script>")


def step(msg: str) -> None:
    print(f"\033[1;36m▸ {msg}\033[0m", flush=True)


def run(cmd: list[str], cwd: Path | None = None) -> None:
    """Run a subprocess and stream output; abort on non-zero exit."""
    print("  $", " ".join(cmd))
    r = subprocess.run(cmd, cwd=cwd or ROOT, env={**os.environ, **BUILD_ENV})
    if r.returncode != 0:
        sys.exit(f"command failed: {' '.join(cmd)}")


def build() -> None:
    step("Building admin SPA")
    run(["npm", "run", "build"])
    if not OUT.exists():
        sys.exit("build did not produce ./out")


def collect_hashes() -> list[str]:
    step("Hashing inline <script> blocks in out/**/*.html")
    seen: set[str] = set()
    for path in sorted(glob.iglob(str(OUT / "**" / "*.html"), recursive=True)):
        with open(path, "r", encoding="utf-8") as f:
            html = f.read()
        for m in INLINE_SCRIPT_RE.finditer(html):
            digest = hashlib.sha256(m.group(1).encode("utf-8")).digest()
            seen.add("sha256-" + base64.b64encode(digest).decode())
    if not seen:
        sys.exit("no inline scripts hashed — build output looks wrong")
    print(f"  found {len(seen)} unique inline-script hashes")
    return sorted(seen)


def write_hashes_file(hashes: list[str]) -> None:
    """Persist hashes for CDK synth so cdk deploy stays in sync with the live policy."""
    HASHES_FILE.write_text(json.dumps(hashes, indent=2) + "\n")
    print(f"  wrote {HASHES_FILE.relative_to(ROOT.parent)}")


def update_csp(hashes: list[str]) -> None:
    step("Updating CloudFront CSP")
    cf = boto3.client("cloudfront")

    # list_response_headers_policies returns paginated by Marker; find ours by name.
    policy_id = None
    marker = None
    while True:
        kwargs = {"Type": "custom", "MaxItems": "100"}
        if marker:
            kwargs["Marker"] = marker
        resp = cf.list_response_headers_policies(**kwargs)
        for s in resp["ResponseHeadersPolicyList"].get("Items") or []:
            if s["ResponseHeadersPolicy"]["ResponseHeadersPolicyConfig"]["Name"] == CSP_POLICY_NAME:
                policy_id = s["ResponseHeadersPolicy"]["Id"]
                break
        if policy_id:
            break
        marker = resp["ResponseHeadersPolicyList"].get("NextMarker")
        if not marker:
            break

    if not policy_id:
        sys.exit(f"ResponseHeadersPolicy '{CSP_POLICY_NAME}' not found")

    got = cf.get_response_headers_policy(Id=policy_id)
    etag = got["ETag"]
    config = got["ResponseHeadersPolicy"]["ResponseHeadersPolicyConfig"]

    script_src = "script-src 'self' " + " ".join(f"'{h}'" for h in hashes)
    csp = "; ".join(
        [
            "default-src 'self'",
            script_src,
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            f"connect-src 'self' https://api.{ROOT_DOMAIN} https://cognito-idp.us-east-1.amazonaws.com",
            "font-src 'self' data:",
            "frame-ancestors 'none'",
        ]
    )
    config["SecurityHeadersConfig"]["ContentSecurityPolicy"] = {
        "ContentSecurityPolicy": csp,
        "Override": True,
    }

    cf.update_response_headers_policy(
        Id=policy_id, IfMatch=etag, ResponseHeadersPolicyConfig=config
    )
    print(f"  updated policy {policy_id} with {len(hashes)} hashes")


def sync_s3() -> None:
    step("Syncing ./out → S3")
    s3 = boto3.client("s3", region_name="us-east-1")

    existing: set[str] = set()
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=SPA_BUCKET):
        for o in page.get("Contents") or []:
            existing.add(o["Key"])

    local: set[str] = set()
    uploaded = 0
    for dirpath, _, files in os.walk(OUT):
        for f in files:
            full = Path(dirpath) / f
            key = str(full.relative_to(OUT)).replace(os.sep, "/")
            local.add(key)
            ctype, _ = mimetypes.guess_type(f)
            ctype = ctype or "application/octet-stream"

            if key.endswith(".html"):
                cache = "public, max-age=60, must-revalidate"
            elif key.startswith("_next/static/"):
                cache = "public, max-age=31536000, immutable"
            else:
                cache = "public, max-age=300"

            s3.upload_file(
                str(full),
                SPA_BUCKET,
                key,
                ExtraArgs={"ContentType": ctype, "CacheControl": cache},
            )
            uploaded += 1

    deleted = [k for k in existing if k not in local]
    for i in range(0, len(deleted), 1000):
        s3.delete_objects(
            Bucket=SPA_BUCKET,
            Delete={
                "Objects": [{"Key": k} for k in deleted[i : i + 1000]],
                "Quiet": True,
            },
        )
    print(f"  uploaded={uploaded} deleted={len(deleted)}")


def invalidate() -> None:
    step("Invalidating CloudFront /*")
    cf = boto3.client("cloudfront")
    inv = cf.create_invalidation(
        DistributionId=SPA_DIST_ID,
        InvalidationBatch={
            "Paths": {"Quantity": 1, "Items": ["/*"]},
            "CallerReference": f"deploy-{int(time.time())}",
        },
    )
    print(f"  invalidation_id={inv['Invalidation']['Id']}")


def main() -> None:
    if not (ROOT / "package.json").exists():
        sys.exit(f"{ROOT}/package.json not found — run from admin-spa/")
    build()
    hashes = collect_hashes()
    write_hashes_file(hashes)
    update_csp(hashes)
    sync_s3()
    invalidate()
    step("Done")


if __name__ == "__main__":
    main()

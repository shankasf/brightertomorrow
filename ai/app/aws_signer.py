"""
SigV4 signing for calls from bt-ai to API Gateway.

Uses botocore (pulled in via boto3) to sign HTTPS requests with the pod's
AWS credentials. Called by the insurance / chat tools in tools.py.
"""
from __future__ import annotations

import json
import os
from typing import Any, Mapping

import httpx
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.credentials import Credentials


def _creds() -> Credentials:
    return Credentials(
        access_key=os.environ["AWS_ACCESS_KEY_ID"],
        secret_key=os.environ["AWS_SECRET_ACCESS_KEY"],
        token=os.environ.get("AWS_SESSION_TOKEN"),
    )


def signed_post(path: str, body: Mapping[str, Any], *, timeout: float = 20.0) -> dict[str, Any]:
    """POST JSON to $BT_API_URL + path, signed with SigV4 (service=execute-api)."""
    base = os.environ.get("BT_API_URL", "https://api.brightertomorrowtherapy.cloud").rstrip("/")
    region = os.environ.get("AWS_REGION", "us-east-1")
    url = f"{base}{path}"
    data = json.dumps(body).encode("utf-8")

    aws_req = AWSRequest(
        method="POST", url=url, data=data,
        headers={"Content-Type": "application/json"},
    )
    SigV4Auth(_creds(), "execute-api", region).add_auth(aws_req)

    resp = httpx.post(url, content=data, headers=dict(aws_req.headers), timeout=timeout)
    resp.raise_for_status()
    return resp.json() if resp.content else {}


def signed_get(path: str, *, params: Mapping[str, str] | None = None, timeout: float = 15.0) -> dict[str, Any]:
    base = os.environ.get("BT_API_URL", "https://api.brightertomorrowtherapy.cloud").rstrip("/")
    region = os.environ.get("AWS_REGION", "us-east-1")
    url = f"{base}{path}"

    aws_req = AWSRequest(method="GET", url=url, params=dict(params or {}))
    SigV4Auth(_creds(), "execute-api", region).add_auth(aws_req)

    resp = httpx.get(url, params=dict(params or {}), headers=dict(aws_req.headers), timeout=timeout)
    resp.raise_for_status()
    return resp.json() if resp.content else {}

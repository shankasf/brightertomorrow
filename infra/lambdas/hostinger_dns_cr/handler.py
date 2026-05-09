"""
CloudFormation custom resource: upsert a single DNS record at Hostinger.

Called by CDK during `cdk deploy`. Reads the Hostinger API token from
Secrets Manager (ARN in HOSTINGER_SECRET_ARN) and PUTs the record.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, Dict

import boto3

HOSTINGER_BASE = "https://developers.hostinger.com/api/dns/v1"
_sm = boto3.client("secretsmanager")


def _get_token() -> str:
    arn = os.environ["HOSTINGER_SECRET_ARN"]
    resp = _sm.get_secret_value(SecretId=arn)
    return resp["SecretString"].strip()


def _request(method: str, path: str, token: str, body: Dict[str, Any] | None = None) -> Any:
    req = urllib.request.Request(
        url=f"{HOSTINGER_BASE}{path}",
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        data=json.dumps(body).encode("utf-8") if body is not None else None,
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = resp.read()
            if not data:
                return None
            return json.loads(data)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Hostinger {method} {path} -> {e.code}: {e.read().decode('utf-8', 'replace')}") from e


def _upsert(domain: str, name: str, rtype: str, content: str, ttl: int, token: str) -> None:
    # Hostinger zone update API accepts a full zone replace per (name,type) group.
    # Safer path: fetch current zone, merge our record into the matching group,
    # and PUT the whole thing back.
    zone = _request("GET", f"/zones/{domain}", token) or []
    if not isinstance(zone, list):
        raise RuntimeError(f"unexpected zone shape: {zone!r}")

    groups = [g for g in zone if not (g.get("name") == name and g.get("type") == rtype)]
    groups.append({
        "name": name,
        "type": rtype,
        "ttl": ttl,
        "records": [{"content": content, "is_disabled": False}],
    })

    _request("PUT", f"/zones/{domain}", token, {"zone": groups, "overwrite": True})


def _delete(domain: str, name: str, rtype: str, token: str) -> None:
    zone = _request("GET", f"/zones/{domain}", token) or []
    if not isinstance(zone, list):
        return
    groups = [g for g in zone if not (g.get("name") == name and g.get("type") == rtype)]
    if len(groups) == len(zone):
        return
    _request("PUT", f"/zones/{domain}", token, {"zone": groups, "overwrite": True})


def on_event(event: Dict[str, Any], _ctx: Any) -> Dict[str, Any]:
    request_type = event["RequestType"]
    props = event["ResourceProperties"]
    domain = props["Domain"]
    name = props["Name"]
    rtype = props["Type"]
    content = props["Content"]
    ttl = int(props.get("TTL", 300))
    physical_id = f"{rtype}:{name}.{domain}"
    token = _get_token()

    if request_type in ("Create", "Update"):
        _upsert(domain, name, rtype, content, ttl, token)
    elif request_type == "Delete":
        _delete(domain, name, rtype, token)

    return {"PhysicalResourceId": physical_id, "Data": {"FQDN": f"{name}.{domain}"}}

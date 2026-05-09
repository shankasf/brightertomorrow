"""Thin helpers around the single-table DynamoDB resource."""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict, Iterable

import boto3
from boto3.dynamodb.conditions import Key

_TABLE_NAME = os.environ.get("DDB_TABLE", "bt-main")
_GSI1 = os.environ.get("DDB_GSI1", "GSI1")

_ddb = boto3.resource("dynamodb")
_table = _ddb.Table(_TABLE_NAME)


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def put(item: Dict[str, Any]) -> None:
    _table.put_item(Item=item)


def get(pk: str, sk: str) -> Dict[str, Any] | None:
    resp = _table.get_item(Key={"PK": pk, "SK": sk})
    return resp.get("Item")


def query_pk(pk: str, sk_begins: str | None = None) -> Iterable[Dict[str, Any]]:
    cond = Key("PK").eq(pk)
    if sk_begins:
        cond = cond & Key("SK").begins_with(sk_begins)
    resp = _table.query(KeyConditionExpression=cond)
    return resp.get("Items", [])


def query_entity(entity: str, since: str | None = None, limit: int = 50) -> Iterable[Dict[str, Any]]:
    cond = Key("GSI1PK").eq(f"ENTITY#{entity}")
    if since:
        cond = cond & Key("GSI1SK").gte(since)
    resp = _table.query(IndexName=_GSI1, KeyConditionExpression=cond, Limit=limit, ScanIndexForward=False)
    return resp.get("Items", [])

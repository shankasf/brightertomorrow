"""Cached Secrets Manager reader. Lambda frozen-ctx friendly."""
from __future__ import annotations

import os
from functools import lru_cache

import boto3

_sm = boto3.client("secretsmanager")


@lru_cache(maxsize=8)
def get_secret(name: str) -> str:
    arn_or_name = os.environ.get(name) or name
    resp = _sm.get_secret_value(SecretId=arn_or_name)
    return resp["SecretString"].strip()

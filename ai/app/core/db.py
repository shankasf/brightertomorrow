"""Tiny psycopg helper used by agent tools."""
from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator

import psycopg


def get_dsn() -> str:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise RuntimeError("DATABASE_URL is not set")
    return dsn


@contextmanager
def conn() -> Iterator[psycopg.Connection]:
    with psycopg.connect(get_dsn(), autocommit=True) as c:
        c.execute("SET search_path TO bt, public")
        yield c

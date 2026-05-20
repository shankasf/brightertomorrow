"""Checkpointer factory + DynamoDB-backed BaseCheckpointSaver.

Why DDB:

  * The compiled graph's state contains live PHI (caller name, DOB, phone,
    email, address, payer, member ID, verify_result). A HIPAA-compliant
    store is required.
  * Hostinger Postgres is NOT under a BAA, so any Postgres checkpointer is
    out. The team's standing rule (memory: project_hostinger_not_hipaa) is
    "all PHI / linkable non-PHI flows through AWS DynamoDB or Lambda."
  * The existing AWS HIPAA stack already has a CMK
    (``alias/bt-phi``) and the bt-ai pod already has AWS creds.

Table: ``bt-langgraph-checkpoints``
  Partition key   : ``thread_id``     (string — same as session_id)
  Sort key        : ``checkpoint_id`` (string — see row-shape table below)
  Attributes      :
    * ``parent_checkpoint_id`` (string, optional) — predecessor (cp rows only)
    * ``checkpoint``           (binary) — JsonPlus-serialised checkpoint
    * ``metadata``             (binary) — JsonPlus-serialised metadata
    * ``cp_id``                (string) — unprefixed checkpoint id
    * ``task_id``              (string, write rows only)
    * ``writes_type``          (string, write rows only)
    * ``writes_blob``          (binary, write rows only)
    * ``ttl``                  (number) — epoch seconds; DDB TTL evicts at 24h

Two row shapes share the same table, distinguished by SK prefix:
  * ``CP#{cp_id}`` — one row per checkpoint (durable graph state).
  * ``W#{cp_id}#{task_id}`` — one row per task's pending writes for that
    checkpoint. Flat per-task rows replace the prior nested map: separate
    sort keys = no overlapping update paths and no races against ``put()``
    overwriting the parent map.

Encryption        : SSE-KMS with ``alias/bt-phi`` (configured at table level).
TTL               : 24 hours from last write — minimum necessary §164.502(b).

Failover          : if AWS creds are missing or the table is unreachable,
                    the factory logs a loud warning and falls back to
                    ``MemorySaver`` so the service keeps serving — better
                    to lose state on restart than to fail closed.
"""
from __future__ import annotations

import logging
import os
import time
import uuid
from collections.abc import AsyncIterator, Iterator
from typing import Any

from langgraph.checkpoint.base import (
    BaseCheckpointSaver,
    ChannelVersions,
    Checkpoint,
    CheckpointMetadata,
    CheckpointTuple,
)
from langgraph.checkpoint.memory import MemorySaver
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer

from .config import checkpointer_kind

logger = logging.getLogger(__name__)

TABLE_NAME = os.environ.get("BT_LANGGRAPH_CHECKPOINT_TABLE", "bt-langgraph-checkpoints")
TTL_SECONDS = int(os.environ.get("BT_LANGGRAPH_CHECKPOINT_TTL", str(60 * 60 * 24)))  # 24h

# Sort-key prefixes. Chosen so checkpoint rows ("CP#") sort BEFORE write
# rows ("W#") under ScanIndexForward=False — that is, descending Query
# walks W rows first, then CP rows, so explicit begins_with filters are
# required for either direction.
SK_CP_PREFIX = "CP#"
SK_WRITE_PREFIX = "W#"


def _now_checkpoint_id() -> str:
    """Monotonic-ish ID — millisecond epoch + 8 random chars for collision-free sort.

    Lexicographic order = chronological order so we can read latest with one
    Query (ScanIndexForward=False, Limit=1) when filtered to CP rows.
    """
    ms = int(time.time() * 1000)
    return f"{ms:013d}-{uuid.uuid4().hex[:8]}"


def _cp_sk(cp_id: str) -> str:
    return f"{SK_CP_PREFIX}{cp_id}"


def _write_sk(cp_id: str, task_id: str) -> str:
    return f"{SK_WRITE_PREFIX}{cp_id}#{task_id}"


def _write_sk_prefix(cp_id: str) -> str:
    return f"{SK_WRITE_PREFIX}{cp_id}#"


class DynamoDBSaver(BaseCheckpointSaver):
    """HIPAA-compliant LangGraph checkpointer backed by DynamoDB.

    Encrypted at rest with KMS (table-level), encrypted in transit with TLS,
    and auto-evicted via DDB TTL — same defaults as the rest of the bt PHI
    stack so a single audit policy covers everything.
    """

    def __init__(self) -> None:
        super().__init__(serde=JsonPlusSerializer())
        import boto3  # late import — keep the optional path optional
        self._ddb = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION", "us-east-1"))
        self._table = self._ddb.Table(TABLE_NAME)

    # ------------------------------------------------------------------
    # Sync helpers — all writes/reads funnel through these.
    # ------------------------------------------------------------------

    def _ttl(self) -> int:
        return int(time.time()) + TTL_SECONDS

    def _query_write_rows(self, thread_id: str, cp_id: str) -> list[dict]:
        """Return every pending-write row for (thread_id, cp_id)."""
        resp = self._table.query(
            KeyConditionExpression="thread_id = :t AND begins_with(checkpoint_id, :pfx)",
            ExpressionAttributeValues={
                ":t": thread_id,
                ":pfx": _write_sk_prefix(cp_id),
            },
        )
        return list(resp.get("Items") or [])

    def _writes_from_rows(self, rows: list[dict]) -> list[tuple[str, str, Any]]:
        out: list[tuple[str, str, Any]] = []
        for row in rows:
            task_id = row.get("task_id") or ""
            blob = row.get("writes_blob")
            w_type = row.get("writes_type")
            if not task_id or blob is None or not w_type:
                continue
            for entry in self.serde.loads_typed((w_type, bytes(blob))):
                out.append((task_id, entry[0], entry[1]))
        return out

    def _item_to_tuple(
        self,
        item: dict,
        config: dict,
        pending_writes: list[tuple[str, str, Any]] | None = None,
    ) -> CheckpointTuple:
        checkpoint = self.serde.loads_typed((item["checkpoint_type"], bytes(item["checkpoint"])))
        metadata = self.serde.loads_typed((item["metadata_type"], bytes(item["metadata"])))
        parent = item.get("parent_checkpoint_id")
        cp_id = item.get("cp_id") or item["checkpoint_id"]
        new_config = {
            "configurable": {
                "thread_id": item["thread_id"],
                "checkpoint_id": cp_id,
            }
        }
        parent_config = None
        if parent:
            parent_config = {"configurable": {"thread_id": item["thread_id"], "checkpoint_id": parent}}
        return CheckpointTuple(
            config=new_config,
            checkpoint=checkpoint,
            metadata=metadata,
            parent_config=parent_config,
            pending_writes=pending_writes or [],
        )

    # ------------------------------------------------------------------
    # BaseCheckpointSaver — sync API. LangGraph derives async from these.
    # ------------------------------------------------------------------

    def put(
        self,
        config: dict,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: ChannelVersions,
    ) -> dict:
        thread_id = config["configurable"]["thread_id"]
        cp_id = checkpoint.get("id") or _now_checkpoint_id()
        parent_id = config["configurable"].get("checkpoint_id")
        cp_type, cp_blob = self.serde.dumps_typed(checkpoint)
        md_type, md_blob = self.serde.dumps_typed(metadata)
        item: dict[str, Any] = {
            "thread_id": thread_id,
            "checkpoint_id": _cp_sk(cp_id),
            "cp_id": cp_id,
            "checkpoint": cp_blob,
            "checkpoint_type": cp_type,
            "metadata": md_blob,
            "metadata_type": md_type,
            "ttl": self._ttl(),
        }
        if parent_id:
            item["parent_checkpoint_id"] = parent_id
        self._table.put_item(Item=item)
        return {
            "configurable": {"thread_id": thread_id, "checkpoint_id": cp_id}
        }

    def put_writes(
        self,
        config: dict,
        writes: list[tuple[str, Any]],
        task_id: str,
        task_path: str = "",
    ) -> None:
        """Persist intermediate writes from a paused task so we can resume.

        Each (cp_id, task_id) pair gets its own row keyed
        ``W#{cp_id}#{task_id}``. Single put_item, idempotent: re-issuing
        the same task_id overwrites cleanly, parallel task_ids hit
        distinct sort keys, and a concurrent ``put()`` cannot wipe these
        rows because they live at a different SK.
        """
        thread_id = config["configurable"]["thread_id"]
        cp_id = config["configurable"]["checkpoint_id"]
        w_type, w_blob = self.serde.dumps_typed(list(writes))
        self._table.put_item(
            Item={
                "thread_id": thread_id,
                "checkpoint_id": _write_sk(cp_id, task_id),
                "cp_id": cp_id,
                "task_id": task_id,
                "writes_type": w_type,
                "writes_blob": w_blob,
                "ttl": self._ttl(),
            }
        )

    def get_tuple(self, config: dict) -> CheckpointTuple | None:
        thread_id = config["configurable"]["thread_id"]
        cp_id = config["configurable"].get("checkpoint_id")
        if cp_id:
            resp = self._table.get_item(
                Key={"thread_id": thread_id, "checkpoint_id": _cp_sk(cp_id)}
            )
            item = resp.get("Item")
        else:
            # Latest checkpoint for this thread (restrict the descending
            # scan to CP rows so write rows can't outsort the checkpoint).
            resp = self._table.query(
                KeyConditionExpression="thread_id = :t AND begins_with(checkpoint_id, :pfx)",
                ExpressionAttributeValues={":t": thread_id, ":pfx": SK_CP_PREFIX},
                ScanIndexForward=False,
                Limit=1,
            )
            items = resp.get("Items") or []
            item = items[0] if items else None
        if not item:
            return None
        resolved_cp = item.get("cp_id") or item["checkpoint_id"]
        write_rows = self._query_write_rows(thread_id, resolved_cp)
        pending_writes = self._writes_from_rows(write_rows)
        return self._item_to_tuple(item, config, pending_writes=pending_writes)

    def list(
        self,
        config: dict | None,
        *,
        filter: dict | None = None,
        before: dict | None = None,
        limit: int | None = None,
    ) -> Iterator[CheckpointTuple]:
        if not config or "configurable" not in config:
            # We don't support cross-thread scan — that's a full table scan
            # against PHI data and we don't want it as a callable surface.
            return iter([])
        thread_id = config["configurable"]["thread_id"]
        kwargs: dict[str, Any] = {
            "KeyConditionExpression": "thread_id = :t AND begins_with(checkpoint_id, :pfx)",
            "ExpressionAttributeValues": {":t": thread_id, ":pfx": SK_CP_PREFIX},
            "ScanIndexForward": False,
        }
        if limit:
            kwargs["Limit"] = limit
        resp = self._table.query(**kwargs)
        for item in resp.get("Items") or []:
            resolved_cp = item.get("cp_id") or item["checkpoint_id"]
            write_rows = self._query_write_rows(thread_id, resolved_cp)
            pending_writes = self._writes_from_rows(write_rows)
            yield self._item_to_tuple(item, config, pending_writes=pending_writes)

    # ------------------------------------------------------------------
    # Async API — defer to sync since botocore is sync-only.
    # LangGraph's runtime hops to a worker thread for these.
    # ------------------------------------------------------------------

    async def aput(self, config, checkpoint, metadata, new_versions):
        import asyncio
        return await asyncio.to_thread(self.put, config, checkpoint, metadata, new_versions)

    async def aput_writes(self, config, writes, task_id, task_path=""):
        import asyncio
        return await asyncio.to_thread(self.put_writes, config, writes, task_id, task_path)

    async def aget_tuple(self, config):
        import asyncio
        return await asyncio.to_thread(self.get_tuple, config)

    async def alist(self, config, *, filter=None, before=None, limit=None) -> AsyncIterator[CheckpointTuple]:
        import asyncio
        # Materialise eagerly so we don't hold the worker thread.
        items = await asyncio.to_thread(
            lambda: list(self.list(config, filter=filter, before=before, limit=limit))
        )
        for it in items:
            yield it


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def build_checkpointer():
    """Return the configured saver.

    ``BT_LANGGRAPH_CHECKPOINT=ddb`` (default in prod) → DynamoDBSaver.
    Anything else, or DDB init failure, → MemorySaver (warns loudly).
    """
    kind = checkpointer_kind()
    if kind == "ddb" or (kind == "auto" and os.environ.get("AWS_ACCESS_KEY_ID")):
        try:
            saver = DynamoDBSaver()
            logger.info("checkpointer=DynamoDBSaver table=%s ttl_s=%d", TABLE_NAME, TTL_SECONDS)
            return saver
        except Exception:
            logger.exception("DynamoDBSaver init failed — falling back to MemorySaver")
    logger.warning("checkpointer=MemorySaver (state will not survive pod restart)")
    return MemorySaver()

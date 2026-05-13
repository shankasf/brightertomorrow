"""In-memory log broadcaster.

Hooks the root logger and republishes every record to:
  • a fixed-size ring buffer (so a freshly-attached client gets recent
    history, not just future events)
  • any number of asyncio queues belonging to subscribed SSE clients

There is intentionally NO disk persistence here — these logs already go
to stdout (and from there to `kubectl logs` and the cluster's log shipper).
This stream is for live operator visibility from the admin portal, nothing
more. Records older than the ring buffer are simply forgotten.

PHI note: operational logs include patient identifiers (email-derived
patient_id, phone numbers, payer IDs in tool-call traces). Access to the
SSE endpoint is gated to superadmins in the gateway and every connection
is recorded in admin_access_log. §164.312(b)
"""
from __future__ import annotations

import asyncio
import itertools
import logging
import time
from collections import deque
from typing import Any

# Bound the broadcast at INFO so we don't flood the wire with DEBUG noise
# (and so we don't leak the chattier debug-only fields). Each subscriber's
# queue is independently bounded; a slow client just drops backlogged
# records rather than holding up the publisher.
_BUFFER_SIZE = 500
_QUEUE_SIZE = 1000
_BROADCAST_LEVEL = logging.INFO


class LogBroadcaster:
    """Singleton-style broadcaster.

    Thread-safety: logging handlers can fire from any thread (e.g. work
    offloaded via ``loop.run_in_executor``). ``asyncio.Queue.put_nowait``
    is NOT thread-safe — calling it from a non-loop thread can corrupt the
    queue's internal state. We bind each subscriber to the loop it was
    created on and schedule puts via ``loop.call_soon_threadsafe``.
    """

    def __init__(self, buffer_size: int = _BUFFER_SIZE) -> None:
        self._buffer: deque[dict[str, Any]] = deque(maxlen=buffer_size)
        self._subscribers: set[tuple[asyncio.AbstractEventLoop, asyncio.Queue[dict[str, Any]]]] = set()
        self._counter = itertools.count(1)

    def publish(self, record: logging.LogRecord) -> None:
        """Called from the logging handler. Build a small JSON-friendly
        dict and fan it out. Failures here must not break logging."""
        try:
            msg = {
                "id": next(self._counter),
                "ts": time.time(),
                "level": record.levelname,
                "logger": record.name,
                "msg": record.getMessage(),
            }
        except Exception:  # pragma: no cover — defensive
            return

        self._buffer.append(msg)
        for loop, q in list(self._subscribers):
            # call_soon_threadsafe is safe from any thread including the
            # loop's own thread. Inner _put guards against the slow-
            # consumer case so a single full queue can't break the fan-out.
            try:
                loop.call_soon_threadsafe(_put_or_drop, q, msg)
            except RuntimeError:
                # Loop closed underneath us (subscriber's task already gone).
                # Best-effort: drop the binding so we don't keep hitting it.
                self._subscribers.discard((loop, q))

    def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        """Return a fresh queue pre-seeded with the ring buffer so a new
        client sees the recent past, then continues live."""
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=_QUEUE_SIZE)
        for item in list(self._buffer):
            try:
                q.put_nowait(item)
            except asyncio.QueueFull:
                break
        loop = asyncio.get_running_loop()
        self._subscribers.add((loop, q))
        return q

    def unsubscribe(self, q: asyncio.Queue[dict[str, Any]]) -> None:
        self._subscribers = {(loop, qq) for loop, qq in self._subscribers if qq is not q}

    def subscriber_count(self) -> int:
        return len(self._subscribers)


def _put_or_drop(q: asyncio.Queue[dict[str, Any]], msg: dict[str, Any]) -> None:
    """Runs on the subscriber's loop thread. Drops on overflow rather than
    blocking the publisher."""
    try:
        q.put_nowait(msg)
    except asyncio.QueueFull:
        # Slow consumer — drop the record for that subscriber.
        pass


broadcaster = LogBroadcaster()


class _BroadcastHandler(logging.Handler):
    """logging.Handler that forwards records to the broadcaster."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            broadcaster.publish(record)
        except Exception:
            self.handleError(record)


def install() -> None:
    """Attach the broadcast handler to the root logger. Idempotent."""
    root = logging.getLogger()
    for h in root.handlers:
        if isinstance(h, _BroadcastHandler):
            return
    h = _BroadcastHandler(level=_BROADCAST_LEVEL)
    h.setFormatter(logging.Formatter("%(message)s"))
    root.addHandler(h)

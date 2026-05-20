"""Canned-reply cache for high-traffic info questions (hours, locations, contact).

Bypasses the agent graph for clearly-canned questions, returning a deterministic
formatted answer in milliseconds. Cache entries are versioned against the source
tables (`site_settings.updated_at` + a content hash of `locations`), so any admin
edit to the underlying data invalidates cache automatically on the next request.

Logging:
    Every lookup, hit, miss, render, store, and version-change is logged at INFO
    with the intent id, version key, latency, and reply length. This makes it
    trivial to confirm the cache is doing its job in production logs.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from dataclasses import dataclass
from typing import Any

from ..core.db import conn

logger = logging.getLogger(__name__)

# Intent ids — stable strings used in logs and as cache keys.
INTENT_HOURS_AND_LOCATIONS = "info_hours_and_locations"
INTENT_HOURS = "info_hours"
INTENT_LOCATIONS = "info_locations"

# Patterns are intentionally conservative: only fire on clearly-canned questions
# so anything nuanced ("are you open Christmas?") falls through to the LLM.
# Order matters — check combined intent first so it wins over the singletons.
_HOURS_RX = re.compile(r"\b(hours?|open|closing|closed|business hours)\b", re.I)
_LOCATIONS_RX = re.compile(
    r"\b(locations?|address(?:es)?|where (?:are|is)|directions?|office)\b", re.I
)


def detect_intent(message: str) -> str | None:
    """Return a cacheable intent id if the message is a canned info question, else None.

    Combined hours+locations wins over either alone. Returns None for anything
    that doesn't cleanly match — those go through the agent graph as usual.
    """
    msg = message.strip()
    if not msg:
        return None

    has_hours = bool(_HOURS_RX.search(msg))
    has_loc = bool(_LOCATIONS_RX.search(msg))

    if has_hours and has_loc:
        return INTENT_HOURS_AND_LOCATIONS
    if has_hours:
        return INTENT_HOURS
    if has_loc:
        return INTENT_LOCATIONS
    return None


@dataclass(frozen=True)
class _Version:
    """Versioning fingerprint for the underlying data.

    Two versions compare equal iff the source data the cache depends on is unchanged.
    """
    hours_ts: str  # site_settings.updated_at as ISO string
    locations_hash: str  # md5 hash of locations rows


@dataclass
class _Entry:
    version: _Version
    reply: str
    stored_at: float
    hits: int = 0


# In-memory cache, per-pod. Process restart clears it; cross-pod inconsistency
# is fine because the version key guarantees correctness — a stale pod just
# pays one render cost on next miss.
_lock = threading.Lock()
_cache: dict[str, _Entry] = {}


def _fetch_version_and_data() -> tuple[_Version, dict[str, Any]]:
    """Single round-trip query: pull version fingerprint AND underlying data.

    Cheaper than separate version-check + data-fetch queries since most lookups
    are during cold cache or after admin edits anyway.
    """
    t0 = time.perf_counter()
    with conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT
                ss.updated_at::text AS hours_ts,
                ss.primary_phone,
                ss.primary_email,
                ss.business_hours,
                COALESCE(MD5(STRING_AGG(
                    COALESCE(l.name,'') || '|' ||
                    COALESCE(l.address1,'') || '|' ||
                    COALESCE(l.city,'') || '|' ||
                    COALESCE(l.state,'') || '|' ||
                    COALESCE(l.postal_code,'') || '|' ||
                    COALESCE(l.phone,'') || '|' ||
                    l.is_telehealth::text,
                    E'\n' ORDER BY l.position
                )), '') AS locations_hash,
                COALESCE(JSON_AGG(JSON_BUILD_OBJECT(
                    'name', l.name,
                    'address1', l.address1,
                    'city', l.city,
                    'state', l.state,
                    'postal_code', l.postal_code,
                    'phone', l.phone,
                    'is_telehealth', l.is_telehealth
                ) ORDER BY l.position) FILTER (WHERE l.id IS NOT NULL), '[]'::json) AS locations
            FROM site_settings ss
            LEFT JOIN locations l ON TRUE
            WHERE ss.id = 1
            GROUP BY ss.updated_at, ss.primary_phone, ss.primary_email, ss.business_hours
            """,
        )
        row = cur.fetchone()

    fetch_ms = (time.perf_counter() - t0) * 1000
    if not row:
        logger.warning("info_cache.fetch_empty: no site_settings row — cache disabled")
        raise RuntimeError("site_settings row missing")

    hours_ts, phone, email, business_hours, loc_hash, locations = row
    version = _Version(hours_ts=hours_ts, locations_hash=loc_hash)
    data = {
        "phone": phone,
        "email": email,
        "business_hours": business_hours,
        "locations": locations,
    }
    logger.debug(
        "info_cache.fetch: version=(%s,%s) locations=%d fetch_ms=%.1f",
        hours_ts, loc_hash[:8], len(locations), fetch_ms,
    )
    return version, data


def _render_hours(data: dict[str, Any]) -> str:
    hours = data.get("business_hours") or {}
    phone = data.get("phone") or "725-238-6990"
    if not hours:
        return f"Please call {phone} for current hours."
    lines = [f"- **{day}:** {time_}" for day, time_ in hours.items()]
    return (
        "Here are our hours:\n\n"
        + "\n".join(lines)
        + f"\n\nYou can also reach us at **{phone}**."
    )


def _render_locations(data: dict[str, Any]) -> str:
    locs = data.get("locations") or []
    phone = data.get("phone") or "725-238-6990"
    if not locs:
        return f"Please call {phone} for our office locations."

    parts: list[str] = ["We have the following options:"]
    for loc in locs:
        name = loc.get("name") or ""
        if loc.get("is_telehealth"):
            parts.append(f"- **{name}** — secure video sessions, available statewide.")
            continue
        addr_bits = [
            loc.get("address1"),
            ", ".join(b for b in [loc.get("city"), loc.get("state")] if b),
            loc.get("postal_code"),
        ]
        addr = " · ".join(b for b in addr_bits if b)
        parts.append(f"- **{name}** — {addr}")
    parts.append(f"\nQuestions? Call **{phone}**.")
    return "\n".join(parts)


def _render_hours_and_locations(data: dict[str, Any]) -> str:
    return (
        _render_hours(data)
        + "\n\n"
        + _render_locations(data)
    )


_RENDERERS = {
    INTENT_HOURS: _render_hours,
    INTENT_LOCATIONS: _render_locations,
    INTENT_HOURS_AND_LOCATIONS: _render_hours_and_locations,
}


@dataclass
class CacheLookup:
    """Result of a cache lookup. `hit=True` means `reply` is ready to serve."""
    intent: str
    reply: str
    hit: bool
    version_key: str
    latency_ms: float
    chars: int


def get_cached_reply(intent: str) -> CacheLookup | None:
    """Return a cached or freshly-rendered reply for `intent`.

    Returns None on database failure (caller falls back to the agent graph).
    On success, logs whether it was a hit, miss-cold, or miss-stale.
    """
    if intent not in _RENDERERS:
        logger.warning("info_cache.unknown_intent intent=%s", intent)
        return None

    t0 = time.perf_counter()

    try:
        version, data = _fetch_version_and_data()
    except Exception:
        logger.exception("info_cache.fetch_error intent=%s — falling back to LLM", intent)
        return None

    version_key = f"{version.hours_ts}|{version.locations_hash[:8]}"

    with _lock:
        entry = _cache.get(intent)

        if entry is not None and entry.version == version:
            entry.hits += 1
            latency_ms = (time.perf_counter() - t0) * 1000
            logger.info(
                "info_cache.hit intent=%s version=%s hits=%d latency_ms=%.1f chars=%d",
                intent, version_key, entry.hits, latency_ms, len(entry.reply),
            )
            return CacheLookup(
                intent=intent,
                reply=entry.reply,
                hit=True,
                version_key=version_key,
                latency_ms=latency_ms,
                chars=len(entry.reply),
            )

        # Miss — render, store, return.
        miss_reason = "cold" if entry is None else "stale"
        prev_version_key = (
            f"{entry.version.hours_ts}|{entry.version.locations_hash[:8]}"
            if entry else "—"
        )
        render_t0 = time.perf_counter()
        reply = _RENDERERS[intent](data)
        render_ms = (time.perf_counter() - render_t0) * 1000

        _cache[intent] = _Entry(version=version, reply=reply, stored_at=time.time())
        latency_ms = (time.perf_counter() - t0) * 1000

        logger.info(
            "info_cache.miss intent=%s reason=%s prev_version=%s new_version=%s "
            "render_ms=%.1f total_ms=%.1f chars=%d",
            intent, miss_reason, prev_version_key, version_key,
            render_ms, latency_ms, len(reply),
        )
        return CacheLookup(
            intent=intent,
            reply=reply,
            hit=False,
            version_key=version_key,
            latency_ms=latency_ms,
            chars=len(reply),
        )


def cache_stats() -> dict[str, Any]:
    """Snapshot of cache state for debugging/observability."""
    with _lock:
        return {
            "intents": [
                {
                    "intent": k,
                    "version": f"{e.version.hours_ts}|{e.version.locations_hash[:8]}",
                    "hits": e.hits,
                    "chars": len(e.reply),
                    "stored_age_s": round(time.time() - e.stored_at, 1),
                }
                for k, e in _cache.items()
            ],
        }

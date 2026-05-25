"""Shared normalization for external identifiers.

Single source of truth so every agent path (phone voice, website voice, chat)
sends identifiers to CLAIM.MD / Jane in the exact form they appear on the card.
"""
from __future__ import annotations

import re


def normalize_member_id(val: str | None) -> str:
    """Strip spaces and separators from an insurance member ID.

    Member IDs are alphanumeric. A caller reading one aloud (voice) or typing
    it (chat) often inserts spaces or dashes ("IDKM C0 169290"); CLAIM.MD is
    whitespace-sensitive and returns error_code 72 / status unknown for the
    spaced form while the clean form ("IDKMC0169290") verifies active
    (proven on call CA4d16293f, 2026-05-24). Keep only [A-Za-z0-9].
    """
    return re.sub(r"[^A-Za-z0-9]", "", val or "")

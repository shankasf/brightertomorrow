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


def normalize_email(val: str | None) -> str:
    """Remove ALL whitespace from an email address.

    Voice ASR routinely inserts spaces around a spoken email ("sagar shankaran
    usa @ gmail . com") and emails never legally contain whitespace, so strip
    every space/tab/newline. Case is preserved (Gmail et al. are case-
    insensitive on the local part anyway).
    """
    return re.sub(r"\s+", "", val or "")


def normalize_phone(val: str | None) -> str:
    """Reduce a spoken/typed phone to digits, preserving a single leading '+'.

    Strips spaces, dashes, parens, and the words-as-digits spacing that ASR
    emits ("7 2 5 2 3 8 4 2 6 7"). Keeps a leading '+' for E.164 inputs.
    """
    raw = (val or "").strip()
    plus = raw.startswith("+")
    digits = re.sub(r"\D", "", raw)
    return ("+" + digits) if plus else digits


def normalize_name(val: str | None) -> str:
    """Trim and collapse internal whitespace runs to a single space.

    Conservative on purpose: multi-word names ("De La Cruz", "Mary Ann") keep
    their single separating spaces, while stray double-spaces / leading /
    trailing whitespace from ASR are removed. Used for first/last/full name
    fields so persisted + CLAIM.MD values are clean.
    """
    return re.sub(r"\s+", " ", (val or "").strip())


def format_dob_pretty(val: str | None) -> str:
    """Render a stored DOB as plain English ("October 2, 1987").

    DOB is persisted/sent as 8-digit YYYYMMDD, but it must NEVER be read back
    to a patient as raw digits or slash dates (ambiguous MM/DD vs DD/MM). Every
    confirmation recap — chat and voice — funnels through here so the user
    always hears one unambiguous "Month Day, Year". Accepts YYYYMMDD or
    YYYY-MM-DD; returns "" for anything unparseable so callers can fall back.
    """
    digits = re.sub(r"\D", "", val or "")
    if len(digits) != 8:
        return ""
    from datetime import date

    try:
        d = date(int(digits[:4]), int(digits[4:6]), int(digits[6:8]))
    except ValueError:
        return ""
    return d.strftime("%B %-d, %Y")

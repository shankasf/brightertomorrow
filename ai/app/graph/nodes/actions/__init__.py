"""actions package — all action nodes re-exported for backwards compatibility.

Consumers import from `graph.nodes.actions` (the old module path) and get
every symbol without change. New callers can import from the sub-modules
directly for finer-grained dependency control.

Sub-module responsibilities:
  insurance.py  — verify_insurance (discriminated outcome), send_coverage_result
  booking.py    — create_pending_request (HIPAA-critical TransactWriteItems)
  notify.py     — send_acknowledgement, log_phi (pure scene setters)
  coverage.py   — offer_self_pay, capture_self_pay_consent (pure scene setters)

The five legacy nodes (propose_slots, book_appointment, cancel_appointment,
submit_callback, search_kb, check_payer) are imported from the legacy module
that has been preserved verbatim as `_legacy.py`.
"""
from __future__ import annotations

# New action nodes (12-step flow)
from .insurance import verify_insurance, send_coverage_result
from .booking import create_pending_request
from .notify import send_acknowledgement, log_phi
from .coverage import offer_self_pay, capture_self_pay_consent

# Legacy action nodes — unchanged from original actions.py
from ._legacy import (
    propose_slots,
    book_appointment,
    cancel_appointment,
    lookup_appointment,
    reschedule_appointment,
    submit_callback,
    search_kb,
    check_payer,
)

__all__ = [
    # New
    "verify_insurance",
    "send_coverage_result",
    "create_pending_request",
    "send_acknowledgement",
    "log_phi",
    "offer_self_pay",
    "capture_self_pay_consent",
    # Legacy
    "propose_slots",
    "book_appointment",
    "cancel_appointment",
    "lookup_appointment",
    "reschedule_appointment",
    "submit_callback",
    "search_kb",
    "check_payer",
]

"""Self-pay offer + consent capture nodes — pure scene setters.

These nodes exist to give the planner explicit routing targets for the
self-pay branch. Neither makes external calls; both return only a scene
key so the respond node renders the correct script.

The actual self-pay decision is driven by:
  1. verify_insurance returning outcome="self_pay" or outcome="no_insurance"
  2. The planner routing to offer_self_pay
  3. The caller responding (captured by extract → insurance.self_pay_consent)
  4. The planner routing to capture_self_pay_consent
  5. If insurance.self_pay_consent==True, planner continues to propose_slots
"""
from __future__ import annotations

from typing import Any

from ...state import State
from ...tracing import traced


@traced(run_type="tool", name="offer_self_pay")
def offer_self_pay(state: State) -> dict[str, Any]:
    """Set scene so respond presents cash-rate options.

    No external call. The respond node reads scene="offer_self_pay" and
    renders the cash-rate script from the prompt template.
    """
    return {
        "scene": "offer_self_pay",
        "last_action": "offer_self_pay",
    }


@traced(run_type="tool", name="capture_self_pay_consent")
def capture_self_pay_consent(state: State) -> dict[str, Any]:
    """Flip payment_path to self_pay after the caller agreed to continue.

    Reached only via planner routing of `last_action=="offer_self_pay" AND
    aff=="yes"` — i.e. respond already asked "want to continue as self-pay?"
    and the caller confirmed. Flipping payment_path here makes the next
    planner turn skip insurance verification and continue to booking-field
    collection.

    No external call.
    """
    return {
        "payment_path": "self_pay",
        "scene": "confirm_self_pay_consent",
        "last_action": "capture_self_pay_consent",
    }


__all__ = ["offer_self_pay", "capture_self_pay_consent"]

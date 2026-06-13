"""
Payer registry — top US health plans with their CLAIM.MD payer IDs.

Used by:
  * the chat widget dropdown (via an HTTP endpoint that serves `PAYERS`)
  * the voice agent (via `resolve_payer_id` — fuzzy match on spoken name)
  * the booking tool (translates a selected name into the payer_id that
    CLAIM.MD expects)

Payer IDs are CLAIM.MD-specific. Verify against https://www.claim.md/payers/
when adding entries — these are the most common ones we've seen at BT.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Payer:
    id: str        # CLAIM.MD payer id
    name: str      # canonical display name
    aliases: tuple[str, ...] = ()  # extra strings to match on (voice)


PAYERS: tuple[Payer, ...] = (
    Payer("87726", "UnitedHealthcare", ("UHC", "United Healthcare", "United")),
    Payer("60054", "Aetna"),
    Payer("62308", "Cigna", ("Cigna Healthcare",)),
    Payer("00590", "Humana"),
    # In Nevada, Anthem is the Blue Cross Blue Shield licensee, so generic
    # "BCBS" / "Blue Cross" / "Blue Shield" resolve to Anthem's CLAIM.MD id
    # (45302). The old "BCBSF" id was BCBS of *Florida* and returned
    # needs_manual_review for every NV member — do not reintroduce it.
    Payer("45302", "Blue Cross Blue Shield", ("BCBS", "Blue Cross", "Blue Shield")),
    Payer("45302", "Anthem", ("Anthem Blue Cross", "Anthem BCBS", "Anthem BCBS NV")),
    Payer("SB580", "Kaiser Permanente", ("Kaiser",)),
    Payer("MCARE", "Medicare", ("Original Medicare", "Medicare Part B")),
    Payer("TRICR", "Tricare", ("TriCare", "Tri Care")),
    Payer("87815", "Molina Healthcare", ("Molina",)),
    Payer("56205", "WellCare"),
    Payer("13265", "Oscar Health", ("Oscar",)),
    Payer("25463", "Health Net"),
    Payer("BS001", "Blue Shield of California"),
    Payer("47198", "EmblemHealth"),
    Payer("36273", "Centene", ("Centene Corporation",)),
    Payer("71412", "Independence Blue Cross", ("IBX", "Independence")),
    Payer("15459", "Ambetter"),
    Payer("11315", "Meritain Health", ("Meritain",)),
    Payer("SELF", "Self-pay / Out-of-network", ("Self pay", "Cash pay", "No insurance", "Uninsured")),
)


# Plans the practice does NOT accept. Matched separately from PAYERS so the
# assistant can give a clear, honest "we don't accept Medicaid" answer and
# pivot to self-pay — instead of routing the caller to manual review or
# failing to resolve the payer. Added 2026-06-13: Medicaid excluded practice-
# wide.
#
# NOTE: this only fires when the caller explicitly names Medicaid (or Medi-Cal,
# California's Medicaid). Commercial plans that ALSO run Medicaid managed-care
# lines (Molina, Centene, WellCare, Ambetter) stay on the accepted roster above
# and are unaffected — a member naming the carrier still verifies normally.
DECLINED_PAYERS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Medicaid", (
        "medicaid", "medi-caid", "medi caid",
        "medi-cal", "medical assistance",
        "straight medicaid", "state medicaid",
        "title 19", "title xix",
    )),
)


def list_for_dropdown() -> list[dict[str, str]]:
    """Shape consumed by the chat widget dropdown."""
    return [{"id": p.id, "name": p.name} for p in PAYERS]


def is_declined_payer(spoken_or_typed: str) -> str | None:
    """Return the canonical name of a NOT-accepted plan (e.g. 'Medicaid') if the
    input names one, else None.

    Checked BEFORE resolve_payer_id so the agent declines clearly and offers
    self-pay rather than calling CLAIM.MD or routing to manual review. Uses the
    same case-insensitive substring match as resolve_payer_id.
    """
    if not spoken_or_typed:
        return None
    needle = spoken_or_typed.strip().lower()
    for canonical, aliases in DECLINED_PAYERS:
        for c in (canonical.lower(), *aliases):
            if c in needle or needle in c:
                return canonical
    return None


def resolve_payer_id(spoken_or_typed: str) -> Payer | None:
    """Fuzzy-match a user-provided name to a Payer. Case-insensitive, substring-based."""
    if not spoken_or_typed:
        return None
    needle = spoken_or_typed.strip().lower()
    for p in PAYERS:
        if p.id.lower() == needle or p.name.lower() == needle:
            return p
    for p in PAYERS:
        candidates = (p.name.lower(), *(a.lower() for a in p.aliases))
        for c in candidates:
            if c in needle or needle in c:
                return p
    return None

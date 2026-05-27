"""Regression test for therapist carry-forward + mid-flow switching.

Contract verified here (deterministic parts only — pronoun resolution itself
lives in the LLM extractor and is covered by the prompt, not this test):

  1. Naming a DIFFERENT therapist mid-flow clears the prior therapist's
     proposed_slots / selected_slot so propose_slots re-runs for the new pick.
  2. Re-naming the SAME therapist is a no-op (slots are NOT thrown away).
  3. `last_therapist_discussed` is tracked from a booking pick (staff_name)…
  4. …and from an info reference (`therapist_about`), so a later pronoun
     ("book with her") has something for the extractor to resolve against.
"""
from __future__ import annotations

import sys
import types


def _install_stubs() -> None:
    sys.modules.setdefault("agents", types.SimpleNamespace(function_tool=lambda f: f))
    sys.modules.setdefault("app.bt_agents", types.SimpleNamespace())
    roster = types.SimpleNamespace(
        ELIGIBLE_FOR_BOOKING=[
            {"staffId": 53, "name": "Janelle Thompson"},
            {"staffId": 47, "name": "Elisia Danley"},
        ],
        THERAPISTS_WITHOUT_FEEDS=[],
        THERAPISTS_WITH_FEEDS=[
            {"staffId": 53, "name": "Janelle Thompson"},
            {"staffId": 47, "name": "Elisia Danley"},
        ],
    )
    sys.modules["app.data.roster"] = roster


def main() -> int:
    _install_stubs()
    fails = 0

    from app.graph.prompts.extract import FieldDeltas
    from app.graph.nodes.extract import _merge_field_deltas
    from app.graph.state import initial_state

    _slots = [
        {"staffId": 47, "staffName": "Elisia Danley",
         "startISO": "2026-06-01T17:00:00+00:00", "displayPT": "Mon Jun 1, 10:00 AM PT"},
    ]

    # --- 1. switching therapist mid-flow drops the old slots/selection ----
    st = initial_state("chat", "t-switch", "test")
    st["intent"] = "booking"
    st["staff_id"] = 47
    st["staff_name"] = "Elisia Danley"
    st["proposed_slots"] = list(_slots)
    st["selected_slot"] = _slots[0]
    st["booking_status"] = "slot_selected"
    out = _merge_field_deltas(st, FieldDeltas(staff_name="Janelle"))
    if (
        out.get("staff_id") == 53
        and out.get("proposed_slots") == []
        and out.get("selected_slot") is None
        and out.get("booking_status") == "collecting"
    ):
        print("OK   1. switch to Janelle cleared Elisia's slots + selection")
    else:
        print(f"FAIL 1. expected reset to Janelle, got {out!r}")
        fails += 1

    # --- 2. re-naming the SAME therapist keeps the existing slots ---------
    st2 = initial_state("chat", "t-same", "test")
    st2["intent"] = "booking"
    st2["staff_id"] = 47
    st2["staff_name"] = "Elisia Danley"
    st2["proposed_slots"] = list(_slots)
    out2 = _merge_field_deltas(st2, FieldDeltas(staff_name="Elisia"))
    if "proposed_slots" not in out2 and out2.get("staff_id") == 47:
        print("OK   2. re-naming Elisia did NOT discard her slots")
    else:
        print(f"FAIL 2. same-therapist should be a no-op, got {out2!r}")
        fails += 1

    # --- 3. a booking pick records last_therapist_discussed ---------------
    st3 = initial_state("chat", "t-disc-pick", "test")
    st3["intent"] = "booking"
    out3 = _merge_field_deltas(st3, FieldDeltas(staff_name="Janelle"))
    if out3.get("last_therapist_discussed") == "Janelle Thompson":
        print("OK   3. booking pick set last_therapist_discussed=Janelle Thompson")
    else:
        print(f"FAIL 3. expected last_therapist_discussed, got {out3.get('last_therapist_discussed')!r}")
        fails += 1

    # --- 4. an info reference (therapist_about) records last_discussed -----
    st4 = initial_state("chat", "t-disc-about", "test")
    out4 = _merge_field_deltas(st4, FieldDeltas(therapist_about="Elisia"))
    if out4.get("last_therapist_discussed") == "Elisia Danley" and not out4.get("staff_id"):
        print("OK   4. 'tell me about Elisia' set last_discussed, did NOT pin booking")
    else:
        print(f"FAIL 4. expected last_discussed=Elisia/no staff_id, got {out4!r}")
        fails += 1

    print(f"\n{fails} failures / 4 checks")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

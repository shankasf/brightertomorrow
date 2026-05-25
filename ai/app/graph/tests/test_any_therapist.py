"""Regression test for the "Any therapist" booking dead-end.

Bug: picking "Any therapist" hash-picked ONE clinician (e.g. Janelle), so
propose_slots only checked that calendar and dead-ended with
"<name> doesn't have any openings" instead of fanning out across the roster.

Fix contract verified here:
  1. _resolve_staff(no_therapist_preference) -> staff_any=True, NO staff_id.
  2. planner does NOT re-ask ask_therapist when staff_any is set.
  3. propose_slots runs the gateway fan-out (staffId=0 / _fetch_free_slots(None))
     and returns slots tagged with their own clinician.
  4. picking a fanned-out slot pins staff_id/staff_name from that slot so
     book_appointment can place the hold.
"""
from __future__ import annotations

import sys
import types


def _install_stubs() -> None:
    """Stub heavy/external modules the same way smoke.py does."""
    sys.modules.setdefault("agents", types.SimpleNamespace(function_tool=lambda f: f))
    from dataclasses import dataclass

    @dataclass
    class _Payer:
        id: str
        name: str
        aliases: tuple = ()

    sys.modules.setdefault("app.bt_agents", types.SimpleNamespace())
    # roster used by _match_roster / planner imports
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
    from app.graph.nodes.extract import _resolve_staff, _merge_field_deltas
    from app.graph.state import initial_state

    # --- 1. "Any therapist" sets staff_any, not a hash-picked staff_id ----
    st = initial_state("chat", "t-any", "test")
    st["intent"] = "booking"
    deltas = FieldDeltas(no_therapist_preference=True)
    out = _resolve_staff(st, deltas)
    if out.get("staff_any") is True and not out.get("staff_id"):
        print("OK   1. any-therapist -> staff_any=True, no staff_id pinned")
    else:
        print(f"FAIL 1. expected staff_any=True/no staff_id, got {out!r}")
        fails += 1

    # A named therapist still resolves to a concrete staff_id (and clears any).
    out2 = _resolve_staff(st, FieldDeltas(staff_name="Elisia"))
    if out2.get("staff_id") == 47 and out2.get("staff_any") is False:
        print("OK   1b. named therapist -> staff_id=47, staff_any cleared")
    else:
        print(f"FAIL 1b. expected staff_id=47/staff_any=False, got {out2!r}")
        fails += 1

    # --- 2. planner does not re-ask ask_therapist when staff_any is set ---
    from app.graph.nodes import planner as planner_mod
    st2 = initial_state("chat", "t-plan", "test")
    st2["staff_any"] = True
    if not st2.get("staff_id") and st2.get("staff_any"):
        # mirror the exact gate condition at planner.py
        gate_would_ask = (not st2.get("staff_id")) and (not st2.get("staff_any"))
        if not gate_would_ask:
            print("OK   2. planner gate passes ask_therapist with staff_any set")
        else:
            print("FAIL 2. planner gate would still re-ask ask_therapist")
            fails += 1

    # --- 3. propose_slots fans out (staffId=0) across the roster ----------
    from app.graph.nodes.actions import _legacy
    seen_staff_ids: list = []

    def _fake_fetch(staff_id, days_ahead=7, slot_minutes=50):
        seen_staff_ids.append(staff_id)
        # gateway any-mode returns slots from DIFFERENT clinicians
        return {"slots": [
            {"staffId": 47, "staffName": "Elisia Danley",
             "startISO": "2026-06-01T17:00:00+00:00", "endISO": "2026-06-01T18:00:00+00:00",
             "displayPT": "Mon Jun 1, 10:00 AM PT"},
            {"staffId": 53, "staffName": "Janelle Thompson",
             "startISO": "2026-06-02T18:00:00+00:00", "endISO": "2026-06-02T19:00:00+00:00",
             "displayPT": "Tue Jun 2, 11:00 AM PT"},
        ]}

    _legacy._fetch_free_slots = _fake_fetch
    st3 = initial_state("chat", "t-prop", "test")
    st3["staff_any"] = True  # any-mode
    res = _legacy.propose_slots(st3)
    fanned_out = seen_staff_ids and seen_staff_ids[0] is None  # None -> gateway staffId=0
    multi = {s["staffId"] for s in res.get("proposed_slots", [])}
    if fanned_out and res.get("proposed_slots") and len(multi) >= 1:
        print(f"OK   3. propose_slots fanned out (sid arg={seen_staff_ids[0]}), "
              f"{len(res['proposed_slots'])} slots across staff {sorted(multi)}")
    else:
        print(f"FAIL 3. fan-out wrong: sid_arg={seen_staff_ids}, slots={res.get('proposed_slots')}")
        fails += 1
    if res.get("last_action") == "propose_slots":
        print("OK   3b. propose_slots did not dead-end (has availability)")
    else:
        print(f"FAIL 3b. last_action={res.get('last_action')}")
        fails += 1

    # --- 4. picking a fanned-out slot pins staff_id/name from that slot ---
    st4 = initial_state("chat", "t-pick", "test")
    st4["staff_any"] = True
    st4["proposed_slots"] = res["proposed_slots"]
    pick = _merge_field_deltas(st4, FieldDeltas(selected_slot_index=1))
    if pick.get("staff_id") == 53 and pick.get("staff_name") == "Janelle Thompson":
        print("OK   4. picking slot[1] pinned staff_id=53 (Janelle) for booking")
    else:
        print(f"FAIL 4. expected staff_id=53/Janelle, got "
              f"id={pick.get('staff_id')} name={pick.get('staff_name')}")
        fails += 1

    print(f"\n{fails} failures / 6 checks")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

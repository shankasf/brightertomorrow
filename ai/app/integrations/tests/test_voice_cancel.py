"""Hermetic test for the VOICE cancel/reschedule tools (voice_tools.py).

The voice agent is speech-to-speech, but the tool *logic* is plain Python we
can exercise via text: this drives `_lookup_appointment_impl` and
`_cancel_appointment_impl` with a faked gateway, asserting the response mapping
(found -> friendly fields, verification_failed / past / not_found, cancel ok/err)
matches what the prompt tells the model to expect.

Heavy deps (the `agents` SDK, `core.db`, `aws_signer`) are stubbed so this runs
without the realtime SDK or a network. Run:
    PYTHONPATH=. ./.venv/bin/python app/integrations/tests/test_voice_cancel.py
"""
from __future__ import annotations

import sys
import types


def _stubs() -> None:
    # openai-agents SDK: @function_tool becomes a no-op passthrough so the
    # decorated tools stay plain callables.
    sys.modules.setdefault(
        "agents", types.SimpleNamespace(function_tool=lambda f: f)
    )
    # DB + AWS transport are imported at module load; stub them out.
    sys.modules.setdefault("app.core.db", types.SimpleNamespace(conn=lambda: None))
    # aws_signer.gateway_post is monkeypatched per-test below; provide a stub
    # module so the top-level import resolves.
    sys.modules.setdefault(
        "app.integrations.aws_signer",
        types.SimpleNamespace(
            gateway_post=lambda *a, **k: {},
            signed_post=lambda *a, **k: {},
        ),
    )


_GW: dict[str, object] = {"lookup": {}}


def _fake_gateway_post(path: str, body=None, *a, **k):
    if "lookup_appointment" in path:
        return _GW["lookup"]
    if "/cancel" in path:
        # echo a deterministic ok based on the ids present
        return {"ok": bool(body.get("appointmentId") and body.get("emailHash"))}
    return {}


def _assert(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    _stubs()
    import app.integrations.voice_tools as vt
    vt.gateway_post = _fake_gateway_post  # used by the impls

    # 1) FOUND + dob_match -> friendly fields, therapist name resolved
    _GW["lookup"] = {
        "found": True, "dob_match": True, "appointment_id": "APT-9",
        "email_hash": "EH9", "appointment_time_iso": "2026-07-15T22:00:00Z",
        "therapist_staff_id": 24, "service": "Individual therapy for stress",
    }
    # The agent converts the spoken DOB to YYYYMMDD before calling (per the
    # prompt + the _validate_dob contract shared with book_appointment).
    r = vt._lookup_appointment_impl("702-555-0123", "19980819")
    print("[found]", r)
    _assert(r["found"] is True, "should be found")
    _assert(r["appointment_id"] == "APT-9" and r["email_hash"] == "EH9", "ids missing")
    _assert("PT" in r["when"] and "July" in r["when"], f"bad when: {r['when']}")
    _assert(r["therapist"] == "Keunshea Fleming", f"staff 24 -> {r['therapist']}")
    _assert(r["reason"] == "Individual therapy for stress", "reason missing")

    # 2) ISO/compact DOB both normalize (agent often sends 1998-08-19)
    r2 = vt._lookup_appointment_impl("7025550123", "1998-08-19")
    _assert(r2["found"] is True, "ISO dob should normalize and find")

    # 3) verification_failed -> NO leak
    _GW["lookup"] = {"found": False, "dob_match": False, "reason": "verification_failed"}
    r = vt._lookup_appointment_impl("702-555-0123", "1990-03-03")
    print("[verify_fail]", r)
    _assert(r == {"found": False, "reason": "verification_failed"}, "must not leak details")

    # 4) past_appointment -> when carried, found False
    _GW["lookup"] = {"found": False, "reason": "past_appointment",
                     "appointment_time_iso": "2020-01-01T17:00:00Z"}
    r = vt._lookup_appointment_impl("702-555-0123", "1998-08-19")
    print("[past]", r)
    _assert(r["found"] is False and r["reason"] == "past_appointment", "past mapping")
    _assert("PT" in r["when"], "past should carry friendly when")

    # 5) not_found
    _GW["lookup"] = {"found": False}
    r = vt._lookup_appointment_impl("702-555-0123", "1998-08-19")
    _assert(r == {"found": False, "reason": "not_found"}, f"not_found mapping: {r}")

    # 6) guards: placeholder phone + invalid dob never hit the gateway
    _GW["lookup"] = {"_should_not_be_returned": True}
    r = vt._lookup_appointment_impl("", "1998-08-19")
    _assert(r.get("error") == "need_phone", "empty phone guard")
    r = vt._lookup_appointment_impl("702-555-0123", "not a date")
    _assert(r.get("error") == "invalid_dob", "bad dob guard")

    # 7) cancel happy + missing-ids guard
    r = vt._cancel_appointment_impl("APT-9", "EH9")
    print("[cancel]", r)
    _assert(r["ok"] is True, "cancel should succeed with ids")
    r = vt._cancel_appointment_impl("", "")
    _assert(r["ok"] is False and r["error"] == "missing_ids", "cancel must require ids")

    print("\nALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Raw-WebSocket Twilio ↔ OpenAI Realtime voice bridge (gpt-realtime-2).

This package is a from-scratch rebuild of the phone bridge that previously
lived in ``app/twilio_voice.py`` (which drives the OpenAI Agents SDK
``RealtimeRunner``). The SDK's response lifecycle proved unreliable on
telephony: server-VAD ``create_response`` frequently failed to auto-fire and
the model went "active but silent" for tens of seconds after tool calls.

This bridge talks the OpenAI Realtime WebSocket protocol directly with
EXPLICIT response control, mirroring the turn-taking of the previously-working
``urackit_v2`` agent:

  * server_vad owns NORMAL turns (``create_response: true`` on the session, so
    the model auto-replies when the caller finishes speaking), and
  * we send an explicit ``response.create`` ONLY for the opening greeting and
    after EVERY function-call result. The post-tool ``response.create`` is the
    fix for the "active but silent" stalls.

There are NO app-side nudge / check-back timers — VAD + explicit post-tool
response.create cover every turn.

Modules:
  * ``openai_ws``    — raw ``websockets`` client to the OpenAI Realtime API.
  * ``twilio_bridge`` — Twilio Media Streams ↔ ``openai_ws`` glue. Exposes
    ``run_twilio_session(twilio_ws)`` with the SAME signature ``main.py``
    expects, so it is a drop-in alternative to ``app.twilio_voice``.

Routing is controlled by the ``VOICE_BRIDGE`` env flag in ``main.py``
(``raw_ws`` selects this package; default ``sdk`` keeps the old bridge).
"""
from __future__ import annotations

from .twilio_bridge import run_twilio_session

__all__ = ["run_twilio_session"]

"""Healthcare-style Twilio ↔ OpenAI Realtime voice bridge (``VOICE_BRIDGE=hc``).

A faithful port of the lean, working turn-taking loop from the
``healthcare_prior_auth`` voice service, adapted to Brighter Tomorrow:

  * US-residency endpoint (``wss://us.api.openai.com`` via ``realtime_ws_url``)
    — MANDATORY for HIPAA; the source repo used the global endpoint.
  * BT's triage prompt + @function_tool registry + tool dispatch.
  * BT's chat-turn persistence (gateway) + Twilio REST hangup helpers.

What it deliberately DROPS vs ``voice_rt`` (the things that made BT worse):
  * NO app-side empty-response nudge / re-create timers.
  * NO logprob low-confidence drop + reprompt.
  * NO RMS echo gate.
Turn-taking is owned entirely by server_vad with the healthcare VAD values
(threshold 0.75, silence 700 ms) + ``create_response: true``. The only manual
``response.create`` calls are the greeting and the post-tool continuation
(server_vad does not fire on a function_call_output).

This package is fully self-contained: it imports glue helpers from the existing
voice modules (read-only) but the ``sdk`` and ``raw_ws`` bridges are untouched,
so flipping ``VOICE_BRIDGE`` back rolls this out instantly.
"""

from .bridge import run_twilio_session

__all__ = ["run_twilio_session"]

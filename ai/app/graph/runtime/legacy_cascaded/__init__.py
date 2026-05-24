"""LEGACY — cascaded STT → LangGraph → TTS voice pipeline (Deepgram + Cartesia).

Archived 2026-05-23 when voice moved back to the OpenAI Realtime
speech-to-speech model (gpt-realtime-2) via the OpenAI Agents SDK. Kept for
reference / possible rollback. NOT wired into main.py.

Contents:
  * voice_pipeline.py — VoicePipeline (LiveKit Deepgram STT + Cartesia TTS,
    streaming, barge-in, echo-gate).
  * voice_twilio.py    — Twilio Media Streams bridge over the cascaded pipeline.
  * voice_browser.py   — browser PCM16 WS bridge over the cascaded pipeline.

To revive: re-point main.py /twilio/media + /ws/voice here and re-add the
Deepgram/Cartesia (livekit-plugins) deps. Chat (LangGraph) is unaffected.
"""

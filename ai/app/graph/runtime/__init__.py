"""Runtime adapters that connect the compiled StateGraph to transports.

Three modules:
  * chat            — FastAPI HTTP + SSE endpoint for the web chat widget.
  * voice_pipeline  — Cascaded STT (Deepgram) → LangGraph → TTS (Cartesia)
                      audio pipeline. Reusable from both voice transports.
  * voice_browser   — Browser WebSocket bridge (PCM16 in/out) using the
                      pipeline.
  * voice_twilio    — Twilio Media Streams WebSocket bridge (mulaw in/out)
                      + TwiML POST handler, also using the pipeline.

Each runtime owns ONLY transport glue. None of them know anything about
the conversation graph's internals — they just call ``app.ainvoke(...)``
on the compiled graph with a ``thread_id`` that LangGraph uses for
checkpointing.
"""
from __future__ import annotations

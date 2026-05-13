"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FiMessageCircle, FiX, FiSend, FiVolume2, FiVolumeX, FiMic, FiMicOff } from "react-icons/fi";

type Msg = { role: "user" | "assistant"; content: string };

// Marker the booking agent emits when it asks for insurance — the widget
// strips it out and renders an in-line dropdown of payer names. Mirror of
// `INSURANCE_PICKER_MARKER` in ai/app/bt_agents/booking_agent.py.
const INSURANCE_PICKER_MARKER = "[[INSURANCE_PICKER]]";

// Display names mirror `PAYERS` in ai/app/data/payers.py — the source of
// truth on the backend. The dropdown is ergonomic only; the agent will
// fuzzy-match whatever the visitor sends, so minor drift is non-fatal.
const INSURANCE_OPTIONS: string[] = [
  "UnitedHealthcare",
  "Aetna",
  "Cigna",
  "Humana",
  "Blue Cross Blue Shield",
  "Anthem",
  "Kaiser Permanente",
  "Medicare",
  "Medicaid",
  "Tricare",
  "Molina Healthcare",
  "WellCare",
  "Oscar Health",
  "Health Net",
  "Blue Shield of California",
  "EmblemHealth",
  "Centene",
  "Independence Blue Cross",
  "Ambetter",
  "Meritain Health",
  "Self-pay / Out-of-network",
];

// Cycling capability hints shown next to the closed chat FAB.
const CAPABILITY_PROMPTS = [
  "Book an appointment",
  "Reschedule a session",
  "Find a therapist",
  "Check insurance",
  "Share office hours",
  "Answer your FAQs",
];

// Quick-reply chips shown above the input on first open.
const QUICK_REPLIES: { label: string; prompt: string }[] = [
  { label: "Check insurance coverage", prompt: "Can you check if my insurance is covered?" },
  { label: "Book an appointment", prompt: "I'd like to book an appointment." },
  { label: "Cancel or reschedule", prompt: "I need to cancel or reschedule my appointment." },
  { label: "Find an available therapist", prompt: "Which therapists are available?" },
  { label: "Office hours & location", prompt: "What are your office hours and where are you located?" },
  { label: "Talk to a human", prompt: "Can someone from your team call me back?" },
];

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "assistant", content: "Hi — I'm the Brighter Tomorrow assistant. This chat is HIPAA-compliant and your data is secure. How can I help?" },
  ]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [muted, setMuted] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<"idle" | "connecting" | "active" | "error">("idle");
  const [promptIdx, setPromptIdx] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const initialMount = useRef(true);
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxVoiceRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const playingRef = useRef(false);

  useEffect(() => { scroller.current?.scrollTo({ top: 9e9, behavior: "smooth" }); }, [msgs, open, loading]);

  // Terminate the chat session when the visitor closes the tab / navigates
  // away. The gateway flips chat_sessions.ended_at so the admin UI stops
  // showing the row as "active". sendBeacon is the only fetch variant the
  // browser guarantees to flush during unload; `pagehide` fires on real
  // navigation/tab-close on every modern browser (Safari skips beforeunload).
  // visibilitychange+hidden catches mobile background-switch where pagehide
  // is not always fired.
  useEffect(() => {
    if (!sessionId) return;
    const end = () => {
      try {
        const body = JSON.stringify({ session_id: sessionId });
        if (navigator.sendBeacon) {
          // Blob with explicit type so the request reaches the right route
          // even though sendBeacon defaults to text/plain.
          navigator.sendBeacon(
            "/v1/chat/end",
            new Blob([body], { type: "application/json" }),
          );
        } else {
          // Fallback for very old browsers — fire-and-forget; the keepalive
          // flag lets the request survive the unload.
          void fetch("/v1/chat/end", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
            keepalive: true,
          });
        }
      } catch {
        // Never let a beacon failure interfere with the unload path.
      }
    };
    const onVis = () => { if (document.visibilityState === "hidden") end(); };
    window.addEventListener("pagehide", end);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", end);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [sessionId]);

  // Cycle the capability tooltip every ~2.4s while the chat is closed.
  useEffect(() => {
    if (open) return;
    const t = setInterval(
      () => setPromptIdx((i) => (i + 1) % CAPABILITY_PROMPTS.length),
      2400,
    );
    return () => clearInterval(t);
  }, [open]);

  // Play a soft two-note chime when a new assistant message arrives (skip first render).
  useEffect(() => {
    if (initialMount.current) { initialMount.current = false; return; }
    if (muted) return;
    const last = msgs[msgs.length - 1];
    if (!last || last.role !== "assistant") return;
    void playChime(audioCtxRef);
  }, [msgs, muted]);

  async function send(override?: string) {
    const text = (override ?? input).trim();
    if (!text || loading) return;
    if (override === undefined) setInput("");
    const next: Msg[] = [...msgs, { role: "user", content: text }];
    setMsgs(next);
    setLoading(true);
    const t0 = performance.now();
    let firstTokenMs: number | null = null;
    let assistantText = "";
    let receivedAnyDelta = false;

    try {
      const r = await fetch("/v1/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ session_id: sessionId, message: text }),
      });

      if (!r.ok || !r.body) {
        throw new Error(`stream failed: ${r.status}`);
      }

      const reader = r.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      const upsertAssistant = (content: string) => {
        setMsgs((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant") {
            const copy = prev.slice();
            copy[copy.length - 1] = { role: "assistant", content };
            return copy;
          }
          return [...prev, { role: "assistant", content }];
        });
      };

      const handleEvent = (eventName: string, dataLine: string) => {
        let payload: Record<string, unknown>;
        try { payload = JSON.parse(dataLine); } catch { return; }

        if (eventName === "session" && typeof payload.session_id === "string" && payload.session_id) {
          setSessionId(payload.session_id);
          return;
        }

        if (eventName === "delta" && typeof payload.text === "string") {
          if (firstTokenMs === null) {
            firstTokenMs = performance.now() - t0;
            console.debug("chat_stream: first_token", { ttft_ms: Math.round(firstTokenMs) });
          }
          assistantText += payload.text;
          receivedAnyDelta = true;
          // Hide the typing indicator the moment we have visible content.
          setLoading(false);
          upsertAssistant(assistantText);
          return;
        }

        if (eventName === "done") {
          const totalMs = performance.now() - t0;
          // Prefer server-canonical reply text (covers any normalization on done).
          const finalReply = (typeof payload.reply === "string" && payload.reply) || assistantText;
          if (finalReply && finalReply !== assistantText) {
            assistantText = finalReply;
            upsertAssistant(assistantText);
          }
          console.debug("chat_stream: done", {
            cached: payload.cached === true,
            intent: payload.intent,
            agent: payload.agent,
            ttft_ms: firstTokenMs !== null ? Math.round(firstTokenMs) : null,
            total_ms: Math.round(totalMs),
            chars: typeof payload.chars === "number" ? payload.chars : assistantText.length,
            usage: payload.usage,
          });
          return;
        }

        if (eventName === "error") {
          console.warn("chat_stream: error event", payload);
        }
      };

      const flushBuffer = () => {
        // SSE events are separated by blank lines (\n\n).
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);

          let eventName = "message";
          const dataLines: string[] = [];
          for (const raw of block.split("\n")) {
            if (raw.startsWith("event:")) eventName = raw.slice(6).trim();
            else if (raw.startsWith("data:")) dataLines.push(raw.slice(5).trim());
          }
          if (dataLines.length) handleEvent(eventName, dataLines.join("\n"));
        }
      };

      // Drain the stream.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        flushBuffer();
      }
      buffer += decoder.decode();
      flushBuffer();

      if (!receivedAnyDelta && !assistantText) {
        // Server closed without sending any content.
        setMsgs((prev) => [...prev, { role: "assistant", content: "Sorry — I had trouble responding. For immediate help, please call us at [725-238-6990](tel:725-238-6990) or use our [contact form](/contact). We typically reply within one business day." }]);
      }
    } catch (err) {
      console.warn("chat_stream: failed", err);
      // Replace any partial assistant bubble with a generic failure message,
      // or append a fresh one if nothing arrived.
      setMsgs((prev) => {
        const last = prev[prev.length - 1];
        const fallback: Msg = { role: "assistant", content: "Sorry — I had trouble reaching the server. For immediate help, please call us at [725-238-6990](tel:725-238-6990) or use our [contact form](/contact). We typically reply within one business day." };
        if (last && last.role === "assistant" && !assistantText) {
          const copy = prev.slice();
          copy[copy.length - 1] = fallback;
          return copy;
        }
        return assistantText ? prev : [...prev, fallback];
      });
    } finally {
      setLoading(false);
    }
  }

  function drainAudioQueue(ctx: AudioContext) {
    const buf = audioQueueRef.current.shift();
    if (!buf) {
      playingRef.current = false;
      return;
    }
    playingRef.current = true;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = () => drainAudioQueue(ctx);
    src.start();
  }

  function playAudioDelta(b64: string) {
    const ctx = audioCtxVoiceRef.current;
    if (!ctx) return;
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768.0;
    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);
    audioQueueRef.current.push(buffer);
    if (!playingRef.current) drainAudioQueue(ctx);
  }

  function stopVoice() {
    processorRef.current?.disconnect();
    processorRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    audioCtxVoiceRef.current?.close().catch(() => {});
    audioCtxVoiceRef.current = null;
    audioQueueRef.current = [];
    playingRef.current = false;
    setVoiceActive(false);
    setVoiceStatus("idle");
  }

  async function toggleVoice() {
    if (voiceActive) {
      stopVoice();
      return;
    }
    setVoiceStatus("connecting");
    try {
      // Voice-first: if no chat session yet, mint a UUID client-side. The
      // gateway's /v1/voice handler creates the bt.chat_sessions row on
      // demand (source='voice'), so no fake "Hello" round-trip is needed
      // and the patient UI starts clean.
      let sid = sessionId;
      if (!sid) {
        sid =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setSessionId(sid);
      }

      const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsURL = `${wsProto}//${window.location.host}/v1/voice?session_id=${sid}`;
      const ws = new WebSocket(wsURL);
      wsRef.current = ws;

      ws.onopen = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              sampleRate: 24000,
              channelCount: 1,
              echoCancellation: true,
              noiseSuppression: true,
            },
          });
          const Ctx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const ctx = new Ctx({ sampleRate: 24000 });
          audioCtxVoiceRef.current = ctx;
          const source = ctx.createMediaStreamSource(stream);
          const processor = ctx.createScriptProcessor(4096, 1, 1);
          processor.onaudioprocess = (e) => {
            const float32 = e.inputBuffer.getChannelData(0);
            const int16 = new Int16Array(float32.length);
            for (let i = 0; i < float32.length; i++) {
              int16[i] = Math.max(-32768, Math.min(32767, Math.round(float32[i] * 32767)));
            }
            const bytes = new Uint8Array(int16.buffer);
            let binary = "";
            bytes.forEach((b) => (binary += String.fromCharCode(b)));
            const b64 = btoa(binary);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: b64 }));
            }
          };
          source.connect(processor);
          processor.connect(ctx.destination);
          processorRef.current = processor;
          micStreamRef.current = stream;
          setVoiceActive(true);
          setVoiceStatus("active");
        } catch (err) {
          console.error("Microphone access denied", err);
          setVoiceStatus("error");
          ws.close();
          alert("Microphone access is required for voice mode. Please allow microphone access and try again.");
          stopVoice();
        }
      };

      ws.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          switch (event.type) {
            case "session.created":
            case "session.updated":
              setVoiceStatus("active");
              break;
            case "response.audio.delta":
              if (event.delta) playAudioDelta(event.delta);
              break;
            case "conversation.item.input_audio_transcription.completed":
              if (event.transcript) {
                setMsgs((prev) => [...prev, { role: "user", content: event.transcript }]);
              }
              break;
            case "response.audio_transcript.done":
              if (event.transcript) {
                setMsgs((prev) => [...prev, { role: "assistant", content: event.transcript }]);
              }
              break;
            case "error":
              console.error("Realtime error", event);
              setVoiceStatus("error");
              stopVoice();
              break;
          }
        } catch (err) {
          console.error("Failed to parse voice event", err);
        }
      };

      ws.onerror = (err) => {
        console.error("WebSocket error", err);
        stopVoice();
        setVoiceStatus("idle");
      };

      ws.onclose = () => {
        stopVoice();
        setVoiceStatus("idle");
      };
    } catch (err) {
      console.error("Failed to start voice", err);
      setVoiceStatus("error");
      stopVoice();
    }
  }

  return (
    <>
      {/* Animated capability tooltip — sits left of the FAB while chat is closed */}
      <AnimatePresence>
        {!open && (
          <motion.button
            type="button"
            onClick={() => setOpen(true)}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="hidden sm:flex fixed bottom-[1.85rem] right-[5.5rem] z-50 items-center gap-2 bg-white border border-surface-line rounded-full pl-4 pr-3.5 py-2.5 shadow-card hover:shadow-glow group max-w-[280px]"
            aria-label="Open chat — see what I can help with"
          >
            {/* Pulse dot */}
            <span className="relative inline-flex w-2 h-2 shrink-0">
              <span
                className="absolute inline-flex w-full h-full rounded-full opacity-70 animate-ping"
                style={{ backgroundColor: "#E1B878" }}
              />
              <span
                className="relative inline-flex w-2 h-2 rounded-full"
                style={{ backgroundColor: "#E1B878" }}
              />
            </span>

            <span className="text-[13px] text-ink-soft whitespace-nowrap">
              Ask me to
            </span>

            {/* Cycling word — height locked to prevent layout jump */}
            <span className="relative inline-flex items-center h-[18px] overflow-hidden">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={promptIdx}
                  initial={{ y: 14, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -14, opacity: 0 }}
                  transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  className="text-[13px] font-semibold whitespace-nowrap"
                  style={{ color: "#66202A" }}
                >
                  {CAPABILITY_PROMPTS[promptIdx]}
                </motion.span>
              </AnimatePresence>
            </span>

            {/* Speech-tail pointing at the FAB */}
            <span
              aria-hidden
              className="absolute right-[-6px] top-1/2 -translate-y-1/2 w-3 h-3 rotate-45 bg-white border-t-0 border-l-0 border border-surface-line"
            />
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            onClick={() => setOpen(true)}
            className="fixed bottom-6 right-6 z-50 bg-brand text-white rounded-full w-14 h-14 shadow-glow ring-1 ring-brand-700/30 flex items-center justify-center hover:bg-brand-600 transition-colors"
            aria-label="Open chat"
          >
            <FiMessageCircle size={22} />
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-6 right-6 z-50 w-[380px] max-w-[calc(100vw-2rem)] h-[600px] max-h-[calc(100vh-3rem)] bg-white rounded-2xl shadow-card border border-surface-line flex flex-col overflow-hidden"
          >
            <div className="bg-brand text-white px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-display font-semibold truncate">Brighter Tomorrow</div>
                <div className="text-xs opacity-80 truncate">Quick questions, real answers</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setMuted((m) => !m)}
                  className="opacity-80 hover:opacity-100 transition shrink-0 p-1"
                  aria-label={muted ? "Unmute" : "Mute"}
                  title={muted ? "Sound off" : "Sound on"}
                >
                  {muted ? <FiVolumeX size={18} /> : <FiVolume2 size={18} />}
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="opacity-80 hover:opacity-100 transition shrink-0 p-1"
                  aria-label="Close chat"
                  title="Close chat"
                >
                  <FiX size={18} />
                </button>
              </div>
            </div>

            <div ref={scroller} className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-2 bg-surface min-w-0">
              {msgs.map((m, i) => {
                // Only let the LAST assistant message render an interactive
                // picker — older ones get the marker stripped but no dropdown,
                // so visitors can't re-submit a stale choice.
                const isLast = i === msgs.length - 1;
                return (
                  <Bubble
                    key={i}
                    role={m.role}
                    content={m.content}
                    onPickInsurance={isLast && !loading ? (name) => void send(name) : undefined}
                  />
                );
              })}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-white text-ink rounded-2xl rounded-bl-sm px-3 py-2 text-sm border border-surface-line">
                    <Typing />
                  </div>
                </div>
              )}
            </div>

            {!voiceActive && !msgs.some((m) => m.role === "user") && (
              <div className="border-t border-surface-line px-3 pt-2.5 pb-2 bg-white">
                <div className="text-[11px] uppercase tracking-[0.08em] text-ink-soft mb-1.5 px-0.5">
                  Try asking
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_REPLIES.map((q) => (
                    <button
                      key={q.label}
                      type="button"
                      disabled={loading}
                      onClick={() => void send(q.prompt)}
                      className="px-3 py-1.5 rounded-full border border-brand/30 bg-brand/5 text-brand-700 text-[12.5px] font-medium hover:bg-brand hover:text-white hover:border-brand transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {voiceActive && (
              <div className="border-t border-surface-line px-3 py-2 flex items-center gap-2 bg-brand/5 text-sm text-ink-muted">
                <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse shrink-0" />
                <span>Voice active — speak naturally</span>
              </div>
            )}

            <form
              onSubmit={(e) => { e.preventDefault(); void send(); }}
              className="border-t border-surface-line p-2 bg-white"
            >
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    // Auto-grow up to ~5 lines.
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
                  }}
                  onKeyDown={(e) => {
                    // Enter submits; Shift+Enter inserts a newline.
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  rows={1}
                  placeholder="Type a message…"
                  className="flex-1 min-w-0 px-3 py-2 rounded-2xl bg-surface border border-surface-line text-sm text-ink placeholder:text-ink-soft focus:outline-none focus:border-brand resize-none leading-5 max-h-[140px]"
                />
                <button
                  type="button"
                  onClick={() => void toggleVoice()}
                  title={voiceActive ? "End voice" : "Talk via voice"}
                  aria-label={voiceActive ? "End voice" : "Start voice"}
                  className={`p-2.5 rounded-full transition shrink-0 ${
                    voiceActive
                      ? "bg-red-500 text-white animate-pulse"
                      : voiceStatus === "connecting"
                      ? "bg-brand/30 text-brand animate-pulse"
                      : "bg-surface border border-surface-line text-ink-muted hover:text-brand hover:border-brand"
                  }`}
                >
                  {voiceActive ? <FiMicOff size={16} /> : <FiMic size={16} />}
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-brand hover:bg-brand-600 text-white p-2.5 rounded-full disabled:opacity-50 transition shrink-0"
                  aria-label="Send"
                >
                  <FiSend size={16} />
                </button>
              </div>
              <div className="mt-1 px-3 text-[10.5px] text-ink-soft">
                <kbd className="rounded border border-surface-line bg-surface px-1 font-mono text-[10px]">Enter</kbd> to send · <kbd className="rounded border border-surface-line bg-surface px-1 font-mono text-[10px]">Shift</kbd>
                {" + "}
                <kbd className="rounded border border-surface-line bg-surface px-1 font-mono text-[10px]">Enter</kbd> for new line
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Bubble({
  role,
  content,
  onPickInsurance,
}: {
  role: "user" | "assistant";
  content: string;
  onPickInsurance?: (name: string) => void;
}) {
  const isUser = role === "user";
  const hasPicker = !isUser && content.includes(INSURANCE_PICKER_MARKER);
  const visibleText = hasPicker
    ? content.split(INSURANCE_PICKER_MARKER).join("").replace(/\n{3,}/g, "\n\n").trim()
    : content;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[15px] leading-[1.6] tracking-[-0.005em] break-words [overflow-wrap:anywhere] shadow-sm ${
          isUser
            ? "bg-brand text-white rounded-br-sm font-medium"
            : "bg-white text-ink rounded-bl-sm border border-surface-line"
        }`}
      >
        {isUser ? <span className="whitespace-pre-wrap">{content}</span> : <RichMarkdown text={visibleText} />}
        {hasPicker && onPickInsurance && (
          <InsurancePicker onPick={onPickInsurance} />
        )}
      </div>
    </div>
  );
}

function InsurancePicker({ onPick }: { onPick: (name: string) => void }) {
  return (
    <div className="mt-2.5">
      <label
        htmlFor="bt-insurance-picker"
        className="block text-[11px] uppercase tracking-[0.08em] text-ink-soft mb-1"
      >
        Choose your insurance
      </label>
      <select
        id="bt-insurance-picker"
        defaultValue=""
        onChange={(e) => {
          const v = e.target.value;
          if (v) onPick(v);
        }}
        className="w-full px-3 py-2 rounded-lg border border-surface-line bg-white text-sm text-ink focus:outline-none focus:border-brand"
      >
        <option value="" disabled>
          Select your insurance…
        </option>
        {INSURANCE_OPTIONS.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Tiny markdown-ish renderer — handles **bold**, *italic*, `code`, links, bullet & numbered lists,
 *  headings, paragraphs. Built so very long URLs / words don't blow out the bubble width. */
function RichMarkdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.split("\n");
  let ulBuf: string[] = [];
  let olBuf: string[] = [];

  const flushUl = () => {
    if (!ulBuf.length) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="my-2 space-y-1.5 pl-1">
        {ulBuf.map((li, i) => (
          <li key={i} className="flex gap-2.5">
            <span aria-hidden className="mt-[0.55em] inline-block w-1.5 h-1.5 rounded-full bg-brand-300 shrink-0" />
            <span className="flex-1">{renderInline(li)}</span>
          </li>
        ))}
      </ul>,
    );
    ulBuf = [];
  };

  const flushOl = () => {
    if (!olBuf.length) return;
    blocks.push(
      <ol key={`ol-${blocks.length}`} className="my-2 space-y-1.5">
        {olBuf.map((li, i) => (
          <li key={i} className="flex gap-2.5">
            <span aria-hidden className="font-display font-semibold text-brand-700 tabular shrink-0 min-w-[1.25rem]">
              {i + 1}.
            </span>
            <span className="flex-1">{renderInline(li)}</span>
          </li>
        ))}
      </ol>,
    );
    olBuf = [];
  };

  const flushAll = () => { flushUl(); flushOl(); };

  for (const raw of lines) {
    const line = raw.trim();
    const ul = line.match(/^[-*]\s+(.*)$/);
    const ol = line.match(/^(\d+)[.)]\s+(.*)$/);
    const h = line.match(/^(#{1,3})\s+(.*)$/);

    if (ul) { flushOl(); ulBuf.push(ul[1]); continue; }
    if (ol) { flushUl(); olBuf.push(ol[2]); continue; }
    flushAll();
    if (!line) { blocks.push(<div key={blocks.length} className="h-1.5" />); continue; }
    if (h) {
      const level = h[1].length;
      const cls =
        level === 1 ? "font-display text-[1.05rem] font-semibold text-ink mt-1.5 mb-1"
        : level === 2 ? "font-display text-[1rem] font-semibold text-ink mt-1.5 mb-1"
        : "font-display text-[0.95rem] font-semibold text-ink-soft uppercase tracking-[0.08em] mt-1.5 mb-0.5";
      blocks.push(<div key={blocks.length} className={cls}>{renderInline(h[2])}</div>);
      continue;
    }
    blocks.push(<p key={blocks.length} className="my-1.5 first:mt-0 last:mb-0">{renderInline(line)}</p>);
  }
  flushAll();
  return <>{blocks}</>;
}

function renderInline(s: string): React.ReactNode {
  // Order: code → bold → italic → links. Each pass tokenizes around the prior.
  const codeRe = /`([^`]+)`/g;
  const boldRe = /\*\*([^*]+)\*\*/g;
  const italicRe = /(?<![*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g;

  type Tok = { kind: "text" | "code" | "bold" | "italic"; value: string };
  let toks: Tok[] = [{ kind: "text", value: s }];

  const splitWith = (re: RegExp, kind: Tok["kind"]) => {
    const next: Tok[] = [];
    for (const t of toks) {
      if (t.kind !== "text") { next.push(t); continue; }
      let last = 0;
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(t.value))) {
        if (m.index > last) next.push({ kind: "text", value: t.value.slice(last, m.index) });
        next.push({ kind, value: m[1] });
        last = m.index + m[0].length;
      }
      if (last < t.value.length) next.push({ kind: "text", value: t.value.slice(last) });
    }
    toks = next;
  };

  splitWith(codeRe, "code");
  splitWith(boldRe, "bold");
  splitWith(italicRe, "italic");

  const out: React.ReactNode[] = [];
  toks.forEach((t, i) => {
    if (t.kind === "text") out.push(...linkify(t.value, `t-${i}`));
    else if (t.kind === "bold") out.push(<strong key={`b-${i}`} className="font-semibold text-ink">{t.value}</strong>);
    else if (t.kind === "italic") out.push(<em key={`i-${i}`} className="italic text-ink-soft">{t.value}</em>);
    else if (t.kind === "code") out.push(
      <code key={`c-${i}`} className="px-1.5 py-0.5 rounded-md bg-surface-line/60 text-[0.9em] font-mono text-ink">
        {t.value}
      </code>,
    );
  });
  return out;
}

function linkify(s: string, key: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push(<span key={`${key}-t-${i++}`}>{s.slice(last, m.index)}</span>);
    parts.push(
      <a key={`${key}-a-${i++}`} href={m[1]} target="_blank" rel="noopener noreferrer"
         className="text-brand-700 font-medium underline decoration-brand-300 underline-offset-[3px] decoration-2 hover:decoration-brand transition break-all">
        {m[1]}
      </a>,
    );
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push(<span key={`${key}-t-${i++}`}>{s.slice(last)}</span>);
  return parts;
}

function Typing() {
  return (
    <span className="inline-flex gap-1 items-center">
      <span className="w-1.5 h-1.5 rounded-full bg-ink-muted animate-bounce" style={{ animationDelay: "0ms" }} />
      <span className="w-1.5 h-1.5 rounded-full bg-ink-muted animate-bounce" style={{ animationDelay: "120ms" }} />
      <span className="w-1.5 h-1.5 rounded-full bg-ink-muted animate-bounce" style={{ animationDelay: "240ms" }} />
    </span>
  );
}

/** Soft two-note chime via Web Audio — no asset file needed. */
async function playChime(ref: React.MutableRefObject<AudioContext | null>) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!ref.current) ref.current = new Ctx();
    const ctx = ref.current;
    if (ctx.state === "suspended") await ctx.resume();
    const t0 = ctx.currentTime;
    const tone = (freq: number, start: number, dur: number, gain = 0.06) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0 + start);
      g.gain.exponentialRampToValueAtTime(gain, t0 + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0 + start);
      osc.stop(t0 + start + dur + 0.05);
    };
    // E5 → A5, soft and short
    tone(659.25, 0, 0.35);
    tone(880.0, 0.12, 0.45);
  } catch {
    // Audio is best-effort; ignore failures (autoplay policy, etc.)
  }
}

"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FiMessageCircle, FiX, FiSend, FiVolume2, FiVolumeX, FiMic, FiMicOff } from "react-icons/fi";

type Msg = { role: "user" | "assistant"; content: string };

// Cycling capability hints shown next to the closed chat FAB.
const CAPABILITY_PROMPTS = [
  "Book an appointment",
  "Reschedule a session",
  "Find a therapist",
  "Check insurance",
  "Share office hours",
  "Answer your FAQs",
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

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const next = [...msgs, { role: "user" as const, content: text }];
    setMsgs(next);
    setLoading(true);
    try {
      const r = await fetch("/v1/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, message: text }),
      });
      const data = await r.json();
      if (data.session_id) setSessionId(data.session_id);
      setMsgs([...next, { role: "assistant", content: data.reply ?? "Sorry — I had trouble responding." }]);
    } catch {
      setMsgs([...next, { role: "assistant", content: "Sorry — I had trouble reaching the server." }]);
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
      // Ensure a session exists before opening the WebSocket.
      let sid = sessionId;
      if (!sid) {
        const r = await fetch("/v1/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session_id: null, message: "Hello" }),
        });
        const data = await r.json();
        if (data.session_id) {
          sid = data.session_id as string;
          setSessionId(sid);
          setMsgs((prev) => [
            ...prev,
            { role: "user", content: "Hello" },
            { role: "assistant", content: data.reply ?? "Hi there!" },
          ]);
        } else {
          throw new Error("Could not create session");
        }
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
              {msgs.map((m, i) => <Bubble key={i} role={m.role} content={m.content} />)}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-white text-ink rounded-2xl rounded-bl-sm px-3 py-2 text-sm border border-surface-line">
                    <Typing />
                  </div>
                </div>
              )}
            </div>

            {voiceActive && (
              <div className="border-t border-surface-line px-3 py-2 flex items-center gap-2 bg-brand/5 text-sm text-ink-muted">
                <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse shrink-0" />
                <span>Voice active — speak naturally</span>
              </div>
            )}

            <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="border-t border-surface-line p-2 flex items-center gap-2 bg-white">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type a message…"
                className="flex-1 min-w-0 px-3 py-2 rounded-full bg-surface border border-surface-line text-sm text-ink placeholder:text-ink-soft focus:outline-none focus:border-brand"
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
              <button type="submit" disabled={loading} className="bg-brand hover:bg-brand-600 text-white p-2.5 rounded-full disabled:opacity-50 transition shrink-0" aria-label="Send">
                <FiSend size={16} />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Bubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[15px] leading-[1.6] tracking-[-0.005em] break-words [overflow-wrap:anywhere] shadow-sm ${
          isUser
            ? "bg-brand text-white rounded-br-sm font-medium"
            : "bg-white text-ink rounded-bl-sm border border-surface-line"
        }`}
      >
        {isUser ? <span className="whitespace-pre-wrap">{content}</span> : <RichMarkdown text={content} />}
      </div>
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

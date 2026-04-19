"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FiMessageCircle, FiX, FiSend, FiVolume2, FiVolumeX, FiMic, FiMicOff } from "react-icons/fi";

type Msg = { role: "user" | "assistant"; content: string };

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "assistant", content: "Hi! I'm the Brighter Tomorrow assistant. Ask me about services, locations, or how to get matched with a therapist." },
  ]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [muted, setMuted] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<"idle" | "connecting" | "active" | "error">("idle");
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
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 z-50 bg-brand text-white rounded-full w-14 h-14 shadow-soft flex items-center justify-center"
        aria-label="Open chat"
      >
        {open ? <FiX size={22} /> : <FiMessageCircle size={22} />}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-24 right-6 z-50 w-[380px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[calc(100vh-7rem)] bg-white rounded-2xl shadow-card border border-surface-line flex flex-col overflow-hidden"
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
                className="flex-1 min-w-0 px-3 py-2 rounded-full bg-surface border border-surface-line text-sm focus:outline-none focus:border-brand"
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
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed break-words [overflow-wrap:anywhere] ${
          isUser
            ? "bg-brand text-white rounded-br-sm"
            : "bg-white text-ink rounded-bl-sm border border-surface-line"
        }`}
      >
        {isUser ? <span className="whitespace-pre-wrap">{content}</span> : <RichMarkdown text={content} />}
      </div>
    </div>
  );
}

/** Tiny markdown-ish renderer — handles **bold**, links, lists, paragraphs.
 *  Built so very long URLs / words don't blow out the bubble width. */
function RichMarkdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.split("\n");
  let listBuf: string[] = [];

  const flushList = () => {
    if (!listBuf.length) return;
    blocks.push(
      <ul key={blocks.length} className="list-disc pl-5 space-y-1 my-1">
        {listBuf.map((li, i) => <li key={i}>{renderInline(li)}</li>)}
      </ul>,
    );
    listBuf = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    const m = line.match(/^[-*]\s+(.*)$/);
    if (m) { listBuf.push(m[1]); continue; }
    flushList();
    if (!line) { blocks.push(<div key={blocks.length} className="h-2" />); continue; }
    blocks.push(<p key={blocks.length} className="my-1">{renderInline(line)}</p>);
  }
  flushList();
  return <>{blocks}</>;
}

function renderInline(s: string): React.ReactNode {
  // Split on bold then on URLs.
  const out: React.ReactNode[] = [];
  const boldRe = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = boldRe.exec(s))) {
    if (m.index > last) out.push(...linkify(s.slice(last, m.index), `b-${last}`));
    out.push(<strong key={`s-${m.index}`}>{m[1]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(...linkify(s.slice(last), `t-${last}`));
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
         className="text-brand underline underline-offset-2 break-all">
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

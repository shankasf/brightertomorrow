"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FiMessageCircle, FiX, FiSend, FiVolume2, FiVolumeX, FiPhone, FiPhoneOff, FiRefreshCw } from "react-icons/fi";

type Msg = { role: "user" | "assistant"; content: string };

// Marker the booking agent emits when it asks for insurance — the widget
// strips it out and renders an in-line dropdown of payer names. Mirror of
// the `[[INSURANCE_PICKER]]` constant in ai/app/graph/prompts/scenes.py.
const INSURANCE_PICKER_MARKER = "[[INSURANCE_PICKER]]";

// Mirror of the `[[THERAPIST_PICKER]]` marker in the ask_therapist scene
// (ai/app/graph/prompts/scenes.py). Same widget pattern as insurance —
// the LLM puts the marker on its own line, we strip it from the bubble
// text and render a dropdown of full names.
const THERAPIST_PICKER_MARKER = "[[THERAPIST_PICKER]]";

// Display labels mirror THERAPISTS_WITH_FEEDS in ai/app/data/roster.py.
// "Any therapist" sits at the top — the agent treats it as "no preference,
// pick the soonest slot across the roster".
const THERAPIST_OPTIONS: string[] = [
  "Any therapist",
  "Sagar Shankaran",
  "Elisia Danley",
  "Keunshea Fleming",
  "Alayna Hammond",
  "Janelle Thompson",
  "Samara Cobb",
  "Joanne Tran",
  "Jordan Fuller",
  "Monica Gonzalez",
];

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

// Synthetic message the widget sends to /chat/stream on first open. The
// backend recognises it, swaps in the cached system-greet prompt, and
// streams a varied warm opener back so the user sees the assistant's
// first message generated live (not a hardcoded string).
const GREET_MARKER = "__BT_GREET__";

// --- Session persistence ---------------------------------------------------
// Why localStorage with a hard staleness cap:
//   * Visitor refreshes → same thread_id → LangGraph resumes from DDB,
//     so mid-booking field collection picks up where it left off.
//   * Past the cap, we ignore the saved id and mint a fresh session →
//     defends against shared-device PHI leak.
//   * Voice gets a separate (shorter) cap because spoken audio carries
//     more PHI density per second than typed chat.
const CHAT_SID_KEY = "bt_chat_session";
const VOICE_SID_KEY = "bt_voice_session";
// 5-min window for chat, ROLLING from the last message (each turn refreshes
// the timestamp). Within it, a refresh OR a brand-new tab restores the same
// session — same thread_id → LangGraph resumes from DDB, so the agent keeps
// what it already verified/collected (no re-asking insurance). Past 5 min of
// inactivity everything is flushed (transcript + session) and the next chat
// is a clean fresh greeting. Short window = minimum-necessary PHI lifetime.
const CHAT_SID_MAX_AGE_MS = 5 * 60 * 1000;         // 5min
const VOICE_SID_MAX_AGE_MS = 30 * 60 * 1000;       // 30min

// Transcript cache — the *rendered* messages, kept so the visible chat is
// restored as-is across a refresh or a new tab within the same 5-min window.
//
// HIPAA posture (why these exact choices):
//   * localStorage (shared across tabs) so "come back in a new tab" works —
//     sessionStorage is tab-scoped and would not survive a new tab.
//   * 5-min ROLLING TTL, evicted on read AND flushed by an in-tab idle timer,
//     so PHI's at-rest lifetime is bounded (§164.312(a)(2)(iii) auto-logoff).
//     Residual: if the browser is fully closed before the timer fires, the
//     bytes sit on disk until the next visit evicts them on read.
//   * NOT encrypted: a browser-held key travels with the ciphertext, so it
//     would protect nothing against XSS or the next user on the device — the
//     control that matters is the short rolling TTL + flush, not a cipher.
const CHAT_MSGS_KEY = "bt_chat_msgs";
const CHAT_MSGS_MAX_AGE_MS = 5 * 60 * 1000;        // 5min, must match CHAT_SID

type StoredSession = { id: string; ts: number };

function loadSession(key: string, maxAgeMs: number): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (!parsed || typeof parsed.id !== "string" || typeof parsed.ts !== "number") return null;
    if (Date.now() - parsed.ts > maxAgeMs) {
      window.localStorage.removeItem(key);
      return null;
    }
    return parsed.id;
  } catch {
    return null;
  }
}

function saveSession(key: string, id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify({ id, ts: Date.now() } satisfies StoredSession));
  } catch {
    // localStorage may be unavailable (private mode, quota) — silently skip
    // so the widget still works for the current tab even if resume won't.
  }
}

function clearSession(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

type StoredMsgs = { id: string; ts: number; msgs: Msg[] };

// Load the cached transcript iff it belongs to `sessionId` and is within the
// 5-min TTL. Anything stale or mismatched is evicted and treated as absent.
function loadMsgsCache(sessionId: string): Msg[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CHAT_MSGS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<StoredMsgs>;
    if (!p || p.id !== sessionId || typeof p.ts !== "number" || !Array.isArray(p.msgs)) return null;
    if (Date.now() - p.ts > CHAT_MSGS_MAX_AGE_MS) {
      window.localStorage.removeItem(CHAT_MSGS_KEY);
      return null;
    }
    return p.msgs.filter(
      (m): m is Msg =>
        !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
    );
  } catch {
    return null;
  }
}

function saveMsgsCache(sessionId: string, msgs: Msg[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CHAT_MSGS_KEY,
      JSON.stringify({ id: sessionId, ts: Date.now(), msgs } satisfies StoredMsgs),
    );
  } catch {
    // localStorage unavailable (private mode, quota) — skip; the chat still
    // works for the current tab, it just won't restore after a refresh.
  }
}

function clearMsgsCache(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CHAT_MSGS_KEY);
  } catch {
    // ignore
  }
}

function mintUuid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  // Hydrate sessionId AND the rendered transcript from localStorage on first
  // render so a refresh or a new tab within the 5-min window restores the
  // chat exactly as it was. Entries past the TTL are evicted inside
  // loadSession/loadMsgsCache, so a stale visit starts clean.
  const [sessionId, setSessionId] = useState<string | null>(() =>
    loadSession(CHAT_SID_KEY, CHAT_SID_MAX_AGE_MS),
  );
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    const sid = loadSession(CHAT_SID_KEY, CHAT_SID_MAX_AGE_MS);
    return sid ? (loadMsgsCache(sid) ?? []) : [];
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const greetedRef = useRef(false);
  const [muted, setMuted] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<"idle" | "connecting" | "active" | "error">("idle");
  const [promptIdx, setPromptIdx] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxVoiceRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const playingRef = useRef(false);

  useEffect(() => { scroller.current?.scrollTo({ top: 9e9, behavior: "smooth" }); }, [msgs, open, loading]);

  // Mirror the rendered transcript into the 5-min localStorage cache so a
  // refresh or a new tab restores it as-is. Skip until there's a real user
  // turn — a greeting-only session isn't worth restoring. Each save refreshes
  // BOTH the transcript and the session timestamp, so the 5-min window rolls
  // from the last message and the two expire together.
  useEffect(() => {
    if (!sessionId) return;
    if (!msgs.some((m) => m.role === "user")) return;
    saveMsgsCache(sessionId, msgs);
    saveSession(CHAT_SID_KEY, sessionId);
  }, [msgs, sessionId]);

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

  // Broadcast the panel's open/closed state so other global UI — namely the
  // "Find Your Therapist" popup mounted in layout.tsx — can suppress itself
  // while a conversation is active. Nothing should pop over a live chat. We
  // set a synchronous window flag (for listeners that mount/fire later) AND
  // dispatch an event (for live updates).
  useEffect(() => {
    try {
      (window as unknown as { __btChatOpen?: boolean }).__btChatOpen = open;
      window.dispatchEvent(new CustomEvent("bt:chat", { detail: { open } }));
    } catch {
      /* SSR / no window — ignore */
    }
  }, [open]);

  // First-open behaviour:
  //   * If a transcript was restored from cache (msgs already populated) —
  //     just show it as-is. No greeting, no chooser.
  //   * If a session id survived but the transcript didn't, still do NOT
  //     re-greet: posting GREET_MARKER on an existing thread creates a stray
  //     assistant turn (the 2026-05-21 bug). The visitor types and the agent
  //     resumes from its server-side state.
  //   * Otherwise (fresh visitor / flushed) — stream the agent's greeting.
  useEffect(() => {
    if (!open || greetedRef.current) return;
    greetedRef.current = true;
    if (msgs.length > 0) return;
    if (sessionId) return;
    void send(GREET_MARKER);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Idle auto-flush. Once a real conversation exists, arm a timer for the
  // rolling 5-min window; every new message re-runs this effect and resets
  // it. When it fires (5 min of inactivity) everything is wiped — transcript,
  // session id, and the server-side session — so a refresh or new tab after
  // that starts clean. This is the §164.312(a)(2)(iii) automatic-logoff
  // safeguard, enforced even if the tab is left open and idle.
  useEffect(() => {
    if (!sessionId || !msgs.some((m) => m.role === "user")) return;
    const t = setTimeout(() => {
      clearMsgsCache();
      clearSession(CHAT_SID_KEY);
      clearSession(VOICE_SID_KEY);
      try {
        void fetch("/v1/chat/end", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session_id: sessionId }),
          keepalive: true,
        });
      } catch {
        // best-effort — the TTL eviction on next read is the backstop
      }
      setMsgs([]);
      setSessionId(null);
      greetedRef.current = false;
    }, CHAT_MSGS_MAX_AGE_MS);
    return () => clearTimeout(t);
  }, [msgs, sessionId]);

  // Wipe the current conversation and start a brand-new one. Mirrors the idle
  // auto-flush: end the server-side session, clear the localStorage caches,
  // reset local state, then immediately re-greet on a fresh session. Passing
  // freshSession forces the greet to post with no session id so the server
  // mints a new thread (setSessionId(null) won't be visible in this tick).
  function startFresh() {
    if (loading) return;
    const sid = sessionId;
    clearMsgsCache();
    clearSession(CHAT_SID_KEY);
    clearSession(VOICE_SID_KEY);
    if (sid) {
      try {
        void fetch("/v1/chat/end", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session_id: sid }),
          keepalive: true,
        });
      } catch {
        // best-effort — TTL eviction is the backstop
      }
    }
    setMsgs([]);
    setSessionId(null);
    greetedRef.current = true; // we greet explicitly below; block the open-effect
    void send(GREET_MARKER, { freshSession: true });
  }

  async function send(override?: string, opts?: { freshSession?: boolean }) {
    const text = (override ?? input).trim();
    if (!text || loading) return;
    if (override === undefined) setInput("");
    const sid = opts?.freshSession ? null : sessionId;
    // The greet marker is a synthetic prompt — never render it as a user
    // bubble; the visitor never typed it. Everything else echoes normally.
    const isGreet = text === GREET_MARKER;
    if (!isGreet) {
      setMsgs((prev) => [...prev, { role: "user", content: text }]);
    }
    setLoading(true);
    const t0 = performance.now();
    let firstTokenMs: number | null = null;
    let assistantText = "";
    let receivedAnyDelta = false;

    try {
      const r = await fetch("/v1/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ session_id: sid, message: text }),
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
          // Persist so a refresh resumes (within 24h staleness cap).
          saveSession(CHAT_SID_KEY, payload.session_id);
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
      if (!muted) void playChime(audioCtxRef);
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
      // Voice gets its own session id with a 30-min staleness cap (stricter
      // than chat's 24h because spoken audio carries more PHI per second).
      // If a non-stale voice id exists in localStorage we reuse it so a
      // refresh / reconnect resumes the prior call's state from DDB.
      let sid = loadSession(VOICE_SID_KEY, VOICE_SID_MAX_AGE_MS) ?? sessionId;
      if (!sid) {
        sid = mintUuid();
        setSessionId(sid);
      }
      saveSession(VOICE_SID_KEY, sid);
      // Also seed the chat key so a later text turn picks up the same thread.
      saveSession(CHAT_SID_KEY, sid);

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
            className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 sm:bottom-6 sm:right-6 z-50 bg-brand text-white rounded-full w-14 h-14 shadow-glow ring-1 ring-brand-700/30 flex items-center justify-center hover:bg-brand-600 transition-colors"
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
            className="fixed inset-x-0 bottom-0 sm:inset-auto sm:bottom-6 sm:right-6 z-50 w-full sm:w-[380px] sm:max-w-[calc(100vw-2rem)] h-[100dvh] sm:h-[600px] sm:max-h-[calc(100vh-3rem)] bg-white rounded-t-2xl sm:rounded-2xl shadow-card border border-surface-line flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]"
          >
            <div className="relative bg-brand text-white px-4 py-3 flex items-center justify-between gap-3 shrink-0">
              {/* iOS-style grab handle — positioned relative to header so it
                  doesn't drift if the panel's outer height changes. */}
              <span
                aria-hidden
                className="sm:hidden absolute left-1/2 -translate-x-1/2 top-1.5 h-1 w-10 rounded-full bg-white/40"
              />
              <div className="min-w-0">
                <div className="font-display font-semibold truncate">Brighter Tomorrow</div>
                <div className="text-xs opacity-80 truncate">Las Vegas therapy for kids, teens &amp; adults</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={startFresh}
                  disabled={loading}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-white/15 hover:bg-white/25 disabled:opacity-50 disabled:cursor-not-allowed px-3 h-8 text-[13px] font-bold transition"
                  aria-label="Start a fresh conversation"
                  title="Start a fresh conversation"
                >
                  <FiRefreshCw size={14} />
                  Start fresh
                </button>
                <button
                  onClick={() => setMuted((m) => !m)}
                  className="opacity-80 hover:opacity-100 transition shrink-0 grid place-items-center w-11 h-11 -mr-1 rounded-full hover:bg-white/10"
                  aria-label={muted ? "Unmute" : "Mute"}
                  title={muted ? "Sound off" : "Sound on"}
                >
                  {muted ? <FiVolumeX size={18} /> : <FiVolume2 size={18} />}
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="opacity-80 hover:opacity-100 transition shrink-0 grid place-items-center w-11 h-11 -mr-2 rounded-full hover:bg-white/10"
                  aria-label="Close chat"
                  title="Close chat"
                >
                  <FiX size={18} />
                </button>
              </div>
            </div>

            <div ref={scroller} className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 bg-gradient-to-b from-surface to-white min-w-0">
              {msgs.map((m, i) => {
                // Group consecutive same-sender messages: the LAST one in
                // a cluster carries the "tail" corner + (for assistants)
                // the avatar; earlier ones lose those flourishes so the
                // chain reads as one continuous thought.
                const isLast = i === msgs.length - 1;
                const prev = msgs[i - 1];
                const next = msgs[i + 1];
                const isFirstInGroup = !prev || prev.role !== m.role;
                const isLastInGroup = !next || next.role !== m.role;
                return (
                  <Bubble
                    key={i}
                    role={m.role}
                    content={m.content}
                    isFirstInGroup={isFirstInGroup}
                    isLastInGroup={isLastInGroup}
                    isLastOverall={isLast}
                    onPickInsurance={isLast && !loading ? (name) => void send(name) : undefined}
                    onPickTherapist={isLast && !loading ? (name) => void send(name) : undefined}
                  />
                );
              })}
              {loading && (
                <div className="flex items-end gap-2 mt-1">
                  <AssistantAvatar />
                  <div className="bg-white text-ink rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm border border-surface-line shadow-sm">
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
                  title={voiceActive ? "End call" : "Talk to us — start a call"}
                  aria-label={voiceActive ? "End call" : "Start a voice call"}
                  className={`grid place-items-center w-11 h-11 rounded-full transition shrink-0 ${
                    voiceActive
                      ? "bg-red-500 text-white animate-pulse"
                      : voiceStatus === "connecting"
                      ? "bg-brand/30 text-brand animate-pulse"
                      : "bg-surface border border-surface-line text-ink-muted hover:text-brand hover:border-brand"
                  }`}
                >
                  {voiceActive ? <FiPhoneOff size={16} /> : <FiPhone size={16} />}
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="grid place-items-center w-11 h-11 bg-brand hover:bg-brand-600 text-white rounded-full disabled:opacity-50 transition shrink-0"
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
              {/*
                HIPAA-required reasonable safeguard: tell the visitor this
                chat carries PHI and they shouldn't continue on a shared
                device. Paired with the localStorage 24h staleness cap so
                the technical and procedural safeguards reinforce each
                other.
              */}
              <div className="mt-1 px-3 flex items-center justify-between gap-2 text-[10.5px] text-ink-soft">
                <span>🔒 Private &amp; HIPAA-protected.</span>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function AssistantAvatar({ hidden = false }: { hidden?: boolean }) {
  return (
    <div
      aria-hidden
      className={`shrink-0 grid place-items-center w-7 h-7 rounded-full bg-gradient-to-br from-brand to-brand-600 text-white text-[10.5px] font-display font-bold tracking-tight shadow-sm ring-1 ring-brand-700/20 ${
        hidden ? "invisible" : ""
      }`}
    >
      BT
    </div>
  );
}

function Bubble({
  role,
  content,
  isFirstInGroup,
  isLastInGroup,
  isLastOverall,
  onPickInsurance,
  onPickTherapist,
}: {
  role: "user" | "assistant";
  content: string;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  isLastOverall: boolean;
  onPickInsurance?: (name: string) => void;
  onPickTherapist?: (name: string) => void;
}) {
  const isUser = role === "user";
  const hasInsurancePicker = !isUser && content.includes(INSURANCE_PICKER_MARKER);
  const hasTherapistPicker = !isUser && content.includes(THERAPIST_PICKER_MARKER);
  const visibleText = (() => {
    if (isUser) return content;
    let t = content;
    if (hasInsurancePicker) t = t.split(INSURANCE_PICKER_MARKER).join("");
    if (hasTherapistPicker) t = t.split(THERAPIST_PICKER_MARKER).join("");
    return t.replace(/\n{3,}/g, "\n\n").trim();
  })();

  // Asymmetric radii: tight on the "tail" side only for the last bubble in
  // a same-sender cluster, gentle on all other corners so grouped messages
  // read as one flow rather than a wall of identical pills.
  const tail = isUser
    ? isLastInGroup
      ? "rounded-br-md"
      : "rounded-br-2xl"
    : isLastInGroup
    ? "rounded-bl-md"
    : "rounded-bl-2xl";

  // Vertical rhythm: tight inside a cluster, wider between clusters.
  const groupSpacing = isFirstInGroup ? "mt-3 first:mt-0" : "mt-1";

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={`flex items-end gap-2 ${groupSpacing} ${isUser ? "justify-end" : "justify-start"}`}
    >
      {!isUser && (
        // Avatar only on the last bubble in a cluster; earlier ones reserve
        // the same width with an invisible placeholder so bubble edges align.
        isLastInGroup ? <AssistantAvatar /> : <AssistantAvatar hidden />
      )}
      <div
        className={`max-w-[82%] sm:max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[15px] leading-[1.6] tracking-[-0.005em] break-words [overflow-wrap:anywhere] ${tail} ${
          isUser
            ? "bg-gradient-to-br from-brand to-brand-600 text-white font-medium shadow-[0_2px_8px_-2px_rgba(var(--brand-rgb,124,99,182),0.35)]"
            : "bg-white text-ink border border-surface-line shadow-[0_1px_2px_rgba(15,23,42,0.04),0_2px_8px_-4px_rgba(15,23,42,0.06)]"
        }`}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap">{content}</span>
        ) : (
          <RichMarkdown text={visibleText} />
        )}
        {hasInsurancePicker && onPickInsurance && isLastOverall && (
          <InsurancePicker onPick={onPickInsurance} />
        )}
        {hasTherapistPicker && onPickTherapist && isLastOverall && (
          <TherapistPicker onPick={onPickTherapist} />
        )}
      </div>
    </motion.div>
  );
}

function TherapistPicker({ onPick }: { onPick: (name: string) => void }) {
  return (
    <div className="mt-2.5">
      <label
        htmlFor="bt-therapist-picker"
        className="block text-[11px] uppercase tracking-[0.08em] text-ink-soft mb-1"
      >
        Choose your therapist
      </label>
      <select
        id="bt-therapist-picker"
        defaultValue=""
        onChange={(e) => {
          const v = e.target.value;
          if (v) onPick(v);
        }}
        className="w-full px-3 py-2 rounded-lg border border-surface-line bg-white text-sm text-ink focus:outline-none focus:border-brand"
      >
        <option value="" disabled>
          Select a therapist…
        </option>
        {THERAPIST_OPTIONS.map((name, i) => (
          <option key={name} value={name}>
            {name}{i === 0 ? " (soonest available)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

function InsurancePicker({ onPick }: { onPick: (name: string) => void }) {
  return (
    <div className="mt-2.5">
      <p className="mb-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] leading-snug text-amber-900">
        We can verify and accept most major insurances. Please note we are
        unable to accept <strong>Medicaid</strong> plans at this time, but
        self-pay / out-of-network options are available.
      </p>
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
 *  headings, blockquotes, horizontal rules, paragraphs. Built so very long URLs / words don't blow
 *  out the bubble width. */
function RichMarkdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.split("\n");
  let ulBuf: string[] = [];
  let olBuf: string[] = [];
  let bqBuf: string[] = [];

  const flushUl = () => {
    if (!ulBuf.length) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="my-2 space-y-1 pl-0.5">
        {ulBuf.map((li, i) => (
          <li key={i} className="flex gap-2.5 leading-[1.55]">
            <span aria-hidden className="mt-[0.62em] inline-block w-1.5 h-1.5 rounded-full bg-gradient-to-br from-brand to-brand-600 shrink-0 ring-2 ring-brand/10" />
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
      <ol key={`ol-${blocks.length}`} className="my-2 space-y-1">
        {olBuf.map((li, i) => (
          <li key={i} className="flex gap-2.5 leading-[1.55]">
            <span aria-hidden className="font-display font-semibold text-brand-700 tabular-nums shrink-0 min-w-[1.35rem] text-right">
              {i + 1}.
            </span>
            <span className="flex-1">{renderInline(li)}</span>
          </li>
        ))}
      </ol>,
    );
    olBuf = [];
  };

  const flushBq = () => {
    if (!bqBuf.length) return;
    blocks.push(
      <blockquote
        key={`bq-${blocks.length}`}
        className="my-2 pl-3 border-l-2 border-brand/40 bg-brand/[0.04] text-ink-soft italic rounded-r-md py-1.5 pr-2"
      >
        {bqBuf.map((li, i) => (
          <div key={i} className="leading-[1.55]">{renderInline(li)}</div>
        ))}
      </blockquote>,
    );
    bqBuf = [];
  };

  const flushAll = () => { flushUl(); flushOl(); flushBq(); };

  for (const raw of lines) {
    const line = raw.trim();
    const ul = line.match(/^[-*]\s+(.*)$/);
    const ol = line.match(/^(\d+)[.)]\s+(.*)$/);
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    const bq = line.match(/^>\s?(.*)$/);
    const hr = /^---+$/.test(line) || /^\*\*\*+$/.test(line);

    if (ul) { flushOl(); flushBq(); ulBuf.push(ul[1]); continue; }
    if (ol) { flushUl(); flushBq(); olBuf.push(ol[2]); continue; }
    if (bq) { flushUl(); flushOl(); bqBuf.push(bq[1]); continue; }
    flushAll();
    if (!line) { blocks.push(<div key={blocks.length} className="h-1.5" />); continue; }
    if (hr) {
      blocks.push(<hr key={blocks.length} className="my-2.5 border-0 h-px bg-gradient-to-r from-transparent via-surface-line to-transparent" />);
      continue;
    }
    if (h) {
      const level = h[1].length;
      const cls =
        level === 1 ? "font-display text-[1.1rem] font-semibold text-ink mt-2 mb-1 leading-tight"
        : level === 2 ? "font-display text-[1.02rem] font-semibold text-ink mt-2 mb-1 leading-tight"
        : "font-display text-[0.78rem] font-semibold text-brand-700 uppercase tracking-[0.1em] mt-2 mb-1";
      blocks.push(<div key={blocks.length} className={cls}>{renderInline(h[2])}</div>);
      continue;
    }
    blocks.push(<p key={blocks.length} className="my-1.5 first:mt-0 last:mb-0">{renderInline(line)}</p>);
  }
  flushAll();
  return <>{blocks}</>;
}

function renderInline(s: string): React.ReactNode {
  // Order: code → bold → italic → md-link → autolinks. Each pass tokenizes around the prior.
  const codeRe = /`([^`]+)`/g;
  const boldRe = /\*\*([^*]+)\*\*/g;
  const italicRe = /(?<![*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g;
  const mdLinkRe = /\[([^\]]+)\]\(([^)]+)\)/g;

  type Tok = { kind: "text" | "code" | "bold" | "italic" | "mdlink"; value: string; href?: string };
  let toks: Tok[] = [{ kind: "text", value: s }];

  const splitWith = (re: RegExp, kind: Exclude<Tok["kind"], "mdlink">) => {
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

  const splitMdLinks = () => {
    const next: Tok[] = [];
    for (const t of toks) {
      if (t.kind !== "text") { next.push(t); continue; }
      let last = 0;
      mdLinkRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = mdLinkRe.exec(t.value))) {
        if (m.index > last) next.push({ kind: "text", value: t.value.slice(last, m.index) });
        next.push({ kind: "mdlink", value: m[1], href: m[2] });
        last = m.index + m[0].length;
      }
      if (last < t.value.length) next.push({ kind: "text", value: t.value.slice(last) });
    }
    toks = next;
  };

  splitWith(codeRe, "code");
  splitWith(boldRe, "bold");
  splitWith(italicRe, "italic");
  splitMdLinks();

  const out: React.ReactNode[] = [];
  toks.forEach((t, i) => {
    if (t.kind === "text") out.push(...linkify(t.value, `t-${i}`));
    else if (t.kind === "bold") out.push(<strong key={`b-${i}`} className="font-semibold text-ink">{t.value}</strong>);
    else if (t.kind === "italic") out.push(<em key={`i-${i}`} className="italic text-ink-soft">{t.value}</em>);
    else if (t.kind === "code") out.push(
      <code key={`c-${i}`} className="px-1.5 py-[1px] rounded-md bg-brand/[0.08] text-[0.88em] font-mono text-brand-700 ring-1 ring-brand/15">
        {t.value}
      </code>,
    );
    else if (t.kind === "mdlink") {
      const href = t.href || "#";
      const isExternal = /^https?:/i.test(href);
      out.push(
        <a
          key={`md-${i}`}
          href={href}
          target={isExternal ? "_blank" : undefined}
          rel={isExternal ? "noopener noreferrer" : undefined}
          className="text-brand-700 font-medium underline decoration-brand-300 underline-offset-[3px] decoration-2 hover:decoration-brand transition"
        >
          {t.value}
        </a>,
      );
    }
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

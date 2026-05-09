"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { currentSession } from "@/lib/auth";
import { apiGet } from "@/lib/api";

type ChatTurn = { SK: string; role: string; text: string; session_id: string };
type PatientData = { chat: ChatTurn[] };
type Session = {
  patient_id: string;
  last_message_at: string;
  first_message_at: string;
  turn_count: number;
  preview: string;
};

function fmtTs(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function ChatPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [listError, setListError] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [chatError, setChatError] = useState("");
  const [chatBusy, setChatBusy] = useState(false);

  useEffect(() => {
    currentSession().then((s) => {
      if (!s) {
        router.replace("/login");
        return;
      }
      apiGet<{ sessions: Session[] }>("/chats")
        .then((r) => setSessions(r.sessions || []))
        .catch((err: unknown) =>
          setListError(err instanceof Error ? err.message : "Failed to load sessions")
        );
    });
  }, [router]);

  async function open(patientId: string) {
    setSelected(patientId);
    setChat([]);
    setChatError("");
    setChatBusy(true);
    try {
      const res = await apiGet<PatientData>(`/patients/${encodeURIComponent(patientId)}`);
      const turns = [...(res.chat || [])].sort((a, b) => (a.SK || "").localeCompare(b.SK || ""));
      setChat(turns);
    } catch (err: unknown) {
      setChatError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setChatBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/" className="text-sm text-stone-500 hover:text-brand-700">
        ← Back to dashboard
      </Link>
      <h1 className="mt-4 font-display text-3xl font-semibold text-stone-900">Chat transcripts</h1>
      <p className="mt-1 text-sm text-stone-500">
        Sessions are ordered by most recent activity. Click a row to view its full transcript.
      </p>

      {listError && (
        <div className="mt-6 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {listError}
        </div>
      )}

      <section className="mt-6 overflow-hidden rounded-xl border border-stone-200 bg-white">
        {sessions === null && !listError && (
          <div className="p-6 text-sm text-stone-500">Loading sessions…</div>
        )}
        {sessions !== null && sessions.length === 0 && (
          <div className="p-6 text-sm text-stone-500">No chat sessions yet.</div>
        )}
        {sessions !== null && sessions.length > 0 && (
          <ul className="divide-y divide-stone-100">
            {sessions.map((s) => {
              const isActive = selected === s.patient_id;
              return (
                <li key={s.patient_id}>
                  <button
                    type="button"
                    onClick={() => open(s.patient_id)}
                    className={`flex w-full items-start justify-between gap-4 px-4 py-3 text-left transition ${
                      isActive ? "bg-brand-50" : "hover:bg-stone-50"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[11px] text-stone-500">{s.patient_id}</div>
                      <div className="mt-1 truncate text-sm text-stone-800">
                        {s.preview || <span className="italic text-stone-400">no user message</span>}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-[11px] text-stone-500">
                      <div>{fmtTs(s.last_message_at)}</div>
                      <div className="mt-0.5">{s.turn_count} turns</div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {selected && (
        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold text-stone-900">Transcript</h2>
            <code className="text-[11px] text-stone-500">{selected}</code>
          </div>

          {chatBusy && <div className="mt-4 text-sm text-stone-500">Loading transcript…</div>}
          {chatError && (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              {chatError}
            </div>
          )}
          {!chatBusy && !chatError && chat.length === 0 && (
            <div className="mt-4 text-sm text-stone-500">No turns in this session.</div>
          )}

          <div className="mt-4 space-y-2">
            {chat.map((turn, idx) => (
              <div
                key={idx}
                className={`rounded-xl border px-4 py-3 ${
                  turn.role === "assistant"
                    ? "border-brand-200 bg-brand-50/50"
                    : "border-stone-200 bg-white"
                }`}
              >
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-stone-500">
                  {turn.role} · {turn.SK?.replace("CHAT#", "")}
                </div>
                <div className="whitespace-pre-wrap text-sm text-stone-800">{turn.text}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

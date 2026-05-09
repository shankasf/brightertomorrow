"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { currentSession } from "@/lib/auth";
import { apiGet } from "@/lib/api";

type PatientData = {
  profile: Record<string, unknown>;
  insurance: Record<string, unknown>[];
  appointments: Record<string, unknown>[];
  chat: Record<string, unknown>[];
};

export default function PatientsPage() {
  const router = useRouter();
  const [patientId, setPatientId] = useState("");
  const [data, setData] = useState<PatientData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    currentSession().then((s) => {
      if (!s) router.replace("/login");
    });
  }, [router]);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setData(null);
    setBusy(true);
    try {
      const res = await apiGet<PatientData>(`/patients/${encodeURIComponent(patientId)}`);
      setData(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/" className="text-sm text-stone-500 hover:text-brand-700">← Back to dashboard</Link>
      <h1 className="mt-4 font-display text-3xl font-semibold text-stone-900">Patients</h1>

      <form onSubmit={lookup} className="mt-6 flex gap-3">
        <input
          value={patientId}
          onChange={(e) => setPatientId(e.target.value)}
          placeholder="Patient ID"
          className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <button
          type="submit"
          disabled={busy || !patientId}
          className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
        >
          {busy ? "Looking up…" : "Look up"}
        </button>
      </form>

      {error && (
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {data && (
        <div className="mt-8 space-y-6">
          <Section title="Profile">
            <Pre value={data.profile} />
          </Section>
          <Section title={`Insurance checks (${data.insurance.length})`}>
            {data.insurance.map((i, idx) => <Pre key={idx} value={i} />)}
          </Section>
          <Section title={`Appointments (${data.appointments.length})`}>
            {data.appointments.map((a, idx) => <Pre key={idx} value={a} />)}
          </Section>
          <Section title={`Chat turns (${data.chat.length})`}>
            {data.chat.slice(-20).map((c, idx) => <Pre key={idx} value={c} />)}
          </Section>
        </div>
      )}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-600">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Pre({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-stone-50 p-3 text-xs text-stone-700">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

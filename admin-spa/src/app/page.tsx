"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { currentSession, logout } from "@/lib/auth";
import { apiGet } from "@/lib/api";

type Metrics = {
  calls: number;
  approved: number;
  denied: number;
  appointments: number;
  approval_rate: number;
};

export default function Dashboard() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    currentSession().then((s) => {
      if (!s) {
        router.replace("/login");
        return;
      }
      setEmail(s.getIdToken().payload.email as string);
      apiGet<Metrics>("/dashboard/metrics").then(setMetrics).catch((e) => setError(String(e)));
    });
  }, [router]);

  if (!email) {
    return <div className="p-8 text-sm text-stone-500">Loading…</div>;
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold text-stone-900">BT Admin</h1>
          <p className="mt-1 text-sm text-stone-500">Signed in as {email}</p>
        </div>
        <button
          onClick={() => {
            logout();
            router.replace("/login");
          }}
          className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm hover:bg-stone-50"
        >
          Sign out
        </button>
      </header>

      {error && (
        <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {error}
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Calls (this month)" value={metrics?.calls ?? "—"} />
        <Stat
          label="Approval rate"
          value={metrics ? `${Math.round(metrics.approval_rate * 100)}%` : "—"}
        />
        <Stat label="Approved" value={metrics?.approved ?? "—"} />
        <Stat label="Appointments" value={metrics?.appointments ?? "—"} />
      </section>

      <nav className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card href="/patients/" title="Patients" sub="Lookup by ID" />
        <Card href="/insurance/" title="Insurance" sub="Run eligibility check" />
        <Card href="/chat/" title="Chat transcripts" sub="Browse by patient" />
      </nav>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-2 font-display text-3xl tabular-nums text-stone-900">{value}</div>
    </div>
  );
}

function Card({ href, title, sub }: { href: string; title: string; sub: string }) {
  return (
    <Link
      href={href}
      className="group block rounded-2xl border border-stone-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md"
    >
      <div className="text-lg font-semibold text-stone-900 group-hover:text-brand-700">{title}</div>
      <div className="mt-1 text-sm text-stone-500">{sub}</div>
    </Link>
  );
}

"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { currentSession, currentSession as _cs } from "@/lib/auth";
import { CONFIG } from "@/lib/config";

type Result = { status: string; copay?: string; plan?: string };

/**
 * This page calls /internal/insurance/verify — which requires AWS SigV4,
 * not Cognito. Browsers can't easily do SigV4, so this form is intended for
 * testing. The "real" flow is: voice agent → bt-ai → SigV4 → API Gateway.
 * Keep this form gated behind Cognito login as usage gate; the Lambda itself
 * is separately IAM-auth-protected.
 */
export default function InsurancePage() {
  const router = useRouter();
  const [form, setForm] = useState({
    patient_id: "",
    first_name: "",
    last_name: "",
    dob: "",
    payer_id: "",
    member_id: "",
  });
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    currentSession().then((s) => {
      if (!s) router.replace("/login");
    });
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setResult(null);
    setBusy(true);
    try {
      // The voice agent path hits /internal/insurance/verify with SigV4. For
      // the admin UI we'd add a /insurance/verify route authorized via Cognito
      // JWT in a follow-up — for now, show a friendly message.
      setError(
        "Not available from browser: /internal/insurance/verify requires SigV4 (IAM) auth. Use the voice agent or add a Cognito-authorized /insurance/verify route."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/" className="text-sm text-stone-500 hover:text-brand-700">← Back to dashboard</Link>
      <h1 className="mt-4 font-display text-3xl font-semibold text-stone-900">Insurance eligibility</h1>
      <p className="mt-1 text-sm text-stone-500">{CONFIG.apiUrl}</p>

      <form onSubmit={submit} className="mt-6 grid grid-cols-2 gap-4">
        {Object.entries(form).map(([k, v]) => (
          <label key={k} className="col-span-2 sm:col-span-1">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-600">
              {k.replace("_", " ")}
            </span>
            <input
              value={v}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"
              required
            />
          </label>
        ))}
        <button
          type="submit"
          disabled={busy}
          className="col-span-2 mt-2 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
        >
          {busy ? "Checking…" : "Check eligibility"}
        </button>
      </form>

      {error && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {error}
        </div>
      )}
      {result && (
        <pre className="mt-6 overflow-x-auto rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </main>
  );
}

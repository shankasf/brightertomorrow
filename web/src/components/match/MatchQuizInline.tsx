"use client";

import { useMemo, useRef, useState } from "react";
import { buildFlow, postMatchTherapists, summarizeAnswers } from "./api";
import { useMatchOptions } from "./useMatchOptions";
import ClinicianCard from "./ClinicianCard";
import type { MatchAnswers, MatchResult } from "./types";

/**
 * Compact, text-chat-only version of the match quiz rendered inline when the
 * agent emits the [[MATCH_QUIZ]] marker. Per "dropdowns are text-chat only" it
 * uses <select>s (never the big option cards). Drives off the SAME
 * useMatchOptions hook + buildFlow as /get-scheduled (DRY). On submit it calls
 * POST /v1/match/therapists with channel="chat", shows result cards (Book →
 * /get-scheduled), and posts a short recap back into the thread once.
 */
export default function MatchQuizInline({
  onSummary,
}: {
  /** Posts a short recap back into the chat thread (fired once). */
  onSummary?: (text: string) => void;
}) {
  const { config } = useMatchOptions();
  const [answers, setAnswers] = useState<MatchAnswers>({});
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const summarizedRef = useRef(false);

  const flow = useMemo(() => buildFlow(config, answers), [config, answers]);

  // Required answers: every visible question must have a value before we match.
  const ready = flow.every((q) => !!answers[q.id as keyof MatchAnswers]);

  const setAnswer = (qid: string, value: string) => {
    setAnswers((prev) => {
      const next = { ...prev, [qid]: value };
      if (qid === "modality" && value !== "in-person") delete next.location;
      return next;
    });
  };

  const submit = async () => {
    if (!ready || loading) return;
    setLoading(true);
    setError(false);
    try {
      const res = await postMatchTherapists({ channel: "chat", answers });
      setResults(res.results);
      if (!summarizedRef.current) {
        summarizedRef.current = true;
        const recap = summarizeAnswers(config, answers);
        const count = res.result_count;
        onSummary?.(
          count > 0
            ? `Here are my preferences — ${recap}. (${count} match${count === 1 ? "" : "es"} found.)`
            : `Here are my preferences — ${recap}. (No exact matches yet.)`,
        );
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  // ── Results view ──────────────────────────────────────────────────────────
  if (results) {
    return (
      <div className="mt-2.5 space-y-2">
        {results.length === 0 ? (
          <p className="text-[13px] text-ink-soft">
            No exact matches yet — try adjusting your answers, or{" "}
            <a href="/get-scheduled" className="font-semibold text-brand-700 underline">
              browse all therapists
            </a>
            .
          </p>
        ) : (
          <>
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
              {results.length} match{results.length === 1 ? "" : "es"}
            </p>
            {results.map((c) => (
              <ClinicianCard
                key={c.slug}
                clinician={c}
                compact
                bookHref="/get-scheduled"
                bookLabel="Book"
              />
            ))}
          </>
        )}
      </div>
    );
  }

  // ── Quiz form (dropdowns) ───────────────────────────────────────────────
  return (
    <div className="mt-2.5 space-y-2.5">
      {flow.map((q) => (
        <div key={q.id}>
          <label
            htmlFor={`bt-match-${q.id}`}
            className="block text-[11px] uppercase tracking-[0.08em] text-ink-soft mb-1"
          >
            {q.question}
          </label>
          <select
            id={`bt-match-${q.id}`}
            value={answers[q.id as keyof MatchAnswers] ?? ""}
            onChange={(e) => setAnswer(q.id, e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-surface-line bg-white text-sm text-ink focus:outline-none focus:border-brand"
          >
            <option value="" disabled>
              Select…
            </option>
            {q.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      ))}

      {error && (
        <p className="text-[12px] text-rose-600">
          Couldn&rsquo;t load matches just now — please try again.
        </p>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={!ready || loading}
        className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Finding matches…" : "Find my matches"}
      </button>
    </div>
  );
}

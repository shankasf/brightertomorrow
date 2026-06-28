"use client";

import Image from "next/image";
import Link from "next/link";
import { FiArrowRight, FiCheck } from "react-icons/fi";
import { prettyLocation } from "./api";
import type { MatchResult } from "./types";

const WINE = "#66202A";

function locationSummary(c: MatchResult): string {
  const inPerson = c.locations.map(prettyLocation);
  const bits = [...inPerson];
  if (c.telehealth) bits.push("Telehealth");
  return bits.join(" · ") || "Telehealth";
}

/**
 * Matched-clinician card. Used on /get-scheduled (with an onBook handler that
 * advances to the insurance step) AND inside the chat widget (with a bookHref
 * link to /get-scheduled). Same component, two booking affordances.
 */
export default function ClinicianCard({
  clinician,
  onBook,
  bookHref,
  bookLabel,
  compact = false,
}: {
  clinician: MatchResult;
  onBook?: () => void;
  bookHref?: string;
  bookLabel?: string;
  compact?: boolean;
}) {
  const tags = clinician.specialties.slice(0, 3);
  const label = bookLabel ?? `Book with ${clinician.name.split(" ")[0]}`;

  return (
    <div
      className={`bg-white border border-surface-line shadow-card flex gap-3.5 ${
        compact ? "p-3" : "p-4 sm:p-5"
      } flex-col sm:flex-row sm:items-start`}
      style={{ borderRadius: "16px 0 16px 16px" }}
    >
      {/* Avatar */}
      {clinician.photo_url ? (
        <Image
          src={clinician.photo_url}
          alt={clinician.name}
          width={56}
          height={56}
          className="h-12 w-12 sm:h-14 sm:w-14 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span
          className="grid h-12 w-12 sm:h-14 sm:w-14 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
          style={{ backgroundColor: WINE }}
          aria-hidden
        >
          {clinician.initials}
        </span>
      )}

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="text-[15px] sm:text-base font-semibold text-ink">{clinician.name}</div>
        <div className="text-[12.5px] sm:text-[13px] text-ink-soft mt-0.5">
          {clinician.credentials} · {locationSummary(clinician)}
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: "#F5EBDD", color: WINE }}
            >
              {t}
            </span>
          ))}
          {clinician.in_network && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: "#fdf3dc", color: "#8a6010" }}
            >
              <FiCheck size={11} /> In-network
            </span>
          )}
        </div>

        {clinician.rate && (
          <div className="mt-1.5 text-[12.5px] sm:text-[13px] text-ink-soft">{clinician.rate}</div>
        )}
        {clinician.match_reason && (
          <div className="mt-1 text-[12px] text-ink-soft italic">{clinician.match_reason}</div>
        )}
      </div>

      {/* Booking affordance */}
      <div className="shrink-0 sm:self-center">
        {onBook ? (
          <button
            type="button"
            onClick={onBook}
            className="inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold text-white transition hover:opacity-90"
            style={{ backgroundColor: WINE }}
          >
            {label} <FiArrowRight size={14} />
          </button>
        ) : bookHref ? (
          <Link
            href={bookHref}
            className="inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold text-white transition hover:opacity-90"
            style={{ backgroundColor: WINE }}
          >
            {label} <FiArrowRight size={14} />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

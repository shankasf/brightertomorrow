"use client";

import { useMemo, useState } from "react";
import Reveal from "@/components/Reveal";
import { FiChevronDown, FiX, FiSearch, FiArrowUpRight } from "react-icons/fi";
import type { TeamGroup, TeamMember } from "@/lib/queries";

type Filters = {
  who: string;
  where: string;
  how: string;
  what: string;
  degree: string;
};

const EMPTY: Filters = { who: "", where: "", how: "", what: "", degree: "" };

const SPECIALTIES = [
  "Anxiety",
  "Depression",
  "Trauma",
  "Couples",
  "Child",
  "Teen",
  "Family",
  "Grief",
  "LGBTQIA+",
  "Life Transitions",
  "Geriatric",
  "Relationship",
];

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

function splitCreds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,/]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="group block">
      <span className="block eyebrow-bare text-brand-700 text-[10px] mb-2">
        {label}
      </span>
      <span className="relative block">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="peer appearance-none w-full rounded-full border border-surface-line bg-cream px-5 py-3 pr-10 text-sm text-ink font-medium hover:border-brand-300 focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none transition"
        >
          <option value="">All</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <FiChevronDown
          aria-hidden
          className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-ink-soft peer-focus:text-brand transition"
          size={15}
        />
      </span>
    </label>
  );
}

export default function TeamFilter({
  groups,
  members,
}: {
  groups: TeamGroup[];
  members: TeamMember[];
}) {
  const [filters, setFilters] = useState<Filters>(EMPTY);

  const options = useMemo(() => {
    const roles = uniq(members.map((m) => m.role).filter(Boolean) as string[]).sort();
    const wheres = groups.map((g) => g.title);
    const hows = ["Telehealth", "In-person"];
    const degrees = uniq(members.flatMap((m) => splitCreds(m.credentials))).sort();
    return { roles, wheres, hows, whats: SPECIALTIES, degrees };
  }, [groups, members]);

  const isDirty = Object.values(filters).some(Boolean);

  const filtered = useMemo(() => {
    return members.filter((m) => {
      if (filters.who && m.role !== filters.who) return false;
      if (filters.where) {
        const g = groups.find((x) => x.id === m.group_id);
        if (!g || g.title !== filters.where) return false;
      }
      if (filters.how) {
        const g = groups.find((x) => x.id === m.group_id);
        const isTele = g?.slug === "telehealth";
        if (filters.how === "Telehealth" && !isTele) return false;
        if (filters.how === "In-person" && isTele) return false;
      }
      if (filters.what) {
        const hay = `${m.bio ?? ""} ${m.role ?? ""}`.toLowerCase();
        if (!hay.includes(filters.what.toLowerCase())) return false;
      }
      if (filters.degree) {
        const creds = splitCreds(m.credentials).map((c) => c.toLowerCase());
        if (!creds.includes(filters.degree.toLowerCase())) return false;
      }
      return true;
    });
  }, [members, groups, filters]);

  const total = filtered.length;

  return (
    <>
      {/* Filter bar — sits directly under the site header (no big hero above) */}
      <section className="bg-white border-b border-surface-line">
        <div className="container-x pt-6 pb-8 sm:pt-8 sm:pb-10">
          <Reveal>
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
              <div>
                <span className="eyebrow">Our Team</span>
                <h1 className="mt-2 font-display text-3xl sm:text-4xl text-ink leading-tight">
                  Find your <span className="italic-accent">therapist.</span>
                </h1>
              </div>
              <div className="flex items-center gap-2 text-xs text-ink-soft">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-sage-400 opacity-60 animate-ping" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-sage-500" />
                </span>
                <span>
                  <span className="font-semibold text-ink tabular">{total}</span>{" "}
                  {total === 1 ? "therapist" : "therapists"}
                  {isDirty ? " match" : " in collective"}
                </span>
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.05}>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 items-end">
              <FilterSelect
                label="Who"
                value={filters.who}
                onChange={(v) => setFilters((f) => ({ ...f, who: v }))}
                options={options.roles}
              />
              <FilterSelect
                label="Where"
                value={filters.where}
                onChange={(v) => setFilters((f) => ({ ...f, where: v }))}
                options={options.wheres}
              />
              <FilterSelect
                label="How"
                value={filters.how}
                onChange={(v) => setFilters((f) => ({ ...f, how: v }))}
                options={options.hows}
              />
              <FilterSelect
                label="Focus"
                value={filters.what}
                onChange={(v) => setFilters((f) => ({ ...f, what: v }))}
                options={options.whats}
              />
              <FilterSelect
                label="Degree"
                value={filters.degree}
                onChange={(v) => setFilters((f) => ({ ...f, degree: v }))}
                options={options.degrees}
              />
              <button
                type="button"
                onClick={() => setFilters(EMPTY)}
                disabled={!isDirty}
                className={`col-span-2 md:col-span-3 lg:col-span-1 inline-flex items-center justify-center gap-2 rounded-full px-5 h-[46px] font-semibold text-sm transition ${
                  isDirty
                    ? "bg-brand text-white hover:bg-brand-600"
                    : "bg-cream text-ink-soft border border-surface-line cursor-not-allowed"
                }`}
              >
                {isDirty ? <><FiX size={14} /> Clear</> : "Clear"}
              </button>
            </div>

            {isDirty && (
              <div className="mt-5 flex flex-wrap items-center gap-2">
                {Object.entries(filters)
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <span
                      key={k}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cream-deep text-brand-700 border border-sage-200 text-xs font-medium"
                    >
                      <span className="text-brand-700/60 capitalize">{k}:</span> {v}
                      <button
                        type="button"
                        aria-label={`Clear ${k}`}
                        className="hover:text-brand transition"
                        onClick={() =>
                          setFilters((f) => ({ ...f, [k]: "" } as Filters))
                        }
                      >
                        <FiX size={12} />
                      </button>
                    </span>
                  ))}
              </div>
            )}
          </Reveal>
        </div>
      </section>

      {/* Results — single mixed grid, no per-office group sections */}
      {total === 0 ? (
        <section className="section bg-cream">
          <div className="container-x text-center">
            <div className="mx-auto max-w-md rounded-4xl bg-white border border-surface-line p-10 shadow-soft">
              <div className="mx-auto w-12 h-12 grid place-items-center rounded-full bg-sage-100 text-sage-700">
                <FiSearch size={20} />
              </div>
              <h3 className="mt-5 font-display text-2xl text-ink">
                No therapists match those filters
              </h3>
              <p className="mt-3 text-sm text-ink-muted leading-relaxed">
                Try loosening a filter — or clear them to see the full team.
              </p>
              <button
                type="button"
                onClick={() => setFilters(EMPTY)}
                className="btn-primary mt-6"
              >
                <FiX size={14} /> Clear filters
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="bg-white pt-10 pb-20 sm:pt-12 sm:pb-24">
          <div className="container-x">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
              {filtered.map((m, i) => {
                const office = groups.find((g) => g.id === m.group_id)?.title;
                return (
                  <Reveal key={m.id} delay={Math.min(i, 8) * 0.03}>
                    <article className="group h-full flex flex-col">
                      {m.photo_url && (
                        <div className="overflow-hidden rounded-3xl border border-surface-line aspect-[4/5]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={m.photo_url}
                            alt={m.full_name}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                          />
                        </div>
                      )}
                      <div className="pt-6 flex-1 flex flex-col">
                        <h3 className="font-display text-2xl text-ink break-words leading-tight">
                          {m.full_name}
                          {m.credentials ? (
                            <span className="text-ink-soft font-normal text-lg">
                              , {m.credentials}
                            </span>
                          ) : null}
                        </h3>
                        {m.role && (
                          <div className="eyebrow-bare text-ink-muted text-[11px] mt-2">
                            {m.role}
                          </div>
                        )}
                        {office && (
                          <div className="text-[11px] text-brand-700 font-semibold uppercase tracking-[0.14em] mt-1">
                            {office}
                          </div>
                        )}
                        {m.bio && (
                          <p className="text-sm text-ink-muted mt-4 flex-1 leading-relaxed line-clamp-4">
                            {m.bio}
                          </p>
                        )}
                        <div className="mt-5 flex flex-wrap gap-2">
                          {splitCreds(m.credentials).slice(0, 3).map((c) => (
                            <span
                              key={c}
                              className="inline-flex items-center px-3 py-1 rounded-full bg-cream-deep text-brand-700 text-[11px] font-medium uppercase tracking-[0.14em]"
                            >
                              {c}
                            </span>
                          ))}
                        </div>
                        <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand-700">
                          Read profile
                          <FiArrowUpRight className="transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-0.5" />
                        </span>
                      </div>
                    </article>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>
      )}
    </>
  );
}

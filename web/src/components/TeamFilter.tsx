"use client";

import { useMemo, useState } from "react";
import Reveal from "@/components/Reveal";
import { FiChevronDown, FiFilter, FiX, FiSearch } from "react-icons/fi";
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
      <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-700/80 mb-1.5">
        {label}
      </span>
      <span className="relative block">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="peer appearance-none w-full rounded-xl border border-surface-line bg-white/80 backdrop-blur px-4 py-3 pr-10 text-sm text-ink font-medium shadow-[0_1px_0_rgba(255,255,255,0.8)_inset] hover:border-brand-300 focus:border-brand focus:ring-4 focus:ring-brand/15 focus:outline-none transition"
        >
          <option value="">All Items</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <FiChevronDown
          aria-hidden
          className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-soft peer-focus:text-brand transition"
          size={16}
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
      {/* Filter bar on top */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-brand-50/60 via-white to-white" />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.5] pointer-events-none"
          style={{
            background:
              "radial-gradient(45% 60% at 10% 0%, rgba(185,135,82,0.12), transparent 60%), radial-gradient(40% 55% at 95% 20%, rgba(102,32,42,0.08), transparent 60%)",
          }}
        />
        <div className="container-x relative py-10 sm:py-12">
          <Reveal>
            <div className="text-center max-w-3xl mx-auto">
              <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/80 ring-1 ring-brand/15 text-brand text-xs font-semibold uppercase tracking-[0.18em] shadow-sm">
                <FiSearch size={13} /> Find your therapist
              </span>
              <h2 className="mt-4 font-display text-2xl sm:text-3xl md:text-[2.1rem] font-bold text-ink leading-tight">
                Utilize the Filters Below to Refine Your Search Results
              </h2>
              <p className="mt-3 text-ink-muted text-sm sm:text-base">
                Narrow by role, office, modality, focus area, or credentials — we'll match you to the right fit.
              </p>
            </div>
          </Reveal>

          <Reveal delay={0.05}>
            <div className="mt-8 relative">
              {/* Glow */}
              <div
                aria-hidden
                className="absolute -inset-x-6 -inset-y-4 bg-gradient-to-r from-brand/10 via-brand-300/10 to-brand/10 blur-2xl rounded-[2.5rem] pointer-events-none"
              />
              <div className="relative rounded-[1.75rem] bg-white/90 backdrop-blur-md ring-1 ring-surface-line shadow-[0_20px_60px_-20px_rgba(59,36,25,0.18)] p-4 sm:p-5 lg:p-6">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 items-end">
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
                    label="What"
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
                  <div className="col-span-2 md:col-span-3 lg:col-span-1">
                    <button
                      type="button"
                      onClick={() => setFilters(EMPTY)}
                      disabled={!isDirty}
                      className={`w-full inline-flex items-center justify-center gap-2 rounded-xl px-5 h-[46px] font-semibold text-sm transition shadow-soft ${
                        isDirty
                          ? "bg-gradient-to-br from-brand to-brand-700 text-white hover:-translate-y-0.5 hover:shadow-lg"
                          : "bg-gradient-to-br from-brand to-brand-600 text-white opacity-80 cursor-not-allowed"
                      }`}
                    >
                      {isDirty ? (
                        <>
                          <FiX size={15} /> Clear
                        </>
                      ) : (
                        <>
                          <FiFilter size={14} /> Filter
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Status row */}
                <div className="mt-4 pt-4 border-t border-surface-line/70 flex flex-wrap items-center justify-between gap-3 text-xs text-ink-soft">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                    </span>
                    <span>
                      Showing <span className="font-semibold text-ink">{total}</span>{" "}
                      {total === 1 ? "therapist" : "therapists"}
                      {isDirty ? " matching your filters" : " — all team"}
                    </span>
                  </div>
                  {isDirty && (
                    <div className="flex flex-wrap items-center gap-2">
                      {Object.entries(filters)
                        .filter(([, v]) => v)
                        .map(([k, v]) => (
                          <span
                            key={k}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-50 text-brand-700 ring-1 ring-brand/15 font-medium"
                          >
                            <span className="text-brand-700/60 capitalize">{k}:</span> {v}
                            <button
                              type="button"
                              aria-label={`Clear ${k}`}
                              className="ml-0.5 hover:text-brand transition"
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
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Results */}
      {total === 0 ? (
        <section className="section !py-16">
          <div className="container-x text-center">
            <div className="mx-auto max-w-md rounded-2xl bg-white border border-surface-line p-8 shadow-soft">
              <div className="mx-auto w-12 h-12 grid place-items-center rounded-full bg-brand-50 text-brand">
                <FiSearch size={20} />
              </div>
              <h3 className="mt-4 font-display text-xl font-semibold text-ink">
                No therapists match those filters
              </h3>
              <p className="mt-2 text-sm text-ink-muted">
                Try loosening a filter — or clear them to see the full team.
              </p>
              <button
                type="button"
                onClick={() => setFilters(EMPTY)}
                className="mt-5 inline-flex items-center gap-2 bg-brand hover:bg-brand-600 text-white font-semibold px-5 py-2.5 rounded-full transition"
              >
                <FiX size={14} /> Clear filters
              </button>
            </div>
          </div>
        </section>
      ) : (
        groups
          .map((g) => ({ g, list: filtered.filter((m) => m.group_id === g.id) }))
          .filter(({ list }) => list.length > 0)
          .map(({ g, list }) => (
            <section key={g.id} className="section !py-10 sm:!py-14 lg:!py-20">
              <div className="container-x">
                <Reveal>
                  <div className="mb-6 sm:mb-8">
                    <h2 className="font-display text-2xl sm:text-3xl font-bold text-ink">
                      {g.title}
                    </h2>
                    {g.description && (
                      <p className="text-ink-muted mt-2">{g.description}</p>
                    )}
                  </div>
                </Reveal>
                <div className="grid sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 lg:gap-6">
                  {list.map((m, i) => (
                    <Reveal key={m.id} delay={i * 0.04}>
                      <div className="bg-white rounded-2xl border border-surface-line overflow-hidden hover:shadow-card transition group">
                        {m.photo_url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={m.photo_url}
                            alt={m.full_name}
                            className="w-full aspect-[4/3] object-cover group-hover:scale-105 transition-transform duration-500"
                          />
                        )}
                        <div className="p-5">
                          <h3 className="font-display text-lg font-semibold text-ink break-words">
                            {m.full_name}
                            {m.credentials ? `, ${m.credentials}` : ""}
                          </h3>
                          <div className="text-sm text-brand">{m.role}</div>
                          <p className="text-sm text-ink-muted mt-2">{m.bio}</p>
                        </div>
                      </div>
                    </Reveal>
                  ))}
                </div>
              </div>
            </section>
          ))
      )}
    </>
  );
}

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import Reveal from "@/components/Reveal";
import { FiChevronDown, FiX, FiSearch, FiMapPin, FiArrowRight } from "react-icons/fi";
import type { TeamGroup, TeamMember } from "@/lib/queries";
import { therapistSlug } from "@/lib/slug";

type Filters = {
  name: string;
  where: string;
  how: string;
  what: string;
  degree: string;
};

const EMPTY: Filters = { name: "", where: "", how: "", what: "", degree: "" };

const FILTER_LABEL: Record<keyof Filters, string> = {
  name: "Name",
  where: "Office",
  how: "Modality",
  what: "Focus",
  degree: "Degree",
};

// Slug → display label mapping for office_locations values.
const OFFICE_SLUG_LABEL: Record<string, string> = {
  telehealth: "Telehealth",
  "n-durango": "N Durango",
  "e-russell": "E Russell",
};

function slugToLabel(slug: string): string {
  return OFFICE_SLUG_LABEL[slug] ?? slug;
}

// Canonical display order for the Office filter — physical locations only.
// Telehealth is universal across the roster, so it lives under the Modality
// filter (and on the cards), not here where it would no longer narrow results.
const OFFICE_ORDER = ["E Russell", "N Durango"];

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
  groups: _groups,
  members,
}: {
  groups: TeamGroup[];
  members: TeamMember[];
}) {
  const [filters, setFilters] = useState<Filters>(EMPTY);

  const options = useMemo(() => {
    // Office options: physical locations only (telehealth excluded — it's a
    // modality, covered by the Modality filter). Sorted by canonical order,
    // then alpha for any unlisted slugs.
    const physicalLabels = uniq(
      members.flatMap((m) =>
        (m.office_locations ?? [])
          .filter((s) => s !== "telehealth")
          .map(slugToLabel),
      ),
    );
    const wheres = [
      ...OFFICE_ORDER.filter((l) => physicalLabels.includes(l)),
      ...physicalLabels.filter((l) => !OFFICE_ORDER.includes(l)),
    ];

    const hasTele = members.some((m) =>
      (m.office_locations ?? []).includes("telehealth"),
    );
    const hasInPerson = members.some((m) =>
      (m.office_locations ?? []).some((s) => s !== "telehealth"),
    );
    const hows = [
      ...(hasTele ? ["Telehealth"] : []),
      ...(hasInPerson ? ["In-person"] : []),
    ];

    // Specialty options: union of all specialties across members, sorted alpha.
    const whats = uniq(
      members.flatMap((m) => m.specialties ?? []),
    ).sort();

    const degrees = uniq(members.flatMap((m) => splitCreds(m.credentials))).sort();
    return { wheres, hows, whats, degrees };
  }, [members]);

  const isDirty = Object.values(filters).some(Boolean);

  const filtered = useMemo(() => {
    return members.filter((m) => {
      if (filters.name.trim()) {
        if (
          !m.full_name.toLowerCase().includes(filters.name.trim().toLowerCase())
        )
          return false;
      }
      const slugs = m.office_locations ?? [];
      if (filters.where) {
        // OR-match: include if ANY location label matches the selected filter.
        if (!slugs.some((s) => slugToLabel(s) === filters.where)) return false;
      }
      if (filters.how) {
        const isTele = slugs.includes("telehealth");
        const isInPerson = slugs.some((s) => s !== "telehealth");
        if (filters.how === "Telehealth" && !isTele) return false;
        if (filters.how === "In-person" && !isInPerson) return false;
      }
      if (filters.what) {
        if (!(m.specialties ?? []).includes(filters.what)) return false;
      }
      if (filters.degree) {
        const creds = splitCreds(m.credentials).map((c) => c.toLowerCase());
        if (!creds.includes(filters.degree.toLowerCase())) return false;
      }
      return true;
    });
  }, [members, filters]);

  const total = filtered.length;

  return (
    <>
      {/* Filter bar */}
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

          <Reveal delay={0.04}>
            <div className="relative mb-5">
              <FiSearch
                aria-hidden
                className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-ink-soft"
                size={18}
              />
              <input
                type="text"
                list="team-name-list"
                value={filters.name}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="Search by name — e.g. Joanne Tran"
                autoComplete="off"
                aria-label="Search therapists by name"
                className="w-full h-14 rounded-full bg-white border border-surface-line shadow-soft pl-14 pr-14 text-[15px] text-ink font-medium placeholder:text-ink-soft hover:border-brand-300 focus:border-brand focus:ring-4 focus:ring-brand/10 focus:outline-none transition"
              />
              {filters.name && (
                <button
                  type="button"
                  aria-label="Clear name search"
                  onClick={() => setFilters((f) => ({ ...f, name: "" }))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 grid place-items-center w-11 h-11 rounded-full text-ink-soft hover:text-brand hover:bg-cream-deep transition"
                >
                  <FiX size={15} />
                </button>
              )}
              <datalist id="team-name-list">
                {members.map((m) => (
                  <option key={m.id} value={m.full_name} />
                ))}
              </datalist>
            </div>
          </Reveal>

          <Reveal delay={0.05}>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 items-end">
              <FilterSelect
                label="Office"
                value={filters.where}
                onChange={(v) => setFilters((f) => ({ ...f, where: v }))}
                options={options.wheres}
              />
              <FilterSelect
                label="Modality"
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
                className={`col-span-2 md:col-span-4 lg:col-span-1 inline-flex items-center justify-center gap-2 rounded-full px-5 h-[46px] font-semibold text-sm transition ${
                  isDirty
                    ? "bg-brand text-white hover:bg-brand-600 shadow-soft"
                    : "bg-cream text-ink-soft border border-surface-line cursor-not-allowed"
                }`}
              >
                {isDirty ? <><FiX size={14} /> Clear all</> : "Clear all"}
              </button>
            </div>

            {isDirty && (
              <div className="mt-5 flex flex-wrap items-center gap-2">
                {(Object.entries(filters) as [keyof Filters, string][])
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <span
                      key={k}
                      className="inline-flex items-center gap-2 pl-3 pr-1 py-1 rounded-full bg-cream-deep text-brand-700 border border-sage-200 text-xs font-medium"
                    >
                      <span className="text-brand-700/60">{FILTER_LABEL[k]}:</span> {v}
                      <button
                        type="button"
                        aria-label={`Clear ${FILTER_LABEL[k]} filter`}
                        className="grid place-items-center w-5 h-5 rounded-full hover:bg-white hover:text-brand transition"
                        onClick={() =>
                          setFilters((f) => ({ ...f, [k]: "" } as Filters))
                        }
                      >
                        <FiX size={11} />
                      </button>
                    </span>
                  ))}
              </div>
            )}
          </Reveal>
        </div>
      </section>

      {/* Results grid */}
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
        <section className="bg-cream-alt pt-10 pb-20 sm:pt-12 sm:pb-24">
          <div className="container-x">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
              {filtered.map((m, i) => {
                const officeLabels = (m.office_locations ?? []).map(slugToLabel);
                const specialties = m.specialties ?? [];
                const price = m.pricing_tier;
                const network = m.network_status;
                const slug = therapistSlug(m.full_name);
                const first = m.full_name.replace(/^Dr\.\s+/i, "").split(/\s+/)[0] ?? m.full_name;
                return (
                  <Reveal key={m.id} delay={Math.min(i, 8) * 0.04}>
                    <Link
                      href={`/team/${slug}`}
                      aria-label={`Learn more about ${m.full_name}`}
                      className="group h-full flex flex-col bg-white border border-surface-line rounded-3xl shadow-soft overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                    >
                      <article className="contents">
                        {m.photo_url && (
                          <div className="relative overflow-hidden aspect-[4/5] bg-cream-deep">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={m.photo_url}
                              alt={m.full_name}
                              loading={i < 6 ? "eager" : "lazy"}
                              className="w-full h-full object-cover object-top group-hover:scale-[1.04] transition-transform duration-[900ms] ease-out"
                            />
                            {/* Location chips — supports hybrid (multiple offices) */}
                            {officeLabels.length > 0 && (
                              <div className="absolute left-3 top-3 right-3 flex flex-wrap gap-1.5">
                                {officeLabels.slice(0, 3).map((o) => (
                                  <span
                                    key={o}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/90 backdrop-blur-sm text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-700 shadow-soft border border-brand-700/10"
                                  >
                                    <FiMapPin aria-hidden size={10} />
                                    {o}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        <div className="p-5 sm:p-6 flex-1 flex flex-col">
                          <h3 className="font-display text-[1.45rem] sm:text-[1.55rem] text-ink leading-[1.15] break-words group-hover:text-brand-700 transition-colors">
                            {m.full_name}
                            {m.credentials && (
                              <span className="text-ink-soft font-medium text-[0.95rem]">
                                , {m.credentials}
                              </span>
                            )}
                          </h3>
                          {m.role && (
                            <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-700">
                              {m.role}
                            </div>
                          )}
                          {m.bio && (
                            <p className="text-[14px] text-ink-muted mt-3 leading-relaxed line-clamp-3">
                              {m.bio}
                            </p>
                          )}

                          {/* Specialty chips */}
                          {specialties.length > 0 && (
                            <div className="mt-4 flex flex-wrap gap-1.5">
                              {specialties.map((s) => (
                                <span
                                  key={s}
                                  className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200 text-[10px] font-semibold uppercase tracking-[0.12em]"
                                >
                                  {s}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Bottom row: pricing (wine) + network (sage) — hidden when empty */}
                          {(price || network) && (
                            <div className="mt-auto pt-5 flex flex-wrap items-center gap-2">
                              {price && (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-brand-700 text-white text-[10.5px] font-semibold tracking-[0.04em]">
                                  {price}
                                </span>
                              )}
                              {network && (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-sage-100 text-sage-700 border border-sage-200 text-[10.5px] font-semibold tracking-[0.04em]">
                                  {network}
                                </span>
                              )}
                            </div>
                          )}

                          {/* Learn more affordance — entire card is clickable; this is the visible CTA */}
                          <div className={`${price || network ? "mt-4" : "mt-auto pt-5"} flex items-center gap-2 text-brand-700 font-semibold text-sm`}>
                            <span>Learn more about {first}</span>
                            <FiArrowRight
                              aria-hidden
                              size={14}
                              className="transition-transform duration-300 group-hover:translate-x-1"
                            />
                          </div>
                        </div>
                      </article>
                    </Link>
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

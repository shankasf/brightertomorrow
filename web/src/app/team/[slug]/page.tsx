import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { FiArrowLeft, FiArrowRight, FiAward, FiBookOpen, FiCheck, FiHeart } from "react-icons/fi";
import Reveal from "@/components/Reveal";
import { getTeamBio } from "@/lib/teamBio";

const JANE_APP_URL = "https://brightertomorrow.janeapp.com/";

// Matches the pattern used by /specialties/[slug]: the root layout fetches
// site_settings/nav from Postgres, which isn't available at build time, so
// we render on demand instead of prerendering.
export const dynamic = "force-dynamic";

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const bio = await getTeamBio(slug);
  if (!bio) return { title: "Therapist — Brighter Tomorrow Therapy" };
  const title = `${bio.full_name}${bio.credentials_suffix ? `, ${bio.credentials_suffix}` : ""} — Brighter Tomorrow Therapy`;
  const description =
    bio.hero_intro ||
    bio.bio_paragraphs?.[0]?.slice(0, 200) ||
    `Meet ${bio.full_name}, ${bio.role ?? "therapist"} at Brighter Tomorrow Therapy.`;
  return { title, description };
}

function firstName(fullName: string): string {
  return fullName.replace(/^Dr\.\s+/i, "").split(/\s+/)[0] ?? fullName;
}

export default async function TherapistBioPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const bio = await getTeamBio(slug);
  if (!bio) notFound();

  const first = firstName(bio.full_name);

  return (
    <article>
      {/* ───── Hero ───── */}
      <section className="bg-cream-alt relative overflow-hidden border-b border-surface-line">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-24 w-[260px] h-[260px] sm:w-[420px] sm:h-[420px] rounded-full opacity-[0.10]"
          style={{ backgroundColor: "#E1B878" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-32 w-[260px] h-[260px] sm:w-[420px] sm:h-[420px] rounded-full opacity-[0.08]"
          style={{ backgroundColor: "#66202A" }}
        />
        <div className="container-x relative py-12 sm:py-16 lg:py-20">
          <Link
            href="/team"
            className="inline-flex items-center gap-2 text-sm text-brand-700 hover:text-brand transition mb-8"
          >
            <FiArrowLeft /> All therapists
          </Link>

          <div className="grid lg:grid-cols-12 gap-10 lg:gap-14 items-center">
            {bio.photo_url && (
              <div className="lg:col-span-5">
                <Reveal>
                  <div className="relative aspect-[4/5] rounded-4xl overflow-hidden shadow-card border border-surface-line bg-cream-deep">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={bio.photo_url}
                      alt={bio.full_name}
                      className="w-full h-full object-cover object-top"
                    />
                  </div>
                </Reveal>
              </div>
            )}

            <div className={bio.photo_url ? "lg:col-span-7" : "lg:col-span-12"}>
              <Reveal delay={0.05}>
                <span className="eyebrow" style={{ color: "#E1B878" }}>Meet your therapist</span>
                {bio.hero_headline && (
                  <h1 className="mt-5 display text-3xl sm:text-4xl lg:text-5xl text-ink leading-[1.08]">
                    <span className="italic-accent" style={{ color: "#66202A" }}>
                      {bio.hero_headline}
                    </span>
                  </h1>
                )}
                <div className="mt-6 font-display text-2xl sm:text-3xl text-ink leading-tight">
                  {bio.full_name}
                  {bio.credentials_suffix && (
                    <span className="text-ink-soft font-medium text-lg">
                      , {bio.credentials_suffix}
                    </span>
                  )}
                </div>
                {bio.role && (
                  <div className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">
                    {bio.role}
                  </div>
                )}
                {bio.hero_intro && (
                  <p className="mt-6 text-ink-muted text-lg leading-relaxed">{bio.hero_intro}</p>
                )}
                <div className="mt-8 flex flex-wrap gap-3">
                  <a
                    href={JANE_APP_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary"
                  >
                    Book an Appointment <FiArrowRight size={14} />
                  </a>
                  <Link href="/team" className="btn-ghost">View all therapists</Link>
                </div>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* ───── About / Bio ───── */}
      {bio.bio_paragraphs.length > 0 && (
        <section className="section bg-white">
          <div className="container-x max-w-4xl">
            <Reveal>
              <span className="eyebrow">About {first}</span>
              <h2 className="mt-4 display text-3xl sm:text-4xl text-ink leading-tight">
                A little about{" "}
                <span className="italic-accent" style={{ color: "#66202A" }}>{first}</span>.
              </h2>
            </Reveal>
            <div className="mt-8 space-y-6">
              {bio.bio_paragraphs.map((p, i) => (
                <Reveal key={i} delay={Math.min(i, 4) * 0.04}>
                  <p className="text-lg leading-[1.85] text-ink-muted">{p}</p>
                </Reveal>
              ))}
            </div>
            <div className="mt-10 flex flex-wrap gap-3">
              <a
                href={JANE_APP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary"
              >
                Book an Appointment <FiArrowRight size={14} />
              </a>
            </div>
          </div>
        </section>
      )}

      {/* ───── Qualifications + Education ───── */}
      {(bio.qualifications.length > 0 || bio.education.length > 0) && (
        <section className="section-tight bg-cream-alt">
          <div className="container-x grid lg:grid-cols-2 gap-8 lg:gap-12">
            {bio.qualifications.length > 0 && (
              <Reveal>
                <div className="rounded-3xl bg-white border border-surface-line p-7 sm:p-9 shadow-soft h-full">
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-full bg-sage-100 text-sage-700 grid place-items-center">
                      <FiAward size={18} />
                    </span>
                    <h3 className="font-display text-2xl text-ink">Credentials &amp; Qualifications</h3>
                  </div>
                  <ul className="mt-6 space-y-3">
                    {bio.qualifications.map((q, i) => (
                      <li key={i} className="flex items-start gap-3 text-ink-muted leading-relaxed">
                        <FiCheck className="mt-1 shrink-0 text-brand-700" size={16} />
                        <span>{q}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            )}
            {bio.education.length > 0 && (
              <Reveal delay={0.05}>
                <div className="rounded-3xl bg-white border border-surface-line p-7 sm:p-9 shadow-soft h-full">
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-full bg-sage-100 text-sage-700 grid place-items-center">
                      <FiBookOpen size={18} />
                    </span>
                    <h3 className="font-display text-2xl text-ink">Education</h3>
                  </div>
                  <ul className="mt-6 space-y-3">
                    {bio.education.map((e, i) => (
                      <li key={i} className="flex items-start gap-3 text-ink-muted leading-relaxed">
                        <FiCheck className="mt-1 shrink-0 text-brand-700" size={16} />
                        <span>{e}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            )}
          </div>
        </section>
      )}

      {/* ───── Approach / Modalities ───── */}
      {bio.modalities.length > 0 && (
        <section className="section bg-white">
          <div className="container-x">
            <Reveal>
              <div className="max-w-3xl">
                <span className="eyebrow">Approach</span>
                {bio.approach_headline && (
                  <h2 className="mt-4 display text-3xl sm:text-4xl text-ink leading-tight">
                    <span className="italic-accent" style={{ color: "#66202A" }}>
                      {bio.approach_headline}
                    </span>
                  </h2>
                )}
                {bio.approach_intro && (
                  <p className="mt-6 text-ink-muted text-lg leading-relaxed">{bio.approach_intro}</p>
                )}
              </div>
            </Reveal>
            <div className="mt-10 grid sm:grid-cols-2 gap-5 lg:gap-6">
              {bio.modalities.map((m, i) => (
                <Reveal key={i} delay={Math.min(i, 6) * 0.04}>
                  <div className="h-full rounded-3xl bg-cream border border-surface-line p-6 sm:p-7 hover:shadow-card transition-shadow">
                    <h3 className="font-display text-xl text-ink leading-tight">{m.name}</h3>
                    {m.description && (
                      <p className="mt-3 text-ink-muted leading-relaxed">{m.description}</p>
                    )}
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ───── Who I Help ───── */}
      {bio.who_i_help.length > 0 && (
        <section className="section-tight bg-cream-alt">
          <div className="container-x max-w-4xl">
            <Reveal>
              <span className="eyebrow">Who I help</span>
              <h2 className="mt-4 display text-3xl sm:text-4xl text-ink leading-tight">
                {bio.who_i_help_headline ?? (
                  <>
                    Who{" "}
                    <span className="italic-accent" style={{ color: "#66202A" }}>{first}</span> helps.
                  </>
                )}
              </h2>
            </Reveal>
            <ul className="mt-8 grid sm:grid-cols-2 gap-x-8 gap-y-3">
              {bio.who_i_help.map((item, i) => (
                <Reveal key={i} delay={Math.min(i, 6) * 0.03}>
                  <li className="flex items-start gap-3 text-ink-muted leading-relaxed">
                    <span className="mt-1 w-6 h-6 rounded-full bg-sage-100 text-sage-700 grid place-items-center shrink-0">
                      <FiHeart size={12} />
                    </span>
                    <span>{item}</span>
                  </li>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ───── Philosophy + Personal interests ───── */}
      {(bio.philosophy_paragraphs.length > 0 || bio.personal_interests) && (
        <section className="section bg-white">
          <div className="container-x max-w-4xl">
            <Reveal>
              <span className="eyebrow">Philosophy</span>
              <h2 className="mt-4 display text-3xl sm:text-4xl text-ink leading-tight">
                In{" "}
                <span className="italic-accent" style={{ color: "#66202A" }}>{first}&rsquo;s</span> own words.
              </h2>
            </Reveal>
            <div className="mt-8 space-y-6">
              {bio.philosophy_paragraphs.map((p, i) => (
                <Reveal key={i} delay={Math.min(i, 4) * 0.04}>
                  <p className="text-lg leading-[1.85] text-ink-muted">{p}</p>
                </Reveal>
              ))}
              {bio.personal_interests && (
                <Reveal delay={0.1}>
                  <p className="text-lg leading-[1.85] text-ink-muted">{bio.personal_interests}</p>
                </Reveal>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ───── Final CTA ───── */}
      <section className="relative overflow-hidden" style={{ backgroundColor: "#66202A" }}>
        <div className="container-x py-16 sm:py-20 text-center">
          <Reveal>
            <h2 className="display text-3xl sm:text-4xl text-white leading-tight">
              {bio.cta_headline ?? `Ready to take the first step?`}
            </h2>
            {bio.cta_subtext && (
              <p className="mt-4 text-white/80 text-lg max-w-2xl mx-auto leading-relaxed">
                {bio.cta_subtext}
              </p>
            )}
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <a
                href={JANE_APP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full bg-white text-brand-700 font-semibold text-sm hover:bg-cream transition shadow-soft"
              >
                Book an Appointment <FiArrowRight size={14} />
              </a>
              <Link
                href="/team"
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full border border-white/30 text-white font-semibold text-sm hover:bg-white/10 transition"
              >
                <FiArrowLeft size={14} /> Meet the full team
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </article>
  );
}

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { FiArrowRight, FiCheck } from "react-icons/fi";
import Reveal from "@/components/Reveal";
import HeroPhotoCarousel from "@/components/HeroPhotoCarousel";
import { getTeamBio } from "@/lib/teamBio";

const JANE_APP_URL = "https://brightertomorrow.janeapp.com/";

// Design tokens lifted from brightertomorrowtherapy.com (Elementor) so these
// individual therapist pages match the .com pages: Karla headings in navy,
// Mukta Vaani body in grey, gold asymmetric buttons, slate closing CTA.
const NAVY = "#192735";
const GREY = "#858585";
const GOLD = "#E1B878";
const MAROON = "#66202A";
const SLATE = "#475560";

// Team data lives in Postgres/JSON (not available at build time) — render on
// demand. Mirrors /specialties/[slug].
export const dynamic = "force-dynamic";

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const bio = await getTeamBio(slug);
  if (!bio) return { title: "Therapist — Brighter Tomorrow Therapy" };
  const title = `${bio.full_name}${bio.credentials_suffix ? `, ${bio.credentials_suffix}` : ""} — Brighter Tomorrow Therapy`;
  const description =
    (bio.hero_intro || "").split("\n\n")[0]?.slice(0, 200) ||
    bio.bio_paragraphs?.[0]?.slice(0, 200) ||
    `Meet ${bio.full_name}, ${bio.role ?? "therapist"} at Brighter Tomorrow Therapy.`;
  return { title, description };
}

// Gold "Book an Appointment" button — matches the .com Elementor button
// (gold fill, navy text, 2px tracking, 20px 0 20px 20px corners).
function GoldButton({ label }: { label: string }) {
  return (
    <a
      href={JANE_APP_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 px-7 py-4 text-[13.5px] font-semibold tracking-[2px] uppercase transition hover:brightness-95"
      style={{ backgroundColor: GOLD, color: NAVY, borderRadius: "20px 0 20px 20px" }}
    >
      {label} <FiArrowRight size={14} />
    </a>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-[30px] sm:text-[38px] lg:text-[45px] font-bold leading-[1.15] tracking-[-1.4px]"
      style={{ color: NAVY }}
    >
      {children}
    </h2>
  );
}

export default async function TherapistBioPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const bio = await getTeamBio(slug);
  if (!bio) notFound();

  const nameLine = `${bio.full_name}${bio.credentials_suffix ? `, ${bio.credentials_suffix}` : ""}`;
  const heroParas = (bio.hero_intro || "").split("\n\n").map((s) => s.trim()).filter(Boolean);
  const heroPhotos = bio.photos && bio.photos.length > 0
    ? bio.photos
    : bio.photo_url
    ? [bio.photo_url]
    : [];

  return (
    <article className="bg-white" style={{ color: GREY }}>
      {/* ───── Hero ───── */}
      <section className="bg-white">
        <div className="container-x py-12 sm:py-16 lg:py-20">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-start">
            {(bio.photo_url || heroPhotos.length > 0) && (
              <Reveal direction="up">
                <div className="relative mx-auto w-full max-w-[420px]">
                  <div
                    aria-hidden
                    className="absolute -bottom-5 -left-5 w-full h-full rounded-[28px]"
                    style={{ backgroundColor: MAROON }}
                  />
                  {heroPhotos.length > 1 ? (
                    <div className="relative">
                      <HeroPhotoCarousel photos={heroPhotos} alt={bio.full_name} />
                    </div>
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={heroPhotos[0] ?? bio.photo_url ?? ""}
                      alt={bio.full_name}
                      className="relative w-full aspect-[4/5] object-cover object-top rounded-[28px] shadow-lg"
                    />
                  )}
                </div>
              </Reveal>
            )}

            <Reveal direction="up" delay={0.08}>
              <div className={bio.photo_url ? "" : "lg:col-span-2 max-w-3xl"}>
                {bio.hero_headline && <SectionHeading>{bio.hero_headline}</SectionHeading>}
                <div className="mt-5 text-2xl font-bold" style={{ color: NAVY }}>
                  {nameLine}
                </div>
                {bio.role && (
                  <div
                    className="mt-1.5 text-xs font-semibold uppercase tracking-[1.5px]"
                    style={{ color: MAROON }}
                  >
                    {bio.role}
                  </div>
                )}
                {heroParas.length > 0 && (
                  <div className="mt-6 space-y-4">
                    {heroParas.map((p, i) => (
                      <p key={i} className="text-[16.5px] leading-[1.6]">{p}</p>
                    ))}
                  </div>
                )}
                <div className="mt-8">
                  <GoldButton label="Book an Appointment with me" />
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ───── About ───── */}
      {(bio.bio_paragraphs.length > 0 || bio.psychology_today_badge) && (
        <section className="bg-white pb-4">
          <div className="container-x max-w-3xl text-center">
            <Reveal><SectionHeading>About {nameLine}</SectionHeading></Reveal>

            {/* Verified by Psychology Today seal (image hosted locally) */}
            {bio.psychology_today_badge && (
              <Reveal delay={0.05}>
                <div className="mt-7 flex justify-center">
                  {bio.psychology_today_url ? (
                    <a
                      href={bio.psychology_today_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${bio.full_name} — verified by Psychology Today`}
                      className="inline-block transition hover:opacity-90"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src="/team/psychology-today-verified.png"
                        alt="Verified by Psychology Today"
                        width={300}
                        height={90}
                        className="h-[58px] w-auto"
                      />
                    </a>
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src="/team/psychology-today-verified.png"
                      alt="Verified by Psychology Today"
                      width={300}
                      height={90}
                      className="h-[58px] w-auto"
                    />
                  )}
                </div>
              </Reveal>
            )}

            <div className="mt-8">
              {bio.bio_paragraphs.map((p, i) => (
                <Reveal key={i} delay={Math.min(i, 4) * 0.04}>
                  {i > 0 && (
                    <div
                      aria-hidden
                      className="mx-auto my-6 h-px w-full"
                      style={{ backgroundColor: "#e6e6e6" }}
                    />
                  )}
                  <p className="text-[16.5px] leading-[1.7]">{p}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ───── Approach (icon-box list) ───── */}
      {bio.modalities.length > 0 && (
        <section className="bg-white py-14 sm:py-16 lg:py-20">
          <div className="container-x max-w-3xl">
            <Reveal>
              <div className="text-center">
                {bio.approach_headline && <SectionHeading>{bio.approach_headline}</SectionHeading>}
                {bio.approach_intro && (
                  <p className="mt-5 text-[16.5px] leading-[1.7] max-w-2xl mx-auto">
                    {bio.approach_intro}
                  </p>
                )}
              </div>
            </Reveal>
            <div className="mt-10 space-y-7">
              {bio.modalities.map((m, i) => (
                <Reveal key={i} delay={Math.min(i, 6) * 0.05}>
                  <div className="flex gap-4 items-start">
                    <span
                      className="mt-0.5 shrink-0 w-9 h-9 rounded-full grid place-items-center"
                      style={{ backgroundColor: MAROON, color: "#fff" }}
                    >
                      <FiCheck size={17} />
                    </span>
                    <div>
                      <h3 className="text-[20px] font-semibold leading-snug" style={{ color: NAVY }}>
                        {m.name}
                      </h3>
                      {m.description && (
                        <p className="mt-1 text-[16.5px] leading-[1.6]">{m.description}</p>
                      )}
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ───── Who They Help ───── */}
      {bio.who_i_help.length > 0 && (
        <section className="bg-white pb-14 sm:pb-16 lg:pb-20">
          <div className="container-x max-w-3xl">
            <Reveal>
              <div className="text-center">
                <SectionHeading>{bio.who_i_help_headline ?? "Who They Help"}</SectionHeading>
              </div>
            </Reveal>
            <ul className="mt-8 space-y-3 max-w-2xl mx-auto">
              {bio.who_i_help.map((item, i) => (
                <Reveal key={i} delay={Math.min(i, 6) * 0.04}>
                  <li className="flex gap-3 text-[16.5px] leading-[1.6]">
                    <span
                      className="mt-[0.55em] w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: MAROON }}
                    />
                    <span>{item}</span>
                  </li>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ───── Philosophy ───── */}
      {bio.philosophy_paragraphs.length > 0 && (
        <section className="bg-white pb-14 sm:pb-16 lg:pb-20">
          <div className="container-x max-w-3xl text-center">
            {bio.philosophy_headline && (
              <Reveal><SectionHeading>{bio.philosophy_headline}</SectionHeading></Reveal>
            )}
            <div className="mt-8 space-y-5">
              {bio.philosophy_paragraphs.map((p, i) => (
                <Reveal key={i} delay={Math.min(i, 4) * 0.04}>
                  <p className="text-[16.5px] leading-[1.7]">{p}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ───── Slate CTA ───── */}
      <section style={{ backgroundColor: SLATE }}>
        <div className="container-x py-16 sm:py-20 text-center">
          <Reveal>
            <p className="script text-lg" style={{ color: GOLD }}>
              Ready to begin your healing journey?
            </p>
            <h2
              className="mt-3 text-[28px] sm:text-[36px] lg:text-[42px] font-bold leading-tight tracking-[-1px]"
              style={{ color: "#F5EDE0" }}
            >
              {bio.cta_headline ?? "Take the first step on the path toward a brighter tomorrow!"}
            </h2>
            {bio.cta_subtext && (
              <p className="mt-4 max-w-2xl mx-auto text-[16.5px] leading-[1.7]" style={{ color: "#E7D9C5" }}>
                {bio.cta_subtext}
              </p>
            )}
            <div className="mt-8 flex justify-center">
              <GoldButton label="Book an Appointment" />
            </div>
          </Reveal>
        </div>
      </section>
    </article>
  );
}

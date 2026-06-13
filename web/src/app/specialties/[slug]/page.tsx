import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Reveal from "@/components/Reveal";
import { pageMetadata } from "@/lib/seo";
import { getSpecialtyBySlug } from "@/lib/queries";
import { FiArrowLeft, FiClock, FiShield, FiStar } from "react-icons/fi";
import MatchTrigger from "./MatchTrigger";

// DB-driven fallback for specialty detail pages. Bespoke hand-built pages
// (e.g. specialties/anxiety-therapy/) take precedence over this dynamic segment.
export const dynamic = "force-dynamic";

const JOTFORM_MATCH_URL = "https://form.jotform.com/253014448330448";

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const sp = await getSpecialtyBySlug(slug);
  // Throw here, not just in the page body: metadata resolves before streaming
  // starts, so this is what makes the response a real HTTP 404 (not a soft 200).
  if (!sp) notFound();
  // sp.title may carry inline HTML (rendered via dangerouslySetInnerHTML) —
  // strip tags & decode the few entities we use for a clean document title.
  const title = sp.title
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .trim();
  return pageMetadata({
    title,
    description:
      sp.short_desc ??
      sp.subheadline ??
      `${title} at Brighter Tomorrow Therapy Collective in Las Vegas, NV. Compassionate, in-person and online care.`,
    path: `/specialties/${slug}`,
    ogImage: sp.image_url ?? undefined,
  });
}

function renderInline(text: string, keyPrefix: string) {
  const parts: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<strong key={`${keyPrefix}-b-${i++}`} className="text-ink font-semibold">{m[1]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

type Block =
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "h4"; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] };

function parseBody(longDesc: string): Block[] {
  const blocks: Block[] = [];
  const chunks = longDesc.split(/\n\n+/).map((c) => c.trim()).filter(Boolean);
  for (const c of chunks) {
    if (c.startsWith("## ")) blocks.push({ kind: "h2", text: c.slice(3).trim() });
    else if (c.startsWith("### ")) blocks.push({ kind: "h3", text: c.slice(4).trim() });
    else if (c.startsWith("#### ")) blocks.push({ kind: "h4", text: c.slice(5).trim() });
    else if (c.split("\n").every((l) => l.trim().startsWith("- "))) {
      blocks.push({
        kind: "ul",
        items: c.split("\n").map((l) => l.trim().replace(/^- /, "")),
      });
    } else {
      blocks.push({ kind: "p", text: c });
    }
  }
  return blocks;
}

export default async function SpecialtyDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sp = await getSpecialtyBySlug(slug);
  if (!sp) notFound();

  const blocks = sp.long_desc ? parseBody(sp.long_desc) : [];

  // Insert inline image right before the SECOND H2 heading (after intro section).
  let inlineImageInjected = false;
  let secondH2Idx = -1;
  let h2Count = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].kind === "h2") {
      h2Count++;
      if (h2Count === 2) { secondH2Idx = i; break; }
    }
  }

  return (
    <article>
      {/* ───── Hero band ───── */}
      <section className="bg-cream-alt relative overflow-hidden border-b border-surface-line">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-24 w-[420px] h-[420px] rounded-full opacity-[0.10]"
          style={{ backgroundColor: "#E1B878" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-32 w-[420px] h-[420px] rounded-full opacity-[0.08]"
          style={{ backgroundColor: "#66202A" }}
        />
        <div className="container-x relative py-16 sm:py-20 lg:py-24">
          <Link
            href="/specialties"
            className="inline-flex items-center gap-2 text-sm text-brand-700 hover:text-brand transition mb-8 py-2 -my-2"
          >
            <FiArrowLeft /> All specialties
          </Link>

          <div className="grid lg:grid-cols-12 gap-10 lg:gap-14 items-center">
            <Reveal direction="up" className={sp.image_url ? "lg:col-span-7" : "lg:col-span-12"}>
              <span className="eyebrow" style={{ color: "#E1B878" }}>Specialty</span>
              <h1
                className="mt-5 display text-4xl sm:text-5xl lg:text-6xl text-ink break-words leading-[1.05]"
                dangerouslySetInnerHTML={{ __html: sp.title }}
              />
              <svg aria-hidden viewBox="0 0 200 8" className="mt-6 w-36 h-2 text-brand">
                <path d="M2 5 Q 50 0 100 4 T 198 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              {sp.subheadline && (
                <p className="mt-6 script text-2xl sm:text-3xl" style={{ color: "#66202A" }}>
                  {sp.subheadline}
                </p>
              )}
              {sp.short_desc && (
                <p className="mt-6 text-ink-muted text-lg leading-relaxed">{sp.short_desc}</p>
              )}
              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href={JOTFORM_MATCH_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary"
                >
                  Find My Therapist
                </a>
                <Link href="/contact" className="btn-ghost">Free Consultation</Link>
              </div>
            </Reveal>

            {sp.image_url && (
              <Reveal direction="right" delay={0.1} className="lg:col-span-5">
                <div className="relative aspect-[5/4] rounded-4xl overflow-hidden shadow-card border border-surface-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sp.image_url} alt={sp.title} className="w-full h-full object-cover" />
                </div>
              </Reveal>
            )}
          </div>
        </div>
      </section>

      {/* ───── Body ───── */}
      <section className="section bg-white">
        <div className="container-x grid lg:grid-cols-12 gap-10 lg:gap-16">
          <Reveal className="lg:col-span-8">
           <div className="space-y-6">
            {blocks.map((b, i) => {
              const node = (() => {
                switch (b.kind) {
                  case "h2":
                    return (
                      <h2 key={i} className="display text-3xl sm:text-4xl text-ink mt-10 first:mt-0 leading-tight">
                        <span className="italic-accent" style={{ color: "#66202A" }}>
                          {renderInline(b.text, `h2-${i}`)}
                        </span>
                      </h2>
                    );
                  case "h3":
                    return (
                      <h3 key={i} className="font-display text-2xl text-ink mt-6">
                        {renderInline(b.text, `h3-${i}`)}
                      </h3>
                    );
                  case "h4":
                    return (
                      <h4 key={i} className="font-display text-lg text-brand-700 mt-4 uppercase tracking-wide">
                        {renderInline(b.text, `h4-${i}`)}
                      </h4>
                    );
                  case "ul":
                    return (
                      <ul key={i} className="space-y-2 list-disc pl-6 text-ink-muted text-lg leading-relaxed marker:text-brand">
                        {b.items.map((it, j) => (
                          <li key={j}>{renderInline(it, `li-${i}-${j}`)}</li>
                        ))}
                      </ul>
                    );
                  default:
                    return (
                      <p key={i} className="text-lg leading-[1.85] text-ink-muted">
                        {renderInline(b.text, `p-${i}`)}
                      </p>
                    );
                }
              })();

              // Inject inline image right before the second H2.
              if (!inlineImageInjected && i === secondH2Idx && sp.inline_image_url) {
                inlineImageInjected = true;
                return (
                  <div key={`wrap-${i}`} className="contents">
                    <figure key={`fig-${i}`} className="my-12">
                      <div className="relative aspect-[16/10] rounded-4xl overflow-hidden shadow-card border border-surface-line">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={sp.inline_image_url}
                          alt={sp.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    </figure>
                    {node}
                  </div>
                );
              }
              return node;
            })}

            {/* If we never hit a second H2, append inline image at the bottom of the body. */}
            {!inlineImageInjected && sp.inline_image_url && (
              <figure className="my-8">
                <div className="relative aspect-[16/10] rounded-4xl overflow-hidden shadow-card border border-surface-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={sp.inline_image_url}
                    alt={sp.title}
                    className="w-full h-full object-cover"
                  />
                </div>
              </figure>
            )}

            <div className="mt-12 pt-8 border-t border-surface-line flex flex-wrap gap-3">
              <a
                href={JOTFORM_MATCH_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary"
              >
                Find My Therapist
              </a>
              <Link href="/team" className="btn-ghost">Meet our therapists</Link>
            </div>
           </div>
          </Reveal>

          <Reveal direction="left" delay={0.08} className="lg:col-span-4">
            <div className="sticky top-24 space-y-4">
              <div className="rounded-3xl bg-cream border border-surface-line p-7">
                <span className="eyebrow">At a glance</span>
                <ul className="mt-6 space-y-5">
                  <li className="flex gap-3">
                    <span className="mt-1 w-9 h-9 rounded-full bg-sage-100 text-sage-700 grid place-items-center shrink-0">
                      <FiStar size={15} />
                    </span>
                    <div>
                      <div className="font-display text-base text-ink">What to expect</div>
                      <div className="text-sm text-ink-muted mt-1 leading-relaxed">
                        A warm, collaborative first session to understand your goals and find the right fit.
                      </div>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-1 w-9 h-9 rounded-full bg-sage-100 text-sage-700 grid place-items-center shrink-0">
                      <FiClock size={15} />
                    </span>
                    <div>
                      <div className="font-display text-base text-ink">How long</div>
                      <div className="text-sm text-ink-muted mt-1 leading-relaxed">
                        Sessions are 50 minutes. Cadence is weekly to biweekly, adjusted to your needs.
                      </div>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-1 w-9 h-9 rounded-full bg-sage-100 text-sage-700 grid place-items-center shrink-0">
                      <FiShield size={15} />
                    </span>
                    <div>
                      <div className="font-display text-base text-ink">Insurance</div>
                      <div className="text-sm text-ink-muted mt-1 leading-relaxed">
                        Most major Nevada insurance accepted. Sliding-scale options available.
                      </div>
                    </div>
                  </li>
                </ul>
              </div>

              <div className="rounded-3xl bg-cream-deep border border-surface-line p-7">
                <h3 className="font-display text-xl text-ink">Not sure where to start?</h3>
                <p className="text-sm text-ink-muted mt-2 leading-relaxed">
                  Tell us a little about you — we&apos;ll match you to the right clinician.
                </p>
                <MatchTrigger />
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </article>
  );
}

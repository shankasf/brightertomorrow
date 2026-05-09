import Link from "next/link";
import Reveal from "./Reveal";
import { FiArrowRight, FiFileText, FiDownload } from "react-icons/fi";
import type { FreeResource } from "@/lib/queries";

export default function FreeResources({ resources }: { resources: FreeResource[] }) {
  if (!resources.length) return null;
  const cols = resources.length >= 3 ? "lg:grid-cols-3" : "md:grid-cols-2";

  return (
    <section className="section bg-white">
      <div className="container-x">
        <Reveal>
          <div className="text-center max-w-2xl mx-auto mb-14">
            <span className="eyebrow center">Free Resources</span>
            <h2 className="display mt-5 text-4xl md:text-5xl text-ink leading-[1.05]">
              Tools to support{" "}
              <span className="italic-accent">your wellbeing.</span>
            </h2>
          </div>
        </Reveal>
        <div className={`grid sm:grid-cols-2 ${cols} gap-6 lg:gap-8 max-w-5xl mx-auto`}>
          {resources.map((r, i) => (
            <Reveal key={r.id} delay={i * 0.05}>
              <article className="group relative h-full bg-cream rounded-3xl border border-surface-line p-8 transition-all duration-300 hover:-translate-y-1 hover:shadow-soft hover:border-brand/40 flex flex-col">
                {r.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.image_url}
                    alt={r.title}
                    className="w-full h-40 object-cover rounded-2xl mb-6"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-brand-50 text-brand-700 grid place-items-center mb-6" aria-hidden>
                    <FiFileText size={20} />
                  </div>
                )}

                <h3 className="font-display text-xl md:text-2xl font-medium text-ink leading-snug">
                  {r.title}
                </h3>

                {r.description && (
                  <p className="text-sm text-ink-muted mt-3 leading-relaxed flex-1">
                    {r.description}
                  </p>
                )}

                {r.cta_url && (
                  <Link
                    href={r.cta_url}
                    className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-brand-700 hover:text-brand transition self-start border-b border-brand/30 hover:border-brand pb-0.5"
                  >
                    <FiDownload size={14} />
                    {r.cta_label ?? "Download free"}
                    <FiArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                  </Link>
                )}
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

import Link from "next/link";
import Reveal from "./Reveal";
import { FiArrowRight, FiBookOpen } from "react-icons/fi";
import type { FreeResource } from "@/lib/queries";

export default function FreeResources({ resources }: { resources: FreeResource[] }) {
  if (!resources.length) return null;
  return (
    <section className="section bg-surface-alt">
      <div className="container-x">
        <Reveal>
          <div className="text-center max-w-2xl mx-auto mb-10">
            <span className="text-xs uppercase tracking-[0.2em] text-brand font-semibold">Free Resources</span>
            <h2 className="mt-2 text-3xl md:text-4xl font-bold text-ink">Tools to support your wellbeing.</h2>
          </div>
        </Reveal>
        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {resources.map((r, i) => (
            <Reveal key={r.id} delay={i * 0.05}>
              <div className="h-full bg-white rounded-2xl border border-surface-line overflow-hidden shadow-soft hover:shadow-card transition grid sm:grid-cols-[140px_1fr]">
                {r.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.image_url} alt={r.title} className="w-full h-48 sm:h-full object-cover" />
                ) : (
                  <div className="bg-brand-50 grid place-items-center min-h-[160px] sm:min-h-0">
                    <FiBookOpen size={40} className="text-brand" />
                  </div>
                )}
                <div className="p-6 flex flex-col">
                  <h3 className="font-display text-lg font-semibold text-ink">{r.title}</h3>
                  {r.description && <p className="text-sm text-ink-muted mt-2 flex-1">{r.description}</p>}
                  {r.cta_url && (
                    <Link href={r.cta_url} className="mt-4 inline-flex items-center gap-1 text-sm text-brand font-semibold">
                      {r.cta_label ?? "Learn more"} <FiArrowRight />
                    </Link>
                  )}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

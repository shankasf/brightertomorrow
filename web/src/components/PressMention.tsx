import Reveal from "./Reveal";
import { FiExternalLink } from "react-icons/fi";
import type { PressMention } from "@/lib/queries";

export default function PressMentionSection({ mentions }: { mentions: PressMention[] }) {
  if (!mentions.length) return null;
  return (
    <section className="section bg-surface-alt">
      <div className="container-x">
        <Reveal>
          <div className="text-center max-w-2xl mx-auto mb-10">
            <span className="text-xs uppercase tracking-[0.2em] text-brand font-semibold">Press Mention</span>
            <h2 className="mt-2 text-3xl md:text-4xl font-bold text-ink">Featured in the Press</h2>
            <p className="mt-3 text-ink-muted">See what the media is saying about us.</p>
          </div>
        </Reveal>
        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {mentions.map((m, i) => (
            <Reveal key={m.id} delay={i * 0.05}>
              <a href={m.url} target="_blank" rel="noopener"
                 className="group flex flex-col h-full bg-white rounded-2xl border border-surface-line p-6 hover:shadow-card hover:-translate-y-1 transition-all duration-300">
                {m.logo_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.logo_url} alt={m.outlet} className="h-10 w-auto object-contain mb-4" />
                )}
                <div className="text-xs uppercase tracking-wider text-ink-muted">{m.outlet}</div>
                {m.title && (
                  <h3 className="font-display text-lg font-semibold text-ink mt-2 group-hover:text-brand transition">
                    {m.title}
                  </h3>
                )}
                <span className="mt-4 inline-flex items-center gap-1 text-sm text-brand font-semibold">
                  Read article <FiExternalLink />
                </span>
              </a>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

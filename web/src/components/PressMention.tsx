import Reveal from "./Reveal";
import type { PressMention } from "@/lib/queries";

export default function PressMentionSection({ mentions }: { mentions: PressMention[] }) {
  if (!mentions.length) return null;
  return (
    <section className="bg-cream-alt border-y border-surface-line py-10 md:py-12">
      <div className="container-x">
        <Reveal>
          <div className="text-center mb-8">
            <span className="eyebrow center">As featured in</span>
          </div>
          <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6 md:gap-x-14 lg:gap-x-16">
            {mentions.map((m) => (
              <li key={m.id}>
                <a
                  href={m.url}
                  target="_blank"
                  rel="noopener"
                  aria-label={`${m.outlet}${m.title ? ` — ${m.title}` : ""}`}
                  className="group inline-flex items-center"
                >
                  {m.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.logo_url}
                      alt={m.outlet}
                      className="h-10 md:h-11 w-auto object-contain grayscale opacity-60 transition-all duration-300 group-hover:grayscale-0 group-hover:opacity-100"
                    />
                  ) : (
                    <span className="font-display text-lg md:text-xl text-ink-soft tracking-wide transition-colors duration-300 group-hover:text-brand-700">
                      {m.outlet}
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

import Reveal from "./Reveal";
import { FiPlay, FiArrowUpRight } from "react-icons/fi";
import type { Podcast } from "@/lib/queries";

export default function PodcastSection({ podcast }: { podcast: Podcast | null }) {
  if (!podcast) return null;
  return (
    <section className="section bg-cream-gradient">
      <div className="container-x">
        <Reveal>
          <div className="rounded-3xl bg-cream border border-surface-line overflow-hidden shadow-soft">
            <div className="grid lg:grid-cols-12 gap-0 items-stretch">
              {/* LEFT — cover + play CTA */}
              <div className="lg:col-span-5 relative bg-cream-alt p-8 md:p-10 flex items-center justify-center">
                <div className="relative w-full max-w-[260px] aspect-square">
                  {podcast.cover_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={podcast.cover_url}
                      alt={podcast.show_name}
                      className="w-full h-full rounded-2xl object-cover shadow-card ring-1 ring-black/5"
                    />
                  ) : (
                    <div className="w-full h-full rounded-2xl bg-brand-50 grid place-items-center">
                      <span className="font-display text-3xl text-brand-700">
                        {podcast.show_name.slice(0, 1)}
                      </span>
                    </div>
                  )}
                  {podcast.listen_url && (
                    <a
                      href={podcast.listen_url}
                      target="_blank"
                      rel="noopener"
                      aria-label={`Play ${podcast.show_name}`}
                      className="absolute -bottom-4 -right-4 w-16 h-16 rounded-full bg-brand text-white grid place-items-center shadow-card hover:bg-brand-600 hover:scale-105 transition-all duration-300"
                    >
                      <FiPlay size={22} className="ml-1" fill="currentColor" />
                    </a>
                  )}
                </div>
              </div>

              {/* RIGHT — copy + subscribe row */}
              <div className="lg:col-span-7 p-8 md:p-12 flex flex-col justify-center">
                <span className="eyebrow">Listen In</span>
                <h2 className="display mt-4 text-3xl md:text-4xl text-ink leading-[1.1]">
                  {podcast.host ? (
                    <>
                      {podcast.host} on{" "}
                      <span className="italic-accent">{podcast.show_name}</span>
                    </>
                  ) : (
                    podcast.show_name
                  )}
                </h2>

                {podcast.tagline && (
                  <p className="mt-5 text-ink-muted leading-relaxed text-base md:text-lg max-w-xl">
                    {podcast.tagline}
                  </p>
                )}

                {podcast.listen_url && (
                  <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
                    <a
                      href={podcast.listen_url}
                      target="_blank"
                      rel="noopener"
                      className="btn-ink"
                    >
                      <FiPlay size={14} fill="currentColor" />
                      Listen Now
                    </a>
                    <div className="flex items-center gap-5 text-sm">
                      <a
                        href={podcast.listen_url}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center gap-1.5 text-ink-muted hover:text-brand-700 transition group"
                      >
                        Apple Podcasts
                        <FiArrowUpRight className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                      </a>
                      <a
                        href={podcast.listen_url}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center gap-1.5 text-ink-muted hover:text-brand-700 transition group"
                      >
                        Spotify
                        <FiArrowUpRight className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

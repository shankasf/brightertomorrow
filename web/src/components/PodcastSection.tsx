import Reveal from "./Reveal";
import { FiHeadphones, FiArrowRight } from "react-icons/fi";
import type { Podcast } from "@/lib/queries";

export default function PodcastSection({ podcast }: { podcast: Podcast | null }) {
  if (!podcast) return null;
  return (
    <section className="section">
      <div className="container-x">
        <div className="rounded-3xl bg-gradient-to-br from-brand-700 via-brand to-brand-500 text-white p-6 sm:p-8 md:p-12 relative overflow-hidden">
          <div className="absolute -top-16 -right-16 w-64 h-64 bg-white/10 rounded-full blur-3xl" />
          <Reveal>
            <div className="relative grid md:grid-cols-[auto_1fr_auto] items-center gap-6 md:gap-8 text-center md:text-left">
              {podcast.cover_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={podcast.cover_url} alt={podcast.show_name}
                     className="w-28 h-28 sm:w-32 sm:h-32 rounded-2xl object-cover shadow-card ring-1 ring-white/20 mx-auto md:mx-0" />
              )}
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-white/80 font-semibold">
                  <FiHeadphones /> Listen Now
                </div>
                <h2 className="mt-2 text-2xl md:text-3xl font-display font-bold break-words">
                  {podcast.host ? `${podcast.host} on ${podcast.show_name}` : podcast.show_name}
                </h2>
                {podcast.tagline && (
                  <p className="mt-2 text-white/85 max-w-xl mx-auto md:mx-0">{podcast.tagline}</p>
                )}
              </div>
              {podcast.listen_url && (
                <a href={podcast.listen_url} target="_blank" rel="noopener"
                   className="bg-white text-brand font-semibold px-5 py-3 rounded-full hover:bg-brand-50 transition inline-flex items-center justify-center gap-2 whitespace-nowrap mx-auto md:mx-0 min-h-[44px]">
                  Listen Now <FiArrowRight />
                </a>
              )}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

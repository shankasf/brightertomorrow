"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import type { TeamMember } from "@/lib/queries";
import { FiArrowRight, FiArrowUpRight } from "react-icons/fi";

export default function FeaturedTherapists({ members }: { members: TeamMember[] }) {
  if (!members.length) return null;
  return (
    <section className="section bg-white">
      <div className="container-x">
        <div className="flex items-end justify-between flex-wrap gap-6 mb-12">
          <div className="max-w-xl">
            <span className="eyebrow">Meet the team</span>
            <h2 className="display mt-4 text-4xl md:text-5xl text-ink leading-[1.05]">
              Therapists who{" "}
              <span className="italic-accent">actually fit.</span>
            </h2>
            <p className="mt-4 text-ink-muted leading-relaxed">
              Real clinicians with depth, warmth, and the lived skill to meet you where you are.
            </p>
          </div>
          <Link href="/team" className="btn-ghost">
            Meet the team <FiArrowRight />
          </Link>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
          {members.slice(0, 3).map((m, i) => (
            <motion.article
              key={m.id}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: i * 0.07, ease: [0.16, 1, 0.3, 1] }}
              className="group flex flex-col"
            >
              <Link href="/team" className="block">
                <div className="relative aspect-[4/5] overflow-hidden rounded-3xl bg-cream-alt">
                  {m.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.photo_url}
                      alt={m.full_name}
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                    />
                  ) : (
                    <div className="w-full h-full grid place-items-center font-display text-6xl text-brand/25">
                      {initials(m.full_name)}
                    </div>
                  )}
                  <span className="absolute top-4 left-4 bg-cream/95 backdrop-blur text-[10px] uppercase tracking-[0.18em] font-semibold text-sage px-3 py-1.5 rounded-full border border-sage/20">
                    Accepting clients
                  </span>
                </div>
              </Link>

              <div className="mt-5">
                <h3 className="font-display text-xl md:text-2xl font-medium text-ink leading-tight">
                  {m.full_name}{m.credentials ? `, ${m.credentials}` : ""}
                </h3>
                {m.role && (
                  <div className="eyebrow-bare mt-2 text-ink-muted">
                    {m.role}
                  </div>
                )}
                {m.bio && (
                  <p className="text-sm text-ink-muted mt-3 leading-relaxed line-clamp-2">
                    {m.bio}
                  </p>
                )}
                <Link
                  href="/team"
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:text-brand transition group/link"
                >
                  View profile
                  <FiArrowUpRight className="transition-transform group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5" />
                </Link>
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

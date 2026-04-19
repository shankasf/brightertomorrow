"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import type { TeamMember } from "@/lib/queries";
import { FiArrowRight } from "react-icons/fi";

export default function FeaturedTherapists({ members }: { members: TeamMember[] }) {
  if (!members.length) return null;
  return (
    <section className="section">
      <div className="container-x">
        <div className="flex items-end justify-between flex-wrap gap-4 mb-10">
          <div>
            <span className="text-xs uppercase tracking-[0.2em] text-brand font-semibold">Meet the team</span>
            <h2 className="mt-2 text-3xl md:text-4xl font-bold text-ink">Therapists who actually fit.</h2>
            <p className="mt-2 text-ink-muted max-w-xl">Real clinicians with depth, warmth, and the lived skill to meet you where you are.</p>
          </div>
          <Link href="/team" className="btn-ghost">Meet the team <FiArrowRight /></Link>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {members.slice(0, 4).map((m, i) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: i * 0.07 }}
              className="group bg-white rounded-2xl border border-surface-line overflow-hidden hover:shadow-card hover:border-brand transition"
            >
              <div className="aspect-[4/5] overflow-hidden bg-surface relative">
                {m.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.photo_url} alt={m.full_name}
                       className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                ) : (
                  <div className="w-full h-full grid place-items-center text-4xl font-display font-bold text-brand/30">
                    {initials(m.full_name)}
                  </div>
                )}
                <div className="absolute top-3 left-3 bg-white/90 backdrop-blur text-[11px] font-semibold text-emerald-700 px-2.5 py-1 rounded-full">
                  Accepting clients
                </div>
              </div>
              <div className="p-4">
                <h3 className="font-display text-base font-semibold text-ink leading-tight">
                  {m.full_name}{m.credentials ? `, ${m.credentials}` : ""}
                </h3>
                {m.role && <div className="text-sm text-brand mt-0.5">{m.role}</div>}
                {m.bio && <p className="text-sm text-ink-muted mt-2 line-clamp-3">{m.bio}</p>}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

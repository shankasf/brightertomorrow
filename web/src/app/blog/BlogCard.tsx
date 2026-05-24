"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import Reveal from "@/components/Reveal";
import type { BlogPost } from "@/lib/queries";

const WINE = "#66202A";
const GOLD = "#E1B878";
const INK = "#192735";

export default function BlogCard({ post, delay = 0 }: { post: BlogPost; delay?: number }) {
  const date = new Date(post.published_at).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return (
    <Reveal delay={delay}>
      <motion.article
        whileHover={{ y: -6 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="h-full bg-white overflow-hidden"
        style={{
          border: `1px solid ${GOLD}`,
          borderRadius: "30px 0 30px 30px",
        }}
      >
        <Link href={`/blog/${post.slug}`} className="block h-full flex flex-col">
          {post.cover_url && (
            <div className="relative aspect-[16/10] overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={post.cover_url}
                alt={post.title}
                loading="lazy"
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 hover:scale-105"
              />
            </div>
          )}
          <div className="p-6 sm:p-7 flex flex-col flex-1">
            <h3
              className="font-display font-bold text-[18px] sm:text-[20px] leading-[1.3] min-h-[3.6em]"
              style={{ color: INK }}
            >
              {post.title}
            </h3>
            <div className="mt-4 flex items-center gap-3 text-[12px]">
              <span className="inline-flex items-center gap-1.5" style={{ color: WINE }}>
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: WINE }}
                  aria-hidden
                />
                Brighter Tomorrow
              </span>
              <span className="text-ink-faint">|</span>
              <span className="text-ink-soft">{date}</span>
            </div>
            {post.excerpt && (
              <p className="mt-4 text-[14.5px] leading-[1.65] text-ink-soft flex-1 line-clamp-3">
                {post.excerpt}
              </p>
            )}
            <span
              className="mt-6 inline-flex items-center gap-2 text-[12px] font-display font-bold uppercase tracking-[0.18em] self-start pb-1"
              style={{
                color: WINE,
                borderBottom: `1px solid ${WINE}`,
              }}
            >
              Read More
            </span>
          </div>
        </Link>
      </motion.article>
    </Reveal>
  );
}

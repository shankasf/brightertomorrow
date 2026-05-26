"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import Reveal from "@/components/Reveal";
import { FiDownload } from "react-icons/fi";
import type { FreeResource } from "@/lib/queries";

const WINE = "#66202A";
const GOLD = "#E1B878";
const INK = "#192735";

export default function WorkbookGrid({ items }: { items: FreeResource[] }) {
  return (
    <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-7">
      {items.map((wb, i) => (
        <Reveal key={wb.id} delay={i * 0.08}>
          <motion.div
            whileHover={{ y: -6 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="h-full bg-white p-5 flex flex-col"
            style={{ borderRadius: "30px 0 30px 30px", border: `1px solid ${i === 0 ? WINE : GOLD}` }}
          >
            <div className="relative aspect-[3/4] overflow-hidden" style={{ borderRadius: "20px 0 20px 20px" }}>
              {wb.image_url && (
                <Image
                  src={wb.image_url}
                  alt={wb.title}
                  fill
                  sizes="(min-width:1024px) 280px, (min-width:640px) 50vw, 100vw"
                  className="object-cover"
                />
              )}
            </div>
            <h4 className="mt-5 font-display font-bold text-[17px] leading-[1.3]" style={{ color: INK }}>
              {wb.title}
            </h4>
            <p className="mt-2 text-[13.5px] leading-[1.6] text-ink-soft flex-1">{wb.description}</p>
            <a
              href={wb.cta_url ?? "#"}
              download
              className="mt-4 inline-flex items-center justify-center gap-2 font-display font-bold tracking-[0.12em] text-[12px] uppercase px-5 py-3 transition hover:opacity-90"
              style={{ backgroundColor: WINE, color: "#fff", borderRadius: "20px 0 20px 20px" }}
            >
              <FiDownload size={14} />
              {wb.cta_label ?? "Download"}
            </a>
          </motion.div>
        </Reveal>
      ))}
    </div>
  );
}

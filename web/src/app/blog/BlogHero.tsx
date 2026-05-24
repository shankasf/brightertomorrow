"use client";

import Reveal from "@/components/Reveal";

const GOLD = "#E1B878";

export default function BlogHero() {
  return (
    <section className="relative overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage:
            "linear-gradient(rgba(15,22,30,0.55), rgba(15,22,30,0.55)), url('/images/blog-list/hero-bg.webp')",
        }}
        aria-hidden
      />
      <div className="relative container-x py-28 sm:py-36 lg:py-44 text-center">
        <Reveal>
          <h1
            className="font-display font-bold leading-tight text-[40px] sm:text-[52px] lg:text-[60px]"
            style={{ color: "#F4F4F4" }}
          >
            <span style={{ color: GOLD }}>Our</span> Blog
          </h1>
        </Reveal>
      </div>
    </section>
  );
}

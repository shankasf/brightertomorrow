"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, animate } from "framer-motion";

export default function Counter({
  to,
  prefix = "",
  suffix = "",
  duration = 1.6,
}: { to: number; prefix?: string; suffix?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-50px" });
  const [val, setVal] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const controls = animate(0, to, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setVal(Math.round(v)),
    });
    return () => controls.stop();
  }, [inView, to, duration]);

  return (
    <span
      ref={ref}
      className="font-display text-4xl md:text-5xl font-bold text-brand tabular-nums tracking-tight"
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {prefix}{val.toLocaleString()}{suffix}
    </span>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, animate } from "framer-motion";

export default function Counter({
  to,
  prefix = "",
  suffix = "",
  duration = 2.4,
  className,
}: {
  to: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-50px" });
  const [val, setVal] = useState(1);

  useEffect(() => {
    if (!inView) return;
    const from = to >= 1 ? 1 : 0;
    const controls = animate(from, to, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setVal(Math.round(v)),
    });
    return () => controls.stop();
  }, [inView, to, duration]);

  return (
    <span
      ref={ref}
      className={
        className ??
        "font-display text-4xl md:text-5xl font-bold text-brand tabular-nums tracking-tight"
      }
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {prefix}
      {val.toLocaleString()}
      {suffix}
    </span>
  );
}

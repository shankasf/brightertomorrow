"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";
import type { ReactNode } from "react";

const variants: Variants = {
  hidden: { opacity: 0, y: 18 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
};

export default function Reveal({
  children,
  delay = 0,
  className,
}: { children: ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();

  if (reduce) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial="show"
      whileInView="show"
      viewport={{ once: true, amount: 0 }}
      transition={{ delay }}
      variants={variants}
    >
      {children}
    </motion.div>
  );
}

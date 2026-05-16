"use client";

import { useState } from "react";
import { FiArrowUpRight } from "react-icons/fi";
import MatchModal from "@/components/MatchModal";

export default function MatchTrigger({
  label = "Get matched",
  className = "btn-ink mt-5 w-full justify-center",
}: {
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {label} <FiArrowUpRight />
      </button>
      <MatchModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

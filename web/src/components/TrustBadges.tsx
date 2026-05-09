import { FiCheck } from "react-icons/fi";

const ITEMS = [
  { icon: <FiCheck />, label: "HIPAA-compliant", note: "Secure, private sessions" },
  { icon: <FiCheck />, label: "WBE Certified",   note: "Women-owned business" },
  { icon: <FiCheck />, label: "Affirming care",  note: "LGBTQIA+ welcome" },
  { icon: <FiCheck />, label: "In-person & online", note: "Across all of Nevada" },
];

export default function TrustBadges() {
  return (
    <section className="border-y border-surface-line bg-cream-alt">
      <div className="container-x py-5 sm:py-6">
        <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 sm:gap-x-8 text-center">
          {ITEMS.map((it, i) => (
            <li key={it.label} className="inline-flex items-center gap-3">
              <span className="inline-flex items-center gap-2">
                <span className="grid place-items-center w-5 h-5 rounded-full bg-sage-100 text-sage-700 shrink-0">
                  <FiCheck className="w-3 h-3" strokeWidth={3} />
                </span>
                <span className="eyebrow-bare text-[0.7rem] sm:text-xs text-ink tracking-[0.2em]">
                  {it.label}
                </span>
                <span className="hidden md:inline text-xs text-ink-soft normal-case tracking-normal font-normal">
                  {it.note}
                </span>
              </span>
              {i < ITEMS.length - 1 && (
                <span aria-hidden className="hidden sm:inline-block w-1 h-1 rounded-full bg-brand-300/70" />
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

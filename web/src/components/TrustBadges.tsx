import { FiShield, FiAward, FiHeart, FiVideo } from "react-icons/fi";

const ITEMS = [
  { icon: <FiShield />, label: "HIPAA-compliant", note: "Secure, private sessions" },
  { icon: <FiAward />,  label: "WBE Certified",   note: "Women-owned business" },
  { icon: <FiHeart />,  label: "Affirming care",  note: "LGBTQIA+ welcome" },
  { icon: <FiVideo />,  label: "In-person & online", note: "Across all of Nevada" },
];

export default function TrustBadges() {
  return (
    <section className="border-y border-surface-line bg-white">
      <div className="container-x grid grid-cols-2 lg:grid-cols-4 gap-6 py-10">
        {ITEMS.map((it) => (
          <div key={it.label} className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand grid place-items-center text-lg shrink-0">
              {it.icon}
            </div>
            <div className="min-w-0">
              <div className="font-display font-semibold text-ink leading-tight">{it.label}</div>
              <div className="text-sm text-ink-muted">{it.note}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

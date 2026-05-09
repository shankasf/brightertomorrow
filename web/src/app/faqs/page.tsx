import { getFaqs } from "@/lib/queries";
import FaqAccordion from "@/components/FaqAccordion";

export const metadata = { title: "FAQs — Brighter Tomorrow Therapy" };

export default async function FaqsPage() {
  const faqs = await getFaqs();

  const groups = new Map<string, typeof faqs>();
  for (const f of faqs) {
    const key = f.category?.trim() || "General";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }
  const grouped = Array.from(groups.entries());

  return (
    <>
      <section className="bg-cream-alt relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-grid opacity-[0.06]" />
        <div className="container-narrow relative py-20 sm:py-28 lg:py-32 text-center">
          <span className="eyebrow center">FAQs</span>
          <h1 className="mt-6 display text-5xl sm:text-6xl lg:text-7xl text-ink">
            Frequently asked
            <br className="hidden sm:inline" />
            {" "}<span className="italic-accent">questions.</span>
          </h1>
          <svg aria-hidden viewBox="0 0 200 8" className="mx-auto mt-7 w-36 h-2 text-brand">
            <path d="M2 5 Q 50 0 100 4 T 198 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
      </section>

      <section className="section bg-white">
        <div className="container-narrow">
          {grouped.length === 0 ? (
            <p className="text-center text-ink-muted py-12">No FAQs yet.</p>
          ) : (
            <FaqAccordion grouped={grouped} showCategoryLabels={grouped.length > 1} />
          )}
        </div>
      </section>
    </>
  );
}

import { pageMetadata } from "@/lib/seo";
import { JsonLd, faqPageGraph, breadcrumbGraph } from "@/components/StructuredData";
import { FAQS } from "./faqs-data";
import FaqsContent from "./FaqsContent";

export const metadata = pageMetadata({
  title: "FAQs",
  description:
    "Answers to common questions about therapy at Brighter Tomorrow Therapy Collective in Las Vegas, NV — getting started, the first session, costs, insurance, telehealth, confidentiality, and care for children and teens.",
  path: "/faqs",
});

export default function FaqsPage() {
  return (
    <>
      {/* AEO: FAQPage + breadcrumb structured data, rendered server-side so
          answer engines and Google can extract Q&A pairs from the HTML. */}
      <JsonLd data={faqPageGraph(FAQS)} />
      <JsonLd
        data={breadcrumbGraph([
          { name: "Home", path: "/" },
          { name: "FAQs", path: "/faqs" },
        ])}
      />
      <FaqsContent />
    </>
  );
}

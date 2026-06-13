import Content from "./Content";
import { pageMetadata } from "@/lib/seo";
import { JsonLd, detailPageGraph } from "@/components/StructuredData";

export const metadata = pageMetadata({
  title: "LGBTQIA+ Affirming Therapy in Las Vegas, NV",
  description:
    "LGBTQIA+ affirming therapy in Las Vegas, NV — a space where you are fully seen, respected, and valued. Our therapists support identity, relationships, and mental health with pride.",
  path: "/specialties/lgbtqia-affirming-therapy",
});

export default function Page() {
  return (
    <>
      <JsonLd
        data={detailPageGraph({
          name: "LGBTQIA+ Affirming Therapy in Las Vegas, NV",
          description:
            "LGBTQIA+ affirming therapy in Las Vegas, NV — a space where you are fully seen, respected, and valued. Our therapists support identity, relationships, and mental health with pride.",
          path: "/specialties/lgbtqia-affirming-therapy",
          breadcrumb: [
            { name: "Home", path: "/" },
            { name: "Specialties", path: "/specialties" },
            { name: "LGBTQIA+ Affirming Therapy in Las Vegas, NV", path: "/specialties/lgbtqia-affirming-therapy" },
          ],
        })}
      />
      <Content />
    </>
  );
}

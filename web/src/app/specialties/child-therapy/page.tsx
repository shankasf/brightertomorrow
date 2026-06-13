import Content from "./Content";
import { pageMetadata } from "@/lib/seo";
import { JsonLd, detailPageGraph } from "@/components/StructuredData";

export const metadata = pageMetadata({
  title: "Child Therapy in Las Vegas, NV",
  description:
    "Supportive child therapy in Las Vegas, NV. Our therapists help children build emotional skills and resilience through play-based, developmentally attuned care — with family involved.",
  path: "/specialties/child-therapy",
});

export default function Page() {
  return (
    <>
      <JsonLd
        data={detailPageGraph({
          name: "Child Therapy in Las Vegas, NV",
          description:
            "Supportive child therapy in Las Vegas, NV. Our therapists help children build emotional skills and resilience through play-based, developmentally attuned care — with family involved.",
          path: "/specialties/child-therapy",
          breadcrumb: [
            { name: "Home", path: "/" },
            { name: "Specialties", path: "/specialties" },
            { name: "Child Therapy in Las Vegas, NV", path: "/specialties/child-therapy" },
          ],
        })}
      />
      <Content />
    </>
  );
}

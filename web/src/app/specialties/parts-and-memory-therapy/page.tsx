import Content from "./Content";
import { pageMetadata } from "@/lib/seo";
import { JsonLd, detailPageGraph } from "@/components/StructuredData";

export const metadata = pageMetadata({
  title: "Parts & Memory Therapy in Las Vegas, NV",
  description:
    "Parts & Memory Therapy in Las Vegas, NV — a gentle, integrative approach to healing trauma and inner conflict by reconnecting with the different parts of yourself.",
  path: "/specialties/parts-and-memory-therapy",
});

export default function Page() {
  return (
    <>
      <JsonLd
        data={detailPageGraph({
          name: "Parts & Memory Therapy in Las Vegas, NV",
          description:
            "Parts & Memory Therapy in Las Vegas, NV — a gentle, integrative approach to healing trauma and inner conflict by reconnecting with the different parts of yourself.",
          path: "/specialties/parts-and-memory-therapy",
          breadcrumb: [
            { name: "Home", path: "/" },
            { name: "Specialties", path: "/specialties" },
            { name: "Parts & Memory Therapy in Las Vegas, NV", path: "/specialties/parts-and-memory-therapy" },
          ],
        })}
      />
      <Content />
    </>
  );
}

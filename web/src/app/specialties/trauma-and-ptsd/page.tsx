import Content from "./Content";
import { pageMetadata } from "@/lib/seo";
import { JsonLd, detailPageGraph } from "@/components/StructuredData";

export const metadata = pageMetadata({
  title: "Trauma & PTSD Therapy in Las Vegas, NV",
  description:
    "Trauma & PTSD therapy in Las Vegas, NV. Our licensed therapists offer safe, evidence-based care to help you process painful experiences and reclaim a sense of safety and control.",
  path: "/specialties/trauma-and-ptsd",
});

export default function Page() {
  return (
    <>
      <JsonLd
        data={detailPageGraph({
          name: "Trauma & PTSD Therapy in Las Vegas, NV",
          description:
            "Trauma & PTSD therapy in Las Vegas, NV. Our licensed therapists offer safe, evidence-based care to help you process painful experiences and reclaim a sense of safety and control.",
          path: "/specialties/trauma-and-ptsd",
          breadcrumb: [
            { name: "Home", path: "/" },
            { name: "Specialties", path: "/specialties" },
            { name: "Trauma & PTSD Therapy in Las Vegas, NV", path: "/specialties/trauma-and-ptsd" },
          ],
        })}
      />
      <Content />
    </>
  );
}

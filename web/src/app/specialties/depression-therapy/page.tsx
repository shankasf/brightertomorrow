import Content from "./Content";
import { pageMetadata } from "@/lib/seo";
import { JsonLd, detailPageGraph } from "@/components/StructuredData";

export const metadata = pageMetadata({
  title: "Depression Therapy in Las Vegas, NV",
  description:
    "Compassionate depression therapy in Las Vegas, NV. Our licensed therapists help you move through low mood, hopelessness, and fatigue toward connection, energy, and hope.",
  path: "/specialties/depression-therapy",
});

export default function Page() {
  return (
    <>
      <JsonLd
        data={detailPageGraph({
          name: "Depression Therapy in Las Vegas, NV",
          description:
            "Compassionate depression therapy in Las Vegas, NV. Our licensed therapists help you move through low mood, hopelessness, and fatigue toward connection, energy, and hope.",
          path: "/specialties/depression-therapy",
          breadcrumb: [
            { name: "Home", path: "/" },
            { name: "Specialties", path: "/specialties" },
            { name: "Depression Therapy in Las Vegas, NV", path: "/specialties/depression-therapy" },
          ],
        })}
      />
      <Content />
    </>
  );
}

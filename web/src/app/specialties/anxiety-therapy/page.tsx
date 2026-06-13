import Content from "./Content";
import { pageMetadata } from "@/lib/seo";
import { JsonLd, detailPageGraph } from "@/components/StructuredData";

export const metadata = pageMetadata({
  title: "Anxiety Therapy in Las Vegas, NV",
  description:
    "Find relief from worry, panic, and overwhelm with anxiety therapy in Las Vegas, NV. Our licensed therapists offer evidence-based, compassionate care — in person or online.",
  path: "/specialties/anxiety-therapy",
});

export default function Page() {
  return (
    <>
      <JsonLd
        data={detailPageGraph({
          name: "Anxiety Therapy in Las Vegas, NV",
          description:
            "Find relief from worry, panic, and overwhelm with anxiety therapy in Las Vegas, NV. Our licensed therapists offer evidence-based, compassionate care — in person or online.",
          path: "/specialties/anxiety-therapy",
          breadcrumb: [
            { name: "Home", path: "/" },
            { name: "Specialties", path: "/specialties" },
            { name: "Anxiety Therapy in Las Vegas, NV", path: "/specialties/anxiety-therapy" },
          ],
        })}
      />
      <Content />
    </>
  );
}

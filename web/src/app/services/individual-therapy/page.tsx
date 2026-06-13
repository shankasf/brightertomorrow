import Content from "./Content";
import { pageMetadata } from "@/lib/seo";
import { JsonLd, detailPageGraph } from "@/components/StructuredData";

export const metadata = pageMetadata({
  title: "Individual Therapy in Las Vegas, NV",
  description:
    "One-on-one individual therapy in Las Vegas, NV. Our licensed therapists offer a holistic, personalized space to work through anxiety, depression, trauma, and life's challenges.",
  path: "/services/individual-therapy",
});

export default function Page() {
  return (
    <>
      <JsonLd
        data={detailPageGraph({
          name: "Individual Therapy in Las Vegas, NV",
          description:
            "One-on-one individual therapy in Las Vegas, NV. Our licensed therapists offer a holistic, personalized space to work through anxiety, depression, trauma, and life's challenges.",
          path: "/services/individual-therapy",
          breadcrumb: [
            { name: "Home", path: "/" },
            { name: "Services", path: "/services" },
            { name: "Individual Therapy in Las Vegas, NV", path: "/services/individual-therapy" },
          ],
        })}
      />
      <Content />
    </>
  );
}

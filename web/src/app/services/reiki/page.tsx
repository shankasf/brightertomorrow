import Content from "./Content";
import { pageMetadata } from "@/lib/seo";
import { JsonLd, detailPageGraph } from "@/components/StructuredData";

export const metadata = pageMetadata({
  title: "Reiki in Las Vegas, NV",
  description:
    "Restore balance with Reiki in Las Vegas, NV. Our holistic energy-healing sessions ease stress and support emotional well-being alongside your therapy at Brighter Tomorrow.",
  path: "/services/reiki",
});

export default function Page() {
  return (
    <>
      <JsonLd
        data={detailPageGraph({
          name: "Reiki in Las Vegas, NV",
          description:
            "Restore balance with Reiki in Las Vegas, NV. Our holistic energy-healing sessions ease stress and support emotional well-being alongside your therapy at Brighter Tomorrow.",
          path: "/services/reiki",
          breadcrumb: [
            { name: "Home", path: "/" },
            { name: "Services", path: "/services" },
            { name: "Reiki in Las Vegas, NV", path: "/services/reiki" },
          ],
        })}
      />
      <Content />
    </>
  );
}

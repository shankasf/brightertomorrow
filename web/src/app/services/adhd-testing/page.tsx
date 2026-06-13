import Content from "./Content";
import { pageMetadata } from "@/lib/seo";
import { JsonLd, detailPageGraph } from "@/components/StructuredData";

export const metadata = pageMetadata({
  title: "ADHD Testing in Las Vegas, NV",
  description:
    "Compassionate ADHD testing and evaluation in Las Vegas, NV. Our licensed clinicians help children, teens, and adults understand their attention, focus, and next steps for support.",
  path: "/services/adhd-testing",
});

export default function Page() {
  return (
    <>
      <JsonLd
        data={detailPageGraph({
          name: "ADHD Testing in Las Vegas, NV",
          description:
            "Compassionate ADHD testing and evaluation in Las Vegas, NV. Our licensed clinicians help children, teens, and adults understand their attention, focus, and next steps for support.",
          path: "/services/adhd-testing",
          breadcrumb: [
            { name: "Home", path: "/" },
            { name: "Services", path: "/services" },
            { name: "ADHD Testing in Las Vegas, NV", path: "/services/adhd-testing" },
          ],
        })}
      />
      <Content />
    </>
  );
}

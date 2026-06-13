import Content from "./Content";
import { pageMetadata } from "@/lib/seo";
import { JsonLd, detailPageGraph } from "@/components/StructuredData";

export const metadata = pageMetadata({
  title: "Relationship Counseling in Las Vegas, NV",
  description:
    "Break unhealthy patterns and build safe, empowering connections with relationship counseling in Las Vegas, NV. Our therapists help you communicate, set boundaries, and reconnect.",
  path: "/specialties/relationship-counseling",
});

export default function Page() {
  return (
    <>
      <JsonLd
        data={detailPageGraph({
          name: "Relationship Counseling in Las Vegas, NV",
          description:
            "Break unhealthy patterns and build safe, empowering connections with relationship counseling in Las Vegas, NV. Our therapists help you communicate, set boundaries, and reconnect.",
          path: "/specialties/relationship-counseling",
          breadcrumb: [
            { name: "Home", path: "/" },
            { name: "Specialties", path: "/specialties" },
            { name: "Relationship Counseling in Las Vegas, NV", path: "/specialties/relationship-counseling" },
          ],
        })}
      />
      <Content />
    </>
  );
}

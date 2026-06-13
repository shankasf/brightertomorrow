import Content from "./Content";
import { pageMetadata } from "@/lib/seo";
import { JsonLd, detailPageGraph } from "@/components/StructuredData";

export const metadata = pageMetadata({
  title: "Teletherapy in Las Vegas, NV",
  description:
    "Convenient, confidential teletherapy in Las Vegas, NV. Meet with a licensed therapist by secure video from the comfort of home — same compassionate care, no commute.",
  path: "/services/teletherapy",
});

export default function Page() {
  return (
    <>
      <JsonLd
        data={detailPageGraph({
          name: "Teletherapy in Las Vegas, NV",
          description:
            "Convenient, confidential teletherapy in Las Vegas, NV. Meet with a licensed therapist by secure video from the comfort of home — same compassionate care, no commute.",
          path: "/services/teletherapy",
          breadcrumb: [
            { name: "Home", path: "/" },
            { name: "Services", path: "/services" },
            { name: "Teletherapy in Las Vegas, NV", path: "/services/teletherapy" },
          ],
        })}
      />
      <Content />
    </>
  );
}

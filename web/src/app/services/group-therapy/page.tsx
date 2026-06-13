import Content from "./Content";
import { pageMetadata } from "@/lib/seo";
import { JsonLd, detailPageGraph } from "@/components/StructuredData";

export const metadata = pageMetadata({
  title: "Group Therapy in Las Vegas, NV",
  description:
    "Connect, share, and heal with group therapy in Las Vegas, NV. Our supportive, therapist-led groups help you build community and grow alongside others facing similar challenges.",
  path: "/services/group-therapy",
});

export default function Page() {
  return (
    <>
      <JsonLd
        data={detailPageGraph({
          name: "Group Therapy in Las Vegas, NV",
          description:
            "Connect, share, and heal with group therapy in Las Vegas, NV. Our supportive, therapist-led groups help you build community and grow alongside others facing similar challenges.",
          path: "/services/group-therapy",
          breadcrumb: [
            { name: "Home", path: "/" },
            { name: "Services", path: "/services" },
            { name: "Group Therapy in Las Vegas, NV", path: "/services/group-therapy" },
          ],
        })}
      />
      <Content />
    </>
  );
}

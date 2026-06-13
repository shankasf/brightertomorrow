import Content from "./Content";
import { pageMetadata } from "@/lib/seo";
import { JsonLd, detailPageGraph } from "@/components/StructuredData";

export const metadata = pageMetadata({
  title: "Grief Counseling in Las Vegas, NV",
  description:
    "Gentle grief counseling in Las Vegas, NV. Our therapists walk with you through loss at your own pace — honoring your story and helping you carry it with more peace.",
  path: "/specialties/grief-counseling",
});

export default function Page() {
  return (
    <>
      <JsonLd
        data={detailPageGraph({
          name: "Grief Counseling in Las Vegas, NV",
          description:
            "Gentle grief counseling in Las Vegas, NV. Our therapists walk with you through loss at your own pace — honoring your story and helping you carry it with more peace.",
          path: "/specialties/grief-counseling",
          breadcrumb: [
            { name: "Home", path: "/" },
            { name: "Specialties", path: "/specialties" },
            { name: "Grief Counseling in Las Vegas, NV", path: "/specialties/grief-counseling" },
          ],
        })}
      />
      <Content />
    </>
  );
}

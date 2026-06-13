import Content from "./Content";
import { pageMetadata } from "@/lib/seo";
import { JsonLd, detailPageGraph } from "@/components/StructuredData";

export const metadata = pageMetadata({
  title: "Life Transitions Counseling in Las Vegas, NV",
  description:
    "Navigate change with life transitions counseling in Las Vegas, NV. From new careers to moves, loss, and identity shifts, our therapists help you find footing and direction.",
  path: "/specialties/life-transitions-counseling",
});

export default function Page() {
  return (
    <>
      <JsonLd
        data={detailPageGraph({
          name: "Life Transitions Counseling in Las Vegas, NV",
          description:
            "Navigate change with life transitions counseling in Las Vegas, NV. From new careers to moves, loss, and identity shifts, our therapists help you find footing and direction.",
          path: "/specialties/life-transitions-counseling",
          breadcrumb: [
            { name: "Home", path: "/" },
            { name: "Specialties", path: "/specialties" },
            { name: "Life Transitions Counseling in Las Vegas, NV", path: "/specialties/life-transitions-counseling" },
          ],
        })}
      />
      <Content />
    </>
  );
}

import Content from "./Content";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Grief Counseling in Las Vegas, NV",
  description:
    "Gentle grief counseling in Las Vegas, NV. Our therapists walk with you through loss at your own pace — honoring your story and helping you carry it with more peace.",
  path: "/specialties/grief-counseling",
});

export default function Page() {
  return <Content />;
}

import ApproachContent from "./ApproachContent";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Our Approach to Therapy in Las Vegas, NV",
  description:
    "How we work at Brighter Tomorrow Therapy — a holistic, collaborative approach to individual, couples, family, and group counseling in Las Vegas, NV, tailored to your goals.",
  path: "/approach",
});

export default function ApproachPage() {
  return <ApproachContent />;
}

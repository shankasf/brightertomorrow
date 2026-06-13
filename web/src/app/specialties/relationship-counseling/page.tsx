import Content from "./Content";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Relationship Counseling in Las Vegas, NV",
  description:
    "Break unhealthy patterns and build safe, empowering connections with relationship counseling in Las Vegas, NV. Our therapists help you communicate, set boundaries, and reconnect.",
  path: "/specialties/relationship-counseling",
});

export default function Page() {
  return <Content />;
}

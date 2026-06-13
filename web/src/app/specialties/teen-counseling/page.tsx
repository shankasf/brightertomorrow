import Content from "./Content";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Teen Counseling in Las Vegas, NV",
  description:
    "Teen counseling in Las Vegas, NV that helps teens build confidence, resilience, and self-trust. Our therapists create a safe space to navigate stress, identity, and relationships.",
  path: "/specialties/teen-counseling",
});

export default function Page() {
  return <Content />;
}

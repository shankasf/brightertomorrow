import Content from "./Content";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Couples Counseling in Las Vegas, NV",
  description:
    "Strengthen your relationship with expert couples counseling in Las Vegas, NV. Our therapists help partners rebuild trust, improve communication, and reconnect — in person or online.",
  path: "/services/couples-counseling",
});

export default function Page() {
  return <Content />;
}

import Content from "./Content";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "ADHD Testing in Las Vegas, NV",
  description:
    "Compassionate ADHD testing and evaluation in Las Vegas, NV. Our licensed clinicians help children, teens, and adults understand their attention, focus, and next steps for support.",
  path: "/services/adhd-testing",
});

export default function Page() {
  return <Content />;
}

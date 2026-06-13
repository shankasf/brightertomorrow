import Content from "./Content";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Reiki in Las Vegas, NV",
  description:
    "Restore balance with Reiki in Las Vegas, NV. Our holistic energy-healing sessions ease stress and support emotional well-being alongside your therapy at Brighter Tomorrow.",
  path: "/services/reiki",
});

export default function Page() {
  return <Content />;
}

import Content from "./Content";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Teletherapy in Las Vegas, NV",
  description:
    "Convenient, confidential teletherapy in Las Vegas, NV. Meet with a licensed therapist by secure video from the comfort of home — same compassionate care, no commute.",
  path: "/services/teletherapy",
});

export default function Page() {
  return <Content />;
}

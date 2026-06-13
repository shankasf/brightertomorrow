import Content from "./Content";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "LGBTQIA+ Affirming Therapy in Las Vegas, NV",
  description:
    "LGBTQIA+ affirming therapy in Las Vegas, NV — a space where you are fully seen, respected, and valued. Our therapists support identity, relationships, and mental health with pride.",
  path: "/specialties/lgbtqia-affirming-therapy",
});

export default function Page() {
  return <Content />;
}

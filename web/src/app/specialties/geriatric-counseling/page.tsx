import Content from "./Content";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Geriatric Counseling in Las Vegas, NV",
  description:
    "Caring geriatric counseling in Las Vegas, NV. We support older adults through grief, transitions, health changes, and isolation with respectful, age-attuned therapy.",
  path: "/specialties/geriatric-counseling",
});

export default function Page() {
  return <Content />;
}

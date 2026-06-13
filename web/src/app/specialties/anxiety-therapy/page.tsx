import Content from "./Content";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Anxiety Therapy in Las Vegas, NV",
  description:
    "Find relief from worry, panic, and overwhelm with anxiety therapy in Las Vegas, NV. Our licensed therapists offer evidence-based, compassionate care — in person or online.",
  path: "/specialties/anxiety-therapy",
});

export default function Page() {
  return <Content />;
}

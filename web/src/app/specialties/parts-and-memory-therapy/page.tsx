import Content from "./Content";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Parts & Memory Therapy in Las Vegas, NV",
  description:
    "Parts & Memory Therapy in Las Vegas, NV — a gentle, integrative approach to healing trauma and inner conflict by reconnecting with the different parts of yourself.",
  path: "/specialties/parts-and-memory-therapy",
});

export default function Page() {
  return <Content />;
}

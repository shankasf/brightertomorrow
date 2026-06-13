import StoryContent from "./StoryContent";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Our Story",
  description:
    "Meet the team behind Brighter Tomorrow Therapy in Las Vegas, NV. Learn how our collective of licensed therapists delivers compassionate, accessible, whole-person mental health care.",
  path: "/story",
});

export default function StoryPage() {
  return <StoryContent />;
}

import Content from "./Content";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Group Therapy in Las Vegas, NV",
  description:
    "Connect, share, and heal with group therapy in Las Vegas, NV. Our supportive, therapist-led groups help you build community and grow alongside others facing similar challenges.",
  path: "/services/group-therapy",
});

export default function Page() {
  return <Content />;
}

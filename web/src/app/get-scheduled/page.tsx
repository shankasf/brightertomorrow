import GetScheduledFlow from "@/components/GetScheduledFlow";
import { pageMetadata } from "@/lib/seo";

export const metadata = {
  ...pageMetadata({
    title: "Get Scheduled",
    description:
      "Verify your insurance coverage in real time, then choose a location and time to book your appointment with Brighter Tomorrow Therapy.",
    path: "/get-scheduled",
  }),
  // PHI-collecting booking funnel — keep it out of the search index.
  robots: { index: false, follow: true },
};

export default function GetScheduledPage() {
  return <GetScheduledFlow />;
}

import type { Metadata } from "next";
import TeamFilter from "@/components/TeamFilter";
import { getTeamGroups, getTeamMembers } from "@/lib/queries";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Our Team",
  description:
    "Meet the licensed therapists, social workers, and clinicians at Brighter Tomorrow Therapy Collective, serving Las Vegas and North Las Vegas, NV.",
  path: "/team",
});

// Team data lives in Postgres (editable via /admin) and isn't available at
// build time — render on demand so the roster always reflects the live DB.
export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const [groups, members] = await Promise.all([getTeamGroups(), getTeamMembers()]);
  return <TeamFilter groups={groups} members={members} />;
}

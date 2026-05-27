import TeamFilter from "@/components/TeamFilter";
import { getTeamGroups, getTeamMembers } from "@/lib/queries";

export const metadata = { title: "Our Team — Brighter Tomorrow Therapy" };

// Team data lives in Postgres (editable via /admin) and isn't available at
// build time — render on demand so the roster always reflects the live DB.
export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const [groups, members] = await Promise.all([getTeamGroups(), getTeamMembers()]);
  return <TeamFilter groups={groups} members={members} />;
}

import TeamFilter from "@/components/TeamFilter";
import { getTeamGroups, getTeamMembers } from "@/lib/queries";

export const metadata = { title: "Our Team — Brighter Tomorrow Therapy" };

export default async function TeamPage() {
  const [groups, members] = await Promise.all([getTeamGroups(), getTeamMembers()]);
  return <TeamFilter groups={groups} members={members} />;
}

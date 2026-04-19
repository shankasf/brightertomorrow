import TeamFilter from "@/components/TeamFilter";
import { getTeamGroups, getTeamMembers } from "@/lib/queries";

export const metadata = { title: "Our Team — Brighter Tomorrow Therapy" };

export default async function TeamPage() {
  const [groups, members] = await Promise.all([getTeamGroups(), getTeamMembers()]);
  return (
    <>
      <section className="bg-hero-gradient">
        <div className="container-x py-10 sm:py-14 lg:py-16 text-center">
          <span className="text-xs uppercase tracking-[0.2em] text-brand font-semibold">Our Team</span>
          <h1 className="mt-2 text-3xl sm:text-4xl md:text-5xl font-bold text-ink">Real therapists, ready when you are.</h1>
          <p className="mt-4 text-ink-muted max-w-2xl mx-auto">Meet the clinicians at Brighter Tomorrow — across our two offices and telehealth team.</p>
        </div>
      </section>

      <TeamFilter groups={groups} members={members} />
    </>
  );
}

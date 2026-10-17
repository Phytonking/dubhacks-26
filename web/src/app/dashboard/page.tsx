import { Suspense } from "react";
import { connection } from "next/server";
import { Card, PageTitle, Stat, StageBadge } from "@/components/ui";
import { getAgent, getCurrentOrg, getDashboardStats } from "@/lib/queries";

export default function DashboardPage() {
  return (
    <>
      <PageTitle title="Dashboard" sub="Your agent and customers at a glance." />
      <Suspense fallback={<div className="text-sm text-stone-500">Loading…</div>}>
        <DashboardContent />
      </Suspense>
    </>
  );
}

async function DashboardContent() {
  await connection();
  const org = await getCurrentOrg();
  const [stats, agent] = await Promise.all([getDashboardStats(org._id), getAgent(org._id)]);
  const stageOrder = ["new", "engaged", "qualified", "won", "lost"];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Contacts" value={stats.contactCount} />
        <Stat label="Messages (24h)" value={stats.msgs24h} />
        <Stat label="Qualified leads" value={stats.hot} />
        <Stat label="Human takeover" value={stats.openHuman} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-medium">Pipeline</h2>
          <ul className="space-y-2">
            {stageOrder.map((s) => (
              <li key={s} className="flex items-center justify-between text-sm">
                <StageBadge stage={s} />
                <span className="font-medium">{stats.stages.find((x) => x._id === s)?.n ?? 0}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-3 font-medium">Agent</h2>
          {agent ? (
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-stone-500">Status</dt><dd className="font-medium">{agent.status}</dd></div>
              <div className="flex justify-between"><dt className="text-stone-500">Harness</dt><dd>{agent.harness ?? "not set"}</dd></div>
              <div className="flex justify-between"><dt className="text-stone-500">Channels</dt>
                <dd>{Object.entries(agent.enabledChannels).filter(([, on]) => on).map(([c]) => c).join(", ") || "none"}</dd></div>
            </dl>
          ) : (
            <p className="text-sm text-stone-500">No agent yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

import { Suspense } from "react";
import { connection } from "next/server";
import { saveAgentSettings } from "@/app/actions";
import { Card, PageTitle } from "@/components/ui";
import { getAgent, getCurrentOrg } from "@/lib/queries";

export default function AgentPage() {
  return (
    <>
      <PageTitle title="Agent" sub="One agent per business. Describe your product and set its guardrails." />
      <Suspense fallback={<div className="text-sm text-stone-500">Loading…</div>}>
        <AgentForm />
      </Suspense>
    </>
  );
}

const input = "mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm";

async function AgentForm() {
  await connection();
  const org = await getCurrentOrg();
  const agent = await getAgent(org._id);
  if (!agent) return <p className="text-sm text-stone-500">No agent configured.</p>;
  return (
    <form action={saveAgentSettings} className="max-w-2xl space-y-4">
      <Card className="space-y-4">
        <label className="block text-sm font-medium">Product / business description
          <textarea name="productDescription" defaultValue={org.productDescription} rows={3} className={input} />
        </label>
        <label className="block text-sm font-medium">Brand voice
          <input name="brandVoice" defaultValue={org.brandVoice} className={input} />
        </label>
        <label className="block text-sm font-medium">Business hours
          <input name="hours" defaultValue={org.hours} className={input} />
        </label>
      </Card>
      <Card className="space-y-4">
        <label className="block text-sm font-medium">Agent persona / instructions
          <textarea name="persona" defaultValue={agent.persona} rows={4} className={input} />
        </label>
        <label className="block text-sm font-medium">Max discount (%)
          <input name="maxDiscountPct" type="number" min={0} max={100} defaultValue={agent.guardrails.maxDiscountPct} className={input} />
        </label>
        <label className="block text-sm font-medium">Escalate to a human on (comma-separated)
          <input name="escalateOn" defaultValue={agent.guardrails.escalateOn.join(", ")} className={input} />
        </label>
      </Card>
      <Card>
        <h2 className="text-sm font-medium">Runtime</h2>
        <p className="mt-1 text-sm text-stone-500">
          Status: <b>{agent.status}</b> · Channels:{" "}
          {Object.entries(agent.enabledChannels).map(([c, on]) => `${c} ${on ? "on" : "off"}`).join(", ")}.
          Sandbox deploy and Photon line binding arrive with the agent service.
        </p>
      </Card>
      <button className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800">Save</button>
    </form>
  );
}

import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { Card, PageTitle, StageBadge, timeAgo } from "@/components/ui";
import { getContact, getCurrentOrg } from "@/lib/queries";

export default function ContactPage({ params }: PageProps<"/contacts/[id]">) {
  return (
    <Suspense fallback={<div className="text-sm text-stone-500">Loading…</div>}>
      <ContactContent params={params} />
    </Suspense>
  );
}

async function ContactContent({ params }: { params: PageProps<"/contacts/[id]">["params"] }) {
  await connection();
  const { id } = await params;
  const org = await getCurrentOrg();
  const data = await getContact(org._id, id);
  if (!data) notFound();
  const { contact, messages } = data;
  // What the person told us about themselves (agent tool during chats, and read from the call transcript afterwards). Not verified.
  const intake = (contact as unknown as { intake?: Record<string, unknown> & { devices?: string[]; interests?: string[]; notes?: string[] } }).intake;
  const known: [string, string][] = intake ? ([
    ["Name", intake.first_name], ["Carrier now", intake.current_carrier], ["Plan now", intake.current_plan],
    ["Pays now", intake.monthly_bill_usd != null ? `$${intake.monthly_bill_usd}/mo` : ""], ["Lines", intake.line_count != null ? String(intake.line_count) : ""],
    ["Phones", intake.devices?.join(", ")], ["Budget", intake.budget_usd != null ? `$${intake.budget_usd}/mo` : ""], ["Needs", intake.needs],
    ["Interested in", intake.interests?.join(", ")], ["Prefers", intake.preferred_contact], ["Notes", intake.notes?.join(" · ")],
  ] as [string, unknown][]).map(([k, v]): [string, string] => [k, typeof v === "string" ? v : ""]).filter(([, v]) => v) : [];
  return (
    <>
      <PageTitle title={contact.name} sub={contact.handles.map((h) => `${h.channel}: ${h.address}`).join(" · ")} />
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <Card>
            <div className="mb-2 flex items-center justify-between">
              <StageBadge stage={contact.stage} />
              <span className="text-sm text-stone-500">Score {contact.score}</span>
            </div>
            <h2 className="mt-3 text-xs uppercase tracking-wide text-stone-500">What we know (they told us)</h2>
            {known.length ? (
              <dl className="mt-1 grid grid-cols-[96px_1fr] gap-x-2 gap-y-1 text-sm">
                {known.map(([k, v]) => (<div key={k} className="contents"><dt className="text-stone-500">{k}</dt><dd>{v}</dd></div>))}
              </dl>
            ) : (
              <p className="mt-1 text-sm text-stone-400">Nothing yet.</p>
            )}
            <h2 className="mt-4 text-xs uppercase tracking-wide text-stone-500">Learned by agent</h2>
            {contact.facts.length ? (
              <ul className="mt-1 list-disc pl-5 text-sm">{contact.facts.map((f) => <li key={f.text}>{f.text}</li>)}</ul>
            ) : (
              <p className="mt-1 text-sm text-stone-400">Nothing yet.</p>
            )}
          </Card>
        </div>
        <Card>
          <h2 className="mb-3 font-medium">History</h2>
          <div className="space-y-2">
            {messages.map((m) => (
              <div key={m._id.toString()} className="text-sm">
                <span className="font-medium">{m.sender}</span>{" "}
                <span className="text-xs text-stone-400">{m.channel} · {timeAgo(m.ts)}</span>
                <div className="text-stone-700">{m.body}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

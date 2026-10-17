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
            <h2 className="mt-3 text-xs uppercase tracking-wide text-stone-500">Learned by agent</h2>
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

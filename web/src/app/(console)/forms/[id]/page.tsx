import { ObjectId } from "mongodb";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { Card, PageTitle } from "@/components/ui";
import { getDb } from "@/lib/db";
import { FORM_TEMPLATES } from "@/lib/form-templates";
import { isOwner, ownerAccessConfigured } from "@/lib/owner-gate";
import { getCurrentOrg } from "@/lib/queries";
import { RevealButton } from "../reveal-button";

export default function SubmissionPage({ params }: PageProps<"/forms/[id]">) {
  return <Suspense fallback={<div className="text-sm text-stone-500">Loading…</div>}><Detail params={params} /></Suspense>;
}

async function Detail({ params }: { params: PageProps<"/forms/[id]">["params"] }) {
  await connection();
  if (!ownerAccessConfigured()) redirect("/forms");
  if (!(await isOwner())) redirect("/forms/login");
  const { id } = await params; if (!ObjectId.isValid(id)) notFound();
  const org = await getCurrentOrg(); const db = await getDb();
  const sub: any = await db.collection("form_submissions").findOne({ _id: new ObjectId(id), orgId: org._id }); if (!sub) notFound();
  const tpl = FORM_TEMPLATES[sub.template]; const contact: any = await db.collection("contacts").findOne({ _id: sub.contactId }, { projection: { name: 1 } });
  return (
    <>
      <PageTitle title={tpl?.title ?? sub.template} sub={`From ${contact?.name ?? "unknown"} · ${new Date(sub.submittedAt).toLocaleString()}`} />
      <Card className="max-w-xl space-y-3">
        {(tpl?.fields ?? []).map((f) => (
          <div key={f.key}>
            <div className="text-xs uppercase tracking-wide text-stone-500">{f.label}</div>
            {f.sensitive ? (sub.secrets?.[f.key] ? <div className="mt-0.5 flex items-center gap-3"><span className="font-mono text-sm tracking-widest">••••••••</span><RevealButton submissionId={id} field={f.key} /></div> : <div className="text-stone-400">not provided</div>)
              : <div>{sub.fields?.[f.key] ?? <span className="text-stone-400">not provided</span>}</div>}
          </div>))}
      </Card>
      <p className="mt-3 max-w-xl text-xs text-stone-500">Sensitive answers are encrypted in the database. Each reveal is written to the access log.</p>
    </>
  );
}

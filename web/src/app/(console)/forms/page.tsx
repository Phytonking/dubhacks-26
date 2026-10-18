import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { Card, PageTitle, timeAgo } from "@/components/ui";
import { getDb } from "@/lib/db";
import { ownerAccessConfigured, isOwner } from "@/lib/owner-gate";
import { getCurrentOrg } from "@/lib/queries";
import { logoutOwner } from "./actions";

export default function FormsPage() {
  return (
    <>
      <PageTitle title="Forms" sub="Private details customers sent through secure links." />
      <Suspense fallback={<div className="text-sm text-stone-500">Loading…</div>}><List /></Suspense>
    </>
  );
}

async function List() {
  await connection();
  if (!ownerAccessConfigured()) return <Card><p className="text-sm">Viewing form answers is switched off. Set <code>FORMS_ADMIN_PASSWORD</code> (and <code>FORM_ENC_KEY</code>) on the server to turn it on.</p></Card>;
  if (!(await isOwner())) redirect("/forms/login");
  const org = await getCurrentOrg(); const db = await getDb();
  const subs = await db.collection("form_submissions").find({ orgId: org._id }).sort({ submittedAt: -1 }).limit(100).toArray();
  const contacts = new Map((await db.collection("contacts").find({ _id: { $in: subs.map((s) => s.contactId) } }).project({ name: 1 }).toArray()).map((c) => [String(c._id), c.name as string]));
  const pending = await db.collection("form_requests").countDocuments({ orgId: org._id, status: "pending", expiresAt: { $gt: new Date() } });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm text-stone-500"><span>{pending} link(s) waiting to be filled in</span>
        <form action={logoutOwner}><button className="underline">Sign out</button></form></div>
      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm"><thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-4 py-2">Customer</th><th className="px-4 py-2">Form</th><th className="px-4 py-2">Submitted</th></tr></thead>
          <tbody>{subs.map((s) => (
            <tr key={String(s._id)} className="border-t border-stone-100 hover:bg-stone-50">
              <td className="px-4 py-2"><Link className="font-medium hover:underline" href={`/forms/${s._id}`}>{contacts.get(String(s.contactId)) ?? "Unknown"}</Link></td>
              <td className="px-4 py-2">{s.template}</td><td className="px-4 py-2 text-stone-500">{timeAgo(s.submittedAt)}</td></tr>))}</tbody></table>
        {!subs.length && <p className="p-4 text-sm text-stone-500">Nothing submitted yet.</p>}
      </div>
    </div>
  );
}

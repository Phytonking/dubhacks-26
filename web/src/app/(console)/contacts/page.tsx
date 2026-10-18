import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { PageTitle, StageBadge } from "@/components/ui";
import { getCurrentOrg, listContacts } from "@/lib/queries";

export default function ContactsPage() {
  return (
    <>
      <PageTitle title="Contacts" sub="Everyone your agent has talked to." />
      <Suspense fallback={<div className="text-sm text-stone-500">Loading…</div>}>
        <ContactsTable />
      </Suspense>
    </>
  );
}

async function ContactsTable() {
  await connection();
  const org = await getCurrentOrg();
  const contacts = await listContacts(org._id);
  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
          <tr><th className="px-4 py-2">Name</th><th className="px-4 py-2">Stage</th><th className="px-4 py-2">Score</th><th className="px-4 py-2">Handle</th></tr>
        </thead>
        <tbody>
          {contacts.map((c) => (
            <tr key={c._id.toString()} className="border-t border-stone-100 hover:bg-stone-50">
              <td className="px-4 py-2"><Link className="font-medium hover:underline" href={`/contacts/${c._id}`}>{c.name}</Link></td>
              <td className="px-4 py-2"><StageBadge stage={c.stage} /></td>
              <td className="px-4 py-2">{c.score}</td>
              <td className="px-4 py-2 text-stone-500">{c.handles[0]?.address}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {contacts.length === 0 && <p className="p-4 text-sm text-stone-500">No contacts yet.</p>}
    </div>
  );
}

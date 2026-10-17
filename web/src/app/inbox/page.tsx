import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { setConversationMode } from "@/app/actions";
import { PageTitle, StageBadge, timeAgo } from "@/components/ui";
import { getCurrentOrg, getThread, listConversations } from "@/lib/queries";

export default function InboxPage({ searchParams }: PageProps<"/inbox">) {
  return (
    <>
      <PageTitle title="Inbox" sub="Every customer conversation, across channels." />
      <Suspense fallback={<div className="text-sm text-stone-500">Loading…</div>}>
        <InboxContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function InboxContent({ searchParams }: { searchParams: PageProps<"/inbox">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const org = await getCurrentOrg();
  const convs = await listConversations(org._id);
  const selectedId = typeof sp.c === "string" ? sp.c : convs[0]?._id.toString();
  const thread = selectedId ? await getThread(org._id, selectedId) : null;

  if (convs.length === 0) return <p className="text-sm text-stone-500">No conversations yet.</p>;

  return (
    <div className="grid h-[calc(100vh-10rem)] grid-cols-[320px_1fr] overflow-hidden rounded-xl border border-stone-200 bg-white">
      <ul className="overflow-y-auto border-r border-stone-200">
        {convs.map((c) => (
          <li key={c._id.toString()}>
            <Link
              href={`/inbox?c=${c._id}`}
              className={`block border-b border-stone-100 px-4 py-3 hover:bg-stone-50 ${
                c._id.toString() === selectedId ? "bg-emerald-50" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{c.contact?.name ?? "Unknown"}</span>
                <span className="text-xs text-stone-400">{timeAgo(c.lastMessageAt)}</span>
              </div>
              <div className="truncate text-sm text-stone-500">{c.lastMessagePreview}</div>
              <div className="mt-1 flex gap-2 text-xs">
                <span className="text-stone-400">{c.lastChannel}</span>
                {c.mode === "human" && <span className="font-medium text-amber-700">human</span>}
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {thread ? (
        <section className="flex min-h-0 flex-col">
          <header className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
            <div className="flex items-center gap-3">
              <Link href={`/contacts/${thread.contact?._id}`} className="font-medium hover:underline">
                {thread.contact?.name}
              </Link>
              {thread.contact && <StageBadge stage={thread.contact.stage} />}
            </div>
            <form action={setConversationMode}>
              <input type="hidden" name="id" value={thread.conversation._id.toString()} />
              <input type="hidden" name="mode" value={thread.conversation.mode === "human" ? "agent" : "human"} />
              <button className="rounded-md border border-stone-300 px-3 py-1 text-sm hover:bg-stone-50">
                {thread.conversation.mode === "human" ? "Hand back to agent" : "Take over"}
              </button>
            </form>
          </header>
          <div className="flex-1 space-y-2 overflow-y-auto p-5">
            {thread.messages.map((m) => (
              <div key={m._id.toString()} className={`flex ${m.direction === "in" ? "justify-start" : "justify-end"}`}>
                <div
                  className={`max-w-[70%] rounded-2xl px-3 py-2 text-sm ${
                    m.direction === "in" ? "bg-stone-100" : m.sender === "owner" ? "bg-amber-100" : "bg-emerald-100"
                  }`}
                >
                  {m.body}
                  <div className="mt-1 text-[10px] text-stone-500">
                    {m.sender} · {m.channel} · {timeAgo(m.ts)}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <footer className="border-t border-stone-200 px-5 py-3 text-xs text-stone-400">
            Replying from the console arrives with the Photon channel worker.
          </footer>
        </section>
      ) : (
        <div className="grid place-items-center text-sm text-stone-500">Select a conversation</div>
      )}
    </div>
  );
}

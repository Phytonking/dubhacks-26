import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { loadRequestForRender } from "@/lib/forms-core";
import { SecureForm } from "./form";

export const metadata: Metadata = { title: "Secure form", robots: { index: false, follow: false }, referrer: "no-referrer" };

// GET is read-only on purpose: iMessage, SMS apps and security scanners open links to build previews. Only the submit consumes the link.
export default function FormPage({ params }: PageProps<"/f/[token]">) {
  return (
    <div className="mx-auto w-full max-w-md px-5 py-10">
      <Suspense fallback={<p className="text-stone-500">Loading…</p>}><Content params={params} /></Suspense>
    </div>
  );
}

async function Content({ params }: { params: PageProps<"/f/[token]">["params"] }) {
  await connection();
  const { token } = await params;
  const st = await loadRequestForRender(await getDb(), token);
  if (st.state === "completed") return <p className="rounded-xl bg-stone-100 p-4">This form was already submitted. Thank you.</p>;
  if (st.state !== "valid") return <p className="rounded-xl bg-stone-100 p-4">This link isn&apos;t valid or has expired. Please ask the business to send you a new one.</p>;   // invalid and expired look the same on purpose
  return (
    <>
      {st.brand && <p className="text-sm uppercase tracking-wide text-stone-500">{st.brand}</p>}
      <h1 className="mt-1 text-2xl font-semibold">{st.template.title}</h1>
      <p className="mt-2 text-stone-600">{st.template.intro}</p>
      <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">Your answers are encrypted. We will never ask for card numbers, passwords or codes on this page.</p>
      <div className="mt-5"><SecureForm token={token} template={st.template} /></div>
    </>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { loadMethodForRender } from "@/lib/account-core";
import { MethodForm } from "./form";

export const metadata: Metadata = { title: "Update payment method", robots: { index: false, follow: false }, referrer: "no-referrer" };

// GET is read-only: message apps and scanners open links to build previews. Only a saved card consumes the link.
export default function MethodPage({ params }: PageProps<"/pay/method/[token]">) {
  return (
    <div className="mx-auto w-full max-w-md px-5 py-10">
      <Suspense fallback={<p className="text-stone-500">Loading…</p>}><Content params={params} /></Suspense>
    </div>
  );
}

async function Content({ params }: { params: PageProps<"/pay/method/[token]">["params"] }) {
  await connection();
  const { token } = await params;
  const st = await loadMethodForRender(await getDb(), token);
  if (st.state === "completed") return <p className="rounded-xl bg-stone-100 p-4">Your payment method was already updated. Thank you.</p>;
  if (st.state === "locked") return <p className="rounded-xl bg-stone-100 p-4">This link was locked after too many declined attempts. Please ask for a new one.</p>;
  if (st.state !== "valid") return <p className="rounded-xl bg-stone-100 p-4">This link isn&apos;t valid or has expired. Please ask for a new one.</p>;
  return (
    <>
      {st.brand && <p className="text-sm uppercase tracking-wide text-stone-500">{st.brand}</p>}
      <h1 className="mt-1 text-2xl font-semibold">Update payment method</h1>
      {st.current && <p className="mt-3 rounded-xl border border-stone-200 bg-white p-4 text-sm">Current: {st.current.brand} ending {st.current.last4}</p>}
      <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">Enter your card here, not in a text message. We keep only the card brand and last 4 digits.</p>
      <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Sandbox: nothing is charged. Test card 4242 4242 4242 4242, any future date, any CVC.</p>
      <div className="mt-5"><MethodForm token={token} /></div>
    </>
  );
}

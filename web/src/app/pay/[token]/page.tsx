import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { loadPaymentForRender } from "@/lib/checkout-core";
import { PaymentForm } from "./form";

export const metadata: Metadata = { title: "Secure payment", robots: { index: false, follow: false }, referrer: "no-referrer" };

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

// GET is read-only on purpose: iMessage, SMS apps and security scanners open links to build previews. Only a successful payment consumes the link.
export default function PayPage({ params }: PageProps<"/pay/[token]">) {
  return (
    <div className="mx-auto w-full max-w-md px-5 py-10">
      <Suspense fallback={<p className="text-stone-500">Loading…</p>}><Content params={params} /></Suspense>
    </div>
  );
}

async function Content({ params }: { params: PageProps<"/pay/[token]">["params"] }) {
  await connection();
  const { token } = await params;
  const st = await loadPaymentForRender(await getDb(), token);
  if (st.state === "completed") return <p className="rounded-xl bg-stone-100 p-4">This order was already paid. Thank you.</p>;
  if (st.state === "locked") return <p className="rounded-xl bg-stone-100 p-4">This link was locked after too many declined attempts. Please ask for a new one.</p>;
  if (st.state !== "valid") return <p className="rounded-xl bg-stone-100 p-4">This link isn&apos;t valid or has expired. Please ask for a new one.</p>;   // invalid and expired look the same on purpose
  return (
    <>
      {st.brand && <p className="text-sm uppercase tracking-wide text-stone-500">{st.brand}</p>}
      <h1 className="mt-1 text-2xl font-semibold">Secure payment</h1>
      <div className="mt-4 rounded-xl border border-stone-200 bg-white p-4 text-sm">
        <ul className="space-y-1">{st.items.map((i, n) => <li key={n}>{i.label}</li>)}</ul>
        <p className="mt-3 flex justify-between border-t border-stone-100 pt-3 text-base font-semibold"><span>Due today</span><span>{usd(st.dueTodayCents)}</span></p>
        {st.monthlyCents !== 0 && <p className="mt-1 flex justify-between text-stone-600"><span>Then per month</span><span>{usd(st.monthlyCents)}</span></p>}
      </div>
      <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">Enter your card here, not in a text message. We keep only the card brand and last 4 digits.</p>
      <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Sandbox: nothing is charged. Test card 4242 4242 4242 4242, any future date, any CVC.</p>
      <div className="mt-5"><PaymentForm token={token} dueTodayCents={st.dueTodayCents} /></div>
    </>
  );
}

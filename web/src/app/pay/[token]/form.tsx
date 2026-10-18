"use client";

import { useActionState } from "react";
import { submitPaymentForm, type PayState } from "./actions";

const input = "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-base";
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

export function PaymentForm({ token, dueTodayCents }: { token: string; dueTodayCents: number }) {
  const [state, action, pending] = useActionState<PayState, FormData>(submitPaymentForm.bind(null, token), {});
  if (state.done) {
    return (
      <div role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-900">
        <p className="font-medium">Payment received: {usd(state.done.amountCents)}</p>
        <p className="mt-1 text-sm">Paid with {state.done.brand} ending {state.done.last4}. You can close this page and go back to your messages.</p>
      </div>
    );
  }
  const e = state.errors ?? {};
  const err = (k: string) => e[k] && <span className="mt-1 block text-sm text-rose-700">{e[k]}</span>;
  return (
    <form action={action} className="space-y-4">
      {state.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{state.error}</p>}
      <label className="block text-sm font-medium">Name on card
        <input name="name" type="text" autoComplete="cc-name" maxLength={80} required className={input} />{err("name")}</label>
      <label className="block text-sm font-medium">Card number
        <input name="number" type="text" inputMode="numeric" autoComplete="cc-number" maxLength={23} required className={input} />{err("number")}</label>
      <div className="grid grid-cols-3 gap-3">
        <label className="block text-sm font-medium">Expires
          <input name="exp" type="text" inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY" maxLength={7} required className={input} />{err("exp")}</label>
        <label className="block text-sm font-medium">CVC
          <input name="cvc" type="password" inputMode="numeric" autoComplete="cc-csc" maxLength={4} required className={input} />{err("cvc")}</label>
        <label className="block text-sm font-medium">ZIP
          <input name="zip" type="text" inputMode="numeric" autoComplete="postal-code" maxLength={10} required className={input} />{err("zip")}</label>
      </div>
      <button disabled={pending} className="w-full rounded-lg bg-emerald-700 px-4 py-3 text-base font-medium text-white disabled:opacity-60">{pending ? "Processing…" : `Pay ${usd(dueTodayCents)}`}</button>
    </form>
  );
}

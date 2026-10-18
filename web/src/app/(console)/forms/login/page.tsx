"use client";

import { useActionState } from "react";
import { loginOwner } from "../actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginOwner, {});
  return (
    <div className="max-w-sm">
      <h1 className="text-2xl font-semibold">Owner access</h1>
      <p className="mt-1 text-sm text-stone-500">Form answers can contain private details. Enter the owner password to view them. Set <code>FORMS_ADMIN_PASSWORD</code> on the server to enable this page.</p>
      <form action={action} className="mt-4 space-y-3">
        <input name="password" type="password" autoComplete="current-password" className="w-full rounded-md border border-stone-300 px-3 py-2" />
        {state.error && <p className="text-sm text-rose-700">{state.error}</p>}
        <button disabled={pending} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white">Sign in</button>
      </form>
    </div>
  );
}

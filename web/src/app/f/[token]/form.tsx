"use client";

import { useActionState } from "react";
import type { FormTemplate } from "@/lib/form-templates";
import { submitSecureForm, type FormState } from "./actions";

const input = "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-base";

export function SecureForm({ token, template }: { token: string; template: FormTemplate }) {
  const [state, action, pending] = useActionState<FormState, FormData>(submitSecureForm.bind(null, token), {});
  if (state.done) return <p className="rounded-xl bg-emerald-50 p-4 text-emerald-900">Thank you. Your answers were sent securely. You can close this page.</p>;
  return (
    <form action={action} className="space-y-4" autoComplete="off">
      {state.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{state.error}</p>}
      {template.fields.map((f) => (
        <label key={f.key} className="block text-sm font-medium">
          {f.label}{!f.required && <span className="font-normal text-stone-500"> (optional)</span>}
          {f.type === "textarea" ? <textarea name={f.key} rows={3} maxLength={f.maxLength} className={input} />
            : f.type === "select" ? <select name={f.key} defaultValue="" className={input}><option value="" disabled>Choose…</option>{f.options?.map((o) => <option key={o}>{o}</option>)}</select>
            : <input name={f.key} type={f.type === "tel" ? "tel" : f.type === "email" ? "email" : f.type === "date" ? "date" : "text"} maxLength={f.maxLength} className={input} autoComplete="off" />}
          {state.errors?.[f.key] && <span className="mt-1 block text-sm text-rose-700">{state.errors[f.key]}</span>}
        </label>
      ))}
      <button disabled={pending} className="w-full rounded-lg bg-emerald-700 px-4 py-3 text-base font-medium text-white disabled:opacity-60">{pending ? "Sending…" : "Send securely"}</button>
    </form>
  );
}

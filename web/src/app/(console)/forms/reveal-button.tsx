"use client";

import { useActionState } from "react";
import { reveal, type Revealed } from "./actions";

export function RevealButton({ submissionId, field }: { submissionId: string; field: string }) {
  const [state, action, pending] = useActionState<Revealed, FormData>(reveal.bind(null, submissionId, field), {});
  if (state.value !== undefined) return <span className="font-mono text-sm">{state.value}</span>;
  return (
    <form action={action} className="inline">
      <button disabled={pending} className="rounded border border-stone-300 px-2 py-0.5 text-xs hover:bg-stone-50">{pending ? "…" : "Reveal (logged)"}</button>
      {state.error && <span className="ml-2 text-xs text-rose-700">{state.error}</span>}
    </form>
  );
}

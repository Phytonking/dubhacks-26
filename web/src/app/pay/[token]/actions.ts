"use server";

import { headers } from "next/headers";
import { getDb } from "@/lib/db";
import { submitPayment } from "@/lib/checkout-core";

export type PayState = { done?: { amountCents: number; brand: string; last4: string }; error?: string; errors?: Record<string, string> };

// In-memory brake on guessing/spamming one link (per token and per IP). The token has 256 bits and attempts are capped server-side too; this is defence in depth.
const hits = new Map<string, number[]>();
function limited(key: string, max = 6, windowMs = 60_000) {
  const now = Date.now(); const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs); arr.push(now); hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return arr.length > max;
}

// Card data lives only in `raw` for the duration of this call. It is never logged, stored or returned: errors name fields, never values.
export async function submitPaymentForm(token: string, _prev: PayState, formData: FormData): Promise<PayState> {
  const h = await headers(); const ip = (h.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  if (limited(`t:${token.slice(0, 12)}`) || limited(`ip:${ip}`, 20)) return { error: "Too many attempts. Please wait a minute and try again." };
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) raw[k] = v;
  try {
    const r = await submitPayment(await getDb(), { token, raw });
    if (r.ok) return { done: { amountCents: r.amountCents, brand: r.brand, last4: r.last4 } };
    if (r.error === "validation") return { errors: r.errors };
    if (r.error === "completed") return { error: "This order was already paid. Thank you." };
    if (r.error === "busy") return { error: "Your payment is already being processed. Please wait a moment." };
    if (r.error === "declined" || r.error === "insufficient_funds" || r.error === "processing_error") return { error: `${r.message}${r.attemptsLeft ? ` (${r.attemptsLeft} ${r.attemptsLeft === 1 ? "try" : "tries"} left)` : ""}` };
    if (r.error === "locked") return { error: r.message ?? "Too many declined attempts. Please ask for a new link." };
    return { error: "This link isn't valid or has expired. Please ask for a new one." };
  } catch { return { error: "Something went wrong. Please try again in a moment." }; }
}

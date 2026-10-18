"use server";

import { headers } from "next/headers";
import { getDb } from "@/lib/db";
import { submitForm } from "@/lib/forms-core";

export type FormState = { done?: boolean; error?: string; errors?: Record<string, string> };

// Simple in-memory brake on guessing/spamming one link (per token and per IP). The token itself has 256 bits, so this is defence in depth.
const hits = new Map<string, number[]>();
function limited(key: string, max = 8, windowMs = 60_000) {
  const now = Date.now(); const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs); arr.push(now); hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return arr.length > max;
}

export async function submitSecureForm(token: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const h = await headers(); const ip = (h.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  if (limited(`t:${token.slice(0, 12)}`) || limited(`ip:${ip}`, 30)) return { error: "Too many attempts. Please wait a minute and try again." };
  const values: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) values[k] = v;
  const key = process.env.FORM_ENC_KEY;
  if (!key) return { error: "This form is not available right now. Please contact the business." };   // never store a secret without encryption
  try {
    const r = await submitForm(await getDb(), { token, values, masterKey: key });
    if (r.ok) return { done: true };
    if (r.error === "validation") return { errors: r.errors };
    if (r.error === "completed") return { done: true };
    return { error: "This link isn't valid or has expired. Please ask the business to send a new one." };
  } catch { return { error: "Something went wrong. Please try again in a moment." }; }
}

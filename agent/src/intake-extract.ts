import type { Db, ObjectId } from "mongodb";
import type { LlmPort } from "./engine/types";
import { looksSensitive, redactSensitive } from "./sensitive";

// After a call ends, read the whole transcript once and pull out what the caller said about themselves. The live agent records things as it
// goes (customer_profile_update); this is the safety net, and it fills in what the live turns missed. It only FILLS GAPS: it never overwrites
// something already recorded. The model is told to use only what the CALLER said, never what the agent said.
export type Extracted = {
  first_name?: string; current_carrier?: string; current_plan?: string; monthly_bill_usd?: number; line_count?: number;
  devices?: string[]; budget_usd?: number; needs?: string; interests?: string[]; preferred_contact?: string; notes?: string[];
};

const PROMPT = `You read a phone call transcript between a wireless-store assistant ("agent") and a caller ("user"). Extract ONLY facts the CALLER stated about themselves. Ignore anything only the agent said. Never include passwords, PINs, card numbers, SSNs or one-time codes. Do not guess.
Reply with ONE JSON object and nothing else, using only the keys that apply:
{"first_name": string, "current_carrier": string, "current_plan": string, "monthly_bill_usd": number, "line_count": integer, "devices": [string], "budget_usd": number, "needs": string, "interests": [string], "preferred_contact": "call"|"text"|"whatsapp"|"imessage", "notes": [string]}
If the caller said nothing about themselves, reply {}. Output the JSON object only: no analysis, no explanation, no text before or after it.`;

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() && !looksSensitive(v) ? redactSensitive(v.trim()).text.slice(0, max) : undefined);
const num = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : undefined);
const strs = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) as string[] : undefined);

/** Validate whatever the model returned. Unknown keys, wrong types and anything secret-looking are dropped. */
export function sanitizeExtracted(raw: any): Extracted {
  const o: Extracted = {};
  const set = <K extends keyof Extracted>(k: K, v: Extracted[K] | undefined) => { if (v !== undefined && !(Array.isArray(v) && !v.length)) o[k] = v; };
  set("first_name", str(raw?.first_name, 40)); set("current_carrier", str(raw?.current_carrier, 40)); set("current_plan", str(raw?.current_plan, 80));
  set("monthly_bill_usd", num(raw?.monthly_bill_usd, 5000)); set("budget_usd", num(raw?.budget_usd, 5000));
  const lc = num(raw?.line_count, 20); if (lc !== undefined && Number.isInteger(lc) && lc >= 1) o.line_count = lc;
  set("devices", strs(raw?.devices, 10, 80)); set("interests", strs(raw?.interests, 8, 60)?.map((x) => x.toLowerCase())); set("notes", strs(raw?.notes, 5, 200));
  set("needs", str(raw?.needs, 200));
  if (["call", "text", "whatsapp", "imessage"].includes(raw?.preferred_contact)) o.preferred_contact = raw.preferred_contact;
  return o;
}

export function parseJsonObject(text: string): any {
  const t = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b < a) return {};
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return {}; }
}

export async function extractIntake(llm: LlmPort, transcript: { role: string; message: string }[]): Promise<Extracted> {
  const text = transcript.filter((t) => typeof t.message === "string" && t.message.trim()).map((t) => `${t.role === "user" ? "CALLER" : "AGENT"}: ${redactSensitive(t.message.trim()).text}`).join("\n").slice(-12_000);
  if (!/CALLER:/.test(text)) return {};
  const r = await llm.chat({ messages: [{ role: "system", content: PROMPT }, { role: "user", content: text + "\n\nJSON only:" }], effort: "none", maxTokens: 700, temperature: 0 });
  return sanitizeExtracted(parseJsonObject(r.message.content ?? ""));
}

/** Store on the call, and fill gaps on the contact (never overwrite). A contact with no account becomes a tracked prospect. Returns the fields added to the contact. */
export async function applyExtraction(db: Db, a: { orgId: ObjectId; callId: ObjectId; contactId: ObjectId; ex: Extracted; now: Date }): Promise<string[]> {
  await db.collection("calls").updateOne({ _id: a.callId }, { $set: { extracted: { ...a.ex, at: a.now, live: false } } });
  if (!Object.keys(a.ex).length) return [];
  const c: any = await db.collection("contacts").findOne({ _id: a.contactId, orgId: a.orgId }, { projection: { intake: 1, externalRefs: 1, profile: 1 } });
  if (!c) return [];
  const have = c.intake ?? {}; const set: Record<string, unknown> = {}; const add: Record<string, unknown> = {}; const added: string[] = [];
  for (const k of ["first_name", "current_carrier", "current_plan", "monthly_bill_usd", "line_count", "budget_usd", "needs", "preferred_contact"] as const)
    if (a.ex[k] != null && have[k] == null) { set[`intake.${k}`] = a.ex[k]; added.push(k); }
  const lower = (xs: string[] = []) => new Set(xs.map((x) => x.toLowerCase()));
  for (const k of ["devices", "interests"] as const) { const seen = lower(have[k]); const fresh = (a.ex[k] ?? []).filter((x) => !seen.has(x.toLowerCase())); if (fresh.length) { add[`intake.${k}`] = { $each: fresh }; added.push(k); } }
  { const seen = lower(have.notes); const fresh = (a.ex.notes ?? []).filter((x) => !seen.has(x.toLowerCase())); if (fresh.length) { add["intake.notes"] = { $each: fresh }; added.push("notes"); } }
  if (!added.length) return [];
  set["intake.updatedAt"] = a.now;
  if (a.ex.first_name && !c.profile?.displayName) set["profile.displayName"] = a.ex.first_name;
  const upd: any = { $set: set, $push: { "intake.sources": { $each: [{ at: a.now, callId: a.callId, channel: "voice", via: "post_call" }], $slice: -20 } } };
  if (Object.keys(add).length) upd.$addToSet = add;
  if (!(c.externalRefs ?? []).some((r: any) => r.system === "tmobile")) upd.$push.externalRefs = { system: "tmobile", kind: "prospect", id: String(a.contactId), linkedAt: a.now, via: "intake" };
  await db.collection("contacts").updateOne({ _id: a.contactId, orgId: a.orgId }, upd);
  return added;
}

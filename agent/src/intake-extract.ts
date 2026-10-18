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

const STOP = new Set(["the", "and", "for", "with", "that", "this", "have", "has", "are", "was", "but", "not", "you", "your", "from", "plan", "phone", "phones", "line", "lines"]);
const WORDNUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
/** Keep only what the CALLER's own words support: the model sometimes lifts a name or a plan from the AGENT's lines. Drops anything it cannot find in what the caller said. */
export function supportedByCaller(ex: Extracted, caller: string): Extracted {
  const c = caller.toLowerCase(); const words = new Set(c.match(/[a-z0-9']+/g) ?? []);
  const str = (v: string) => { const t = (v.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !STOP.has(w)); return !t.length || t.filter((w) => words.has(w) || c.includes(w)).length >= Math.ceil(t.length / 2); };
  const num = (n: number) => words.has(String(n)) || [...words].some((w) => WORDNUM[w] === n) || new RegExp(`\\b${n}\\b`).test(c) || (n % 100 === 0 && n >= 100 && /hundred/.test(c)) || (n >= 1000 && /thousand/.test(c));
  const o: Extracted = {};
  if (ex.first_name && words.has(ex.first_name.toLowerCase())) o.first_name = ex.first_name;
  for (const k of ["current_carrier", "current_plan", "needs"] as const) if (ex[k] && str(ex[k]!)) o[k] = ex[k];
  for (const k of ["monthly_bill_usd", "budget_usd", "line_count"] as const) if (ex[k] != null && num(ex[k]!)) o[k] = ex[k];
  for (const k of ["devices", "interests", "notes"] as const) { const v = (ex[k] ?? []).filter(str); if (v.length) o[k] = v; }
  if (ex.preferred_contact && c.includes(ex.preferred_contact === "imessage" ? "imessage" : ex.preferred_contact)) o.preferred_contact = ex.preferred_contact;
  return o;
}

export async function extractIntake(llm: LlmPort, transcript: { role: string; message: string }[]): Promise<Extracted> {
  const text = transcript.filter((t) => typeof t.message === "string" && t.message.trim()).map((t) => `${t.role === "user" ? "CALLER" : "AGENT"}: ${redactSensitive(t.message.trim()).text}`).join("\n").slice(-12_000);
  if (!/CALLER:/.test(text)) return {};
  const r = await llm.chat({ messages: [{ role: "system", content: PROMPT }, { role: "user", content: text + "\n\nJSON only:" }], effort: "none", maxTokens: 700, temperature: 0 });
  const callerText = transcript.filter((t) => t.role === "user" && typeof t.message === "string").map((t) => t.message).join(" ");
  return supportedByCaller(sanitizeExtracted(parseJsonObject(r.message.content ?? "")), callerText);
}

/** Store on the call, and fill gaps on the contact (never overwrite). A contact with no account becomes a tracked prospect. Returns the fields added to the contact. */
export async function applyExtraction(db: Db, a: { orgId: ObjectId; callId?: ObjectId | null; contactId: ObjectId; ex: Extracted; now: Date; channel?: string; via?: string }): Promise<string[]> {
  if (a.callId) await db.collection("calls").updateOne({ _id: a.callId }, { $set: { extracted: { ...a.ex, at: a.now, live: false } } });
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
  const upd: any = { $set: set, $push: { "intake.sources": { $each: [{ at: a.now, ...(a.callId ? { callId: a.callId } : {}), channel: a.channel ?? "voice", via: a.via ?? "post_call" }], $slice: -20 } } };
  if (Object.keys(add).length) upd.$addToSet = add;
  if (!(c.externalRefs ?? []).some((r: any) => r.system === "tmobile")) upd.$push.externalRefs = { system: "tmobile", kind: "prospect", id: String(a.contactId), linkedAt: a.now, via: "intake" };
  await db.collection("contacts").updateOne({ _id: a.contactId, orgId: a.orgId }, upd);
  return added;
}

/**
 * Safety net for the live conversation: when the person said something about themselves and the model did not record it (it sometimes
 * answers instead of calling customer_profile_update), read their message once and fill the gaps. Runs AFTER the reply, never delays it.
 */
export async function learnFromTurn(deps: { db: Db; llm: LlmPort }, a: { orgId: ObjectId; contactId: ObjectId; text: string; recorded: boolean; channel: string; callId?: ObjectId | null; now?: Date }): Promise<string[]> {
  const text = a.text.trim();
  if (a.recorded || text.length < 12 || (!/\d/.test(text) && text.split(/\s+/).length < 5)) return [];
  const ex = await extractIntake(deps.llm, [{ role: "user", message: text }]);
  if (!Object.keys(ex).length) return [];
  return applyExtraction(deps.db, { orgId: a.orgId, callId: a.callId ?? null, contactId: a.contactId, ex, now: a.now ?? new Date(), channel: a.channel, via: "turn" });
}

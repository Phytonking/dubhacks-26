import { looksSensitive } from "../../sensitive";
import type { Tool } from "../types";

// What a person tells us about themselves (name, carrier, plan, phones, lines, budget). Structured so a person can read it in the console and so
// a new customer's record is filled in while the conversation goes on. Only what THEY said; never prices, offers or eligibility; never secrets.
const STR = (max: number) => ({ type: "string", maxLength: max });
export const INTAKE_FIELDS = ["first_name", "current_carrier", "current_plan", "monthly_bill_usd", "line_count", "devices", "budget_usd", "needs", "interests", "preferred_contact", "note"] as const;

export const customer_profile_update: Tool = {
  name: "customer_profile_update", risk: "write_low", timeoutMs: 3000,
  description: "Save what the person just told you about themselves, as soon as they say it: their first name, current carrier, current plan, what they pay per month, how many lines, their phones (and how old), a budget, what they need. Pass only the fields they gave. Safe to call again as you learn more; later answers replace earlier ones. Never store secrets, prices we quoted, or guesses.",
  parameters: { type: "object", properties: {
    first_name: STR(40), current_carrier: STR(40), current_plan: STR(80),
    monthly_bill_usd: { type: "number", minimum: 0, maximum: 5000, description: "what they say they pay now per month" },
    line_count: { type: "integer", minimum: 1, maximum: 20 },
    devices: { type: "array", maxItems: 10, items: STR(80), description: "phones they have, e.g. 'iPhone 13, about 3 years old'" },
    budget_usd: { type: "number", minimum: 0, maximum: 5000, description: "what they want to spend per month" },
    needs: STR(200), interests: { type: "array", maxItems: 8, items: STR(60) },
    preferred_contact: { type: "string", enum: ["call", "text", "whatsapp", "imessage"] },
    note: { ...STR(200), description: "anything else useful they said about themselves" },
  } },
  async run(ctx, a) {
    const set: Record<string, unknown> = {}; const add: Record<string, unknown> = {};
    const strings = [a.first_name, a.current_carrier, a.current_plan, a.needs, a.note, ...(a.devices ?? []), ...(a.interests ?? [])].filter((x) => typeof x === "string") as string[];
    if (strings.some(looksSensitive)) return { ok: false, error: "not_storable", data: { hint: "Never store passwords, PINs, SSNs or card numbers." }, audit: { error: "not_storable", note: "arguments withheld: looked sensitive" } };
    for (const k of ["current_carrier", "current_plan", "monthly_bill_usd", "line_count", "budget_usd", "needs", "preferred_contact"] as const) if (a[k] != null && a[k] !== "") set[`intake.${k}`] = typeof a[k] === "string" ? a[k].trim() : a[k];
    if (a.first_name?.trim()) { set["intake.first_name"] = a.first_name.trim(); }
    if (a.devices?.length) add["intake.devices"] = { $each: a.devices.map((d: string) => d.trim()).filter(Boolean) };
    if (a.interests?.length) add["intake.interests"] = { $each: a.interests.map((d: string) => d.trim().toLowerCase()).filter(Boolean) };
    if (a.note?.trim()) add["intake.notes"] = { $each: [a.note.trim()] };
    if (!Object.keys(set).length && !Object.keys(add).length) return { ok: false, error: "nothing_to_save", data: { hint: "Pass at least one field the person actually told you." } };
    const c: any = await ctx.db.collection("contacts").findOne({ _id: ctx.contactId, orgId: ctx.orgId }, { projection: { intake: 1, externalRefs: 1, profile: 1 } });
    if (!c) return { ok: false, error: "contact_not_found" };
    set["intake.updatedAt"] = ctx.now;
    if (a.first_name?.trim() && !c.profile?.displayName) set["profile.displayName"] = a.first_name.trim();
    const src = { at: ctx.now, ...(ctx.callId ? { callId: ctx.callId } : {}), ...(ctx.sourceMessageId ? { messageId: ctx.sourceMessageId } : {}), channel: ctx.channel };
    const noRef = !(c.externalRefs ?? []).some((r: any) => r.system === "tmobile");
    const upd: any = { $set: set, $push: { "intake.sources": { $each: [src], $slice: -20 } } };
    if (Object.keys(add).length) upd.$addToSet = add;
    // first thing learned about someone with no account: they become a tracked prospect
    if (noRef) upd.$push.externalRefs = { system: "tmobile", kind: "prospect", id: String(ctx.contactId), linkedAt: ctx.now, via: "intake" };
    await ctx.db.collection("contacts").updateOne({ _id: ctx.contactId, orgId: ctx.orgId }, upd);
    if (ctx.callId) await ctx.db.collection("calls").updateOne({ _id: ctx.callId }, { $set: { "extracted.live": true, updatedAt: ctx.now } });
    return { ok: true, data: { status: "saved", fields: Object.keys(set).concat(Object.keys(add)).map((k) => k.replace("intake.", "")).filter((k) => k !== "updatedAt") }, sideEffect: true };
  },
};

/** What is still unknown about a person, in the order worth asking. Drives the "ask naturally, one thing at a time" coaching. */
export function missingIntake(intake: any): string[] {
  const i = intake ?? {}; const out: string[] = [];
  if (!i.first_name) out.push("first name");
  if (!i.current_carrier) out.push("current carrier");
  if (!i.line_count) out.push("how many lines");
  if (!i.devices?.length) out.push("phones they use");
  if (!i.current_plan && !i.monthly_bill_usd) out.push("current plan or monthly bill");
  if (!i.budget_usd && !i.needs) out.push("budget or what matters most");
  return out;
}

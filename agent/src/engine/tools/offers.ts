import type { ObjectId } from "mongodb";
import { isVerified } from "../../customer";
import type { Tool, ToolCtx } from "../types";
import { planTotalCents } from "./tmo-catalog";

const usd = (c: number) => `$${(c / 100).toFixed(2).replace(/\.00$/, "")}`;
const rx = (q: string) => new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").split(/\s+/).join(".*"), "i");

// ---- what a person can actually get: promotions checked against THEIR situation, in code --------------------------------------------------
export type Situation = { new_line?: boolean; port_in?: boolean; trade_in?: boolean; byod?: boolean; buying_device?: string; plan?: string; lines?: number; home_internet?: boolean; student?: boolean };
type Known = Situation & { planFamily?: string; planVariant?: string; planMonthlyCents?: number; deviceSku?: string; tenureMonths?: number | null; supportContacts90d?: number | null; oldestDeviceMonths?: number | null };

/** Which of a promotion's conditions are NOT met yet, in words. Empty = qualifies on what we know. `hard` = cannot be met by anything the customer can choose. */
export function unmetConditions(p: any, k: Known): { unmet: string[]; hard: boolean; unknown: string[] } {
  const unmet: string[] = [], unknown: string[] = []; let hard = false;
  const need = (ok: boolean | undefined, words: string) => { if (!ok) unmet.push(words); };
  if (p.requiresNewLine && !k.new_line && !(p.newLineOrTradein && k.trade_in)) need(false, "adding a new line");
  if (p.requiresPortIn) need(k.port_in, "moving a number over from another carrier");
  if (p.requiresTradein && !k.trade_in && !(p.newLineOrTradein && k.new_line)) need(false, "trading in a phone");
  if (p.requiresDevice || p.deviceSkus?.length) need(Boolean(k.buying_device), "buying a phone");
  if (p.deviceSkus?.length && k.deviceSku && !p.deviceSkus.includes(k.deviceSku)) { unmet.push("buying one of the phones this promotion covers"); hard = true; }
  if (p.requiresByod) need(k.byod, "bringing your own phone");
  if (p.requiresAddonKind) need(k.home_internet, `adding ${String(p.requiresAddonKind).replace(/_/g, " ")}`);
  if (p.planFamilies?.length) {
    if (!k.planFamily) unknown.push("which plan");
    else if (!p.planFamilies.includes(k.planFamily)) { unmet.push(`being on ${p.planFamilies.join(" or ").replace(/_/g, " ")}`); hard = true; }
    else if (p.planVariants?.length && k.planVariant && !p.planVariants.includes(k.planVariant)) { unmet.push("the right plan variant"); hard = true; }
  }
  if (p.minPlanCents && (k.planMonthlyCents ?? 0) < p.minPlanCents) { if (k.planMonthlyCents == null) unknown.push("plan price"); else unmet.push(`a plan of at least ${usd(p.minPlanCents)} a month`); }
  if (p.minLines && (k.lines ?? 0) < p.minLines) need(false, `at least ${p.minLines} lines`);
  if (p.minTenureMonths) { if (k.tenureMonths == null) unknown.push("how long they have been a customer"); else if (k.tenureMonths < p.minTenureMonths) { unmet.push(`${p.minTenureMonths}+ months as a customer`); hard = true; } }
  if (p.minSupportContacts90d) { if (k.supportContacts90d == null) unknown.push("recent support history"); else if (k.supportContacts90d < p.minSupportContacts90d) { unmet.push("recent unresolved support issues"); hard = true; } }
  if (p.minDeviceAgeMonths) { if (k.oldestDeviceMonths == null) unknown.push("age of their current phone"); else if (k.oldestDeviceMonths < p.minDeviceAgeMonths) { unmet.push(`a phone ${p.minDeviceAgeMonths}+ months old`); hard = true; } }
  if (p.discountGroups?.length) { if (p.discountGroups.includes("student") && !k.student) unknown.push("whether they are a verified student"); else if (!p.discountGroups.includes("student")) unknown.push("whether a savings group applies"); }
  if (p.creditTiers?.length) unknown.push("a credit check");
  return { unmet, hard, unknown };
}
const worth = (p: any) => (p.percentOff != null ? `${p.percentOff}% off` : p.valueCents ? `${usd(p.valueCents)}${p.payoutMonths > 1 ? ` as bill credits over ${p.payoutMonths} months` : p.kind === "bill_credit" && /month/i.test(p.description ?? "") ? " per month" : ""}${p.per === "line" ? " per line" : p.per === "device" ? " per phone" : ""}` : "see conditions");

async function account(ctx: ToolCtx): Promise<{ tenure: number | null; support: number | null; oldest: number | null; family?: string; lines?: number } | null> {
  const ref = ctx.party.externalRefs.find((r) => r.system === "tmobile" && r.kind === "account");
  if (!ref || !isVerified(await ctx.db.collection("contacts").findOne({ _id: ctx.contactId, orgId: ctx.orgId }), ctx.now)) return null;   // account facts only after verification
  const doc: any = await ctx.db.collection("tmo_accounts").findOne({ orgId: ctx.orgId, accountId: ref.id }, { projection: { context: 1 } });
  const c = doc?.context; if (!c) return null;
  const ages = (c.lines ?? []).map((l: any) => l.device?.age_months).filter((n: unknown) => typeof n === "number");
  return { tenure: c.tenure_months ?? null, support: c.support?.contacts_90d ?? null, oldest: ages.length ? Math.max(...ages) : null, family: c.lines?.[0]?.plan_family, lines: (c.lines ?? []).length };
}

async function known(ctx: ToolCtx, s: Situation): Promise<Known> {
  const k: Known = { ...s }; const col = (n: string) => ctx.db.collection(n);
  const acct = await account(ctx);
  if (acct) { k.tenureMonths = acct.tenure; k.supportContacts90d = acct.support; k.oldestDeviceMonths = acct.oldest; k.lines ??= acct.lines; }
  const intake = ((await col("contacts").findOne({ _id: ctx.contactId, orgId: ctx.orgId }, { projection: { intake: 1 } })) as any)?.intake;
  k.lines ??= intake?.line_count;
  if (s.plan) { const p: any = (await col("tmo_plans").find({ orgId: ctx.orgId, name: rx(s.plan) }).limit(5).toArray())[0]; if (p) { k.planFamily = p.family; k.planVariant = p.variant; k.planMonthlyCents = planTotalCents(p.linePrices ?? [], p.extraLineCents ?? 0, Math.max(1, k.lines ?? 1)); } }
  else if (acct?.family) k.planFamily = acct.family;
  if (s.buying_device) { const d: any = (await col("tmo_devices").find({ orgId: ctx.orgId, name: rx(s.buying_device) }).limit(5).toArray())[0]; if (d) k.deviceSku = d.sku; }
  return k;
}

const SIT = { type: "object", properties: {
  new_line: { type: "boolean", description: "adding a new line" }, port_in: { type: "boolean", description: "moving a number from another carrier" }, trade_in: { type: "boolean" }, byod: { type: "boolean", description: "bringing their own phone" },
  buying_device: { type: "string", description: "the phone they would buy, e.g. 'iPhone 17'" }, plan: { type: "string", description: "the plan being discussed, e.g. 'Experience More'" },
  lines: { type: "integer", minimum: 1, maximum: 12 }, home_internet: { type: "boolean" }, student: { type: "boolean" } } };

export const tmo_offers: Tool = {
  name: "tmo_offers", risk: "read", timeoutMs: 5000,
  description: "What promotions this person can actually get, checked against their situation in code: for each, whether they qualify now and exactly what they would need to do to qualify (add a line, bring a number, trade in a phone, pick a plan). Use it to find real ways to lower their cost before offering anything yourself. Pass what you know; omit what you do not.",
  parameters: { type: "object", properties: { situation: SIT } },
  async run(ctx, a) {
    const hasAccount = ctx.party.externalRefs.some((r) => r.system === "tmobile" && r.kind === "account");
    const verified = isVerified(await ctx.db.collection("contacts").findOne({ _id: ctx.contactId, orgId: ctx.orgId }), ctx.now);
    const k = await known(ctx, a.situation ?? {});
    const rows: any[] = await ctx.db.collection("tmo_promotions").find({ orgId: ctx.orgId }).toArray();
    const out = rows.map((p) => { const u = unmetConditions(p, k); return { p, ...u }; }).filter((x) => !x.hard).map((x) => ({
      promotion: x.p.name, worth: worth(x.p), qualifies_now: !x.unmet.length && !x.unknown.length,
      to_qualify: x.unmet, still_unknown: x.unknown, _v: x.p.valueCents ?? 0,
    })).sort((a2, b2) => Number(b2.qualifies_now) - Number(a2.qualifies_now) || a2.to_qualify.length - b2.to_qualify.length || b2._v - a2._v).slice(0, 8).map(({ _v, ...r }) => r);
    return { ok: true, data: { offers: out, used_account_facts: k.tenureMonths != null, ...(hasAccount && !verified ? { verify_first: "Their account is on file but they are not verified, so what they personally qualify for (loyalty, goodwill) is not shown. Call verify_send_code now; do not guess." } : {}), note: "Describe what they would need to do and what they would get. 'qualifies_now' is based on what we know; a person confirms the final eligibility." } };
  },
};

// ---- negotiation: a bounded concession ladder, enforced here, not in the prompt -------------------------------------------------------------
export type Authority = { maxMonthlyCreditCents: number; maxMonths: number; maxPct: number; steps: number[]; resetHours: number };
export const DEFAULT_AUTHORITY: Authority = { maxMonthlyCreditCents: 1500, maxMonths: 12, maxPct: 15, steps: [0, 0.33, 0.66, 1], resetHours: 24 };
/** What the customer must actually have SAID for each "give" to count. The model is not allowed to put words in their mouth. */
const GIVE_SAID: Record<string, RegExp> = {
  autopay: /auto.?pay|automatic payment/i, paperless: /paperless|e.?bill/i, trade_in: /trade.?in|trade (in|my|it)/i, upgrade_plan: /upgrade|better plan|step up|bigger plan/i,
  home_internet: /home internet|internet/i,
  add_line: /\b(add|adding|another|extra|second|third|fourth|more|additional)\b[^.?!]{0,25}\blines?\b|\blines?\b[^.?!]{0,15}\b(more|extra|additional)\b|\b(two|three|four|2|3|4) (more )?(lines|phones|numbers)\b/i,
  port_in: /\bport(ing)?\b|bring(ing)?\b[^.?!]{0,25}numbers?|switch(ing)?\b[^.?!]{0,30}(number|carrier|over)|transfer(ring)?\b[^.?!]{0,20}numbers?|moving (my|our|the) numbers?|numbers? over/i,
  keep_12_months: /\byear\b|12 months|twelve months|2 years|contract|commit(ment)?\b|stay (with|for|a)|keep (my |our )?(service|lines?)/i,
};
const GIVES = ["autopay", "add_line", "port_in", "home_internet", "keep_12_months", "trade_in", "upgrade_plan", "paperless"] as const;

/** The most the agent may take off one month, for this plan: the smaller of the money cap and the percentage cap. Whole dollars. */
export function creditCap(planMonthlyCents: number, auth: Authority): number {
  return Math.floor(Math.min(auth.maxMonthlyCreditCents, (planMonthlyCents * auth.maxPct) / 100) / 100) * 100;
}
/** The credit for a ladder round (1-based). Round 1 is always zero: explain value and find real promotions first. */
export function creditForRound(cap: number, round: number, auth: Authority): number {
  const f = auth.steps[Math.min(round - 1, auth.steps.length - 1)] ?? 1;
  return Math.floor((cap * f) / 100) * 100;
}

export const negotiation_offer: Tool = {
  name: "negotiation_offer", risk: "write_low", timeoutMs: 6000,
  description: "Use when the customer pushes back on price and you want to make a concession. Returns the most you are allowed to offer RIGHT NOW (it starts at zero and rises one step each time they push again) and what to ask for in return. You cannot offer more than it returns. Call it once per round of pushback. Always get something in return (autopay, another line, bringing a number, keeping service 12 months).",
  parameters: { type: "object", properties: {
    plan: { type: "string", description: "the plan being discussed" }, lines: { type: "integer", minimum: 1, maximum: 12 },
    customer_gives: { type: "array", items: { type: "string", enum: [...GIVES] }, description: "what the customer has agreed to give in return for a better price" },
    reason: { type: "string", maxLength: 200, description: "why they say it is too high, in their words" } }, required: ["plan"] },
  async run(ctx, a) {
    const agent: any = await ctx.db.collection("agents").findOne({ orgId: ctx.orgId }, { projection: { guardrails: 1 } });
    const auth: Authority = { ...DEFAULT_AUTHORITY, ...(agent?.guardrails?.negotiation ?? {}) };
    const hasAccount = ctx.party.externalRefs.some((r) => r.system === "tmobile" && r.kind === "account");
    const contact: any = await ctx.db.collection("contacts").findOne({ _id: ctx.contactId, orgId: ctx.orgId }, { projection: { memory: 1, intake: 1, verifiedPhone: 1, handles: 1 } });
    if (hasAccount && !isVerified(contact, ctx.now)) return { ok: false, error: "not_verified", data: { hint: "Their account is on file but they are not verified. Send the code (verify_send_code) before discussing changes to their price." } };
    const plan: any = (await ctx.db.collection("tmo_plans").find({ orgId: ctx.orgId, status: "current", name: rx(a.plan) }).limit(5).toArray())[0];
    if (!plan) return { ok: false, error: "plan_not_found", data: { hint: "Look the plan up with tmo_catalog first." } };
    const lines = Math.max(1, a.lines ?? contact?.intake?.line_count ?? 1);
    const total = planTotalCents(plan.linePrices ?? [], plan.extraLineCents ?? 0, lines);
    const neg = contact?.memory?.negotiation ?? {};
    const fresh = neg.at && ctx.now.getTime() - new Date(neg.at).getTime() < auth.resetHours * 3600_000;
    const key = plan.sku;   // the same deal even when the number of lines changes: the conversation keeps its momentum
    const sameDeal = fresh && neg.key === key;
    let round = sameDeal ? (neg.round ?? 0) + 1 : 1;
    const said = ctx.guard.evidence.filter((e) => e.startsWith("USER:")).join("\n");
    const claimed: string[] = [...new Set<string>(a.customer_gives ?? [])];
    const unsupported = claimed.filter((g) => !GIVE_SAID[g]?.test(said));
    const gives: string[] = [...new Set<string>([...(fresh && sameDeal ? neg.gives ?? [] : []), ...claimed.filter((g) => !unsupported.includes(g))])];   // what they have given stays given; only what they actually said counts
    // a concession is never free: pushing again with nothing in return does not climb
    const held = round > 1 && !gives.length;
    if (held) round = neg.round ?? 1;
    // a bigger commitment is rewarded faster: each thing they give lets the offer jump a step, but never on the first ask and never past the ceiling
    const step = round === 1 ? 1 : Math.min(auth.steps.length, Math.max(round, held ? round : 1 + gives.length));
    const cap = creditCap(total, auth);
    const credit = creditForRound(cap, step, auth);
    const atCeiling = credit >= cap || step >= auth.steps.length;
    const offer = credit > 0 && gives.length ? { monthly_credit: usd(credit), for_months: auth.maxMonths, new_monthly_total: usd(total - credit), saves_over_the_term: usd(credit * auth.maxMonths), in_return_for: gives } : null;
    await ctx.db.collection("contacts").updateOne({ _id: ctx.contactId, orgId: ctx.orgId }, { $set: { "memory.negotiation": { at: ctx.now, key, round, step, gives, plan: plan.name, lines, lastCreditCents: offer ? credit : 0, turnId: ctx.turnId } } });
    const more = plan.maxLines == null || lines + 1 <= plan.maxLines ? planTotalCents(plan.linePrices ?? [], plan.extraLineCents ?? 0, lines + 1) : null;
    const ask = [...GIVES].filter((g) => !gives.includes(g)).slice(0, 3);
    const data: Record<string, unknown> = {
      round, plan: plan.name, lines, list_monthly_total: usd(total),
      ...(more != null ? { if_they_add_a_line: { new_total: usd(more), average_per_line: usd(Math.round(more / (lines + 1))), versus_now_per_line: usd(Math.round(total / lines)) } } : {}),
      ...(unsupported.length ? { not_counted: `The customer has not actually agreed to: ${unsupported.join(", ").replace(/_/g, " ")}. Ask them; do not assume.` } : {}),
      allowed_now: offer ?? { monthly_credit: "$0", reason: round === 1 ? "first round: show the value and find real promotions (tmo_offers) before any credit" : "they have not offered anything in return yet" },
      ...(gives.length ? { their_commitments_are_enough: "They have already agreed to give something in return. Do not ask for more; present this offer and ask if they want it." } : { ask_for_in_return: ask.map((g) => g.replace(/_/g, " ")) }),
      can_go_further_if_they_push_again: !atCeiling,
      guidance: atCeiling ? "This is the best you can do. Say so honestly ('this is the most I can do on my own'). If they still want more, offer to have a specialist review it (handoff_escalate); do not invent more." : round === 1 ? "Do not offer a credit yet. Lead with value, then real promotions, then a cheaper plan that fits. Ask what matters most." : "Offer exactly this and no more, and ask for the 'in return' items. Keep a little room: do not say it is your best.",
    };
    return { ok: true, data, audit: { round, creditCents: offer ? credit : 0, capCents: cap, gives }, sideEffect: true };
  },
};

export const negotiation_accept: Tool = {
  name: "negotiation_accept", risk: "write_high", timeoutMs: 5000,
  description: "Call when the customer clearly says yes to what you put to them: the plan at list price, or a concession you offered in an EARLIER message. Records the agreement and tells the team to finish it. Never for a maybe, and never in the same turn you first offered a concession.",
  parameters: { type: "object", properties: { summary: { type: "string", maxLength: 300, description: "what was agreed, in one sentence" }, plan: { type: "string", description: "the plan they agreed to, if no concession was offered" }, lines: { type: "integer", minimum: 1, maximum: 12 } }, required: ["summary"] },
  async run(ctx, a) {
    const contact: any = await ctx.db.collection("contacts").findOne({ _id: ctx.contactId, orgId: ctx.orgId }, { projection: { memory: 1 } });
    const neg = contact?.memory?.negotiation;
    const credit = neg?.lastCreditCents ?? 0;
    if (credit > 0 && neg.turnId === ctx.turnId) return { ok: false, error: "offer_not_presented_yet", data: { hint: "You only just made this offer in this same turn; the customer has not heard it. Tell them the offer and wait for their answer." } };
    const planName = neg?.plan ?? a.plan;
    if (!planName) return { ok: false, error: "needs_plan", data: { hint: "Say which plan they agreed to (plan, lines)." } };
    const offer = { creditCents: credit, months: DEFAULT_AUTHORITY.maxMonths, plan: planName, lines: neg?.lines ?? a.lines ?? 1, gives: neg?.gives ?? [], summary: a.summary, status: "accepted", at: ctx.now };
    await ctx.db.collection("contacts").updateOne({ _id: ctx.contactId, orgId: ctx.orgId }, { $push: { "memory.offers": offer } as never, $unset: { "memory.negotiation": "" } });
    // The sale itself: an order (what was agreed and what it is worth per month) and an approval for the team to finish. The console reads both.
    const plan: any = (await ctx.db.collection("tmo_plans").find({ orgId: ctx.orgId, status: "current", name: rx(planName) }).limit(1).toArray())[0];
    const listCents = plan ? planTotalCents(plan.linePrices ?? [], plan.extraLineCents ?? 0, offer.lines) : 0;
    const monthlyCents = Math.max(0, listCents - credit);
    const items = `${planName}, ${offer.lines} line${offer.lines === 1 ? "" : "s"}${credit ? `, ${usd(credit)}/mo credit for ${offer.months} months` : " at list price"}`;
    const orderKey = { orgId: ctx.orgId, conversationId: ctx.conversationId, status: "pending", item: planName };   // one open order per plan per conversation: a repeated "yes" updates it
    const orderSet = { contactId: ctx.contactId, amountCents: monthlyCents, listCents, creditCents: credit, months: offer.months, lines: offer.lines, summary: a.summary, items, source: "agent", turnId: ctx.turnId, updatedAt: ctx.now };
    await ctx.db.collection("orders").updateOne(orderKey, { $set: orderSet, $setOnInsert: { createdAt: ctx.now } }, { upsert: true });
    await ctx.db.collection("approvals").updateOne({ orgId: ctx.orgId, conversationId: ctx.conversationId, status: "texted", plan: planName },
      { $set: { contactId: ctx.contactId, items, amountCents: monthlyCents, sentAt: ctx.now, updatedAt: ctx.now }, $setOnInsert: { createdAt: ctx.now, checkout: "", resendCount: 0 } }, { upsert: true });
    await ctx.db.collection("notifications").insertOne({ orgId: ctx.orgId, contactId: ctx.contactId, conversationId: ctx.conversationId, kind: "deal", message: `Customer accepted: ${a.summary}${credit ? ` (${usd(credit)}/mo credit for ${offer.months} months on ${planName})` : ` (${planName} at list price)`}. Please finish the order.`, urgency: "high", read: false, createdAt: ctx.now } as never);
    return { ok: true, data: { status: "recorded", next: "Tell them it is noted and a team member will finish setting it up and confirm. Do not say it is already applied." }, sideEffect: true };
  },
};
export type { ObjectId };

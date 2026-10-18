import type { Db, ObjectId } from "mongodb";
import { checkoutStatus, CheckoutError, createPaymentRequest, createQuote, DEFAULT_OWNER_LIMIT_CENTS, type QuoteItem } from "../../../../web/src/lib/checkout-core";
import type { Tool } from "../types";
import { reachHint } from "./reach";
import { planTotalCents } from "./tmo-catalog";

// Sales and checkout for the agent. The model chooses WHAT the customer wants; the server prices it, decides whether the owner must approve,
// sends the payment link, and reports the outcome. The model never types an amount into a charge, never sees the link, and never sees card data.
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const CREDIT: Record<string, { downPct: number; apr: number }> = { prime: { downPct: 0, apr: 0 }, near_prime: { downPct: 0.1, apr: 0.049 }, subprime: { downPct: 0.2, apr: 0.099 } };
const FINANCE_MONTHS = 24;
const TRADEIN_MAX_AGE = 60;

/** Monthly payment for an amortized loan (0% APR is a straight split). Whole cents. */
export function monthlyPayment(principalCents: number, apr: number, months = FINANCE_MONTHS): number {
  if (principalCents <= 0) return 0;
  if (!apr) return Math.round(principalCents / months);
  const r = apr / 12;
  return Math.round((principalCents * r) / (1 - Math.pow(1 + r, -months)));
}

const rx = (q: string) => new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").split(/\s+/).join(".*"), "i");
/** Pick exactly one catalog row: exact name, else the only name that starts with the words, else the only name containing them. Ambiguity is an error the model can act on. */
function pickOne(allRows: any[], q: string, what: string): { row: any } | { error: string; options?: string[] } {
  const k = q.trim().toLowerCase();
  // discount variants ("... w/ 55+ Savings") only when the customer's words point at one; "Experience More" means the standard plan
  const wantsVariant = /\bw\/|55|partner|community|senior|military|saver|offer/.test(k);
  const rows = what === "plan" && !wantsVariant ? allRows.filter((r) => !/ w\/ /.test(String(r.name))) : allRows;
  const exact = rows.filter((r) => String(r.name).toLowerCase() === k);
  if (exact.length === 1) return { row: exact[0] };
  const starts = rows.filter((r) => String(r.name).toLowerCase().startsWith(k));
  if (starts.length === 1) return { row: starts[0] };
  const hits = starts.length ? starts : rows;
  if (hits.length === 1) return { row: hits[0] };
  if (!hits.length) return { error: `no ${what} matches "${q}"` };
  return { error: `"${q}" matches more than one ${what}; ask which one`, options: hits.slice(0, 6).map((r) => r.name) };
}

type Acct = { creditTier: string; discountGroup: string | null; lines: any[]; haveAccount: boolean };
async function loadAccount(ctx: Parameters<Tool["run"]>[0]): Promise<Acct> {
  const ref = ctx.party.externalRefs.find((r) => r.system === "tmobile" && r.kind === "account");
  const doc: any = ref ? await ctx.db.collection("tmo_accounts").findOne({ orgId: ctx.orgId, accountId: ref.id }, { projection: { context: 1, discountGroup: 1 } }) : null;
  const c = doc?.context;
  return { creditTier: c?.credit_tier ?? "prime", discountGroup: c?.discount_group ?? doc?.discountGroup ?? null, lines: c?.lines ?? [], haveAccount: Boolean(c) };
}

async function ownerLimit(db: Db, orgId: ObjectId): Promise<number> {
  const org: any = await db.collection("orgs").findOne({ _id: orgId }, { projection: { ownerLimitCents: 1 } });
  const agent: any = await db.collection("agents").findOne({ orgId }, { projection: { guardrails: 1 } });
  return org?.ownerLimitCents ?? agent?.guardrails?.ownerLimitCents ?? DEFAULT_OWNER_LIMIT_CENTS;
}

export const checkout_quote: Tool = {
  name: "checkout_quote", risk: "write_low", timeoutMs: 6000,
  description: "Price what the customer wants to buy (plan, phones, add-ons, optional trade-in) EXACTLY, from the catalog. Returns what is due today and per month and whether the owner must approve. Use it before saying any total. Read the result back and get a clear yes before sending the payment link. A new quote replaces the previous one.",
  parameters: { type: "object", properties: {
    use_accepted_offer: { type: "boolean", description: "true to price the plan, lines and monthly credit the customer just agreed to through negotiation_accept (taken from our record of what they accepted, never from you)" },
    plan: { type: "string", description: "plan name, e.g. 'Experience Beyond'" },
    lines: { type: "integer", minimum: 1, maximum: 12, description: "how many lines on that plan" },
    phones: { type: "array", maxItems: 6, items: { type: "object", properties: {
      device: { type: "string", description: "phone name, e.g. 'iPhone 17'" },
      payment: { type: "string", enum: ["financed", "full"], description: "financed (24 months, default) or pay in full today" },
      trade_in_who: { type: "string", description: "account holders only: which line's current phone they trade in (name or label). Only the first phone gets the credit." },
    }, required: ["device"] } },
    addons: { type: "array", maxItems: 8, items: { type: "object", properties: { name: { type: "string" }, qty: { type: "integer", minimum: 1, maximum: 10 } }, required: ["name"] } },
  } },
  async run(ctx, a) {
    const col = (n: string) => ctx.db.collection(n);
    const acct = await loadAccount(ctx);
    const credit = CREDIT[acct.creditTier] ?? CREDIT.prime;
    const items: QuoteItem[] = []; const notes: string[] = []; const names: string[] = [];
    const fail = (error: string, hint: string, extra: Record<string, unknown> = {}) => ({ ok: false as const, error, data: { hint, ...extra } });

    let offerAt: Date | null = null;
    let accepted: any = null;
    if (a.use_accepted_offer) {
      const c: any = await col("contacts").findOne({ _id: ctx.contactId, orgId: ctx.orgId }, { projection: { memory: 1 } });
      accepted = [...(c?.memory?.offers ?? [])].reverse().find((o: any) => o.status === "accepted");
      if (!accepted) return fail("no_accepted_offer", "There is no accepted, unused offer on record for this customer. Price what they asked for directly (plan, lines).");
      if (!a.plan) a.plan = accepted.plan;
      if (a.lines == null) a.lines = accepted.lines;
    }
    if (a.plan) {
      const lines = Number(a.lines ?? 1);
      const rows: any[] = await col("tmo_plans").find({ orgId: ctx.orgId, status: { $in: ["current", "limited_time"] } }).toArray();
      const p = pickOne(rows, String(a.plan), "plan"); if ("error" in p) return fail("plan_not_found", p.error, { options: p.options });
      const plan = p.row;
      if (lines < (plan.minLines ?? 1) || (plan.maxLines != null && lines > plan.maxLines)) return fail("plan_line_limit", `${plan.name} allows ${plan.minLines ?? 1}${plan.maxLines != null ? `-${plan.maxLines}` : "+"} lines, not ${lines}.`);
      if (plan.eligibility && plan.eligibility !== acct.discountGroup) return fail("plan_not_eligible", `${plan.name} is only for ${String(plan.eligibility).replace("_", " ")} accounts. Offer the standard version instead.`);
      const list = planTotalCents(plan.linePrices ?? [], plan.extraLineCents ?? 0, lines);
      const conn = (plan.deviceConnectionCents ?? 0) * lines;
      // a concession the customer accepted (recorded by negotiation_accept) applies only to the plan and lines it was made for, for the months it was offered
      const sameDeal = accepted && String(accepted.plan).toLowerCase() === String(plan.name).toLowerCase() && Number(accepted.lines ?? lines) === lines;
      if (a.use_accepted_offer && !sameDeal) return fail("offer_does_not_match", `The accepted offer was for ${accepted.plan}, ${accepted.lines} line(s). Quote exactly that, or quote this plan at list price without use_accepted_offer.`);
      const credit = sameDeal ? Math.min(accepted.creditCents ?? 0, list) : 0;
      if (sameDeal) offerAt = new Date(accepted.at);
      items.push({ kind: "plan", sku: plan.sku, label: `${plan.name}, ${lines} line${lines > 1 ? "s" : ""}${credit ? `, with the ${usd(credit)}/mo credit you agreed` : ""}`, qty: lines, dueTodayCents: conn, monthlyCents: list - credit, ...(credit ? { creditCents: credit, creditMonths: accepted.months } : {}) });
      if (credit) notes.push(`the ${usd(credit)} a month credit lasts ${accepted.months} months; after that the list price of ${usd(list)} a month applies`);
      names.push(`${plan.name} (${lines} line${lines > 1 ? "s" : ""})`);
      if (plan.pricesIncludeAutopay) notes.push("plan prices assume AutoPay");
    }

    const phones: any[] = Array.isArray(a.phones) ? a.phones : [];
    const boughtTiers: number[] = [];
    if (phones.length) {
      const devs: any[] = await col("tmo_devices").find({ orgId: ctx.orgId, status: "current" }).toArray();
      let creditUsed = false;
      for (const ph of phones) {
        const d = pickOne(devs, String(ph.device), "phone"); if ("error" in d) return fail("phone_not_found", d.error, { options: d.options });
        const dev = d.row; boughtTiers.push(dev.protectionTier);
        let price = dev.msrpCents as number, balanceOwed = 0, droppedMonthly = 0, creditApplied = 0, label = dev.name as string;
        if (ph.trade_in_who && !creditUsed) {
          if (!acct.haveAccount) return fail("no_account", "Trade-ins need an account on file. Tell them you can look into it after they are verified, or price the phone without one.");
          const who = String(ph.trade_in_who).toLowerCase();
          const names = new Map<string, string>(((ctx.party.contact as any).profile?.household ?? []).map((h: any) => [h.lineId, String(h.name).toLowerCase()]));
          const line = acct.lines.find((l) => names.get(l.line_id) === who || String(l.member_label).toLowerCase() === who || String(l.line_id).toLowerCase() === who) ?? (acct.lines.length === 1 ? acct.lines[0] : null);
          if (!line?.device) return fail("tradein_line_not_found", "I could not tell which line's phone is being traded in. Ask which line.", { lines: acct.lines.map((l) => names.get(l.line_id) ?? l.member_label) });
          if (!line.tradein_eligible) return fail("not_tradein_eligible", "That line's phone cannot be traded in.");
          const old: any = await col("tmo_devices").findOne({ orgId: ctx.orgId, sku: line.device.sku });
          creditApplied = Math.min(price, old?.tradeinCurve?.[Math.min(line.device.age_months, TRADEIN_MAX_AGE)] ?? 0);
          if (line.financing && !line.financing.paid_off) { balanceOwed = line.financing.balance_cents; droppedMonthly = line.financing.monthly_installment_cents; }
          creditUsed = true; label += ` with ${line.device.name} trade-in`;
        }
        price -= creditApplied;
        if ((ph.payment ?? "financed") === "full") {
          items.push({ kind: "device", sku: dev.sku, label: `${label}, paid in full`, qty: 1, dueTodayCents: price + balanceOwed, monthlyCents: -droppedMonthly });
        } else {
          const down = Math.round(price * credit.downPct);
          items.push({ kind: "device", sku: dev.sku, label: `${label}, financed over ${FINANCE_MONTHS} months`, qty: 1, dueTodayCents: down + balanceOwed, monthlyCents: monthlyPayment(price - down, credit.apr) - droppedMonthly });
        }
        if (creditApplied) items.push({ kind: "tradein", label: `Trade-in credit ${usd(creditApplied)} applied`, qty: 1, dueTodayCents: 0, monthlyCents: 0 });
        if (balanceOwed) notes.push(`trading in a phone still being paid off means its remaining balance (${usd(balanceOwed)}) is due today and its old monthly payment stops`);
        names.push(dev.name);
      }
      notes.push(acct.haveAccount ? `financing uses the account's ${acct.creditTier.replace("_", "-")} credit terms` : "financing terms assume standard credit and are subject to approval");
    }

    const addons: any[] = Array.isArray(a.addons) ? a.addons : [];
    if (addons.length) {
      const rows: any[] = await col("tmo_addons").find({ orgId: ctx.orgId }).toArray();
      for (const ad of addons) {
        const p = pickOne(rows, String(ad.name), "add-on"); if ("error" in p) return fail("addon_not_found", p.error, { options: p.options });
        const x = p.row, qty = Number(ad.qty ?? 1);
        if (x.kind === "protection") {
          if (!boughtTiers.includes(x.protectionTier)) return fail("protection_tier_mismatch", `${x.name} only covers phones in protection tier ${x.protectionTier}. Match it to the phone in this order (tier ${boughtTiers.join("/") || "none yet"}), or add the phone first.`);
        }
        items.push({ kind: "addon", sku: x.sku, label: `${x.name}${qty > 1 ? ` x${qty}` : ""}`, qty, dueTodayCents: (x.oneTimeCents ?? 0) * qty, monthlyCents: (x.monthlyCents ?? 0) * qty });
        names.push(x.name);
      }
    }
    if (!items.length) return fail("nothing_to_quote", "Say what they want: a plan with a number of lines, a phone, or an add-on.");

    let q;
    try { q = await createQuote(ctx.db, { orgId: ctx.orgId, contactId: ctx.contactId, conversationId: ctx.conversationId, items, summary: names.join(", "), offerAt, ownerLimitCents: await ownerLimit(ctx.db, ctx.orgId), now: ctx.now }); }
    catch (e) { if (e instanceof CheckoutError) return fail(e.code, e.message); throw e; }
    return {
      ok: true, sideEffect: true,
      data: {
        quote_id: String(q.id), items: items.map((i) => ({ item: i.label, due_today: usd(i.dueTodayCents), per_month: i.monthlyCents ? usd(i.monthlyCents) : null })),
        due_today: usd(q.dueTodayCents), per_month_after: usd(q.monthlyCents), requires_owner_approval: q.requiresApproval, notes,
        status: q.status,
        next: q.status === "approved"
          ? "The owner already approved this exact order. Do not quote again: tell them it is approved and, after a clear yes, call checkout_send_payment_link."
          : q.requiresApproval
          ? "This is over the owner's limit and now waits for their approval. Tell the customer the total, that it needs a quick approval, and that you will message them when it is approved. Do not send a payment link yet."
          : "Read the items and totals back and ask if they want to go ahead. Only after a clear yes, call checkout_send_payment_link.",
      },
      audit: { quote_id: String(q.id), due_today_cents: q.dueTodayCents, monthly_cents: q.monthlyCents, requires_approval: q.requiresApproval },
    };
  },
};

export const checkout_send_payment_link: Tool = {
  name: "checkout_send_payment_link", risk: "write_high", timeoutMs: 10_000,
  description: "Text the customer a private, one-time link to pay for the current quote by card. Only after they clearly said yes to the quoted total. They enter the card on that page, never in chat. You never see the link or the card, and the amount cannot be changed. If they offer to type or say a card number, stop them and use this instead.",
  parameters: { type: "object", properties: { customer_confirmed: { type: "boolean", description: "true only if the customer clearly agreed to the quoted total" } }, required: ["customer_confirmed"] },
  async run(ctx, a) {
    if (a.customer_confirmed !== true) return { ok: false, error: "not_confirmed", data: { hint: "Read the total back and get a clear yes first." } };
    // account holders must prove they hold the number before a purchase on their account; prospects are paying with their own card for their own order
    if (ctx.customer.status === "linked_account" && !ctx.customer.verified) return { ok: false, error: "not_verified", data: { hint: "The customer is not verified. Offer a one-time code (verify_send_code) before sending a payment link." } };
    const quote: any = await ctx.db.collection("checkout_quotes").findOne({ orgId: ctx.orgId, contactId: ctx.contactId, conversationId: ctx.conversationId, status: { $in: ["open", "approved", "awaiting_approval", "declined"] } }, { sort: { createdAt: -1, _id: -1 } });
    if (!quote) return { ok: false, error: "no_quote", data: { hint: "Make a quote first (checkout_quote)." } };
    let req;
    try { req = await createPaymentRequest(ctx.db, { orgId: ctx.orgId, contactId: ctx.contactId, conversationId: ctx.conversationId, quoteId: quote._id, now: ctx.now }); }
    catch (e) { if (e instanceof CheckoutError) return { ok: false, error: e.code, data: { hint: e.message } }; throw e; }
    const link = `${ctx.env.publicFormsBaseUrl.replace(/\/$/, "")}/pay/${req.token}`;
    const sent = await ctx.messenger.send({
      orgId: ctx.orgId, contactId: ctx.contactId, conversationId: ctx.conversationId, purpose: "payment_link", agentTurnId: ctx.turnId,
      body: `${ctx.env.brandFallback}: Pay securely here: ${link} ${quote.summary}, ${usd(quote.dueTodayCents)} due today. The link expires in ${req.minutes} minutes. Never send your card number by text. Reply STOP to opt out.`,
      redact: "[secure payment link sent]", idempotencyKey: `pay:${req.id}`,
      channels: ctx.channel === "voice" ? undefined : [ctx.channel, "imessage", "whatsapp", "sms"],
    });
    if (!sent.ok) {
      await ctx.db.collection("payment_requests").updateOne({ _id: req.id }, { $set: { status: "revoked" } });
      if (sent.error === "no_channel") {
        const reach = await reachHint(ctx, "form");
        return { ok: false, error: "no_channel", data: { hint: "We cannot text them yet. Tell them which number to message, then stop.", ...reach.data }, sideEffect: true, reply: reach.reply };
      }
      return { ok: false, error: sent.error, data: sent.error === "no_consent" ? { hint: "Ask if you may text them a payment link, then call consent_record." } : undefined };
    }
    return { ok: true, data: { status: "sent", via: sent.channel, due_today: usd(quote.dueTodayCents), expires_in_minutes: req.minutes, next: "Tell them it is on the way and to pay on that page. Never ask for card details in chat." }, audit: { status: "sent", quote_id: String(quote._id), via: sent.channel }, sideEffect: true };
  },
};

export const checkout_status: Tool = {
  name: "checkout_status", risk: "read", timeoutMs: 3000,
  description: "Check where this customer's purchase stands: waiting for owner approval, link sent and waiting, paid (with card brand and last 4 only), declined card, or locked after too many attempts. Never returns the link or card details.",
  parameters: { type: "object", properties: {} },
  async run(ctx) {
    const s: any = await checkoutStatus(ctx.db, ctx.orgId, ctx.contactId, ctx.conversationId, ctx.now);
    if (s.status === "none") return { ok: true, data: { status: "none" } };
    const { due_today_cents, monthly_cents, amount_paid_cents, ...rest } = s;
    return { ok: true, data: { ...rest, due_today: usd(due_today_cents), per_month: usd(monthly_cents), ...(amount_paid_cents != null ? { amount_paid: usd(amount_paid_cents) } : {}) } };
  },
};

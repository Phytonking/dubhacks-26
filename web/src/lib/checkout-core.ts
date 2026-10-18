import { createHash } from "node:crypto";
import type { Db, ObjectId } from "mongodb";
import { newToken, hashToken } from "./forms-core";

// Checkout: quote -> approval (if over the owner's limit) -> one-time payment link -> mock charge -> order.
// Imported by the web app (payment page, owner approvals) AND by the agent (quote + link tools), so there is one implementation. No Next.js imports.
//
// Card data rules (the point of this file):
//  * The agent never sees a card number, expiry, CVC or the link. Chat text is redacted before it is stored (agent/src/sensitive.ts).
//  * The card goes only to the payment page; submitPayment() hands it to the gateway and keeps NOTHING of it except brand and last 4 digits.
//    No PAN, expiry or CVC is written to Mongo, to the thread, to tool_calls or to a log line, not even encrypted.
//  * The amount is fixed server-side in the quote. The page cannot change it, and the agent cannot either.
//  * A link is single-use for a successful payment, expires, allows a few declined attempts, and is claimed atomically so a double submit charges once.

export const PAYMENT_LINK_MINUTES = 30;
export const QUOTE_HOURS = 24;
export const MAX_ATTEMPTS = 3;
export const DEFAULT_OWNER_LIMIT_CENTS = 150_000;   // same default the console shows

// ---- card validation ----------------------------------------------------------------------------------------------
export const digitsOnly = (s: string) => s.replace(/\D/g, "");
export function luhn(d: string): boolean { let sum = 0, alt = false; for (let i = d.length - 1; i >= 0; i--) { let n = Number(d[i]); if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; } return d.length > 0 && sum % 10 === 0; }
export type Brand = "visa" | "mastercard" | "amex" | "discover" | "unknown";
export function cardBrand(d: string): Brand {
  if (/^4/.test(d)) return "visa";
  if (/^(5[1-5]|2(2[2-9][1-9]|2[3-9]|[3-6]|7[01]|720))/.test(d)) return "mastercard";
  if (/^3[47]/.test(d)) return "amex";
  if (/^(6011|65|64[4-9])/.test(d)) return "discover";
  return "unknown";
}
export type ValidCard = { number: string; expMonth: number; expYear: number; cvc: string; zip: string; name: string; brand: Brand; last4: string };
export type CardValidation = { ok: true; card: ValidCard } | { ok: false; errors: Record<string, string> };
export function validateCard(raw: Record<string, unknown>, now = new Date()): CardValidation {
  const s = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string).trim() : "");
  const errors: Record<string, string> = {};
  const number = digitsOnly(s("number")), brand = cardBrand(number);
  if (number.length < 13 || number.length > 19 || !luhn(number) || brand === "unknown") errors.number = "Enter a valid card number";
  const m = s("exp").match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/);
  let expMonth = 0, expYear = 0;
  if (!m) errors.exp = "Use MM/YY";
  else {
    expMonth = Number(m[1]); expYear = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    const endOfMonth = Date.UTC(expYear, expMonth, 1) - 1;
    if (expMonth < 1 || expMonth > 12) errors.exp = "Enter a valid month";
    else if (endOfMonth < now.getTime()) errors.exp = "This card has expired";
  }
  const cvc = digitsOnly(s("cvc"));
  if (!/^\d+$/.test(s("cvc")) || cvc.length !== (brand === "amex" ? 4 : 3)) errors.cvc = brand === "amex" ? "4 digits" : "3 digits";
  const zip = s("zip");
  if (!/^\d{5}(-\d{4})?$/.test(zip)) errors.zip = "Enter a 5-digit ZIP";
  const name = s("name");
  if (name.length < 2 || name.length > 80) errors.name = "Enter the name on the card";
  for (const k of Object.keys(raw)) if (!["number", "exp", "cvc", "zip", "name"].includes(k) && !k.startsWith("$") && k !== "token") errors[k] = "Unexpected field";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, card: { number, expMonth, expYear, cvc, zip, name, brand, last4: number.slice(-4) } };
}

// ---- gateway ------------------------------------------------------------------------------------------------------
export type ChargeResult = { ok: true; authCode: string; brand: Brand; last4: string } | { ok: false; reason: "declined" | "insufficient_funds" | "processing_error" };
export interface Gateway { name: string; charge(a: { amountCents: number; card: ValidCard; idempotencyKey: string }): Promise<ChargeResult> }
/** Sandbox processor. Nothing is charged. Well-known test numbers pick the outcome; the same idempotency key always gives the same auth code. */
export const mockGateway: Gateway = {
  name: "mock",
  async charge({ amountCents, card, idempotencyKey }) {
    if (!(amountCents > 0)) return { ok: false, reason: "processing_error" };
    if (card.number === "4000000000000002") return { ok: false, reason: "declined" };
    if (card.number === "4000000000009995") return { ok: false, reason: "insufficient_funds" };
    if (card.number === "4000000000000119") return { ok: false, reason: "processing_error" };
    return { ok: true, authCode: `MOCK-${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 8).toUpperCase()}`, brand: card.brand, last4: card.last4 };
  },
};
const FAIL_TEXT: Record<string, string> = {
  declined: "That card was declined. Please try a different card.",
  insufficient_funds: "That card doesn't have enough available funds. Please try a different card.",
  processing_error: "We couldn't process that card right now. Please try again or use a different card.",
};

// ---- quotes -------------------------------------------------------------------------------------------------------
export type QuoteItem = { kind: "plan" | "device" | "addon" | "tradein"; sku?: string; label: string; qty: number; dueTodayCents: number; monthlyCents: number; creditCents?: number; creditMonths?: number };
export type QuoteStatus = "open" | "awaiting_approval" | "approved" | "paid" | "payment_failed" | "declined" | "cancelled";
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

export async function createQuote(db: Db, a: { orgId: ObjectId; contactId: ObjectId; conversationId: ObjectId; items: QuoteItem[]; summary: string; ownerLimitCents?: number; offerAt?: Date | null; now?: Date }) {
  const now = a.now ?? new Date();
  const dueTodayCents = a.items.reduce((n, i) => n + i.dueTodayCents, 0);
  const monthlyCents = a.items.reduce((n, i) => n + i.monthlyCents, 0);
  if (!(dueTodayCents > 0)) throw new CheckoutError("nothing_due", "Nothing is due today, so there is nothing to charge. Tell the customer what happens next instead of sending a payment link.");
  const limit = a.ownerLimitCents ?? DEFAULT_OWNER_LIMIT_CENTS;
  const requiresApproval = dueTodayCents > limit;
  // the same order quoted again (a model that re-checks, a customer who repeats themselves) returns the live quote: it must not reset an approval or a link
  const sig = (xs: QuoteItem[]) => JSON.stringify(xs.map((i) => [i.kind, i.sku ?? i.label, i.qty, i.dueTodayCents, i.monthlyCents]));
  const live: any = await db.collection("checkout_quotes").findOne({ orgId: a.orgId, conversationId: a.conversationId, status: { $in: ["open", "awaiting_approval", "approved"] }, expiresAt: { $gt: now } }, { sort: { createdAt: -1, _id: -1 } });
  if (live && sig(live.items) === sig(a.items) && live.dueTodayCents === dueTodayCents && String(live.offerAt ?? "") === String(a.offerAt ?? "")) {
    const ap: any = await db.collection("approvals").findOne({ quoteId: live._id }, { sort: { createdAt: -1 } });
    return { id: live._id, approvalId: ap?._id ?? null, dueTodayCents, monthlyCents, requiresApproval: live.requiresApproval as boolean, status: live.status as QuoteStatus, existing: true as const };
  }
  // one live quote per conversation: a new quote replaces the old one (and its pending approval and links)
  const olds = await db.collection("checkout_quotes").find({ orgId: a.orgId, conversationId: a.conversationId, status: { $in: ["open", "awaiting_approval", "approved"] } }).project({ _id: 1 }).toArray();
  if (olds.length) {
    const ids = olds.map((o) => o._id);
    await db.collection("checkout_quotes").updateMany({ _id: { $in: ids } }, { $set: { status: "cancelled", updatedAt: now } });
    await db.collection("payment_requests").updateMany({ quoteId: { $in: ids }, status: "pending" }, { $set: { status: "revoked" } });
    await db.collection("approvals").updateMany({ quoteId: { $in: ids }, status: "texted" }, { $set: { status: "cancelled", resolvedAt: now, resolvedBy: "agent", checkout: "Replaced by a newer quote", updatedAt: now } });
  }
  const ins = await db.collection("checkout_quotes").insertOne({
    orgId: a.orgId, contactId: a.contactId, conversationId: a.conversationId, items: a.items, summary: a.summary.slice(0, 200), dueTodayCents, monthlyCents, requiresApproval,
    ownerLimitCents: limit, offerAt: a.offerAt ?? null, status: requiresApproval ? "awaiting_approval" : "open", expiresAt: new Date(now.getTime() + QUOTE_HOURS * 3600_000), createdAt: now, updatedAt: now,
  } as never);
  let approvalId: ObjectId | null = null;
  if (requiresApproval) {
    const ap = await db.collection("approvals").insertOne({
      orgId: a.orgId, conversationId: a.conversationId, contactId: a.contactId, quoteId: ins.insertedId, items: a.summary.slice(0, 200), amountCents: dueTodayCents, limitCents: limit,
      status: "texted", sentAt: now, checkout: "Waiting for the owner", createdAt: now, updatedAt: now,
    } as never);
    approvalId = ap.insertedId;
    await db.collection("notifications").insertOne({ orgId: a.orgId, contactId: a.contactId, conversationId: a.conversationId, kind: "approval", message: `Approval needed: ${a.summary} (${usd(dueTodayCents)} due today, over your ${usd(limit)} limit)`, urgency: "high", read: false, createdAt: now } as never);
  }
  return { id: ins.insertedId, approvalId, dueTodayCents, monthlyCents, requiresApproval, status: (requiresApproval ? "awaiting_approval" : "open") as QuoteStatus, existing: false as const };
}

/** Owner decision on an over-limit quote. Idempotent per decision; a resolved approval cannot be flipped. */
export async function resolveApproval(db: Db, a: { orgId: ObjectId; approvalId: ObjectId; decision: "approved" | "declined"; by?: string; now?: Date }) {
  const now = a.now ?? new Date();
  const ap: any = await db.collection("approvals").findOneAndUpdate(
    { _id: a.approvalId, orgId: a.orgId, status: "texted" },
    { $set: { status: a.decision, resolvedAt: now, resolvedBy: a.by ?? "human", checkout: a.decision === "approved" ? "Approved: customer can pay" : "Declined by owner", updatedAt: now } }, { returnDocument: "after" });
  if (!ap) return { ok: false as const, error: "not_pending" };
  if (ap.quoteId) {
    await db.collection("checkout_quotes").updateOne({ _id: ap.quoteId, orgId: a.orgId, status: "awaiting_approval" }, { $set: { status: a.decision === "approved" ? "approved" : "declined", updatedAt: now } });
    if (a.decision === "declined") await db.collection("payment_requests").updateMany({ quoteId: ap.quoteId, status: "pending" }, { $set: { status: "revoked" } });
  }
  if (ap.conversationId) {   // a notice in the thread makes the agent take a turn and tell the customer
    const q: any = ap.quoteId ? await db.collection("checkout_quotes").findOne({ _id: ap.quoteId }) : null;
    await systemNotice(db, ap, a.decision === "approved" ? `Order approved by the owner: ${q?.summary ?? "your order"}. The customer can now pay` : `Order declined by the owner: ${q?.summary ?? "your order"}`, `approval:${ap._id}`, now);
  }
  return { ok: true as const };
}

// ---- payment links ------------------------------------------------------------------------------------------------
export class CheckoutError extends Error { constructor(public code: string, msg: string) { super(msg); } }

export async function createPaymentRequest(db: Db, a: { orgId: ObjectId; contactId: ObjectId; conversationId: ObjectId; quoteId: ObjectId; now?: Date }) {
  const now = a.now ?? new Date();
  const q: any = await db.collection("checkout_quotes").findOne({ _id: a.quoteId, orgId: a.orgId, contactId: a.contactId });
  if (!q) throw new CheckoutError("no_quote", "No such quote for this customer.");
  if (q.status === "awaiting_approval") throw new CheckoutError("approval_required", "This order is over the owner's limit and is waiting for their approval. Tell the customer it is waiting and that you will let them know; do not send a payment link yet.");
  if (q.status === "declined") throw new CheckoutError("declined", "The owner declined this order. Do not offer payment; offer a person to follow up.");
  if (q.status === "paid") throw new CheckoutError("already_paid", "This quote was already paid.");
  if (q.status !== "open" && q.status !== "approved") throw new CheckoutError("quote_closed", `This quote is ${q.status}. Make a new quote.`);
  if (q.expiresAt.getTime() <= now.getTime()) throw new CheckoutError("quote_expired", "This quote expired. Make a new quote so the prices are current.");
  const token = newToken();
  await db.collection("payment_requests").updateMany({ quoteId: a.quoteId, status: "pending" }, { $set: { status: "revoked" } });   // one live link per quote
  const expiresAt = new Date(now.getTime() + PAYMENT_LINK_MINUTES * 60_000);
  const r = await db.collection("payment_requests").insertOne({
    orgId: a.orgId, contactId: a.contactId, conversationId: a.conversationId, quoteId: a.quoteId, tokenHash: hashToken(token), status: "pending", attempts: 0, expiresAt, createdAt: now, completedAt: null,
  } as never);
  return { id: r.insertedId, token, expiresAt, minutes: PAYMENT_LINK_MINUTES };
}

export type PaymentRender =
  | { state: "valid"; brand: string; items: { label: string; qty: number }[]; dueTodayCents: number; monthlyCents: number; attemptsLeft: number }
  | { state: "invalid" | "expired" | "completed" | "locked" };
/** READ ONLY. Link-preview bots call this through GET; it must never consume or alter the link. */
export async function loadPaymentForRender(db: Db, token: string, now = new Date()): Promise<PaymentRender> {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return { state: "invalid" };
  const req: any = await db.collection("payment_requests").findOne({ tokenHash: hashToken(token) });
  if (!req) return { state: "invalid" };
  if (req.status === "completed") return { state: "completed" };
  if (req.status === "locked") return { state: "locked" };
  if ((req.status !== "pending" && req.status !== "processing") || req.expiresAt.getTime() <= now.getTime()) return { state: "expired" };
  const q: any = await db.collection("checkout_quotes").findOne({ _id: req.quoteId });
  if (!q || (q.status !== "open" && q.status !== "approved")) return { state: "expired" };
  const org: any = await db.collection("orgs").findOne({ _id: req.orgId }, { projection: { name: 1 } });
  return { state: "valid", brand: org?.name ?? "", items: q.items.map((i: QuoteItem) => ({ label: i.label, qty: i.qty })), dueTodayCents: q.dueTodayCents, monthlyCents: q.monthlyCents, attemptsLeft: Math.max(0, MAX_ATTEMPTS - (req.attempts ?? 0)) };
}

export type PayResult =
  | { ok: true; amountCents: number; last4: string; brand: Brand; authCode: string }
  | { ok: false; error: "invalid" | "expired" | "completed" | "busy" | "validation" | "declined" | "insufficient_funds" | "processing_error" | "locked"; message?: string; errors?: Record<string, string>; attemptsLeft?: number };

export async function submitPayment(db: Db, a: { token: string; raw: Record<string, unknown>; gateway?: Gateway; now?: Date }): Promise<PayResult> {
  const now = a.now ?? new Date();
  const st = await loadPaymentForRender(db, a.token, now);
  if (st.state === "completed") return { ok: false, error: "completed" };
  if (st.state === "locked") return { ok: false, error: "locked", message: "Too many declined attempts. Please ask for a new link." };
  if (st.state !== "valid") return { ok: false, error: st.state === "expired" ? "expired" : "invalid" };
  const v = validateCard(a.raw, now);
  if (!v.ok) return { ok: false, error: "validation", errors: v.errors };   // errors name fields only; they never echo what was typed
  // claim the link: of two simultaneous submits only one gets to charge. A claim stuck for 2 minutes (crash) can be retaken; the idempotency key keeps a retry from double charging.
  const claimed: any = await db.collection("payment_requests").findOneAndUpdate(
    { tokenHash: hashToken(a.token), expiresAt: { $gt: now }, $or: [{ status: "pending" }, { status: "processing", processingAt: { $lt: new Date(now.getTime() - 120_000) } }] },
    { $set: { status: "processing", processingAt: now }, $inc: { attempts: 1 } }, { returnDocument: "after" });
  if (!claimed) { const again = await loadPaymentForRender(db, a.token, now); return { ok: false, error: again.state === "completed" ? "completed" : "busy" }; }
  const quote: any = await db.collection("checkout_quotes").findOne({ _id: claimed.quoteId, orgId: claimed.orgId });
  // defence in depth: the link should not exist before approval, but never charge an unapproved over-limit quote
  if (!quote || (quote.status !== "open" && quote.status !== "approved")) { await db.collection("payment_requests").updateOne({ _id: claimed._id }, { $set: { status: "revoked" } }); return { ok: false, error: "expired" }; }
  const gateway = a.gateway ?? mockGateway;
  let res: ChargeResult;
  try { res = await gateway.charge({ amountCents: quote.dueTodayCents, card: v.card, idempotencyKey: String(claimed._id) }); }
  catch { res = { ok: false, reason: "processing_error" }; }
  if (!res.ok) {
    const attemptsLeft = Math.max(0, MAX_ATTEMPTS - claimed.attempts);
    await db.collection("payment_requests").updateOne({ _id: claimed._id }, { $set: { status: attemptsLeft ? "pending" : "locked", lastFailure: res.reason, processingAt: null } });
    if (!attemptsLeft) {
      await db.collection("checkout_quotes").updateOne({ _id: quote._id }, { $set: { status: "payment_failed", updatedAt: now } });
      await db.collection("notifications").insertOne({ orgId: claimed.orgId, contactId: claimed.contactId, conversationId: claimed.conversationId, kind: "payment_failed", message: `Payment failed ${MAX_ATTEMPTS} times: ${quote.summary}`, urgency: "high", read: false, createdAt: now } as never);
    }
    await marker(db, claimed, `Payment not completed (${FAIL_TEXT[res.reason].replace(/\.$/, "")})${attemptsLeft ? "" : ". The link is locked after too many attempts"}`, now);
    return { ok: false, error: res.reason, message: FAIL_TEXT[res.reason], attemptsLeft };
  }
  // success: record the payment (brand + last 4 only), the order the console counts as a sale, and close the quote and the link
  await db.collection("payments").updateOne({ requestId: claimed._id }, {
    $setOnInsert: { orgId: claimed.orgId, contactId: claimed.contactId, conversationId: claimed.conversationId, quoteId: quote._id, requestId: claimed._id, amountCents: quote.dueTodayCents, brand: res.brand, last4: res.last4, authCode: res.authCode, gateway: gateway.name, status: "succeeded", createdAt: now },
  }, { upsert: true });
  await db.collection("orders").updateOne({ orgId: claimed.orgId, conversationId: claimed.conversationId }, { $setOnInsert: { contactId: claimed.contactId, amountCents: 0, quoteIds: [], status: "paid", source: "agent_checkout", createdAt: now } }, { upsert: true });
  await db.collection("orders").updateOne({ orgId: claimed.orgId, conversationId: claimed.conversationId, quoteIds: { $ne: quote._id } },
    { $inc: { amountCents: quote.dueTodayCents }, $addToSet: { quoteIds: quote._id }, $set: { item: quote.summary, status: "paid", source: "agent_checkout", monthlyCents: quote.monthlyCents, updatedAt: now } });
  await db.collection("checkout_quotes").updateOne({ _id: quote._id }, { $set: { status: "paid", paidAt: now, updatedAt: now } });
  // a negotiated concession is used up by the purchase it was priced into (the customer's accepted offer, matched by its timestamp)
  if (quote.offerAt) await db.collection("contacts").updateOne({ _id: claimed.contactId, orgId: claimed.orgId, "memory.offers.at": quote.offerAt }, { $set: { "memory.offers.$.status": "redeemed", "memory.offers.$.redeemedAt": now, "memory.offers.$.quoteId": quote._id } });
  await db.collection("payment_requests").updateOne({ _id: claimed._id }, { $set: { status: "completed", completedAt: now, processingAt: null } });
  await db.collection("notifications").insertOne({ orgId: claimed.orgId, contactId: claimed.contactId, conversationId: claimed.conversationId, kind: "sale", message: `Sale: ${quote.summary}, ${usd(quote.dueTodayCents)} paid (${res.brand} ending ${res.last4})`, urgency: "normal", read: false, createdAt: now } as never);
  await marker(db, claimed, `Payment completed: ${usd(quote.dueTodayCents)} paid by ${res.brand} ending ${res.last4}. Order recorded${quote.monthlyCents ? `; ${usd(quote.monthlyCents)}/mo going forward` : ""}`, now);
  return { ok: true, amountCents: quote.dueTodayCents, last4: res.last4, brand: res.brand, authCode: res.authCode };
}

/** What the agent may know about a customer's checkout: state, amounts, brand and last 4. Never the link, never card data. */
export async function checkoutStatus(db: Db, orgId: ObjectId, contactId: ObjectId, conversationId: ObjectId, now = new Date()) {
  const q: any = await db.collection("checkout_quotes").findOne({ orgId, contactId, conversationId }, { sort: { createdAt: -1, _id: -1 } });
  if (!q) return { status: "none" as const };
  const out: Record<string, unknown> = { status: q.status, summary: q.summary, due_today_cents: q.dueTodayCents, monthly_cents: q.monthlyCents, requires_owner_approval: q.requiresApproval };
  if (q.status === "paid") { const p: any = await db.collection("payments").findOne({ quoteId: q._id }, { sort: { createdAt: -1, _id: -1 } }); if (p) { out.paid_with = `${p.brand} ending ${p.last4}`; out.amount_paid_cents = p.amountCents; } }
  const r: any = await db.collection("payment_requests").findOne({ quoteId: q._id }, { sort: { createdAt: -1, _id: -1 } });
  if (r) { out.link = r.status === "pending" && r.expiresAt.getTime() > now.getTime() ? "sent_and_waiting" : r.status; out.declined_attempts = r.lastFailure ? r.attempts : 0; if (r.lastFailure) out.last_failure = r.lastFailure; }
  return out as { status: QuoteStatus | "none" } & Record<string, unknown>;
}

// A plain notice in the thread. The agent's next turn reads it ("Payment completed...") and replies; it contains no card data.
export async function systemNotice(db: Db, a: { orgId: ObjectId; conversationId: ObjectId }, body: string, key: string, now: Date) {
  const conv: any = await db.collection("conversations").findOne({ _id: a.conversationId });
  if (!conv) return;
  await db.collection("messages").insertOne({ orgId: a.orgId, conversationId: conv._id, channel: conv.lastChannel ?? "sms", direction: "in", sender: "customer",
    body, channelMsgId: key, deliveryStatus: "received", handling: conv.mode === "human" ? "human" : "agent", ts: now } as never).catch(() => {});
  await db.collection("conversations").updateOne({ _id: conv._id }, { $set: { lastMessageAt: now, lastMessagePreview: body.slice(0, 80) } });
  if (conv.mode !== "human") await wake(db, conv._id, now);
}
const marker = (db: Db, req: any, body: string, now: Date) => systemNotice(db, req, body, `pay:${req._id}:${req.attempts ?? 0}`, now);
/** Make the conversation lane due so the scheduler runs a turn (same fields the worker sets when a text arrives). */
async function wake(db: Db, conversationId: ObjectId, now: Date) {
  await db.collection("conversations").updateOne({ _id: conversationId }, [{ $set: { "lane.state": { $ifNull: ["$lane.state", "idle"] }, "lane.firstAt": { $ifNull: ["$lane.firstAt", now] }, "lane.dueAt": new Date(now.getTime() + 1500) } }] as never);
}

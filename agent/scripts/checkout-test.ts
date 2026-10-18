// Sales + checkout: quote, owner approval, one-time payment link, card handling, order, console. pnpm exec tsx scripts/checkout-test.ts
// No network: in-memory Mongo, scripted model, loopback channels, mock payment gateway.
import { ObjectId } from "mongodb";
import { executeTool } from "../src/engine/turn";
import { ALL_TOOLS } from "../src/engine/tools/index";
import { monthlyPayment } from "../src/engine/tools/checkout";
import { asksForSecrets, redactSensitive } from "../src/sensitive";
import { cardBrand, checkoutStatus, createPaymentRequest, createQuote, loadPaymentForRender, luhn, mockGateway, resolveApproval, submitPayment, validateCard, type Gateway } from "../../web/src/lib/checkout-core";
import { Worker } from "../src/recorded-io";
import { runTurn } from "../src/engine/turn";
import { ScriptedLlm, ok, t, finish, makeKit } from "./_testkit";

const kit = await makeKit({ groundMoney: true });
const { db, orgId, adapters } = kit;
const NOW = kit.now.t;

const imp = (rows: any[]) => rows.map((r) => ({ ...r, importedAt: NOW }));   // the tmo_* validators require importedAt
// ---- catalog + one account holder (credit tier near_prime, a financed phone, a paid-off phone) ----
await db.collection("tmo_plans").insertMany(imp([
  { orgId, sku: "P-MORE", name: "Experience More 2.0", status: "current", family: "experience_more", variant: "standard", linePrices: [9000, 6000, 3500, 3500, 3500], extraLineCents: 3500, minLines: 1, maxLines: null, eligibility: null, deviceConnectionCents: 3500, pricesIncludeAutopay: true },
  { orgId, sku: "P-55", name: "Experience More w/ 55+ Savings 2.0", status: "current", family: "experience_more", variant: "senior_55", linePrices: [7500, 3500], extraLineCents: 3500, minLines: 1, maxLines: 2, eligibility: "55_plus", deviceConnectionCents: 3500 },
  { orgId, sku: "P-SAVER", name: "Essentials Saver 2.0", status: "current", family: "essentials", variant: "saver", linePrices: [5500, 3500], extraLineCents: 3500, minLines: 1, maxLines: 2, eligibility: null, deviceConnectionCents: null },
]) as never);
const curve = (v: number) => Array.from({ length: 61 }, (_, a) => Math.max(0, Math.round(v * (1 - a / 70))));
await db.collection("tmo_devices").insertMany(imp([
  { orgId, sku: "D-17", name: "iPhone 17", status: "current", tier: "flagship", msrpCents: 83000, protectionTier: 4, tradeinCurve: curve(83000) },
  { orgId, sku: "D-17PM", name: "iPhone 17 Pro Max", status: "current", tier: "flagship", msrpCents: 189900, protectionTier: 6, tradeinCurve: curve(189900) },
  { orgId, sku: "D-17E", name: "iPhone 17e", status: "current", tier: "mid", msrpCents: 59900, protectionTier: 3, tradeinCurve: curve(59900) },
  { orgId, sku: "D-13", name: "iPhone 13", status: "legacy", tier: "flagship", msrpCents: 79900, protectionTier: 4, tradeinCurve: curve(79900) },
  { orgId, sku: "D-S24", name: "Galaxy S24", status: "legacy", tier: "flagship", msrpCents: 79900, protectionTier: 4, tradeinCurve: curve(79900) },
]) as never);
await db.collection("tmo_addons").insertMany(imp([
  { orgId, sku: "A-PROT4", name: "Device Protection Tier 4", kind: "protection", protectionTier: 4, monthlyCents: 1600, oneTimeCents: 0 },
  { orgId, sku: "A-PROT6", name: "Device Protection Tier 6", kind: "protection", protectionTier: 6, monthlyCents: 2600, oneTimeCents: 0 },
  { orgId, sku: "A-CASE", name: "Silicone Case", kind: "accessory", protectionTier: null, monthlyCents: 0, oneTimeCents: 4999 },
]) as never);

const toolCtx = async (contactId = kit.contactId, conversationId = kit.conversationId, o: { linked?: boolean; verified?: boolean; acct?: string; household?: any[] } = {}) => {
  const contact: any = await db.collection("contacts").findOne({ _id: contactId });
  const conversation: any = await db.collection("conversations").findOne({ _id: conversationId });
  return { db, orgId, contactId, conversationId, channel: "imessage" as const, mode: "text" as const,
    party: { contact: { ...contact, profile: { household: o.household ?? [] } }, conversation, address: contact.handles[0].address, created: false, matchedBy: "channel_handle" as const, externalRefs: o.linked ? [{ system: "tmobile", id: o.acct ?? "ACC-T1", kind: "account" }] : [] },
    customer: { status: o.linked ? "linked_account" : "prospect", verified: o.verified ?? false } as never, turnId: "turn-x", sourceMessageId: null, now: NOW, messenger: kit.messenger,
    env: kit.deps(new ScriptedLlm([])).env, guard: { cfg: { maxDiscountPct: 10 }, evidence: [] as string[] } };
};
const call = async (name: string, args: unknown, ctx: any) => { const r = await executeTool(kit.deps(new ScriptedLlm([])), ctx, { id: `c${Math.random()}`, type: "function", function: { name, arguments: JSON.stringify(args) } }); return { ...r, data: r.result.data as any }; };
const grantConsent = (id = kit.contactId) => db.collection("contacts").updateOne({ _id: id }, { $set: { "consent.text": { granted: true, at: NOW, source: "test" } } });
const sentLink = (n = adapters.imessage.sent.length - 1) => adapters.imessage.sent[n]?.text.match(/https:\/\/forms\.example\.test\/pay\/([A-Za-z0-9_-]+)/)?.[1] ?? "";
// the per-number hourly cap (6 proactive texts) is a real limit; each scenario below stands for a separate hour
const freshLimits = () => db.collection("messages").deleteMany({ purpose: { $exists: true } });
const sendLink = async (ctx: any) => { await freshLimits(); const r = await call("checkout_send_payment_link", { customer_confirmed: true }, ctx); ok(r.result.ok, "send link: " + JSON.stringify(r.result)); return sentLink(); };
const CARD = { name: "Pat Lee", number: "4242 4242 4242 4242", exp: "09/31", cvc: "737", zip: "98101" };
const everything = async () => JSON.stringify(await Promise.all((await db.listCollections().toArray()).map(async (c) => ({ c: c.name, d: await db.collection(c.name).find({}).toArray() }))));
const keysOf = (v: any, out = new Set<string>()): Set<string> => { if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out); } return out; };
await grantConsent();

// ======================= cards and the gateway =======================
await t("cards: Luhn, brand, expiry, CVC length (4 for Amex), ZIP; errors name fields and never echo the card", async () => {
  ok(luhn("4242424242424242") && !luhn("4242424242424241"), "luhn");
  ok(cardBrand("4242424242424242") === "visa" && cardBrand("5555555555554444") === "mastercard" && cardBrand("378282246310005") === "amex" && cardBrand("6011111111111117") === "discover" && cardBrand("9999") === "unknown", "brands");
  const good = validateCard(CARD, NOW); ok(good.ok && good.card.last4 === "4242" && good.card.expYear === 2031, "valid card");
  const amex = validateCard({ ...CARD, number: "3782 822463 10005", cvc: "1234" }, NOW); ok(amex.ok, "amex 4-digit cvc");
  const amexBad = validateCard({ ...CARD, number: "378282246310005", cvc: "123" }, NOW); ok(!amexBad.ok && !!amexBad.errors.cvc, "amex needs 4");
  ok(!validateCard({ ...CARD, exp: "01/26" }, NOW).ok, "expired card rejected (Oct 2026 asked)");
  ok(validateCard({ ...CARD, exp: "10/26" }, NOW).ok, "this month is still valid");
  const bad = validateCard({ ...CARD, number: "4242 4242 4242 4241", zip: "ab", extra: "x" }, NOW);
  ok(!bad.ok && bad.errors.number && bad.errors.zip && bad.errors.extra, "errors by field");
  ok(!JSON.stringify(bad).includes("4242"), "error object never echoes the number");
});
await t("gateway: test numbers pick the outcome; same idempotency key gives the same auth code", async () => {
  const card = (n: string) => { const v = validateCard({ ...CARD, number: n }, NOW); if (!v.ok) throw new Error("card"); return v.card; };
  const a = await mockGateway.charge({ amountCents: 100, card: card("4242424242424242"), idempotencyKey: "k1" }), b = await mockGateway.charge({ amountCents: 100, card: card("4242424242424242"), idempotencyKey: "k1" });
  ok(a.ok && b.ok && a.authCode === b.authCode, "idempotent");
  ok((await mockGateway.charge({ amountCents: 100, card: card("4000000000000002"), idempotencyKey: "k" })).ok === false, "declined");
  const f = await mockGateway.charge({ amountCents: 100, card: card("4000000000009995"), idempotencyKey: "k" }); ok(!f.ok && f.reason === "insufficient_funds", "insufficient");
  const e = await mockGateway.charge({ amountCents: 100, card: card("4000000000000119"), idempotencyKey: "k" }); ok(!e.ok && e.reason === "processing_error", "processing error");
});

// ======================= pricing (checkout_quote) =======================
await t("quote: plan with lines is exact (3 lines on More = $185/mo + $105 connection), and it replaces the previous quote", async () => {
  const ctx = await toolCtx();
  const r = await call("checkout_quote", { plan: "Experience More", lines: 3 }, ctx);
  ok(r.result.ok && r.data.per_month_after === "$185.00" && r.data.due_today === "$105.00" && r.data.requires_owner_approval === false, JSON.stringify(r.data));
  const r2 = await call("checkout_quote", { plan: "Experience More", lines: 4 }, ctx);
  ok(r2.data.per_month_after === "$220.00", "4 lines " + JSON.stringify(r2.data));
  const open = await db.collection("checkout_quotes").find({ conversationId: kit.conversationId, status: "open" }).toArray();
  ok(open.length === 1 && (await db.collection("checkout_quotes").countDocuments({ conversationId: kit.conversationId, status: "cancelled" })) === 1, "one live quote");
});
await t("quote: phone full price, financed prime (0 down), protection must match the phone's tier, add-on accessory is due today", async () => {
  const ctx = await toolCtx();
  const full = await call("checkout_quote", { phones: [{ device: "iPhone 17", payment: "full" }] }, ctx); ok(full.data.due_today === "$830.00" && full.data.per_month_after === "$0.00", JSON.stringify(full.data));
  const fin = await call("checkout_quote", { phones: [{ device: "iPhone 17" }] }, ctx);
  ok(fin.result.error === "nothing_due" || fin.data?.hint?.includes("Nothing is due"), "financed prime with nothing down is $0 due today: " + JSON.stringify(fin.data));
  const withCase = await call("checkout_quote", { phones: [{ device: "iPhone 17" }], addons: [{ name: "Silicone Case" }, { name: "Device Protection Tier 4" }] }, ctx);
  ok(withCase.result.ok && withCase.data.due_today === "$49.99" && withCase.data.per_month_after === `$${((monthlyPayment(83000, 0) + 1600) / 100).toFixed(2)}`, JSON.stringify(withCase.data));
  const mism = await call("checkout_quote", { phones: [{ device: "iPhone 17" }], addons: [{ name: "Device Protection Tier 6" }] }, ctx);
  ok(!mism.result.ok && mism.result.error === "protection_tier_mismatch", "tier mismatch");
  const amb = await call("checkout_quote", { phones: [{ device: "iPhone 17" , payment: "full" }, { device: "iPhone" }] }, ctx);
  ok(!amb.result.ok && amb.result.error === "phone_not_found" && Array.isArray(amb.data.options), "ambiguous phone is an error the model can act on: " + JSON.stringify(amb.data));
});
await t("quote: plan limits and eligibility are enforced (55+ plan needs the discount group, Saver max 2 lines)", async () => {
  const ctx = await toolCtx();
  const a = await call("checkout_quote", { plan: "Experience More w/ 55+", lines: 1 }, ctx); ok(!a.result.ok && a.result.error === "plan_not_eligible", JSON.stringify(a.result));
  const b = await call("checkout_quote", { plan: "Essentials Saver", lines: 3 }, ctx); ok(!b.result.ok && b.result.error === "plan_line_limit", JSON.stringify(b.result));
  ok((await call("checkout_quote", {}, ctx)).result.error === "nothing_to_quote", "empty");
});
await t("quote: near-prime account pays 10% down and finances the rest at 4.9% over 24 months; financed trade-in charges the old balance today", async () => {
  const { contactId, conversationId } = await kit.newContact("+14255550177", { externalRefs: [{ system: "tmobile", id: "ACC-T1", kind: "account" }], verifiedPhone: { number: "+14255550177", at: NOW } });
  await grantConsent(contactId);
  await db.collection("tmo_accounts").insertOne({ orgId, accountId: "ACC-T1", importedAt: NOW, context: { credit_tier: "near_prime", discount_group: null, lines: [
    { line_id: "L1", member_label: "Line 1", tradein_eligible: true, device: { sku: "D-13", name: "iPhone 13", age_months: 14 }, financing: { paid_off: false, balance_cents: 21000, months_remaining: 8, monthly_installment_cents: 2625 } },
    { line_id: "L2", member_label: "Line 2", tradein_eligible: true, device: { sku: "D-S24", name: "Galaxy S24", age_months: 30 }, financing: { paid_off: true, balance_cents: 0, months_remaining: 0, monthly_installment_cents: 0 } },
  ] } } as never);
  const ctx = await toolCtx(contactId, conversationId, { linked: true, verified: true, household: [{ lineId: "L1", name: "Maya" }, { lineId: "L2", name: "Dev" }] });
  const credit1 = curve(79900)[14];
  const r = await call("checkout_quote", { phones: [{ device: "iPhone 17", trade_in_who: "Maya" }] }, ctx);
  const price = 83000 - credit1, down = Math.round(price * 0.1), dueToday = down + 21000, monthly = monthlyPayment(price - down, 0.049) - 2625;
  ok(r.result.ok && r.data.due_today === `$${(dueToday / 100).toFixed(2)}` && r.data.per_month_after === `$${(monthly / 100).toFixed(2)}`, `${JSON.stringify(r.data)} want due ${dueToday} monthly ${monthly}`);
  ok(r.data.notes.some((n: string) => /remaining balance/.test(n)), "says the old balance is due today");
  const paidOff = await call("checkout_quote", { phones: [{ device: "iPhone 17", payment: "full", trade_in_who: "Dev" }] }, ctx);
  ok(paidOff.data.due_today === `$${((83000 - curve(79900)[30]) / 100).toFixed(2)}`, "paid-off trade-in has no balance: " + JSON.stringify(paidOff.data));
  const unknown = await call("checkout_quote", { phones: [{ device: "iPhone 17", trade_in_who: "Zed" }] }, ctx);
  ok(!unknown.result.ok && unknown.result.error === "tradein_line_not_found", "unknown line");
  ok((await call("checkout_quote", { phones: [{ device: "iPhone 17", trade_in_who: "Maya" }] }, await toolCtx())).result.error === "no_account", "prospect cannot trade in");
});

// ======================= sending the link =======================
await t("link: needs a clear yes; account holders must be verified; the model never sees the link; only a hash is stored; the text redacts it in the thread", async () => {
  adapters.imessage.sent.length = 0;
  const ctx = await toolCtx(); await call("checkout_quote", { phones: [{ device: "iPhone 17", payment: "full" }] }, ctx);
  ok((await call("checkout_send_payment_link", { customer_confirmed: false }, ctx)).result.error === "not_confirmed", "needs yes");
  const linked = await toolCtx(kit.contactId, kit.conversationId, { linked: true, verified: false });
  ok((await call("checkout_send_payment_link", { customer_confirmed: true }, linked)).result.error === "not_verified", "account holder must verify first");
  await freshLimits(); const r = await call("checkout_send_payment_link", { customer_confirmed: true }, ctx);
  ok(r.result.ok && r.data.due_today === "$830.00" && !/https?:|pay\//.test(r.content), "model view has no link: " + r.content);
  const token = sentLink(); ok(token.length > 30, "customer got the link by text");
  ok(/\$830\.00 due today/.test(adapters.imessage.sent[0].text) && /Never send your card number by text/.test(adapters.imessage.sent[0].text), "text states amount and warns");
  const req: any = await db.collection("payment_requests").findOne({ contactId: kit.contactId, status: "pending" });
  ok(!JSON.stringify(req).includes(token) && req.tokenHash.length === 64, "only the hash is stored");
  const logs = JSON.stringify([...(await db.collection("messages").find({}).toArray()), ...(await db.collection("tool_calls").find({}).toArray())]);
  ok(!logs.includes(token), "link is in no message or tool log");
  ok(await db.collection("messages").findOne({ purpose: "payment_link", body: "[secure payment link sent]", redacted: true }), "thread shows a redacted marker");
  await freshLimits(); const again = await call("checkout_send_payment_link", { customer_confirmed: true }, ctx); const t2 = sentLink();
  ok(again.result.ok && t2 !== token && (await loadPaymentForRender(db, token, NOW)).state === "expired" && (await loadPaymentForRender(db, t2, NOW)).state === "valid", "a new link revokes the old one");
});
await t("link: GET (preview bots) never consumes it; garbage, expired and wrong-length tokens look the same", async () => {
  const token = sentLink();
  for (let i = 0; i < 3; i++) ok((await loadPaymentForRender(db, token, NOW)).state === "valid", "GET must not consume");
  const v: any = await loadPaymentForRender(db, token, NOW); ok(v.state === "valid" && v.dueTodayCents === 83000 && !JSON.stringify(v).includes("tokenHash"), "render data");
  ok((await loadPaymentForRender(db, "nope", NOW)).state === "invalid" && (await loadPaymentForRender(db, "x".repeat(43), NOW)).state === "invalid", "invalid");
  ok((await loadPaymentForRender(db, token, new Date(NOW.getTime() + 31 * 60_000))).state === "expired", "expires after 30 minutes");
  const late = await submitPayment(db, { token, raw: CARD, now: new Date(NOW.getTime() + 31 * 60_000) }); ok(!late.ok && late.error === "expired", "cannot pay on an expired link");
});

// ======================= paying =======================
let paidToken = "";
await t("pay: card is validated, charged once, only brand + last 4 are kept, order + payment + notice recorded, quote and link closed", async () => {
  const token = sentLink(); paidToken = token;
  const bad = await submitPayment(db, { token, raw: { ...CARD, number: "4242 4242 4242 4241" }, now: NOW });
  ok(!bad.ok && bad.error === "validation" && !!bad.errors?.number && !JSON.stringify(bad).includes("4241"), "typo is a validation error, no charge");
  ok((await db.collection("payments").countDocuments({})) === 0, "nothing charged on validation failure");
  const r = await submitPayment(db, { token, raw: CARD, now: NOW });
  ok(r.ok && r.amountCents === 83000 && r.last4 === "4242" && r.brand === "visa", JSON.stringify(r));
  const p: any = await db.collection("payments").findOne({}); ok(p.amountCents === 83000 && p.last4 === "4242" && p.brand === "visa" && p.status === "succeeded" && /^MOCK-/.test(p.authCode), "payment row");
  const order: any = await db.collection("orders").findOne({ conversationId: kit.conversationId }); ok(order.amountCents === 83000 && order.status === "paid" && order.source === "agent_checkout", "order row " + JSON.stringify(order));
  ok((await checkoutStatus(db, orgId, kit.contactId, kit.conversationId, NOW)).status === "paid", "quote paid");
  ok((await loadPaymentForRender(db, token, NOW)).state === "completed", "link closed");
  const notice: any = await db.collection("messages").findOne({ channelMsgId: { $regex: "^pay:" }, body: /^Payment completed/ });
  ok(notice && notice.handling === "agent" && /\$830\.00/.test(notice.body) && /visa ending 4242/.test(notice.body), "agent notice: " + notice?.body);
  const conv: any = await db.collection("conversations").findOne({ _id: kit.conversationId }); ok(conv.lane?.dueAt, "conversation woken so the agent replies");
  ok(await db.collection("notifications").findOne({ kind: "sale" }), "owner notified of the sale");
});
await t("pay: NO card data anywhere (number, spaced number, expiry, CVC, field names) after a successful payment", async () => {
  const all = await everything();
  for (const s of ["4242424242424242", "4242 4242 4242 4242", "09/31", '"737"']) ok(!all.includes(s), `found ${s} in the database`);
  const keys = keysOf(JSON.parse(all));
  for (const k of ["cvc", "cvv", "pan", "expMonth", "expYear", "cardNumber"]) ok(!keys.has(k), `field "${k}" exists`);
  for (const c of ["payments", "payment_requests", "checkout_quotes", "orders", "notifications"]) ok(!keysOf(await db.collection(c).find({}).toArray()).has("number"), `${c} has a "number" field`);
});
await t("pay: a second submit of the same link (replay) does not charge again", async () => {
  const r = await submitPayment(db, { token: paidToken, raw: CARD, now: NOW });
  ok(!r.ok && r.error === "completed" && (await db.collection("payments").countDocuments({})) === 1 && (await db.collection("orders").findOne({ conversationId: kit.conversationId }) as any).amountCents === 83000, "still one payment");
});
await t("pay: two simultaneous submits charge exactly once", async () => {
  const ctx = await toolCtx(); await call("checkout_quote", { phones: [{ device: "iPhone 17e", payment: "full" }] }, ctx); await sendLink(ctx);
  const token = sentLink(); let charges = 0;
  const slow: Gateway = { name: "slow", async charge(a) { charges++; await new Promise((r) => setTimeout(r, 40)); return mockGateway.charge(a); } };
  const [a, b] = await Promise.all([submitPayment(db, { token, raw: CARD, gateway: slow, now: NOW }), submitPayment(db, { token, raw: CARD, gateway: slow, now: NOW })]);
  ok([a, b].filter((x) => x.ok).length === 1 && charges === 1, `ok=${[a, b].filter((x) => x.ok).length} charges=${charges} ${JSON.stringify([a, b].map((x) => x.ok ? "ok" : x.error))}`);
  const order: any = await db.collection("orders").findOne({ conversationId: kit.conversationId });
  ok(order.amountCents === 83000 + 59900 && order.quoteIds.length === 2 && (await db.collection("orders").countDocuments({ conversationId: kit.conversationId })) === 1, "one order accumulates both purchases: " + JSON.stringify(order));
});
await t("pay: a gateway that throws is a safe decline, never a crash or a half-written order", async () => {
  const ctx = await toolCtx(); await call("checkout_quote", { phones: [{ device: "iPhone 17e", payment: "full" }] }, ctx); await sendLink(ctx);
  const token = sentLink(); const before = await db.collection("payments").countDocuments({});
  const boom: Gateway = { name: "boom", async charge() { throw new Error("network down"); } };
  const r = await submitPayment(db, { token, raw: CARD, gateway: boom, now: NOW });
  ok(!r.ok && r.error === "processing_error" && (await db.collection("payments").countDocuments({})) === before, JSON.stringify(r));
  ok((await loadPaymentForRender(db, token, NOW)).state === "valid", "link still usable for another try");
});

// ======================= declines =======================
await t("decline: kind message, link stays usable with tries left, a notice wakes the agent, and the third failure locks the link and fails the quote", async () => {
  const ctx = await toolCtx(); await call("checkout_quote", { phones: [{ device: "iPhone 17e", payment: "full" }] }, ctx); await sendLink(ctx);
  const token = sentLink();
  const d1 = await submitPayment(db, { token, raw: { ...CARD, number: "4000000000000002" }, now: NOW }); ok(!d1.ok && d1.error === "declined" && d1.attemptsLeft === 2 && /declined/.test(d1.message ?? ""), JSON.stringify(d1));
  ok((await loadPaymentForRender(db, token, NOW)).state === "valid", "still valid");
  const notice: any = await db.collection("messages").findOne({ body: /^Payment not completed/ }, { sort: { ts: -1 } }); ok(notice && notice.handling === "agent", "agent told: " + notice?.body);
  const d2 = await submitPayment(db, { token, raw: { ...CARD, number: "4000000000009995" }, now: NOW }); ok(!d2.ok && d2.error === "insufficient_funds" && d2.attemptsLeft === 1, JSON.stringify(d2));
  const st = await checkoutStatus(db, orgId, kit.contactId, kit.conversationId, NOW); ok(st.link === "sent_and_waiting" && st.declined_attempts === 2, JSON.stringify(st));
  const d3 = await submitPayment(db, { token, raw: { ...CARD, number: "4000000000000002" }, now: NOW }); ok(!d3.ok && d3.error === "declined" && d3.attemptsLeft === 0, JSON.stringify(d3));
  ok((await loadPaymentForRender(db, token, NOW)).state === "locked", "locked");
  const good = await submitPayment(db, { token, raw: CARD, now: NOW }); ok(!good.ok && good.error === "locked", "a good card cannot use a locked link");
  ok((await checkoutStatus(db, orgId, kit.contactId, kit.conversationId, NOW)).status === "payment_failed" && await db.collection("notifications").findOne({ kind: "payment_failed" }), "quote failed + owner told");
  await freshLimits(); const retry = await call("checkout_send_payment_link", { customer_confirmed: true }, ctx); ok(!retry.result.ok && ["quote_closed", "no_quote"].includes(retry.result.error ?? ""), "failed quote cannot be re-linked; make a new quote: " + JSON.stringify(retry.result));
  ok(!(await everything()).includes("4000000000000002"), "declined card numbers are not stored either");
});

// ======================= owner approval =======================
await t("approval: an order over the owner's limit gets no link until approved; approve wakes the agent; the link then works", async () => {
  const ctx = await toolCtx();
  const q = await call("checkout_quote", { phones: [{ device: "iPhone 17 Pro Max", payment: "full" }] }, ctx);
  ok(q.result.ok && q.data.requires_owner_approval === true && q.data.due_today === "$1899.00", JSON.stringify(q.data));
  const ap: any = await db.collection("approvals").findOne({ conversationId: kit.conversationId, status: "texted" }); ok(ap && ap.amountCents === 189900 && ap.limitCents === 150000, "approval row");
  ok(await db.collection("notifications").findOne({ kind: "approval" }), "owner notified");
  const sentBefore = adapters.imessage.sent.length;
  await freshLimits(); const blocked = await call("checkout_send_payment_link", { customer_confirmed: true }, ctx); ok(!blocked.result.ok && blocked.result.error === "approval_required" && adapters.imessage.sent.length === sentBefore, "no link before approval");
  const r = await resolveApproval(db, { orgId, approvalId: ap._id, decision: "approved", now: NOW }); ok(r.ok, "approved");
  ok(!(await resolveApproval(db, { orgId, approvalId: ap._id, decision: "declined", now: NOW })).ok, "a decided approval cannot be flipped");
  ok(await db.collection("messages").findOne({ body: /^Order approved by the owner/ }), "agent notice");
  await freshLimits(); const sent = await call("checkout_send_payment_link", { customer_confirmed: true }, ctx); ok(sent.result.ok, "link after approval: " + JSON.stringify(sent.result));
  const paid = await submitPayment(db, { token: sentLink(), raw: CARD, now: NOW }); ok(paid.ok && paid.amountCents === 189900, "paid after approval");
});
await t("approval: a declined order can never be paid, and the existing link (if any) is revoked", async () => {
  const ctx = await toolCtx(); await call("checkout_quote", { phones: [{ device: "iPhone 17 Pro Max", payment: "full" }] }, ctx);
  const ap: any = await db.collection("approvals").findOne({ conversationId: kit.conversationId, status: "texted" });
  ok((await resolveApproval(db, { orgId, approvalId: ap._id, decision: "declined", now: NOW })).ok, "declined");
  await freshLimits(); const r = await call("checkout_send_payment_link", { customer_confirmed: true }, ctx); ok(!r.result.ok && r.result.error === "declined", JSON.stringify(r.result));
  ok(await db.collection("messages").findOne({ body: /^Order declined by the owner/ }), "agent notice");
});
await t("approval: defence in depth, a link that somehow exists for an unapproved over-limit quote still cannot be charged", async () => {
  const q = await createQuote(db, { orgId, contactId: kit.contactId, conversationId: kit.conversationId, items: [{ kind: "device", label: "x", qty: 1, dueTodayCents: 200000, monthlyCents: 0 }], summary: "x", now: NOW });
  ok(q.requiresApproval, "over limit");
  await db.collection("checkout_quotes").updateOne({ _id: q.id }, { $set: { status: "open" } });   // simulate a bug elsewhere
  await db.collection("checkout_quotes").updateOne({ _id: q.id }, { $set: { status: "awaiting_approval" } });
  let threw = ""; try { await createPaymentRequest(db, { orgId, contactId: kit.contactId, conversationId: kit.conversationId, quoteId: q.id, now: NOW }); } catch (e: any) { threw = e.code; }
  ok(threw === "approval_required", "no link: " + threw);
});

// ======================= status tool and chat redaction =======================
await t("checkout_status: paid shows brand + last 4 only; nothing the model sees contains a card number or a link", async () => {
  const ctx = await toolCtx(); await call("checkout_quote", { phones: [{ device: "iPhone 17e", payment: "full" }] }, ctx); await sendLink(ctx);
  const waiting = await call("checkout_status", {}, ctx); ok(waiting.data.status === "open" && waiting.data.link === "sent_and_waiting" && waiting.data.due_today === "$599.00", JSON.stringify(waiting.data));
  await submitPayment(db, { token: sentLink(), raw: CARD, now: NOW });
  const paid = await call("checkout_status", {}, ctx); ok(paid.data.status === "paid" && paid.data.paid_with === "visa ending 4242" && paid.data.amount_paid === "$599.00" && !/4242424242|https?:/.test(paid.content), paid.content);
  const empty = await toolCtx((await kit.newContact("+14255550166")).contactId, (await kit.newContact("+14255550165")).conversationId);
  ok((await call("checkout_status", {}, { ...empty, contactId: new ObjectId() })).data.status === "none", "none");
});
await t("chat: card numbers (even mistyped), expiry and CVC typed into a text are redacted before anything is stored", async () => {
  const cases: [string, RegExp][] = [
    ["my card is 4242 4242 4242 4242 exp 09/31 cvv 737", /^my card is \[redacted card number\] exp \[redacted\] cvv \[redacted\]$/],
    ["4242 4242 4242 4241", /^\[redacted card number\]$/],
    ["amex 3782 822463 10005", /^amex \[redacted card number\]$/],
    ["4242424242424242", /^\[redacted card number\]$/],
  ];
  for (const [i, re] of cases) { const r = redactSensitive(i); ok(r.redacted && re.test(r.text) && !/4242|3782|737|09\/31/.test(r.text), `${i} -> ${r.text}`); }
  for (const keep of ["order 123456789012", "tracking 9400111899223344556677", "call 425-555-0123", "I'll pay $830.00 today", "my number is +1 425 555 0123"]) ok(!redactSensitive(keep).redacted && redactSensitive(keep).text === keep, "left alone: " + keep);
});
await t("chat: the assistant asking for a card number, CVC or PIN is caught", async () => {
  for (const s of ["Please type your full card number and CVC.", "What's your card number?", "Can you read me the security code on the back?"]) ok(asksForSecrets(s), s);
  for (const s of ["Please don't send your card number here.", "I'll text you a secure payment link."]) ok(!asksForSecrets(s), s);
});

// ======================= the whole text flow, through the real turn loop =======================
const turnInput = async (conversationId: ObjectId, text: string) => { const id = await kit.addInbound(conversationId, text); return { orgId, conversationId, channel: "imessage" as const, mode: "text" as const, batch: [{ _id: id, body: text, ts: NOW }] }; };
await t("flow: buy, read back, confirm, link by text, pay on the page, agent confirms; replies pass the money guardrail and never contain card data", async () => {
  const { contactId, conversationId } = await kit.newContact("+14255550133", { name: "Jo Park" }); await grantConsent(contactId); adapters.imessage.sent.length = 0; await freshLimits();
  // 1. the customer wants the phone; the model quotes (server prices it) and reads it back using the tool's own numbers
  const llm1 = new ScriptedLlm([{ tools: [{ name: "checkout_quote", args: { phones: [{ device: "iPhone 17", payment: "full" }] } }] }, { content: "The iPhone 17 is $830.00 due today, nothing monthly. Want me to text you a secure link to pay?" }]);
  const r1 = await runTurn(kit.deps(llm1), await turnInput(conversationId, "I'll take the iPhone 17, paying in full"));
  ok(r1.outcome === "reply" && /\$830\.00/.test(r1.text), JSON.stringify({ o: r1.outcome, t: r1.text }));
  // 2. a made-up total is blocked by the money guardrail (the model cannot invent what is due)
  const bad = await runTurn(kit.deps(new ScriptedLlm([{ content: "That will be $799.00 today." }, { content: "That will be $799.00 today." }])), await turnInput(conversationId, "how much again?"));
  ok(!/\$799/.test(bad.text), "ungrounded amount must not reach the customer: " + bad.text);
  // 3. clear yes: the model sends the link; the customer's phone gets it, the model and logs never do
  const llm2 = new ScriptedLlm([{ tools: [{ name: "checkout_send_payment_link", args: { customer_confirmed: true } }] }, { content: "It's on its way. Pay on that page and I'll confirm here." }]);
  const r2 = await runTurn(kit.deps(llm2), await turnInput(conversationId, "yes please"));
  ok(r2.outcome === "reply" && r2.toolCalls.some((c) => c.name === "checkout_send_payment_link" && c.ok), JSON.stringify(r2.toolCalls));
  const token = sentLink(); ok(token.length > 30, "link texted");
  ok(!JSON.stringify(llm2.requests).includes(token) && !r2.text.includes(token), "the model never saw the link");
  // 4. the customer pays on the page; the checkout notice wakes the agent, which confirms using the notice's own figures
  const pay = await submitPayment(db, { token, raw: CARD, now: NOW }); ok(pay.ok, "paid");
  const notice: any = await db.collection("messages").findOne({ conversationId, body: /^Payment completed/ });
  const llm3 = new ScriptedLlm([{ content: "Thanks, your $830.00 payment by Visa ending 4242 went through. A teammate will confirm the next steps." }]);
  const r3 = await runTurn(kit.deps(llm3), { orgId, conversationId, channel: "imessage", mode: "text", batch: [{ _id: notice._id, body: notice.body, ts: NOW }] });
  ok(r3.outcome === "reply" && /\$830\.00/.test(r3.text) && /4242/.test(r3.text), JSON.stringify({ o: r3.outcome, t: r3.text }));
  const stored = JSON.stringify(await db.collection("messages").find({ conversationId }).toArray()) + JSON.stringify(await db.collection("tool_calls").find({ conversationId }).toArray()) + JSON.stringify(llm1.requests) + JSON.stringify(llm2.requests);
  ok(!stored.includes("4242424242424242") && !stored.includes(token), "no card number and no link in the thread, the tool log or any model request");
});
await t("flow: assistant that asks for a card number in chat is replaced with the redirect (never reaches the customer)", async () => {
  const { contactId, conversationId } = await kit.newContact("+14255550122", { name: "Al Wu" }); await grantConsent(contactId);
  const r = await runTurn(kit.deps(new ScriptedLlm([{ content: "Sure! What's your card number and the CVC on the back?" }, { content: "Sure! What's your card number and the CVC on the back?" }])), await turnInput(conversationId, "ok let's buy it"));
  ok(!/card number/i.test(r.text) || /don't send/i.test(r.text), "reply: " + r.text);
});
await t("chat: a customer who texts their card number gets it redacted at the door (stored redacted, flagged, never reaches the model)", async () => {
  const { contactId, conversationId } = await kit.newContact("+14255550111", { name: "Ro Díaz" });
  const worker = new Worker(db, {} as never, adapters.imessage, async () => {}, { scheduled: true });
  const r: any = await worker.handleInbound({ orgId, address: "+14255550111", text: "ok my card is 4242 4242 4242 4242 exp 09/31 cvv 737", channelMsgId: "card-in-1", ref: { spaceId: "s1", senderId: "u1" } });
  ok(r.scheduled === true, "accepted: " + JSON.stringify(r));
  const m: any = await db.collection("messages").findOne({ channelMsgId: "card-in-1" });
  ok(m.redacted === true && m.body === "ok my card is [redacted card number] exp [redacted] cvv [redacted]" && !/4242|737|09\/31/.test(JSON.stringify(m)), JSON.stringify(m.body));
  void contactId; void conversationId;
});

// ======================= negotiation -> checkout =======================
await t("negotiation: an accepted offer is priced into the quote from OUR record (the model cannot supply a credit), lasts its months, and is used up by the purchase", async () => {
  const { contactId, conversationId } = await kit.newContact("+14255550188", { name: "Kim Ode" }); await grantConsent(contactId);
  const ctx = await toolCtx(contactId, conversationId);
  const none = await call("checkout_quote", { use_accepted_offer: true }, ctx); ok(!none.result.ok && none.result.error === "no_accepted_offer", "nothing accepted yet: " + JSON.stringify(none.result));
  const at = new Date(NOW.getTime() - 60_000);
  await db.collection("contacts").updateOne({ _id: contactId }, { $set: { "memory.offers": [{ creditCents: 1500, months: 12, plan: "Experience More 2.0", lines: 3, gives: ["autopay"], summary: "3 lines on More with a $15 credit", status: "accepted", at }] } });
  const wrong = await call("checkout_quote", { use_accepted_offer: true, plan: "Essentials Saver", lines: 2 }, ctx); ok(!wrong.result.ok && wrong.result.error === "offer_does_not_match", JSON.stringify(wrong.result));
  const q = await call("checkout_quote", { use_accepted_offer: true }, ctx);
  ok(q.result.ok && q.data.per_month_after === "$170.00" && q.data.due_today === "$105.00" && q.data.notes.some((n: string) => /\$15\.00 a month credit lasts 12 months.*\$185\.00/.test(n)), JSON.stringify(q.data));
  const stored: any = await db.collection("checkout_quotes").findOne({ _id: new ObjectId(q.data.quote_id) }); ok(stored.offerAt && stored.items[0].creditCents === 1500 && stored.items[0].creditMonths === 12, "quote remembers the offer");
  const token = await sendLink(ctx); const pay = await submitPayment(db, { token, raw: CARD, now: NOW }); ok(pay.ok && pay.amountCents === 10500, "paid the connection charge");
  const c2: any = await db.collection("contacts").findOne({ _id: contactId }); ok(c2.memory.offers[0].status === "redeemed" && c2.memory.offers[0].redeemedAt, "offer used up: " + JSON.stringify(c2.memory.offers[0]));
  const again = await call("checkout_quote", { use_accepted_offer: true }, ctx); ok(!again.result.ok && again.result.error === "no_accepted_offer", "an offer cannot be redeemed twice");
  // the same plan at list price (no offer) is not discounted
  const list = await call("checkout_quote", { plan: "Experience More", lines: 3 }, ctx); ok(list.data.per_month_after === "$185.00", "list price: " + JSON.stringify(list.data));
});
await t("negotiation: negotiation_accept now points the agent at checkout when something is due today", async () => {
  const { contactId, conversationId } = await kit.newContact("+14255550171", { name: "Ed Ng", memory: { negotiation: { at: new Date(NOW.getTime() - 600_000), key: "P-MORE", round: 2, step: 2, gives: ["autopay"], plan: "Experience More 2.0", lines: 3, lastCreditCents: 1000, turnId: "earlier-turn" } } });
  const r = await call("negotiation_accept", { summary: "3 lines on More with a $10 credit" }, await toolCtx(contactId, conversationId));
  ok(r.result.ok && /checkout_quote/.test(r.data.next) && /use_accepted_offer/.test(r.data.next), JSON.stringify(r.data));
});

await t("quote: re-quoting the same order returns the live quote (an approval or link is never reset); a changed order replaces it", async () => {
  const { contactId, conversationId } = await kit.newContact("+14255550199", { name: "Mo Tan" }); await grantConsent(contactId);
  const ctx = await toolCtx(contactId, conversationId);
  const q1 = await call("checkout_quote", { phones: [{ device: "iPhone 17 Pro Max", payment: "full" }] }, ctx);
  const ap: any = await db.collection("approvals").findOne({ conversationId, status: "texted" });
  await resolveApproval(db, { orgId, approvalId: ap._id, decision: "approved", now: NOW });
  const q2 = await call("checkout_quote", { phones: [{ device: "iPhone 17 Pro Max", payment: "full" }] }, ctx);
  ok(q2.data.quote_id === q1.data.quote_id && q2.data.status === "approved" && /Do not quote again/.test(q2.data.next), "same quote, still approved: " + JSON.stringify(q2.data));
  ok((await db.collection("approvals").countDocuments({ conversationId })) === 1 && (await db.collection("checkout_quotes").countDocuments({ conversationId })) === 1, "no duplicate approval or quote");
  await freshLimits(); const link = await call("checkout_send_payment_link", { customer_confirmed: true }, ctx); ok(link.result.ok, "link works after the re-quote: " + JSON.stringify(link.result));
  const q3 = await call("checkout_quote", { phones: [{ device: "iPhone 17e", payment: "full" }] }, ctx);
  ok(q3.data.quote_id !== q1.data.quote_id && q3.data.requires_owner_approval === false && (await db.collection("checkout_quotes").findOne({ _id: new ObjectId(q1.data.quote_id) }) as any).status === "cancelled", "a different order replaces the old quote");
});

// ======================= the console =======================
await t("console: pending, paid, failed and approval states show up in the snapshot, and Approve works from the console action", async () => {
  process.env.MONGODB_URI = kit.mongo.getUri(); process.env.MONGODB_DB = "t";
  const { buildSnapshot } = await import("../../web/src/lib/console-snapshot");
  const { decideApproval } = await import("../../web/src/lib/console-actions");
  const c2 = await kit.newContact("+14255550155", { name: "Sam Rivera" }); await grantConsent(c2.contactId);
  const ctx2 = await toolCtx(c2.contactId, c2.conversationId);
  await kit.addInbound(c2.conversationId, "I'll take the Pro Max");
  await call("checkout_quote", { phones: [{ device: "iPhone 17 Pro Max", payment: "full" }] }, ctx2);
  let snap: any = await buildSnapshot(); let c: any = snap.conversations.find((x: any) => x.id === String(c2.conversationId));
  ok(c.status === "awaiting_approval" && c.pending?.kind === "approval" && c.pending.amount_cents === 189900 && c.pending.limit_cents === 150000, JSON.stringify(c.pending));
  ok((await decideApproval(c.pending.approval_id, "approved")).ok, "console approve");
  snap = await buildSnapshot(); c = snap.conversations.find((x: any) => x.id === String(c2.conversationId));
  ok(c.pending?.kind === "payment" && c.status === "awaiting_approval", "waiting for the customer to pay: " + JSON.stringify(c.pending));
  await sendLink(ctx2);
  await submitPayment(db, { token: sentLink(), raw: CARD, now: NOW });
  snap = await buildSnapshot(); c = snap.conversations.find((x: any) => x.id === String(c2.conversationId));
  ok(c.outcome === "purchased" && c.amount_cents === 189900 && c.pending === null && /iPhone 17 Pro Max/.test(c.item), JSON.stringify({ o: c.outcome, a: c.amount_cents, i: c.item }));
  ok(snap.audit.some((a: any) => a.action === "order.paid"), "audit lists the sale");
  let threw = false; try { await decideApproval(c.id, "approved"); } catch { threw = true; } ok(threw, "bad id rejected");
  // a purchase that failed three times is a "Not paid" attempt
  const c3 = await kit.newContact("+14255550144", { name: "Lee Park" }); await grantConsent(c3.contactId); await kit.addInbound(c3.conversationId, "buy it");
  const ctx3 = await toolCtx(c3.contactId, c3.conversationId); await call("checkout_quote", { phones: [{ device: "iPhone 17e", payment: "full" }] }, ctx3); await sendLink(ctx3);
  const tok = sentLink(); for (let i = 0; i < 3; i++) await submitPayment(db, { token: tok, raw: { ...CARD, number: "4000000000000002" }, now: NOW });
  snap = await buildSnapshot(); c = snap.conversations.find((x: any) => x.id === String(c3.conversationId));
  ok(c.outcome === "not_paid" && c.amount_cents === 59900, JSON.stringify({ o: c.outcome, a: c.amount_cents }));
});
await t("registry: the three checkout tools exist, are valid, and the link tool is the only high-risk one", async () => {
  const names = ALL_TOOLS.map((x) => x.name); for (const n of ["checkout_quote", "checkout_send_payment_link", "checkout_status"]) ok(names.includes(n), n);
  ok(ALL_TOOLS.find((x) => x.name === "checkout_send_payment_link")!.risk === "write_high" && ALL_TOOLS.find((x) => x.name === "checkout_status")!.risk === "read", "risk classes");
  for (const x of ALL_TOOLS.filter((x) => x.name.startsWith("checkout_"))) ok(!/card number|cvc/i.test(JSON.stringify(x.parameters)), `${x.name} takes no card data`);
});

await finish(kit);

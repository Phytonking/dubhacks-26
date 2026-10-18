// Negotiation ladder, authority caps, promotion eligibility.   pnpm exec tsx scripts/offers-test.ts
import { readFileSync } from "node:fs";
import { ObjectId } from "mongodb";
import { executeTool } from "../src/engine/turn";
import { creditCap, creditForRound, DEFAULT_AUTHORITY, unmetConditions } from "../src/engine/tools/offers";
import { ScriptedLlm, ok, t, finish, makeKit } from "./_testkit";

const D = JSON.parse(readFileSync(new URL("./fixtures/tmo-sample.json", import.meta.url), "utf8"));
const kit = await makeKit({ template: "tmobile-system", groundMoney: true });
const { db, orgId } = kit; const now = kit.now.t;
const ins = (c: string, docs: any[]) => db.collection(c).insertMany(docs.map((d) => ({ ...d, orgId, importedAt: now })) as never);
await ins("tmo_plans", D.plans); await ins("tmo_promotions", D.promotions); await ins("tmo_devices", D.devices);

const run = async (contact: { contactId: ObjectId; conversationId: ObjectId }, name: string, args: unknown, o: Record<string, unknown> = {}) => {
  const c: any = await db.collection("contacts").findOne({ _id: contact.contactId });
  const d = kit.deps(new ScriptedLlm([]));
  const ctx = { db, orgId, contactId: contact.contactId, conversationId: contact.conversationId, channel: "imessage" as const, mode: "text" as const, party: { contact: c, conversation: {} as never, address: kit.phone, created: false, matchedBy: "channel_handle" as const, externalRefs: c.externalRefs ?? [] },
    customer: {} as never, turnId: "t", sourceMessageId: new ObjectId(), now, messenger: kit.messenger, env: d.env, guard: { cfg: { maxDiscountPct: 15 }, evidence: ["USER:I will turn on autopay, add another line, bring my number over, stay a full year, add home internet, trade in my phone, upgrade, and go paperless"] }, calls: new Map(), ...o };
  const r = await executeTool(d, ctx as never, { id: "x", type: "function", function: { name, arguments: JSON.stringify(args) } });
  return { ...r, data: (() => { try { return JSON.parse(r.content); } catch { return {}; } })() as any };
};

await t("authority math: the cap is the smaller of the money cap and the percentage cap; whole dollars; round 1 is always zero", async () => {
  const A = DEFAULT_AUTHORITY;
  ok(creditCap(10500, A) === 1500, "a $105 plan: $15 cap"); ok(creditCap(5500, A) === 800, "a $55 plan: 15% = $8.25 -> $8");
  const steps = [1, 2, 3, 4, 9].map((r) => creditForRound(1500, r, A) / 100); ok(steps.join() === "0,4,9,15,15", steps.join());
  ok(creditForRound(0, 3, A) === 0, "no credit when the cap is zero");
});
await t("ladder: starts at zero, will not move without a 'get', rises one step per push, stops at the ceiling and says so", async () => {
  const c = await kit.newContact("+14255550801");
  const args = (g?: string[]) => ({ plan: "Experience Beyond 2.0", lines: 1, ...(g ? { customer_gives: g } : {}) });
  const r1 = await run(c, "negotiation_offer", args()); ok(r1.result.ok && r1.data.round === 1 && r1.data.allowed_now.monthly_credit === "$0" && /Do not offer a credit yet/.test(r1.data.guidance), r1.content);
  const r2 = await run(c, "negotiation_offer", args()); ok(r2.data.allowed_now.monthly_credit === "$0" && r2.data.round === 1, "pushing again with nothing in return does not climb: " + r2.content);
  const r3 = await run(c, "negotiation_offer", args(["autopay"])); ok(r3.data.round === 2 && r3.data.allowed_now.monthly_credit === "$4" && r3.data.allowed_now.new_monthly_total === "$101", r3.content);
  const r4 = await run(c, "negotiation_offer", args(["autopay", "add_line"])); ok(r4.data.round === 3 && r4.data.allowed_now.monthly_credit === "$9" && r4.data.can_go_further_if_they_push_again === true, r4.content);
  const r5 = await run(c, "negotiation_offer", args(["autopay", "add_line", "keep_12_months"])); ok(r5.data.round === 4 && r5.data.allowed_now.monthly_credit === "$15" && r5.data.allowed_now.saves_over_the_term === "$180" && r5.data.can_go_further_if_they_push_again === false && /best you can do/i.test(r5.data.guidance), r5.content);
  const r6 = await run(c, "negotiation_offer", args(["autopay", "add_line", "keep_12_months"])); ok(r6.data.allowed_now.monthly_credit === "$15", "never above the ceiling: " + r6.content);
});
await t("a bigger commitment is rewarded faster, but never on the first ask and never past the ceiling; what they gave stays given", async () => {
  const c = await kit.newContact("+14255550811");
  const big = ["autopay", "add_line", "keep_12_months"];
  const first = await run(c, "negotiation_offer", { plan: "Experience Beyond 2.0", lines: 1, customer_gives: big }); ok(first.data.allowed_now.monthly_credit === "$0", "hard on the first ask even for a big commitment: " + first.content);
  const second = await run(c, "negotiation_offer", { plan: "Experience Beyond 2.0", lines: 1 }); ok(second.data.round === 2 && second.data.allowed_now.monthly_credit === "$15" && second.data.can_go_further_if_they_push_again === false, "their earlier commitments count: " + second.content);
  ok(second.data.if_they_add_a_line.average_per_line === "$90" && second.data.if_they_add_a_line.new_total === "$180", "adding a line shows the per-line drop: " + JSON.stringify(second.data.if_they_add_a_line));
  const small = await kit.newContact("+14255550812");
  await run(small, "negotiation_offer", { plan: "Experience Beyond 2.0", lines: 1 });
  const one = await run(small, "negotiation_offer", { plan: "Experience Beyond 2.0", lines: 1, customer_gives: ["autopay"] }); ok(one.data.allowed_now.monthly_credit === "$4", "one small give, one small step: " + one.content);
});
await t("the model cannot put words in the customer's mouth: a 'give' they never said does not count and unlocks nothing", async () => {
  const c = await kit.newContact("+14255550813");
  const said = { guard: { cfg: { maxDiscountPct: 15 }, evidence: ["USER:too expensive, lower it!", "USER:I'll leave a five star review"] } };
  await run(c, "negotiation_offer", { plan: "Experience Beyond 2.0", lines: 1 }, said);
  const r = await run(c, "negotiation_offer", { plan: "Experience Beyond 2.0", lines: 1, customer_gives: ["autopay", "port_in"] }, said);
  ok(r.data.allowed_now.monthly_credit === "$0" && /not actually agreed to: autopay, port in/.test(r.data.not_counted), r.content);
  const ok2 = await run(c, "negotiation_offer", { plan: "Experience Beyond 2.0", lines: 1, customer_gives: ["autopay"] }, { guard: { cfg: { maxDiscountPct: 15 }, evidence: ["USER:ok I will use autopay"] } });
  ok(ok2.data.allowed_now.monthly_credit !== "$0" && !ok2.data.not_counted, "what they did say counts: " + ok2.content);
});
await t("changing the number of lines keeps the same negotiation going (the cap follows the new total)", async () => {
  const c = await kit.newContact("+14255550814");
  await run(c, "negotiation_offer", { plan: "Experience More 2.0", lines: 2 });
  const r = await run(c, "negotiation_offer", { plan: "Experience More 2.0", lines: 4, customer_gives: ["autopay", "add_line", "keep_12_months"] });
  ok(r.data.round === 2 && r.data.lines === 4 && r.data.allowed_now.monthly_credit === "$15", r.content);
});
await t("a different plan or a stale negotiation starts over at round 1", async () => {
  const c = await kit.newContact("+14255550802");
  await run(c, "negotiation_offer", { plan: "Experience More 2.0", lines: 1, customer_gives: ["autopay"] });
  const other = await run(c, "negotiation_offer", { plan: "Essentials 2.0", lines: 1, customer_gives: ["autopay"] }); ok(other.data.round === 1, "new plan, new negotiation: " + other.content);
  await db.collection("contacts").updateOne({ _id: c.contactId }, { $set: { "memory.negotiation.at": new Date(now.getTime() - 30 * 3600_000) } });
  const stale = await run(c, "negotiation_offer", { plan: "Essentials 2.0", lines: 1, customer_gives: ["autopay"] }); ok(stale.data.round === 1, "stale: " + stale.content);
});
await t("an account holder must be verified before their price is negotiated; a prospect needs nothing", async () => {
  const acct = await kit.newContact("+14255550803", { externalRefs: [{ system: "tmobile", id: "ACC-1", kind: "account" }] });
  const r = await run(acct, "negotiation_offer", { plan: "Experience More 2.0", lines: 1 }); ok(!r.result.ok && r.result.error === "not_verified" && /verify_send_code/.test(r.content), r.content);
  await db.collection("contacts").updateOne({ _id: acct.contactId }, { $set: { verifiedPhone: { number: "+14255550803", at: now, method: "otp" } } });
  const v = await run(acct, "negotiation_offer", { plan: "Experience More 2.0", lines: 1 }); ok(v.result.ok, v.content);
});
await t("acceptance records the deal and tells the team; it refuses when nothing was offered, and never says 'applied'", async () => {
  const c = await kit.newContact("+14255550804");
  const none = await run(c, "negotiation_accept", { summary: "they said yes" }); ok(!none.result.ok && none.result.error === "needs_plan", none.content);
  const plain = await run(c, "negotiation_accept", { summary: "Experience More, 2 lines at list price", plan: "Experience More 2.0", lines: 2 }); ok(plain.result.ok, "a plain yes at list price is recorded too: " + plain.content);
  await db.collection("contacts").updateOne({ _id: c.contactId }, { $unset: { "memory.offers": "" } }); await db.collection("notifications").deleteMany({ contactId: c.contactId });
  await run(c, "negotiation_offer", { plan: "Experience More 2.0", lines: 2, customer_gives: ["autopay", "add_line"] });
  await run(c, "negotiation_offer", { plan: "Experience More 2.0", lines: 2, customer_gives: ["autopay", "add_line"] });
  const same = await run(c, "negotiation_accept", { summary: "x" }, { turnId: "t" }); ok(!same.result.ok && same.result.error === "offer_not_presented_yet", "cannot accept an offer in the same turn it was made: " + same.content);
  await db.collection("contacts").updateOne({ _id: c.contactId }, { $set: { "memory.negotiation.turnId": "an-earlier-turn" } });
  const acc = await run(c, "negotiation_accept", { summary: "Experience More, 2 lines, $5 a month credit for AutoPay and a second line" });
  ok(acc.result.ok && /Do not say it is already applied/.test(acc.content), acc.content);
  const after: any = await db.collection("contacts").findOne({ _id: c.contactId }); ok(after.memory.offers?.length === 1 && !after.memory.negotiation && after.memory.offers[0].status === "accepted", JSON.stringify(after.memory));
  ok((await db.collection("notifications").countDocuments({ contactId: c.contactId, kind: "deal" })) === 1, "team told");
});
await t("the authority is configurable per business", async () => {
  await db.collection("agents").updateOne({ orgId }, { $set: { "guardrails.negotiation": { maxMonthlyCreditCents: 500, maxPct: 10 } } });
  const c = await kit.newContact("+14255550805");
  const a = ["autopay", "add_line", "keep_12_months"];
  let last: any; for (let i = 0; i < 5; i++) last = await run(c, "negotiation_offer", { plan: "Experience Beyond 2.0", lines: 1, customer_gives: a });
  ok(last.data.allowed_now.monthly_credit === "$5" && last.data.round >= 4, last.content);
  await db.collection("agents").updateOne({ orgId }, { $unset: { "guardrails.negotiation": "" } });
});
await t("promotion eligibility is computed from the situation: what qualifies now, what they would need to do, what is ruled out", async () => {
  const promo = (n: string) => D.promotions.find((p: any) => p.name === n);
  const byod = unmetConditions(promo("Bring your own phone card"), { new_line: true, port_in: true, byod: true, planFamily: "essentials", planMonthlyCents: 6500 }); ok(!byod.unmet.length && !byod.unknown.length, JSON.stringify(byod));
  const noPort = unmetConditions(promo("Bring your own phone card"), { new_line: true, byod: true, planFamily: "essentials", planMonthlyCents: 6500 }); ok(noPort.unmet.join() === "moving a number over from another carrier" && !noPort.hard, JSON.stringify(noPort));
  const wrongPlan = unmetConditions(promo("razr+ 2026 credit"), { new_line: true, buying_device: "razr+", planFamily: "essentials", planMonthlyCents: 6500 }); ok(wrongPlan.hard, "wrong plan family is ruled out");
  const loyal = unmetConditions(promo("Loyalty monthly credit"), { tenureMonths: 20 }); ok(loyal.hard && /36\+ months/.test(loyal.unmet.join()), JSON.stringify(loyal));
  const loyalUnknown = unmetConditions(promo("Loyalty monthly credit"), {}); ok(loyalUnknown.unknown.length === 1 && !loyalUnknown.hard, "not verified yet: unknown, not 'no'");
});
await t("tmo_offers: ranks what they qualify for first, lists what each other offer needs, hides what is ruled out, and uses account facts only after verification", async () => {
  const c = await kit.newContact("+14255550806");
  const r = await run(c, "tmo_offers", { situation: { new_line: true, port_in: true, byod: true, plan: "Essentials 2.0", lines: 1 } });
  const offers = r.data.offers; ok(offers[0].promotion === "Bring your own phone card" && offers[0].qualifies_now === true && /\$200/.test(offers[0].worth), JSON.stringify(offers.slice(0, 2)));
  ok(!offers.some((o: any) => o.promotion === "razr+ 2026 credit"), "razr is Beyond-only: ruled out for Essentials");
  ok(offers.some((o: any) => o.to_qualify.length) && r.data.used_account_facts === false, "others list what to do; no account facts for a stranger");
  const acct = await kit.newContact("+14255550807", { externalRefs: [{ system: "tmobile", id: "ACC-LOY", kind: "account" }], verifiedPhone: { number: "+14255550807", at: now, method: "otp" } });
  await db.collection("tmo_accounts").insertOne({ orgId, accountId: "ACC-LOY", importedAt: now, context: { tenure_months: 48, support: { contacts_90d: 1 }, lines: [{ plan_family: "essentials", device: { age_months: 40 } }] } } as never);
  const v = await run(acct, "tmo_offers", { situation: {} }); ok(v.data.used_account_facts === true && v.data.offers.some((o: any) => o.promotion === "Loyalty monthly credit" && o.qualifies_now), JSON.stringify(v.data.offers.slice(0, 3)));
});
await finish(kit);

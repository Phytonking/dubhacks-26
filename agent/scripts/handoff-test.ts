// The handoff gate and the health watch: system faults never lock a customer out; real reasons do; a stuck lock heals.   pnpm exec tsx scripts/handoff-test.ts
import { ObjectId } from "mongodb";
import { acceptedOfferOfPerson, healthCheck, recordHandoff, supportedBy, REASON_TYPES } from "../src/handoff";
import { ok, t, finish, makeKit } from "./_testkit";

const kit = await makeKit(); const { db, orgId } = kit; const now = kit.now.t;
const conv = async (phone: string) => { const k = await kit.newContact(phone); return { ...k, mode: async () => ((await db.collection("conversations").findOne({ _id: k.conversationId })) as any).mode }; };

await t("a system fault tells the team once per half hour and NEVER locks the chat; a customer or policy reason locks it", async () => {
  const c = await conv("+14255550901");
  const a = await recordHandoff(db, { orgId, contactId: c.contactId, conversationId: c.conversationId, cause: "system", reason: "model error: 503", now });
  const b = await recordHandoff(db, { orgId, contactId: c.contactId, conversationId: c.conversationId, cause: "system", reason: "model error: 503", now: new Date(now.getTime() + 60_000) });
  ok(!a.locked && a.recorded && !b.recorded && (await c.mode()) === "agent", "system: noted once, not locked");
  ok((await db.collection("notifications").countDocuments({ conversationId: c.conversationId })) === 1, "no flood");
  const d = await conv("+14255550902");
  const l = await recordHandoff(db, { orgId, contactId: d.contactId, conversationId: d.conversationId, cause: "customer_request", reason: "asked for a person", now });
  ok(l.locked && (await d.mode()) === "human", "customer request locks");
  const e = await conv("+14255550903");
  await recordHandoff(db, { orgId, contactId: e.contactId, conversationId: e.conversationId, cause: "policy", reason: "legal", now }); ok((await e.mode()) === "human", "policy locks");
});
await t("every reason type is checkable against the customer's words, and ordinary sales talk matches none of them", async () => {
  for (const r of REASON_TYPES) ok(typeof supportedBy(r, "x") === "boolean", r);
  const sales = ["I'm thinking about switching to T-Mobile from Verizon", "can you do a discount?", "that's too expensive", "I need to think about it", "what's the price of the iPhone 17", "my current plan is a rip-off, I want a better deal", "I'm comparing carriers", "do you have anything cheaper"];
  for (const s of sales) for (const r of REASON_TYPES) ok(!supportedBy(r, s), `"${s}" must not count as ${r}`);
  ok(supportedBy("cancel_or_port_out", "I'm going to port my number to AT&T") && supportedBy("asked_for_person", "let me talk to someone") && supportedBy("fraud_or_theft", "I think it's fraud"), "real reasons match");
});
await t("'yes please' to the assistant's own offer of a specialist counts as asking for one; 'yes' to anything else does not", async () => {
  ok(acceptedOfferOfPerson(["USER:Yes please, have a specialist look at it.", "ASSISTANT:I can have a specialist review it. Want me to set that up?"]), "yes to the offer");
  ok(!acceptedOfferOfPerson(["USER:Yes please", "ASSISTANT:Want me to check promos for you?"]), "yes to something else");
  ok(!acceptedOfferOfPerson(["USER:No thanks", "ASSISTANT:Want me to bring in a specialist?"]), "no");
  ok(supportedBy("asked_for_person", "have a specialist look at it") && supportedBy("asked_for_person", "get me a manager") && !supportedBy("asked_for_person", "I'm calling your manager"), "wording");
});
await t("health watch: a chat locked by a system fault (or a legacy 'Automatic handoff') is given back to the agent; a customer-requested lock is left alone", async () => {
  const a = await conv("+14255550904"), b = await conv("+14255550905"), c = await conv("+14255550906");
  for (const x of [a, b, c]) await db.collection("conversations").updateOne({ _id: x.conversationId }, { $set: { mode: "human" } });
  await db.collection("notifications").insertOne({ orgId, conversationId: a.conversationId, kind: "handoff", message: "Automatic handoff: the agent failed 3 times in a row", urgency: "high", read: false, createdAt: now } as never);   // legacy row, no cause
  await db.collection("notifications").insertOne({ orgId, conversationId: b.conversationId, kind: "handoff", cause: "system", message: "x", urgency: "normal", read: false, createdAt: now } as never);
  await db.collection("notifications").insertOne({ orgId, conversationId: c.conversationId, kind: "handoff", cause: "customer_request", message: "asked for a person", urgency: "high", read: false, createdAt: now } as never);
  const logs: string[] = []; const r = await healthCheck(db, orgId, now, (m) => logs.push(m));
  ok(r.resumed === 2 && (await a.mode()) === "agent" && (await b.mode()) === "agent" && (await c.mode()) === "human", JSON.stringify({ r, a: await a.mode(), b: await b.mode(), c: await c.mode() }));
});
await t("health watch: if more than a quarter of the last hour's turns end in an escalation, block or failure the team is told ONCE", async () => {
  await db.collection("agent_turns").deleteMany({});
  const ins = (n: number, outcome: string) => db.collection("agent_turns").insertMany(Array.from({ length: n }, () => ({ orgId, conversationId: new ObjectId(), contactId: new ObjectId(), turnId: String(new ObjectId()), channel: "imessage", mode: "text", batchMessageIds: [], rounds: 1, outcome, model: "m", effort: "low", tokensIn: 1, tokensOut: 1, ms: 1, attempts: 1, note: null, toolCalls: [], startedAt: new Date(now.getTime() - 600_000) })) as never);
  await ins(12, "reply"); const calm = await healthCheck(db, orgId, now); ok(!calm.alarm, "healthy: no alarm");
  await ins(6, "escalated"); const hot = await healthCheck(db, orgId, now); ok(hot.alarm, "6 of 18 bad: alarm");
  const again = await healthCheck(db, orgId, now); ok(!again.alarm && (await db.collection("notifications").countDocuments({ kind: "health" })) === 1, "only once per hour");
});
await finish(kit);

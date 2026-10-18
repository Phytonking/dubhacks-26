// Lanes: bursts, ordering, parallelism, fairness, crash recovery, takeover, stale drafts, STOP/START/HELP.  pnpm exec tsx scripts/scheduler-test.ts
import { ObjectId } from "mongodb";
import { Scheduler } from "../src/scheduler";
import { Worker } from "../src/recorded-io";
import { singleFlight } from "../src/limits";
import type { ChatRequest } from "../src/engine/types";
import { ScriptedLlm, ok, t, finish, makeKit, type Kit } from "./_testkit";

const kit = await makeKit();
const { db, orgId, adapters } = kit;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Model with latency, a global concurrency meter, and an optional side-effect hook. */
class SlowLlm extends ScriptedLlm {
  inflight = 0; maxInflight = 0; perText = new Map<string, number>(); violation = false; nCalls = 0;
  constructor(private ms: number, script: ConstructorParameters<typeof ScriptedLlm>[0] = [{ content: "Sure, happy to help." }], private hook?: (req: ChatRequest, n: number) => Promise<void>) { super(script); }
  async chat(req: ChatRequest) {
    const text = String((req.messages[req.messages.length - 1] as any).content); const n = ++this.nCalls;
    this.inflight++; this.maxInflight = Math.max(this.maxInflight, this.inflight);
    const c = (this.perText.get(text) ?? 0) + 1; this.perText.set(text, c); if (c > 1) this.violation = true;
    try { await this.hook?.(req, n); await sleep(this.ms); return await super.chat(req); } finally { this.inflight--; this.perText.set(text, (this.perText.get(text) ?? 1) - 1); }
  }
}
const workers = (o: Record<string, unknown> = {}) => ({ imessage: new Worker(db, {} as never, adapters.imessage, async () => {}, { scheduled: true, debounceMs: 60, maxWaitMs: 400, brand: "Sunrise", ...o }) });
const inbound = (w: Worker, conv: { address?: string }, text: string, id?: string) => w.handleInbound({ orgId, address: conv.address ?? kit.phone, text, channelMsgId: id ?? `m_${Math.random().toString(36).slice(2)}`, ref: { spaceId: "spc", senderId: "usr" } });
const mkSched = (llm: ScriptedLlm, w: ReturnType<typeof workers>, o: Record<string, unknown> = {}) => new Scheduler({ db, engine: kit.deps(llm), workers: w, learn: false, pollMs: 20, leaseMs: 5000, heartbeatMs: 1000, ...o });
const clean = async () => { for (const a of Object.values(adapters)) { a.sent.length = 0; a.failNext = 0; } await db.collection("messages").deleteMany({}); await db.collection("agent_turns").deleteMany({}); await db.collection("opt_outs").deleteMany({}); await db.collection("notifications").deleteMany({});
  await db.collection("conversations").updateMany({}, { $unset: { lane: "" }, $set: { mode: "agent" } }); };
const outbound = () => db.collection("messages").find({ direction: "out" }).toArray();

await t("ingest is fast and never waits for the model: 30 messages from 30 people are stored and scheduled in well under a second while the model takes 300 ms each", async () => {
  await clean(); const w = workers(); const convs = [];
  for (let i = 0; i < 30; i++) convs.push(`+1425555${String(2000 + i)}`);
  const t0 = Date.now(); await Promise.all(convs.map((a) => inbound(w.imessage, { address: a }, "hello " + a)));
  const ms = Date.now() - t0; ok(ms < 1500, `ingest took ${ms} ms`);
  ok((await db.collection("conversations").countDocuments({ "lane.dueAt": { $type: "date" } })) >= 30, "lanes scheduled");
  return `${ms} ms for 30`;
});

await t("burst: three quick messages from one person become ONE turn and ONE reply that saw all three", async () => {
  await clean(); await db.collection("conversations").deleteMany({ _id: { $ne: kit.conversationId } }); await db.collection("contacts").deleteMany({ _id: { $ne: kit.contactId } });
  const w = workers(); const llm = new SlowLlm(20); const s = mkSched(llm, w);
  await inbound(w.imessage, {}, "Do you have size 54?"); await sleep(15); await inbound(w.imessage, {}, "and in blue?"); await sleep(15); await inbound(w.imessage, {}, "also what's the price");
  ok((await s.tick()) === 0, "must not start before the quiet period ends");
  await sleep(90); await s.drain();
  ok(llm.nCalls === 1, "one model call, got " + llm.nCalls);
  const asked = String((llm.requests[0].messages.at(-1) as any).content); ok(asked.includes("size 54") && asked.includes("in blue") && asked.includes("price"), asked);
  ok((await outbound()).length === 1, "one reply, got " + (await outbound()).length);
  const turns = await db.collection("agent_turns").find({}).toArray(); ok(turns.length === 1 && turns[0].batchMessageIds.length === 3 && turns[0].outcome === "reply", JSON.stringify(turns));
  ok((await db.collection("messages").countDocuments({ direction: "in", handledByTurn: { $exists: true } })) === 3, "all three marked answered");
});
await t("max wait: a constant trickle of messages cannot postpone the first reply beyond the cap", async () => {
  await clean(); const w = workers({ debounceMs: 100, maxWaitMs: 250 });
  const t0 = Date.now(); for (let i = 0; i < 6; i++) { await inbound(w.imessage, {}, "msg " + i); await sleep(50); }
  const c: any = await db.collection("conversations").findOne({ _id: kit.conversationId });
  ok(c.lane.dueAt.getTime() <= c.lane.firstAt.getTime() + 250 + 5, `dueAt ${c.lane.dueAt.getTime() - c.lane.firstAt.getTime()} ms after the first message`);
  void t0;
});
await t("a person is never handled by two turns at once, and a message that arrives mid-turn discards the stale draft: one reply to everything", async () => {
  await clean(); const w = workers(); let injected = false;
  const llm = new SlowLlm(120, [{ content: "Draft that does not know about the second message." }, { content: "Final answer that covers both questions." }], async (_req, n) => { if (n === 1 && !injected) { injected = true; await inbound(w.imessage, {}, "one more thing"); } });
  const s = mkSched(llm, w);
  await inbound(w.imessage, {}, "first question"); await sleep(90); await s.drain();
  ok(!llm.violation, "two simultaneous turns for one conversation");
  const out = await outbound(); ok(out.length === 1 && out[0].body.startsWith("Final answer"), JSON.stringify(out.map((o) => o.body)));
  const turns = await db.collection("agent_turns").find({}).sort({ startedAt: 1 }).toArray();
  ok(turns.map((x) => x.outcome).join() === "discarded,reply", turns.map((x) => x.outcome).join());
  const last = String((llm.requests[1].messages.at(-1) as any).content); ok(last.includes("first question") && last.includes("one more thing"), last);
});
await t("many people at once run in parallel up to the cap and all get answered (20 people, cap 8, 100 ms model: far faster than one at a time)", async () => {
  await clean(); const w = workers({ debounceMs: 10, maxWaitMs: 50 }); const llm = new SlowLlm(100); const s = mkSched(llm, w, { globalCap: 8, perOrgCap: 8 });
  const nums = Array.from({ length: 20 }, (_, i) => `+1425555${3000 + i}`);
  await Promise.all(nums.map((a, i) => inbound(w.imessage, { address: a }, "question " + i)));
  await sleep(30); const t0 = Date.now(); await s.drain(); const ms = Date.now() - t0;
  ok(llm.maxInflight <= 8 && llm.maxInflight >= 4, "max in flight " + llm.maxInflight);
  ok((await outbound()).length === 20, "answered " + (await outbound()).length);
  ok(ms < 20 * 100 * 0.6, `took ${ms} ms (sequential would be 2000+)`);
  ok(!llm.violation, "no person double-handled");
  return `max in flight ${llm.maxInflight}, ${ms} ms for 20`;
});
await t("fairness: one busy business cannot starve another (A has 30 waiting, B has 1; B is started in the first wave)", async () => {
  await clean(); const w = workers({ debounceMs: 5, maxWaitMs: 20 });
  const orgB = new ObjectId(); await db.collection("orgs").insertOne({ _id: orgB, name: "Other Shop", productDescription: "x", brandVoice: "x", hours: "x", plan: "pro", createdAt: kit.now.t });
  await db.collection("agents").insertOne({ orgId: orgB, status: "running", harness: null, persona: "p", guardrails: { maxDiscountPct: 5, escalateOn: [] }, enabledChannels: { imessage: true, whatsapp: false, sms: false, voice: false }, sandboxId: null, updatedAt: kit.now.t });
  const cb = new ObjectId(), vb = new ObjectId();
  await db.collection("contacts").insertOne({ _id: cb, orgId: orgB, handles: [{ channel: "imessage", address: "+14255559000" }], name: "B", stage: "new", score: 0, notes: "", facts: [], createdAt: kit.now.t } as never);
  await db.collection("conversations").insertOne({ _id: vb, orgId: orgB, contactId: cb, mode: "agent", lastChannel: "imessage", lastMessageAt: kit.now.t, lastMessagePreview: "" } as never);
  for (let i = 0; i < 30; i++) await inbound(w.imessage, { address: `+1425555${4000 + i}` }, "A question " + i);
  await sleep(10);
  await db.collection("messages").insertOne({ orgId: orgB, conversationId: vb, channel: "imessage", direction: "in", sender: "customer", body: "B question", channelMsgId: "b1", deliveryStatus: "received", handling: "agent", ts: new Date(), ref: { spaceId: "s", senderId: "u" } } as never);
  await db.collection("conversations").updateOne({ _id: vb }, { $set: { "lane.state": "idle", "lane.dueAt": new Date(Date.now() - 1) } });   // B has waited the longest of no one: it is the NEWEST
  const llm = new SlowLlm(200); const s = mkSched(llm, w, { globalCap: 4, perOrgCap: 3 });
  const started = await s.tick();
  ok(started === 4, "first wave " + started);
  const running = await db.collection("conversations").find({ "lane.state": "running" }).toArray();
  ok(running.filter((c) => String(c.orgId) === String(orgId)).length === 3 && running.some((c) => String(c.orgId) === String(orgB)), "wave: " + running.map((c) => String(c.orgId) === String(orgId) ? "A" : "B").join(""));
  await s.stop(); await db.collection("conversations").deleteMany({ orgId: orgB }); await db.collection("contacts").deleteMany({ orgId: orgB });
});
await t("crash recovery: a conversation whose worker died mid-turn (lease expired) is picked up by another worker and answered once", async () => {
  await clean(); const w = workers();
  await inbound(w.imessage, {}, "are you open sunday?"); await sleep(80);
  await db.collection("conversations").updateOne({ _id: kit.conversationId }, { $set: { "lane.state": "running", "lane.owner": "dead-worker", "lane.leaseUntil": new Date(Date.now() - 1000), "lane.startedAt": new Date(Date.now() - 5000) } });
  const llm = new SlowLlm(10); const s = mkSched(llm, w, { owner: "worker-2" }); await s.drain();
  ok((await outbound()).length === 1 && llm.nCalls === 1, "answered once: " + (await outbound()).length);
  const c: any = await db.collection("conversations").findOne({ _id: kit.conversationId }); ok(c.lane.state === "idle" && c.lane.owner === null && c.lane.dueAt === null, JSON.stringify(c.lane));
});
await t("crash after sending but before committing: the retry does not send a second time", async () => {
  await clean(); const w = workers();
  await inbound(w.imessage, {}, "price check?"); await sleep(80);
  const m: any = await db.collection("messages").findOne({ conversationId: kit.conversationId, direction: "in" });
  await db.collection("messages").insertOne({ orgId, conversationId: kit.conversationId, channel: "imessage", direction: "out", sender: "agent", body: "earlier reply", channelMsgId: "prov_1", clientMsgId: `turn:${kit.conversationId}:${m._id}`, deliveryStatus: "sent", handling: "agent", ts: new Date() } as never);
  const before = adapters.imessage.sent.length; const s = mkSched(new SlowLlm(10), w); await s.drain();
  ok(adapters.imessage.sent.length === before, "provider must not be called again");
  ok((await db.collection("messages").countDocuments({ conversationId: kit.conversationId, direction: "out" })) === 1, "still one outbound row");
  ok((await db.collection("messages").countDocuments({ _id: m._id, handledByTurn: { $exists: true } })) === 1, "inbound marked answered");
});
await t("owner takes over while the model is thinking: nothing is sent and the message is not left to be answered later", async () => {
  await clean(); const w = workers();
  const llm = new SlowLlm(50, [{ content: "Auto reply that must not be sent." }], async () => { await db.collection("conversations").updateOne({ _id: kit.conversationId }, { $set: { mode: "human" } }); });
  const s = mkSched(llm, w); await inbound(w.imessage, {}, "hello?"); await sleep(80); await s.drain();
  ok((await outbound()).length === 0, "must send nothing");
  const turns = await db.collection("agent_turns").find({}).toArray(); ok(turns[0]?.outcome === "silent", JSON.stringify(turns.map((x) => x.outcome)));
  ok((await db.collection("messages").countDocuments({ direction: "in", handledByTurn: { $exists: false } })) === 0, "inbound not left pending");
});
await t("lease lost mid-turn (another worker took the conversation): the slow worker does not send", async () => {
  await clean(); const w = workers();
  const llm = new SlowLlm(50, [{ content: "Should never be sent by the old owner." }], async () => { await db.collection("conversations").updateOne({ _id: kit.conversationId }, { $set: { "lane.owner": "someone-else", "lane.leaseUntil": new Date(Date.now() + 60_000) } }); });
  const s = mkSched(llm, w); await inbound(w.imessage, {}, "hi"); await sleep(80); await s.tick(); await sleep(250); await s.stop();
  ok((await outbound()).length === 0, "old owner must not send");
  const turns = await db.collection("agent_turns").find({}).toArray(); ok(turns.some((x) => x.outcome === "discarded" && /lease lost/.test(x.note ?? "")), JSON.stringify(turns.map((x) => x.note)));
});
await t("a lane that keeps failing retries with backoff, then hands the conversation to a person instead of looping", async () => {
  await clean(); const w = workers(); const broken = { imessage: { sendReply: async () => { throw new Error("db write failed"); } } } as never;
  const s = mkSched(new SlowLlm(5), broken, { pollMs: 10 }); await inbound(w.imessage, {}, "hello"); await sleep(80);
  for (let i = 0; i < 3; i++) { await s.tick(); await sleep(60); await db.collection("conversations").updateOne({ _id: kit.conversationId, "lane.dueAt": { $ne: null } }, { $set: { "lane.dueAt": new Date(Date.now() - 1) } }); }
  await s.drain().catch(() => {});
  const c: any = await db.collection("conversations").findOne({ _id: kit.conversationId }); ok(c.mode === "human", "mode " + c.mode);
  ok((await db.collection("notifications").countDocuments({ conversationId: kit.conversationId, kind: "handoff" })) === 1, "owner told");
});

// ---------------- STOP / START / HELP, human mode, duplicates ----------------
await t("STOP: opts out, confirms with fixed text, schedules nothing; later messages get no reply; START restores; the model never sees these", async () => {
  await clean(); const w = workers(); const llm = new SlowLlm(5); const s = mkSched(llm, w);
  let r: any = await inbound(w.imessage, {}, "STOP");
  ok(r.handling === "keyword" && r.keyword === "stop", JSON.stringify(r));
  ok(adapters.imessage.sent.length === 1 && /unsubscribed/.test(adapters.imessage.sent[0].text), "confirmation: " + adapters.imessage.sent[0]?.text);
  ok(await db.collection("opt_outs").countDocuments({ orgId, address: kit.phone }) === 1, "opt-out stored");
  r = await inbound(w.imessage, {}, "hello are you there"); ok(r.handling === "opted_out", "handling " + r.handling);
  await sleep(80); await s.drain(); ok(adapters.imessage.sent.length === 1 && llm.nCalls === 0, "no reply, no model call");
  r = await inbound(w.imessage, {}, "start"); ok(r.keyword === "start" && /subscribed again/.test(adapters.imessage.sent[1].text), "start confirmation");
  r = await inbound(w.imessage, {}, "HELP"); ok(r.keyword === "help" && /Reply STOP/.test(adapters.imessage.sent[2].text), "help text");
  r = await inbound(w.imessage, {}, "okay, now a real question"); ok(r.scheduled === true, "answered again after START");
  await sleep(80); await s.drain(); ok(llm.nCalls === 1, "model called once, for the real question");
});
await t("messages while a person has the conversation are stored but never scheduled; duplicates of the same provider message are ignored", async () => {
  await clean(); const w = workers(); await db.collection("conversations").updateOne({ _id: kit.conversationId }, { $set: { mode: "human" } });
  const r: any = await inbound(w.imessage, {}, "anyone there?", "dup1"); ok(r.handling === "human", "handling " + r.handling);
  ok(!(await db.collection("conversations").findOne({ _id: kit.conversationId, "lane.dueAt": { $type: "date" } })), "must not be scheduled");
  await db.collection("conversations").updateOne({ _id: kit.conversationId }, { $set: { mode: "agent" } });
  await inbound(w.imessage, {}, "hello", "dup2"); const again: any = await inbound(w.imessage, {}, "hello", "dup2");
  ok(again.duplicate === true && (await db.collection("messages").countDocuments({ channelMsgId: "dup2" })) === 1, "duplicate ignored");
});
await t("singleFlight: 20 concurrent callers share one execution (one sandbox wake, not twenty)", async () => {
  let runs = 0; const results = await Promise.all(Array.from({ length: 20 }, () => singleFlight("wake:org1", async () => { runs++; await sleep(30); return "up"; })));
  ok(runs === 1 && results.every((x) => x === "up"), "runs " + runs);
  await singleFlight("wake:org1", async () => { runs++; }); ok(runs === 2, "a later call runs again");
});

await finish(kit);

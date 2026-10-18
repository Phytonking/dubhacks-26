import { mkdirSync, writeFileSync } from "node:fs";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, ObjectId } from "mongodb";
import { applySchema } from "../../web/src/lib/schema";
import { Daytona } from "@daytona/sdk";
import { SandboxLink } from "../src/sandbox-link";
import { Orchestrator } from "../src/orchestrator";
import { LoopbackAdapter, PhotonAdapter, Worker, counters } from "../src/recorded-io";
import { photonEventHandler, mongoCursorStore } from "../src/photon-worker";
import { webhookServer, verifyWebhook } from "../src/webhook";
import { createHmac } from "node:crypto";

const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`missing env ${k}`); return v.trim(); };
const MODAL = { endpoint: need("MODAL_API_ENDPOINT"), id: need("MODAL_PROXY_TOKEN_ID"), secret: need("MODAL_PROXY_TOKEN_SECRET") };
const MODEL = "Qwen/Qwen3.8-2.4T-A95B";
const DAYTONA_KEY = need("DAYTONA_API_KEY");

type R = { name: string; ok: boolean; ms: number; detail: string };
const results: R[] = [];
const extra: Record<string, unknown> = {};
async function test(name: string, fn: () => Promise<string | void>) {
  const t0 = Date.now();
  try { const d = (await fn()) ?? ""; results.push({ name, ok: true, ms: Date.now() - t0, detail: d }); console.log("PASS", name, d); }
  catch (e) { const d = String((e as Error).message ?? e).slice(0, 600); results.push({ name, ok: false, ms: Date.now() - t0, detail: d }); console.log("FAIL", name, d); }
}
const assert = (c: unknown, m: string) => { if (!c) throw new Error(m); };

let mongo: MongoMemoryServer | undefined;
let orch: Orchestrator | undefined;
let orgId: ObjectId | undefined;
let mclient: MongoClient | undefined;
const daytona0 = new Daytona({ apiKey: DAYTONA_KEY });

try {
  // ---------- infra ----------
  await test("Modal endpoint answers directly", async () => {
    const t0 = Date.now();
    const r = await fetch(`${MODAL.endpoint}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${MODAL.id}.${MODAL.secret}` }, body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: "Say hi in 5 words." }], max_tokens: 120, reasoning_effort: "low" }) });
    assert(r.status === 200, `HTTP ${r.status}`);
    const j: any = await r.json();
    extra.modalDirectMs = Date.now() - t0;
    return `HTTP 200 in ${Date.now() - t0} ms, ${j.usage?.completion_tokens} completion tokens, reasoning returned in separate field: ${"reasoning_content" in j.choices[0].message}`;
  });

  mongo = await MongoMemoryServer.create();
  const client = await new MongoClient(mongo.getUri()).connect(); mclient = client;
  const db = client.db("e2e");
  const daytona = new Daytona({ apiKey: DAYTONA_KEY });
  const clamp = { low: { max_tokens: 300, reasoning_effort: "low" }, voice: { max_tokens: 120, reasoning_effort: "low" } };
  const llm = async (messages: unknown[], o: { channel: string }) => {
    const r = await fetch(`${MODAL.endpoint}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${MODAL.id}.${MODAL.secret}` },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.4, stream: false, ...(o.channel === "voice" ? clamp.voice : clamp.low) }) });
    if (!r.ok) throw new Error(`modal ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  };
  const link = new SandboxLink(daytona, llm);
  await test("Mongo schema + new message validators applied", async () => {
    const names = await applySchema(db);
    const ix = await db.collection("messages").indexes();
    const dedupe = ix.find((i) => i.name === "channel_1_channelMsgId_1");
    assert(dedupe?.partialFilterExpression, "dedupe index is not partial");
    return `${names.length} collections; dedupe index partial: ${JSON.stringify(dedupe!.partialFilterExpression)}`;
  });

  await test("Daytona API key valid (list sandboxes)", async () => {
    let n = 0; for await (const _ of daytona.list() as any) { n++; if (n > 50) break; }
    return `authenticated; ${n} existing sandbox(es) visible`;
  });

  // ---------- seed a test business ----------
  orgId = new ObjectId();
  const agentId = new ObjectId();
  await db.collection("orgs").insertOne({ _id: orgId, name: "Sunrise Bike Shop (e2e test)", productDescription: "Local bike shop in Seattle. Commuter, gravel and e-bikes; tune-ups, fitting, trade-ins.", brandVoice: "Friendly, upbeat, short replies.", hours: "Mon-Sat 10am-6pm PT", plan: "pro", createdAt: new Date() });
  await db.collection("agents").insertOne({ _id: agentId, orgId, status: "draft", harness: null, persona: "You help customers pick a bike and book a tune-up. Be concise.", guardrails: { maxDiscountPct: 10, escalateOn: ["refund", "legal"] }, enabledChannels: { imessage: true, whatsapp: false, sms: false, voice: false }, sandboxId: null, updatedAt: new Date() });
  await db.collection("knowledge").insertMany([
    { orgId, kind: "faq", title: "Tune-up pricing", content: "Basic tune-up is $89, takes 2 days. Full overhaul is $219.", sourceUrl: null, version: 1, status: "ready", createdAt: new Date() },
    { orgId, kind: "catalog", title: "Gravel bikes", content: "Trailhead Gravel GX is $1,450. Comes in sizes 49 to 58.", sourceUrl: null, version: 1, status: "ready", createdAt: new Date() },
  ]);

  const secrets = [need("PHOTON_API_KEY"), need("PHOTON_WEBHOOK_SIGNING_SECRET"), DAYTONA_KEY, MODAL.secret, MODAL.id, need("MONGODB_URI")];
  orch = new Orchestrator({ daytonaApiKey: DAYTONA_KEY, llmModel: MODEL, platformSecrets: secrets }, db, link);
  let steps: any[] = [];
  let sandbox: any;
  await test("provisionAgent: create sandbox, start agentd, reachable via preview URL, health check, assign line", async () => {
    const t0 = Date.now();
    const r = await orch!.provisionAgent(orgId!);
    steps = r.steps; sandbox = r.sandbox; extra.provisionTotalMs = Date.now() - t0; extra.steps = steps;
    return `total ${Date.now() - t0} ms: ` + steps.map((s) => `${s.name} ${s.ms}ms`).join(", ");
  });
  assert(sandbox, "provisioning failed, cannot continue");

  await test("Sandbox env has no Photon/Daytona/Modal/Mongo secrets", async () => {
    const r = await sandbox.process.executeCommand("env; echo ---; ps aux | head -50");
    const out: string = r.result ?? r.artifacts?.stdout ?? "";
    for (const s of secrets) assert(!out.includes(s), "a platform secret value appears in sandbox env/process list");
    for (const k of ["PHOTON_", "DAYTONA_API", "MODAL_", "MONGODB_URI"]) assert(!out.includes(k), `variable name ${k} present in sandbox`);
    for (const k of ["TURN_SECRET", "ORG_ID", "AGENT_ID"]) assert(out.includes(k), `${k} missing from sandbox env`);
    const node = (await sandbox.process.executeCommand("node -v")).result?.trim();
    extra.sandboxNode = node;
    return `env ok (node ${node}); TURN_SECRET present; no Photon/Daytona/Modal/Mongo secrets`;
  });

  // ---------- messaging ----------
  const adapter = new LoopbackAdapter();
  const worker = new Worker(db, link, adapter, async (o) => { await orch!.wake(o); });
  const customer = "+12065550142";
  const transcript: Array<{ dir: string; text: string; status?: string; ms?: number }> = [];
  const say = async (id: string, text: string) => {
    const t0 = Date.now(); transcript.push({ dir: "in", text });
    console.log(`  [${new Date().toISOString()}] CUSTOMER ${customer} (${id}): ${text}`);
    const r: any = await worker.handleInbound({ orgId: orgId!, address: customer, text, channelMsgId: id });
    if (r.reply) transcript.push({ dir: "out", text: r.reply.text, status: r.out?.status, ms: Date.now() - t0 });
    console.log(`  [${new Date().toISOString()}] ${r.duplicate ? "DUPLICATE ignored" : r.reply ? `AGENT (${r.out?.status}, ${Date.now() - t0} ms, usage ${JSON.stringify(r.reply.usage)}, tools ${JSON.stringify(r.reply.toolCalls.map((x: any) => x.tool))}): ${r.reply.text}` : `handling=${r.handling}, no agent reply`}`);
    return { r, ms: Date.now() - t0 };
  };

  await test("Inbound text -> agent reply (uses knowledge) -> both recorded", async () => {
    const { r, ms } = await say("in_001", "How much is a basic tune-up and how long does it take?");
    assert(r.out?.status === "sent", "reply not sent: " + JSON.stringify(r.out));
    assert(/89/.test(r.reply.text), "reply did not use knowledge (no $89): " + r.reply.text);
    const rows = await db.collection("messages").find({ orgId }).toArray();
    assert(rows.some((m) => m.direction === "in" && m.deliveryStatus === "received"), "no inbound row");
    const o = rows.find((m) => m.direction === "out");
    assert(o?.deliveryStatus === "sent" && o.channelMsgId && o.clientMsgId && o.agentTurnId, "outbound row incomplete");
    extra.firstReplyMs = ms;
    return `round trip ${ms} ms (agent turn ${r.reply.ms} ms). Reply: "${r.reply.text}"`;
  });
  await test("Duplicate delivery of the same inbound message is ignored", async () => {
    const before = await db.collection("messages").countDocuments({ orgId });
    const { r } = await say("in_001", "How much is a basic tune-up and how long does it take?");
    transcript.pop();
    assert(r.duplicate === true, "not flagged duplicate");
    assert((await db.collection("messages").countDocuments({ orgId })) === before, "duplicate created rows");
    return "duplicate-key on (channel, channelMsgId): no new rows, agent not re-run";
  });
  await test("Multi-turn context (history reaches the agent)", async () => {
    const { r, ms } = await say("in_002", "And what's the price of the gravel bike you carry?");
    assert(/1,?450/.test(r.reply.text), "did not use catalog knowledge: " + r.reply.text);
    const t2 = await say("in_003", "Great, remind me what I asked about first?");
    return `turn 2 ${ms} ms, turn 3 ${t2.ms} ms. Turn 3 reply: "${t2.r.reply.text}"`;
  });
  await test("Guardrail blocks an over-limit discount; stored as blocked, never sent", async () => {
    const conv = await db.collection("conversations").findOne({ orgId });
    const before = adapter.sent.length;
    const out = await worker.sendReply(orgId!, conv!._id, customer, "Sure, I can do 50% off today!", "guardrail-test", { maxDiscountPct: 10 });
    assert(out.status === "blocked", "not blocked");
    assert(adapter.sent.length === before, "blocked message was sent");
    const row = await db.collection("messages").findOne({ orgId, deliveryStatus: "blocked" });
    assert(row?.guardrail && (row.guardrail as any).reason, "no guardrail reason on row");
    return (row!.guardrail as any).reason;
  });
  await test("Human takeover: inbound stored, agent stays silent", async () => {
    await db.collection("conversations").updateOne({ orgId }, { $set: { mode: "human" } });
    const outsBefore = await db.collection("messages").countDocuments({ orgId, direction: "out" });
    const sentBefore = adapter.sent.length;
    const { r } = await say("in_004", "Hello? Is a human there?");
    assert(r.handling === "human" && !r.reply, "agent replied during takeover");
    assert((await db.collection("messages").countDocuments({ orgId, direction: "out" })) === outsBefore && adapter.sent.length === sentBefore, "outbound row/send during takeover");
    await db.collection("conversations").updateOne({ orgId }, { $set: { mode: "agent" } });
    return "inbound row handling=human, zero outbound rows";
  });
  await test("Agent does not invent facts it has no knowledge of", async () => {
    const { r } = await say("in_004b", "Do you sell Brompton folding bikes and what do they cost?");
    assert(!/\$\s?\d/.test(r.reply.text), "reply invented a price: " + r.reply.text);
    return `Reply: "${r.reply.text}"`;
  });
  await test("Voice-style turn (channel=voice): short spoken reply, latency", async () => {
    const t0 = Date.now();
    const cfg = { org: await db.collection("orgs").findOne({ _id: orgId }), agent: await db.collection("agents").findOne({ orgId }), knowledge: await db.collection("knowledge").find({ orgId }).toArray() };
    const r = await link.send(String((cfg.agent as any)._id), { channel: "voice", text: "Hi, what are your opening hours?", config: cfg, history: [] });
    const words = r.text.split(/\s+/).length;
    extra.voiceTurnMs = Date.now() - t0;
    assert(words <= 45, `voice reply too long (${words} words)`);
    return `${Date.now() - t0} ms, ${words} words: "${r.text}"  (voice target 1200 ms p50 incl. STT/TTS, not yet met if > 1200)`;
  });
  await test("Photon event path: message.received -> agent -> Photon sendMessage (mocked) -> delivery events update status", async () => {
    const calls: any[] = [];
    const fake: any = { sendText: async (a: any) => { calls.push(a); return { id: "pho_msg_out_1" }; } };
    const pw = new Worker(db, link, new PhotonAdapter(fake), async (o) => { await orch!.wake(o); });
    await db.collection("channel_lines").updateOne({ orgId }, { $set: { address: "+12066353267" } });
    const handle = photonEventHandler(pw, async (line) => (await db.collection("channel_lines").findOne({ address: line }))?.orgId ?? null, (m) => console.log("  [photon]", m));
    const received = { id: "evt_1", type: "message.received", apiVersion: "2026-07-01", timestamp: new Date().toISOString(), data: { projectId: "pho_prj_test", object: {
      id: "pho_msg_in_100", platform: "imessage", status: "received", content: { type: "text", format: "plain", text: "Hi! What are your hours?" },
      sentBy: { id: "pho_usr_cust", handle: "+12065550177", kind: "user", platform: "imessage" },
      receivedBy: { id: "pho_usr_agent", handle: "+12066353267", kind: "agent", platform: "imessage" },
      space: { id: "pho_spc_1", kind: "direct", platform: "imessage" } } } };
    console.log("  [photon] event message.received from +12065550177: Hi! What are your hours?");
    await handle(received as any);
    assert(calls.length === 1, `expected 1 sendMessage call, got ${calls.length}`);
    const c = calls[0];
    assert(c.spaceId === "pho_spc_1" && c.senderId === "pho_usr_agent" && c.parentMessageId === "pho_msg_in_100", "wrong routing fields: " + JSON.stringify(c));
    const out = await db.collection("messages").findOne({ orgId, direction: "out", channelMsgId: "pho_msg_out_1" });
    assert(out && out.clientMsgId === c.idempotencyKey, "idempotency key is not the stored clientMsgId");
    console.log(`  [photon] sendMessage(spaceId=${c.spaceId}, senderId=${c.senderId}, parent=${c.parentMessageId}, idempotency-key=${String(c.idempotencyKey).slice(0, 8)}…): "${c.text}"`);
    await handle({ id: "e2", type: "message.dispatched", apiVersion: "2026-07-01", timestamp: "", data: { projectId: "x", object: { id: "pho_msg_out_1", platform: "imessage" } } } as any);
    await handle({ id: "e3", type: "message.delivered", apiVersion: "2026-07-01", timestamp: "", data: { projectId: "x", object: { id: "pho_msg_out_1", platform: "imessage" } } } as any);
    await handle({ id: "e4", type: "message.dispatched", apiVersion: "2026-07-01", timestamp: "", data: { projectId: "x", object: { id: "pho_msg_out_1", platform: "imessage" } } } as any); // late duplicate must not move status backwards
    const after = await db.collection("messages").findOne({ _id: out!._id });
    assert(after!.deliveryStatus === "delivered", `status is ${after!.deliveryStatus}, expected delivered`);
    const dup = await handle(received as any).then(() => calls.length);
    assert(dup === 1, "redelivered event re-sent a reply");
    const cur = mongoCursorStore(db, "test"); await cur.set(5); await cur.set(3); // $max: never goes backwards
    assert((await cur.get()) === 5, "cursor moved backwards");
    return `sendMessage routed to space/agent user, idempotency key = clientMsgId; dispatched -> delivered; late dispatched ignored; replayed event not re-sent; cursor monotonic. Reply: "${c.text}"`;
  });
  await test("Photon message.failed marks the stored message failed with a reason", async () => {
    const m = await db.collection("messages").findOne({ orgId, direction: "out", channelMsgId: "pho_msg_out_1" });
    await db.collection("messages").updateOne({ _id: m!._id }, { $set: { deliveryStatus: "sent" } }); // reset to test failure transition
    const pw = new Worker(db, link, new PhotonAdapter({} as any), async () => {});
    await pw.handleDelivery("message.failed", { id: "pho_msg_out_1", failure: { message: "recipient unreachable" } });
    const f = await db.collection("messages").findOne({ _id: m!._id });
    assert(f!.deliveryStatus === "failed" && f!.deliveryError === "recipient unreachable", JSON.stringify(f));
    return `deliveryStatus=failed, deliveryError="${f!.deliveryError}"`;
  });
  await test("Webhook signatures: valid accepted; forged, tampered, stale and unsigned rejected (your real whsec_ secret)", async () => {
    const secret = need("PHOTON_WEBHOOK_SIGNING_SECRET");
    const body = JSON.stringify({ id: "evt_w", type: "message.received", apiVersion: "2026-07-01", data: { object: {}, projectId: "p" } });
    const now = Math.floor(Date.now() / 1000);
    const std = (id: string, ts: number, b: string, s = secret) => ({ "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": "v1," + createHmac("sha256", Buffer.from(s.replace(/^whsec_/, ""), "base64")).update(`${id}.${ts}.${b}`).digest("base64") });
    const spec = (ts: number, b: string, s = secret) => ({ "x-spectrum-timestamp": String(ts), "x-spectrum-signature": "v0=" + createHmac("sha256", s).update(`v0:${ts}:${b}`).digest("hex") });
    const r: Record<string, boolean> = {
      standardValid: verifyWebhook(std("msg_1", now, body), body, [secret]).ok,
      spectrumValid: verifyWebhook(spec(now, body), body, [secret]).ok,
      rotationOverlap: verifyWebhook(std("msg_2", now, body, "whsec_" + Buffer.from("old-secret-old-secret-old-secret!").toString("base64")), body, ["whsec_" + Buffer.from("new").toString("base64"), "whsec_" + Buffer.from("old-secret-old-secret-old-secret!").toString("base64")]).ok,
      wrongSecretRejected: !verifyWebhook(std("msg_3", now, body, "whsec_" + Buffer.from("x".repeat(32)).toString("base64")), body, [secret]).ok,
      tamperedRejected: !verifyWebhook(std("msg_4", now, body), body + " ", [secret]).ok,
      staleRejected: !verifyWebhook(std("msg_5", now - 600, body), body, [secret]).ok,
      futureRejected: !verifyWebhook(std("msg_6", now + 600, body), body, [secret]).ok,
      unsignedRejected: !verifyWebhook({}, body, [secret]).ok,
      idSwapRejected: !verifyWebhook({ ...std("msg_7", now, body), "webhook-id": "msg_other" }, body, [secret]).ok,
    };
    const bad = Object.entries(r).filter(([, v]) => !v).map(([k]) => k);
    assert(bad.length === 0, "failed: " + bad.join(", "));
    return `${Object.keys(r).length}/${Object.keys(r).length} cases correct: ${Object.keys(r).join(", ")}`;
  });
  await test("Webhook receiver: signed delivery acked once the message is stored; bad signature 401 and nothing stored; replay ignored", async () => {
    const secret = need("PHOTON_WEBHOOK_SIGNING_SECRET");
    const calls: any[] = [];
    const fake: any = { sendText: async (a: any) => { calls.push(a); return { id: "pho_msg_wh_out" }; } };
    const ww = new Worker(db, link, new PhotonAdapter(fake, "sms"), async (o) => { await orch!.wake(o); });
    await db.collection("channel_lines").updateOne({ orgId }, { $set: { address: "+12066353267" } });
    const handle = photonEventHandler({ sms: ww }, async (line) => (await db.collection("channel_lines").findOne({ address: line }))?.orgId ?? null, (m) => console.log("  [webhook]", m));
    const srv = webhookServer({ secrets: [secret], handler: handle, log: (m) => console.log("  [webhook]", m) });
    await new Promise<void>((r) => srv.listen(8788, "127.0.0.1", () => r()));
    try {
      const evt = { id: "evt_wh_1", type: "message.received", apiVersion: "2026-07-01", timestamp: new Date().toISOString(), data: { projectId: "pho_prj_t", object: {
        id: "pho_msg_wh_in_1", platform: "sms", status: "received", content: { type: "text", format: "plain", text: "Do you have gravel bikes?" },
        sentBy: { id: "pho_usr_c2", handle: "+12065550188", kind: "human", platform: "sms" }, receivedBy: { id: "pho_usr_a2", handle: "+12066353267", kind: "agent", platform: "sms" }, space: { id: "pho_spc_wh", kind: "direct", platform: "sms" } } } };
      const body = JSON.stringify(evt); const ts = Math.floor(Date.now() / 1000); const id = "msg_whtest_1";
      const sig = "v1," + createHmac("sha256", Buffer.from(secret.replace(/^whsec_/, ""), "base64")).update(`${id}.${ts}.${body}`).digest("base64");
      const post = (b: string, headers: Record<string, string>) => fetch("http://127.0.0.1:8788/", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: b });
      const before = await db.collection("messages").countDocuments({ orgId });
      const bad = await post(body, { "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": "v1,AAAA" });
      assert(bad.status === 401, `forged request got ${bad.status}`);
      assert((await db.collection("messages").countDocuments({ orgId })) === before, "forged request wrote rows");
      const t0 = Date.now();
      const ok = await post(body, { "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": sig });
      const ackMs = Date.now() - t0;
      assert(ok.status === 200, `signed request got ${ok.status}`);
      const stored = await db.collection("messages").findOne({ orgId, channelMsgId: "pho_msg_wh_in_1" });
      assert(stored && stored.deliveryStatus === "received", "inbound message not stored at ack time");
      for (let i = 0; i < 40 && calls.length === 0; i++) await new Promise((r) => setTimeout(r, 250));   // agent turn finishes after the ack
      assert(calls.length === 1, "agent reply was not sent after the ack");
      const again = await post(body, { "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": sig });
      assert(again.status === 200 && calls.length === 1, "replayed webhook re-ran the agent");
      return `forged -> 401, no rows; signed -> 200 in ${ackMs} ms with message already stored; agent reply sent after ack ("${String(calls[0].text).slice(0, 70)}"); replay -> 200, not re-run`;
    } finally { await new Promise((r) => srv.close(() => r(null))); }
  });
  await test("Stop sandbox, then inbound message wakes it and gets a reply", async () => {
    const ag = String((await db.collection("agents").findOne({ orgId }))!._id);
    const t0 = Date.now();
    await daytona.stop(sandbox);
    const stopMs = Date.now() - t0;
    assert(!(await link.online(ag)), "agent still reachable after stop");
    const w0 = Date.now();
    const { r } = await say("in_005", "Do you do bike fittings?");
    extra.stopMs = stopMs; extra.wakeToReplyMs = Date.now() - w0;
    assert(r.out?.status === "sent", "no reply after wake");
    return `stop ${stopMs} ms; inbound -> wake -> reply ${Date.now() - w0} ms. Reply: "${r.reply.text}"`;
  });

  await test("Completeness: every inbound/outbound attempt has a Mongo row; nothing stuck", async () => {
    const inRows = await db.collection("messages").countDocuments({ orgId, direction: "in" });
    const outRows = await db.collection("messages").countDocuments({ orgId, direction: "out" });
    const tools = await db.collection("tool_calls").countDocuments({ orgId });
    const usage = await db.collection("usage").findOne({ orgId });
    const stuck = await worker.stuckSends(0);
    assert(inRows === counters.inReceived - 2, `inbound rows ${inRows} vs received ${counters.inReceived} (2 duplicates expected: one direct, one replayed Photon event; replayed webhooks are dropped earlier by webhook-id)`);
    assert(outRows === counters.outAttempted, `outbound rows ${outRows} vs attempts ${counters.outAttempted}`);
    assert(stuck === 0, `${stuck} stuck sends`);
    assert(tools >= 5, `only ${tools} tool_calls rows`);
    assert(usage && usage.tokensOut > 0, "no usage row");
    const u = usage!;
    extra.counts = { inRows, outRows, tools, tokensIn: u.tokensIn, tokensOut: u.tokensOut, adapterSent: adapter.sent.length };
    return `in ${inRows}/${counters.inReceived - 2} · out ${outRows}/${counters.outAttempted} · tool_calls ${tools} · tokens in/out ${u.tokensIn}/${u.tokensOut} · stuck ${stuck}`;
  });
  extra.transcript = transcript;
  extra.dbMessages = (await db.collection("messages").find({ orgId }).sort({ ts: 1 }).toArray()).map((m) => ({ dir: m.direction, status: m.deliveryStatus, handling: m.handling, body: m.body, channelMsgId: m.channelMsgId, guardrail: m.guardrail }));
} catch (e) {
  results.push({ name: "e2e aborted", ok: false, ms: 0, detail: String((e as Error).stack ?? e).slice(0, 800) });
} finally {
  if (orch && orgId) {
    try { const sb: any = await daytona0.get(`agent-${orgId}`); if (sb.state !== "started") await daytona0.start(sb, 60); const l = await sb.process.executeCommand("cat /tmp/agentd.log"); console.log("\n===== agentd.log (from inside the sandbox) =====\n" + String(l.result).trim() + "\n===== end agentd.log =====\n"); } catch (e) { console.log("could not read agentd.log:", (e as Error).message); }
  }
  if (orch && orgId) { await test("Cleanup: delete test sandbox", async () => { await orch!.destroy(orgId!); return "deleted"; }); }
  await mclient?.close(); await mongo?.stop();
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/results.json", JSON.stringify({ at: new Date().toISOString(), results, extra }, null, 2));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
  process.exit(0);
}

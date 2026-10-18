// Live runner: real Daytona sandbox + real Photon events + Atlas. Texts to the project's number get answered by the agent.
//   cd agent && pnpm live          (Ctrl-C or `pkill -f scripts/live.ts` to stop; the sandbox is deleted on exit)
import { appendFileSync, mkdirSync } from "node:fs";
import { MongoClient, ObjectId } from "mongodb";
import { Daytona } from "@daytona/sdk";
import { Photon, PhotonEvents } from "../src/photon";
import { Orchestrator } from "../src/orchestrator";
import { SandboxLink } from "../src/sandbox-link";
import { PhotonAdapter, Worker, type ChannelAdapter, type ChannelId } from "../src/recorded-io";
import { mongoCursorStore, photonEventHandler } from "../src/photon-worker";
import { webhookServer } from "../src/webhook";
import { handleCallEvent } from "../src/calls";
import { randomBytes } from "node:crypto";
import { ModalLlm } from "../src/engine/llm";
import { ALL_TOOLS } from "../src/engine/tools/index";
import type { EngineDeps } from "../src/engine/turn";
import { Messenger, type Readiness } from "../src/messenger";
import { Scheduler } from "../src/scheduler";
import { summarizeIfNeeded } from "../src/summarizer";
import { startVoiceServer } from "../src/voice/bridge";

const need = (k: string) => { const v = process.env[k]?.trim(); if (!v) throw new Error(`missing env ${k}`); return v; };
mkdirSync("test-results", { recursive: true });
const log = (m: string) => { const line = `[${new Date().toISOString()}] ${m}`; console.log(line); appendFileSync("test-results/live.log", line + "\n"); };
const mask = (s: string) => s.replace(/\+(\d)(\d{3})(\d{3})(\d{4})/g, "+$1$2***$4");

const MODAL = { endpoint: need("MODAL_API_ENDPOINT"), id: need("MODAL_PROXY_TOKEN_ID"), secret: need("MODAL_PROXY_TOKEN_SECRET") };
const MODEL = "Qwen/Qwen3.8-2.4T-A95B";
const photon = new Photon(need("PHOTON_API_KEY"), need("PHOTON_PROJECT_ID"));
const mongo = await new MongoClient(need("MONGODB_URI")).connect();
const db = mongo.db(process.env.MONGODB_DB ?? "salesagent");
const daytona = new Daytona({ apiKey: need("DAYTONA_API_KEY") });

const llm = async (messages: unknown[], o: { channel: string }) => {
  const r = await fetch(`${MODAL.endpoint}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${MODAL.id}.${MODAL.secret}` },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.4, stream: false, max_tokens: o.channel === "sms" ? 200 : 300, reasoning_effort: "low" }) });
  if (!r.ok) throw new Error(`modal ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
};
const link = new SandboxLink(daytona, llm);

// ---- business: reuse the first org in Atlas (the demo shop); give it knowledge if it has none ----
const org: any = await db.collection("orgs").findOne(process.env.LIVE_ORG ? { name: process.env.LIVE_ORG } : {});
if (!org) throw new Error(process.env.LIVE_ORG ? `no business named "${process.env.LIVE_ORG}" in Atlas (run pnpm db:seed:tmobile in web/)` : "no org in Atlas; run pnpm db:seed in web/");
const orgId: ObjectId = org._id;
log(`business: "${org.name}" (${orgId})`);
if (!(await db.collection("knowledge").countDocuments({ orgId }))) {
  await db.collection("knowledge").insertMany([
    { orgId, kind: "faq", title: "Tune-up pricing", content: "Basic tune-up is $89 and takes 2 days. Full overhaul is $219.", sourceUrl: null, version: 1, status: "ready", createdAt: new Date() },
    { orgId, kind: "catalog", title: "Gravel bikes", content: "Trailhead Gravel GX is $1,450. Sizes 49 to 58. Test rides welcome.", sourceUrl: null, version: 1, status: "ready", createdAt: new Date() },
    { orgId, kind: "faq", title: "Hours and location", content: "Open Mon-Sat 10am-6pm Pacific. Closed Sunday. Walk-ins welcome for tune-ups.", sourceUrl: null, version: 1, status: "ready", createdAt: new Date() },
  ]);
  log("seeded 3 knowledge rows (the business had none)");
}

// ---- real Photon lines -> channel_lines (maps receiving number -> business) ----
const resources: any = await photon.listResources();
const smsLine = resources.resources.find((r: any) => r.abilities?.includes("sms") && r.state === "active");
const knownLines = new Set<string>();
async function registerLines() {
  // iMessage shared line: each assignment's assignedPhoneNumber is the number that user texts -> this business
  const asg: any = await photon.req("GET", "/platforms/imessage/assignments").catch(() => ({ assignments: [] }));
  // IMESSAGE_KEEP_HANDLES (comma list): only these people keep an iMessage line (the owner's test line). Others are switched off here; Photon's own assignments are not touched.
  const keep = (process.env.IMESSAGE_KEEP_HANDLES ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (keep.length) asg.assignments = (asg.assignments ?? []).filter((a: any) => keep.includes(a.handle));
  const live = new Set<string>((asg.assignments ?? []).map((a: any) => a.assignedPhoneNumber));
  // assignments can be replaced in the Photon dashboard: disable lines that no longer exist
  await db.collection("channel_lines").updateMany({ channel: "imessage", provider: "photon", address: { $nin: [...live] }, status: "active" }, { $set: { status: "disabled" } });
  for (const a of asg.assignments ?? []) {
    if (knownLines.has(a.assignedPhoneNumber + a.handle)) { await db.collection("channel_lines").updateOne({ channel: "imessage", address: a.assignedPhoneNumber }, { $set: { status: "active" }, $addToSet: { handles: a.handle } }); continue; }
    knownLines.add(a.assignedPhoneNumber + a.handle);
    await db.collection("channel_lines").updateOne({ channel: "imessage", address: a.assignedPhoneNumber },
      { $set: { orgId, provider: "photon", photonLineId: a.assignmentId, status: "active", capabilities: ["typing", "reactions", "threads"] }, $addToSet: { handles: a.handle }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true });
    log(`line: iMessage ${mask(a.assignedPhoneNumber)} (shared, assignment ${String(a.assignmentId).slice(0, 8)}…) -> this business`);
  }
  if (smsLine) {
    const first = !knownLines.has("sms");
    knownLines.add("sms");
    await db.collection("channel_lines").updateOne({ channel: "sms", address: smsLine.detail.phoneNumber },
      { $set: { orgId, provider: "photon", photonLineId: smsLine.resourceId, status: "active", capabilities: smsLine.abilities }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true });   // errors must surface: a silent failure here means inbound texts have no business to go to
    if (first) log(`line: SMS ${mask(smsLine.detail.phoneNumber)} -> this business`);
  }
  // the number people CALL (voice) and the WhatsApp Business number are lines of the business as well: the agent tells customers about them
  const voiceLine = resources.resources.find((r: any) => r.abilities?.includes("pstn_voice") && r.state === "active");
  if (voiceLine && !knownLines.has("voice")) {
    knownLines.add("voice");
    await db.collection("channel_lines").updateOne({ channel: "voice", address: voiceLine.detail.phoneNumber }, { $set: { orgId, provider: "photon", photonLineId: voiceLine.resourceId, status: "active", capabilities: ["pstn_voice"] }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
    log(`line: voice ${mask(voiceLine.detail.phoneNumber)} -> this business`);
  }
  if (!knownLines.has("whatsapp")) {
    const wa: any = await photon.req("GET", "/platforms/whatsapp-business/account/phone-numbers").catch(() => null);
    for (const n of wa?.phoneNumbers ?? []) {
      knownLines.add("whatsapp");
      await db.collection("channel_lines").updateOne({ channel: "whatsapp", address: n.phoneNumber }, { $set: { orgId, provider: "photon", photonLineId: n.phoneNumberId ?? null, status: "active", capabilities: ["templates", "session"] }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
      log(`line: WhatsApp ${mask(n.phoneNumber)} -> this business`);
    }
  }
}

const orch = new Orchestrator({ daytonaApiKey: need("DAYTONA_API_KEY"), llmModel: MODEL, snapshot: undefined,
  platformSecrets: [need("PHOTON_API_KEY"), need("DAYTONA_API_KEY"), MODAL.secret, MODAL.id, need("MONGODB_URI")],
  assignLine: registerLines }, db, link);

log("provisioning Daytona sandbox + agent ...");
await orch.destroy(orgId);                       // clear any leftover sandbox from an earlier run
const t0 = Date.now();
const { steps } = await orch.provisionAgent(orgId);
log(`agent ready in ${Date.now() - t0} ms: ` + steps.map((s) => `${s.name} ${s.ms}ms`).join(", "));

// ---- workers per platform; hourly send cap as a safety net ----
let sent = 0; const windowStart = Date.now();
const capped = (a: ChannelAdapter): ChannelAdapter => ({ channel: a.channel, send: async (...args) => {
  if (Date.now() - windowStart < 3_600_000 && ++sent > 60) throw new Error("hourly send cap (60) reached");
  const r = await a.send(...args); log(`SENT via Photon on ${a.channel}: "${args[1]}"`); return r; } });
const ensure = async (o: ObjectId) => { const w = await orch.wake(o); if (w.woke) log(`woke sandbox in ${w.ms} ms`); };
// ---- engine v2 (default): a message is stored and scheduled in milliseconds; the Scheduler runs turns with tools, memory, verification,
//      guardrails and a per-conversation lane. ENGINE=legacy keeps the old sandbox prompt path (one inline turn per message). ----
const v2 = process.env.ENGINE !== "legacy";
log(`engine: ${v2 ? "v2 (scheduler + tools)" : "legacy (sandbox prompt path)"}`);
const wopts = { scheduled: v2, debounceMs: Number(process.env.DEBOUNCE_MS ?? 2000), maxWaitMs: Number(process.env.MAX_WAIT_MS ?? 8000), brand: org.name };
const mk = (c: ChannelId, o: object = {}) => new Worker(db, link, capped(new PhotonAdapter(photon, c)), ensure, { ...wopts, ...o });
// SMS sends are refused by carriers unless a 10DLC campaign is assigned to the line (verified 2026-10-18: SMS_CAMPAIGN_NOT_ELIGIBLE).
// Don't spend LLM turns on texts we cannot answer; start answering automatically on the next restart once the line is eligible.
let smsReady = false;
if (smsLine) {
  const camp: any = await photon.req("GET", `/platforms/sms/lines/${smsLine.resourceId}/campaign`).catch((e: Error) => ({ eligibility: "unknown", reasonCode: e.message.slice(0, 80) }));
  smsReady = camp.eligibility === "eligible";
  log(smsReady ? "SMS: campaign eligible, answering SMS" : `SMS: LISTEN-ONLY, reads inbound and records it, cannot reply (campaign eligibility=${camp.eligibility}, ${camp.reasonCode}). Register a 10DLC campaign in the Photon dashboard and assign it to the line.`);
}
// WhatsApp Business is connected (approved) on the same number. Log-only until WHATSAPP_REPLIES=1: the first message we received was a
// Meta setup notice, not a customer, and business-initiated WhatsApp needs approved templates we have not created yet.
const waReplies = process.env.WHATSAPP_REPLIES !== "0";
log(waReplies ? "WhatsApp: replies ENABLED (set WHATSAPP_REPLIES=0 to turn off)" : "WhatsApp: logging inbound only");
const wIm = mk("imessage"), wWa = mk("whatsapp", { autoReply: waReplies }), wSms = mk("sms", smsReady ? {} : { listenOnly: true });   // not eligible to send yet: still read and learn from inbound texts (callers can text the call number), never reply
const workers = { imessage: wIm, whatsapp_business: wWa, sms: wSms };

let scheduler: Scheduler | undefined; let engine: EngineDeps | undefined; let voice: Awaited<ReturnType<typeof startVoiceServer>> | undefined;
if (v2) {
  const verifySecret = process.env.VERIFY_HMAC_SECRET?.trim() || (() => { log("WARNING: VERIFY_HMAC_SECRET is not set; using a temporary secret (codes issued before a restart will not verify)"); return randomBytes(24).toString("hex"); })();
  if (!process.env.FORM_ENC_KEY) log("secure forms: FORM_ENC_KEY is not set in this process (agent can send links; the web app needs the key to accept answers)");
  const adapters = { imessage: capped(new PhotonAdapter(photon, "imessage")), whatsapp: capped(new PhotonAdapter(photon, "whatsapp")), ...(smsReady ? { sms: capped(new PhotonAdapter(photon, "sms")) } : {}) };
  // A channel is "ready" for an unprompted text only when the provider will accept it: iMessage needs a recent message from the person (shared line
  // cannot start a chat), WhatsApp only inside its 24-hour window (otherwise an approved template is required), SMS only once the campaign is approved.
  const ready: Readiness = async (channel, c) => {
    if (channel === "sms") return smsReady ? { ok: true } : { ok: false, reason: "SMS campaign not eligible" };
    const hours = channel === "whatsapp" ? 24 : 24 * 30;
    const n = await db.collection("messages").countDocuments({ orgId: c.orgId, conversationId: c.conversationId, channel, direction: "in", ref: { $ne: null }, ts: { $gte: new Date(Date.now() - hours * 3600_000) } }, { limit: 1 });
    return n ? { ok: true } : { ok: false, reason: channel === "whatsapp" ? "WhatsApp 24-hour window closed (needs an approved template)" : "no recent message from this person on iMessage" };
  };
  const llm = new ModalLlm({ endpoint: MODAL.endpoint, id: MODAL.id, secret: MODAL.secret, model: MODEL });
  // A caller on the phone who has never texted us can only be reached on iMessage after the shared line is assigned to them. Done on request
  // (contact_options), reusing an existing assignment, capped so a burst of callers cannot use up the plan's assignments. Off by default (only the one test iMessage line is kept); AUTO_ASSIGN_IMESSAGE=1 turns it on.
  const assignCap = Number(process.env.IMESSAGE_ASSIGN_CAP ?? 20);
  const assignIMessage = process.env.AUTO_ASSIGN_IMESSAGE !== "1" ? undefined : async (a: { orgId: ObjectId; handle: string; firstName?: string }) => {
    const list: any = await photon.req("GET", "/platforms/imessage/assignments");
    const all: any[] = list.assignments ?? [];
    let found = all.find((x) => x.handle === a.handle);
    if (!found) {
      if (all.length >= assignCap) { log(`iMessage assignment cap reached (${all.length}/${assignCap}); not assigning ${mask(a.handle)}`); return null; }
      found = await photon.assignSharedLine({ handle: a.handle, firstName: a.firstName, idempotencyKey: `assign:${a.orgId}:${a.handle}` });
      log(`iMessage: assigned ${mask(found.assignedPhoneNumber)} to ${mask(a.handle)} (${all.length + 1}/${assignCap})`);
    }
    await db.collection("channel_lines").updateOne({ channel: "imessage", address: found.assignedPhoneNumber },
      { $set: { orgId: a.orgId, provider: "photon", photonLineId: found.assignmentId ?? null, status: "active", capabilities: ["typing", "reactions", "threads"] }, $addToSet: { handles: a.handle }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
    return found.assignedPhoneNumber as string;
  };
  engine = { db, llm, tools: ALL_TOOLS, messenger: new Messenger(db, { adapters, ready }), log,
    env: { brandFallback: org.name, assignIMessage, publicFormsBaseUrl: process.env.PUBLIC_FORMS_BASE_URL ?? "http://localhost:3000", verifySecret, formsMasterKey: process.env.FORM_ENC_KEY?.trim() } };
  scheduler = new Scheduler({ db, engine, workers: { imessage: wIm, whatsapp: wWa, sms: wSms }, log, afterTurn: async (a) => { await summarizeIfNeeded(db, llm, a); } });
  scheduler.start();
  const vs = process.env.VOICE_PATH_SECRET?.trim(), ws = process.env.ELEVENLABS_WEBHOOK_SECRET?.trim();
  if (vs && ws) { voice = await startVoiceServer({ db, engine, port: Number(process.env.VOICE_PORT ?? 8787), pathSecret: vs, webhookSecret: ws, bearer: process.env.VOICE_BEARER?.trim() || undefined, log });
    log(`voice server on :${voice.port}  Custom LLM URL path: /voice/***/v1/chat/completions   webhook path: /voice/***/webhooks/elevenlabs`); }
  else log("voice server: off (set VOICE_PATH_SECRET and ELEVENLABS_WEBHOOK_SECRET to start it)");
}
const handler = photonEventHandler(workers, async (line) => (await db.collection("channel_lines").findOne({ address: line }))?.orgId ?? null, log,
  async (evt, reason) => { await db.collection("unrouted_events").insertOne({ evt, reason, at: new Date() }); });
const MAX_AGE_MS = 10 * 60_000;   // replay guard: never answer a text older than this (restarts replay the stream)
const events = new PhotonEvents(photon, mongoCursorStore(db, `live:${process.env.PHOTON_PROJECT_ID}`), async (e) => {
  const m = e.data?.object;
  if (e.type === "message.received" && Date.now() - new Date(e.timestamp).getTime() > MAX_AGE_MS) { log(`SKIP stale ${e.type} (${Math.round((Date.now() - new Date(e.timestamp).getTime()) / 60000)} min old): not answering`); return; }
  log(`EVENT ${e.type} platform=${m?.platform} from=${mask(String(m?.sentBy?.handle ?? "-"))} to=${mask(String(m?.receivedBy?.handle ?? "-"))}${m?.content?.text ? ` text="${m.content.text}"` : ""}`);
  if (e.type.startsWith("call.")) { await handleCallEvent(db, e, log); return; }   // voice: log every call (who, when, how long, outcome)
  await handler(e);
}, log);
events.start();
setInterval(() => registerLines().catch((e) => log(`line refresh failed: ${e.message}`)), 30_000);   // pick up replaced iMessage assignments
// Optional HTTP webhook receiver (same pipeline, signature-verified). Needs a public HTTPS URL registered as a Photon webhook destination.
const whSecret = process.env.PHOTON_WEBHOOK_SIGNING_SECRET?.trim();
if (whSecret && process.env.PHOTON_WEBHOOK_PORT) {
  const port = Number(process.env.PHOTON_WEBHOOK_PORT);
  webhookServer({ secrets: [whSecret, ...(process.env.PHOTON_WEBHOOK_PREVIOUS_SECRET ? [process.env.PHOTON_WEBHOOK_PREVIOUS_SECRET.trim()] : [])], handler: handler as any, log }).listen(port, "127.0.0.1", () => log(`webhook receiver listening on :${port} (signature required)`));
}
log(`LISTENING. Text the iMessage number above from your Apple ID now; replies come from the agent engine.`);

const stop = async () => { log("stopping: closing events, scheduler and voice server, deleting sandbox"); events.stop(); await scheduler?.stop(); await voice?.close(); await orch.destroy(orgId); await mongo.close(); process.exit(0); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
setInterval(() => log(`heartbeat: events=${events.stats.events} errors=${events.stats.errors} subscribed=${events.stats.subscribed} lastSeq=${events.stats.lastSeq}`), 60_000);

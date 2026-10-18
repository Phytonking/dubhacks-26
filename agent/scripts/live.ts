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
const org: any = await db.collection("orgs").findOne({});
if (!org) throw new Error("no org in Atlas; run pnpm db:seed in web/");
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
async function registerLines() {
  if (smsLine) {
    await db.collection("channel_lines").updateOne({ channel: "sms", address: smsLine.detail.phoneNumber },
      { $set: { orgId, provider: "photon", photonLineId: smsLine.resourceId, status: "active", capabilities: smsLine.abilities }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true });   // errors must surface: a silent failure here means inbound texts have no business to go to
    log(`line: SMS ${mask(smsLine.detail.phoneNumber)} -> this business`);
  }
  // Shared iMessage: each assigned handle texts a pool number; route those numbers here too.
  const { assignments } = await photon.listSharedAssignments();
  for (const num of new Set(assignments.map((a) => a.assignedPhoneNumber))) {
    await db.collection("channel_lines").updateOne({ channel: "imessage", address: num },
      { $set: { orgId, provider: "photon", status: "active", capabilities: ["imessage"] }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true });
    log(`line: iMessage ${mask(num)} -> this business`);
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
const mk = (c: ChannelId) => new Worker(db, link, capped(new PhotonAdapter(photon, c)), ensure);
const workers = { imessage: mk("imessage"), sms: mk("sms") };
const handler = photonEventHandler(workers, async (line) => (await db.collection("channel_lines").findOne({ address: line }))?.orgId ?? null, log,
  async (evt, reason) => { await db.collection("unrouted_events").insertOne({ evt, reason, at: new Date() }); });
const events = new PhotonEvents(photon, mongoCursorStore(db, `live:${process.env.PHOTON_PROJECT_ID}`), async (e) => {
  const m = e.data?.object;
  log(`EVENT ${e.type} platform=${m?.platform} from=${mask(String(m?.sentBy?.handle ?? "-"))} to=${mask(String(m?.receivedBy?.handle ?? "-"))}${m?.content?.text ? ` text="${m.content.text}"` : ""}`);
  await handler(e);
}, log);
events.start();
// Optional HTTP webhook receiver (same pipeline, signature-verified). Needs a public HTTPS URL registered as a Photon webhook destination.
const whSecret = process.env.PHOTON_WEBHOOK_SIGNING_SECRET?.trim();
if (whSecret && process.env.PHOTON_WEBHOOK_PORT) {
  const port = Number(process.env.PHOTON_WEBHOOK_PORT);
  webhookServer({ secrets: [whSecret, ...(process.env.PHOTON_WEBHOOK_PREVIOUS_SECRET ? [process.env.PHOTON_WEBHOOK_PREVIOUS_SECRET.trim()] : [])], handler: handler as any, log }).listen(port, "127.0.0.1", () => log(`webhook receiver listening on :${port} (signature required)`));
}
log(`LISTENING. Text ${smsLine ? mask(smsLine.detail.phoneNumber) : "the project's number"} now; replies come from the agent running in the Daytona sandbox.`);

const stop = async () => { log("stopping: closing events and deleting sandbox"); events.stop(); await orch.destroy(orgId); await mongo.close(); process.exit(0); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
setInterval(() => log(`heartbeat: events=${events.stats.events} errors=${events.stats.errors} subscribed=${events.stats.subscribed} lastSeq=${events.stats.lastSeq}`), 60_000);

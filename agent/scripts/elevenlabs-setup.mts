// One-time (re-runnable) ElevenLabs setup: workspace secret + post-call webhook + custom-LLM agent + SIP-trunk number import.
//   ELEVENLABS_API_KEY in ../web/.env.local, and the public URL of the voice server (ngrok/cloudflared -> :VOICE_PORT):
//   pnpm exec tsx --env-file=../web/.env.local scripts/elevenlabs-setup.mts https://<public-host>
// Writes VOICE_PATH_SECRET, ELEVENLABS_WEBHOOK_SECRET, ELEVENLABS_AGENT_ID, ELEVENLABS_PHONE_ID to ../web/.env.local (gitignored). Never prints secrets.
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { MongoClient } from "mongodb";

const KEY = process.env.ELEVENLABS_API_KEY?.trim(); if (!KEY) throw new Error("ELEVENLABS_API_KEY is not set in web/.env.local");
const base = process.argv[2]?.replace(/\/$/, ""); if (!base?.startsWith("https://")) throw new Error("pass the public https URL of the voice server");
const API = "https://api.elevenlabs.io";
const ENV = new URL("../../web/.env.local", import.meta.url).pathname;
const env = readFileSync(ENV, "utf8");
const get = (k: string) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim();
const put = (k: string, v: string) => { let s = readFileSync(ENV, "utf8"); s = new RegExp(`^${k}=`, "m").test(s) ? s.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`) : s.replace(/\n?$/, `\n${k}=${v}\n`); writeFileSync(ENV, s); };
const el = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { "xi-api-key": KEY, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j: any; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${typeof j === "string" ? j.slice(0, 300) : JSON.stringify(j).slice(0, 400)}`);
  return j;
};

const pathSecret = get("VOICE_PATH_SECRET") ?? randomBytes(18).toString("hex"); put("VOICE_PATH_SECRET", pathSecret);
const bearer = get("VOICE_BEARER") ?? randomBytes(24).toString("hex"); put("VOICE_BEARER", bearer);
const root = `${base}/voice/${pathSecret}`;

// the number people call: Photon's voice line for this business
const mongo = await new MongoClient(process.env.MONGODB_URI!.trim()).connect();
const db = mongo.db(process.env.MONGODB_DB ?? "salesagent");
const org: any = await db.collection("orgs").findOne(process.env.LIVE_ORG ? { name: process.env.LIVE_ORG } : {});
const line: any = await db.collection("channel_lines").findOne({ orgId: org._id, channel: "voice", status: "active" });
const agentDoc: any = await db.collection("agents").findOne({ orgId: org._id });
await mongo.close();
if (!line) throw new Error("no active voice line in Atlas; start the live runner once so it registers lines");

const secret = await el("POST", "/v1/convai/secrets", { type: "new", name: `voice-bearer-${Date.now()}`, value: bearer });
console.log("secret stored");
const hook = await el("POST", "/v1/workspace/webhooks", { settings: { auth_type: "hmac", name: "salesagent post-call", webhook_url: `${root}/webhooks/elevenlabs` } });
if (hook.webhook_secret) put("ELEVENLABS_WEBHOOK_SECRET", hook.webhook_secret);
else console.log("WARNING: no webhook secret returned; copy it from the ElevenLabs dashboard into ELEVENLABS_WEBHOOK_SECRET");
console.log("webhook created");

const name = agentDoc?.assistantName ?? `${org.name} assistant`;
const agent = await el("POST", "/v1/convai/agents/create", {
  name: `${org.name} phone agent`,
  conversation_config: { agent: { language: "en", first_message: `Thanks for calling ${org.name}. I'm ${name}, an AI assistant. How can I help?`,
    prompt: { prompt: "[call caller={{system__caller_id}} called={{system__called_number}} conv={{system__conversation_id}}]\nThe real instructions are supplied by the server; this line only identifies the call.",
      llm: "custom-llm", custom_llm: { url: `${root}/v1/chat/completions`, model_id: "salesagent", api_key: { secret_id: secret.secret_id }, api_type: "chat_completions" } } } },
  platform_settings: { workspace_overrides: { webhooks: { post_call_webhook_id: hook.webhook_id, events: ["transcript"] } } },
});
put("ELEVENLABS_AGENT_ID", agent.agent_id); console.log("agent created", agent.agent_id);

const existing = ((await el("GET", "/v1/convai/phone-numbers")) as any[]).find((n) => n.phone_number === line.address);   // imported earlier (dashboard or a previous run): attach the agent
let phone: { phone_number_id: string };
if (existing) { await el("PATCH", `/v1/convai/phone-numbers/${existing.phone_number_id}`, { agent_id: agent.agent_id }); phone = existing; console.log("number already imported; agent attached"); }
else phone = await el("POST", "/v1/convai/phone-numbers", { provider: "sip_trunk", label: `${org.name} line`, phone_number: line.address, agent_id: agent.agent_id, inbound_trunk_config: { media_encryption: "allowed" } });
put("ELEVENLABS_PHONE_ID", phone.phone_number_id); console.log("number imported", phone.phone_number_id);
console.log(`done. Voice server must be reachable at ${root}/ . Restart the live runner so it picks up the secrets.`);

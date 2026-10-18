// Point the existing ElevenLabs phone agent at a new public voice URL (e.g. the Daytona preview URL), without recreating the agent or the phone number.
//   pnpm exec tsx --env-file=../web/.env.local scripts/elevenlabs-repoint.mts https://<public-host>
// Creates a new post-call webhook for the new URL (ElevenLabs cannot change a webhook's URL), attaches it to the agent, and writes the new
// ELEVENLABS_WEBHOOK_SECRET to ../web/.env.local. Never prints secrets.
import { readFileSync, writeFileSync } from "node:fs";
const KEY = process.env.ELEVENLABS_API_KEY!.trim(), AGENT = process.env.ELEVENLABS_AGENT_ID!.trim(), PATH_SECRET = process.env.VOICE_PATH_SECRET!.trim();
const base = process.argv[2]?.replace(/\/$/, ""); if (!base?.startsWith("https://")) throw new Error("pass the public https URL of the voice server");
const ENV = new URL("../../web/.env.local", import.meta.url).pathname;
const el = async (method: string, path: string, body?: unknown) => {
  const r = await fetch("https://api.elevenlabs.io" + path, { method, headers: { "xi-api-key": KEY, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j: any; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
};
const root = `${base}/voice/${PATH_SECRET}`;
const cur = await el("GET", `/v1/convai/agents/${AGENT}`);
const custom = cur.conversation_config.agent.prompt.custom_llm;
for (const w of ((await el("GET", "/v1/workspace/webhooks")).webhooks ?? [])) if (w.name === "salesagent post-call (daytona)") await el("DELETE", `/v1/workspace/webhooks/${w.webhook_id}`);   // leftovers of an earlier run
const hook = await el("POST", "/v1/workspace/webhooks", { settings: { auth_type: "hmac", name: "salesagent post-call (daytona)", webhook_url: `${root}/webhooks/elevenlabs` } });
await el("PATCH", `/v1/convai/agents/${AGENT}`, {
  conversation_config: { agent: { prompt: { llm: cur.conversation_config.agent.prompt.llm, custom_llm: { ...custom, url: `${root}/v1/chat/completions` } } } },
  platform_settings: { workspace_overrides: { webhooks: { post_call_webhook_id: hook.webhook_id, events: ["transcript"] } } },
});
if (!hook.webhook_secret) throw new Error("no webhook secret returned; copy it from the ElevenLabs dashboard");
let s = readFileSync(ENV, "utf8"); s = s.replace(/^ELEVENLABS_WEBHOOK_SECRET=.*$/m, `ELEVENLABS_WEBHOOK_SECRET=${hook.webhook_secret}`); writeFileSync(ENV, s);
console.log("agent repointed; new webhook", hook.webhook_id, "(secret written to web/.env.local)");

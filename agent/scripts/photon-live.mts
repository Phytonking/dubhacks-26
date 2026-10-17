// Live, read-only check of the Photon beta integration. Sends nothing, creates nothing.
// Verifies: project + iMessage platform state, voice profiles, Socket.IO handshake + subscribe, event stream health.
import { mkdirSync, writeFileSync } from "node:fs";
import { Photon, PhotonEvents } from "../src/photon";
const photon = new Photon(process.env.PHOTON_API_KEY!.trim(), process.env.PHOTON_PROJECT_ID!.trim());
const results: Array<[string, boolean, string]> = [];
const step = async (n: string, f: () => Promise<string>) => { try { const d = await f(); results.push([n, true, d]); console.log("PASS", n, d); } catch (e) { results.push([n, false, String((e as Error).message).slice(0, 300)]); console.log("FAIL", n, (e as Error).message.slice(0, 300)); } };
await step("Project readable with API key", async () => { const p = await photon.getProject(); return `${p.name} (${p.slug}), created ${p.createdAt}`; });
await step("iMessage platform state", async () => JSON.stringify(await photon.getImessagePlatform()));
await step("Messages list (empty expected before first text)", async () => { const m = await photon.listMessages({ pageSize: 5 }); return `${m.items.length} message(s)`; });
await step("Voice profiles list", async () => JSON.stringify((await photon.req("GET", "/platforms/voice/profiles")).profiles.length) + " profile(s)");
await step("Platform resources (lines owned by project)", async () => { const r = await photon.listResources(); return JSON.stringify(r).slice(0, 220); });
await step("Socket.IO connect + subscribe (startSeq 0), 12 s listen", async () => {
  let cursor = 0; const logs: string[] = [];
  const ev = new PhotonEvents(photon, { get: async () => cursor, set: async (s) => { cursor = s; } }, async (e) => { logs.push(`event ${e.type}`); }, (m) => logs.push(m));
  ev.start();
  await new Promise((r) => setTimeout(r, 12000));
  const connected = ev.socket.connected; const subscribed = ev.stats.subscribed; ev.stop();
  if (!connected || !subscribed) throw new Error(`connected=${connected} subscribed=${subscribed}: ` + logs.join(" | "));
  const errs = logs.filter((l) => l.startsWith("delivery_error") || l.startsWith("connect_error"));
  if (errs.length) throw new Error(errs.join(" | "));
  return `connected=${connected}, subscribed=${subscribed}, connects=${ev.stats.connects}, events=${ev.stats.events}, log: ${logs.join(" | ") || "(quiet)"}`;
});
mkdirSync("test-results", { recursive: true });
writeFileSync("test-results/photon-live.json", JSON.stringify({ at: new Date().toISOString(), results: results.map(([name, ok, detail]) => ({ name, ok, detail: detail.split(process.env.PHOTON_PROJECT_ID!.trim()).join("{projectId}").replace(/pho_res_[a-z0-9]+/g, "pho_res_…").replace(/\+\d{10,}/g, "+1XXXXXXXXXX") })) }, null, 1));
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} passed`);
process.exit(results.every((r) => r[1]) ? 0 : 1);

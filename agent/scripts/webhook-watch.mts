// Watches a webhook.site inspector through a throwaway Daytona sandbox (this machine cannot reach webhook.site)
// and checks every delivery's signature locally with PHOTON_WEBHOOK_SIGNING_SECRET. Usage: pnpm tsx --env-file=../web/.env.local scripts/webhook-watch.mts <token-or-url> [minutes]
import { createHmac, timingSafeEqual } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { Daytona } from "@daytona/sdk";
import { verifyWebhook } from "../src/webhook";
mkdirSync("test-results", { recursive: true });
const log = (m: string) => { const l = `[${new Date().toISOString()}] ${m}`; console.log(l); appendFileSync("test-results/webhook-watch.log", l + "\n"); };
const mask = (s: string) => s.replace(/\+(\d)(\d{3})(\d{3})(\d{4})/g, "+$1$2***$4");
const token = (process.argv[2] ?? "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
if (!token) throw new Error("pass the webhook.site URL or token");
const minutes = Number(process.argv[3] ?? 8);
const secret = process.env.PHOTON_WEBHOOK_SIGNING_SECRET!.trim();
const d = new Daytona({ apiKey: process.env.DAYTONA_API_KEY!.trim() });
const sb: any = await d.create({ name: "webhook-watch-" + Date.now(), language: "typescript", labels: { app: "sales-agent-probe" }, ephemeral: true } as any, { timeout: 120 });
log(`watching webhook.site/${token.slice(0, 8)}… for ${minutes} min (proxy sandbox up)`);
const seen = new Set<string>();
const fetchAll = async () => {
  const r = await sb.process.executeCommand(`curl -sS -m 20 "https://webhook.site/token/${token}/requests?sorting=newest&per_page=20"`);
  try { return JSON.parse(String(r.result)); } catch { throw new Error("proxy fetch failed: " + String(r.result).slice(0, 200)); }
};
const first = await fetchAll();
if (process.argv[4] !== "backlog") for (const q of first.data ?? []) seen.add(q.uuid);
log(`inspector reachable via sandbox; ${first.total ?? first.data?.length ?? 0} earlier request(s) already there (ignoring ${seen.size}); waiting for NEW ones`);
const variants = (id: string, ts: string, body: string) => {
  const raw = Buffer.from(secret), dec = Buffer.from(secret.replace(/^whsec_/, ""), "base64"), out: Record<string, string> = {};
  for (const [kn, k] of [["rawkey", raw], ["b64key", dec]] as const) for (const [cn, c] of [["id.ts.body", `${id}.${ts}.${body}`], ["ts.body", `${ts}.${body}`], ["v0:ts:body", `v0:${ts}:${body}`], ["body", body]] as const)
    for (const enc of ["base64", "hex"] as const) out[`${kn} | ${cn} | ${enc}`] = createHmac("sha256", k).update(c).digest(enc);
  return out;
};
const end = Date.now() + minutes * 60_000; let n = 0;
while (Date.now() < end) {
  const j = await fetchAll();
  for (const q of (j.data ?? []).slice().reverse()) {
    if (seen.has(q.uuid)) continue; seen.add(q.uuid); n++;
    const h: Record<string, string> = {}; for (const [k, v] of Object.entries(q.headers ?? {})) h[k.toLowerCase()] = Array.isArray(v) ? v[0] as string : String(v);
    const body: string = q.content ?? "";
    log(`\n=== DELIVERY #${n} ${q.method} at ${q.created_at} from ${q.ip} ===`);
    log("headers: " + Object.entries(h).filter(([k]) => !/^(host|x-forwarded|x-real|accept-encoding|connection|content-length|x-amzn|via|cf-)/.test(k)).map(([k, v]) => `${k}=${/signature/.test(k) ? v.slice(0, 16) + "…(len " + v.length + ")" : mask(v).slice(0, 80)}`).join("\n         "));
    let ev: any = null; try { ev = JSON.parse(body); } catch { log("body not JSON: " + body.slice(0, 200)); }
    if (ev) { const o = ev.data?.object ?? ev.message ?? {}; log(`event: type=${ev.type ?? ev.event} id=${ev.id} apiVersion=${ev.apiVersion} platform=${o.platform} from=${mask(String(o.sentBy?.handle ?? "-"))} text=${JSON.stringify(o.content?.text ?? null)}`); }
    const v = verifyWebhook(h, body, [secret]);
    log(`SIGNATURE CHECK by webhook.ts: ${v.ok ? "VALID (" + v.scheme + ")" : "INVALID (" + v.reason + ")"}`);
    if (!v.ok) {
      const given = Object.entries(h).filter(([k]) => /signature/.test(k)).map(([, x]) => x).join(" ").split(/[ ,]/).map((s) => s.replace(/^v\d=|^v\d,/, ""));
      const id = h["webhook-id"] ?? h["x-spectrum-webhook-id"] ?? "", ts = h["webhook-timestamp"] ?? h["x-spectrum-timestamp"] ?? "";
      const hit = Object.entries(variants(id, ts, body)).find(([, sig]) => given.includes(sig));
      log(hit ? `DIAGNOSTIC: signature matches variant [${hit[0]}]` : `DIAGNOSTIC: none of 16 HMAC variants match; headers present: ${Object.keys(h).filter((k) => /sign|webhook|timestamp|id/.test(k)).join(", ")}`);
    }
  }
  if (n >= 1 && Date.now() > end - (minutes * 60_000 - 90_000)) { /* got at least one; keep polling a bit for the follow-ups */ }
  await new Promise((r) => setTimeout(r, 4000));
}
log(`done: ${n} new delivery(ies) in ${minutes} min`);
await d.delete(sb, 60); log("proxy sandbox deleted"); process.exit(0);

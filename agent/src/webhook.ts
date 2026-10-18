import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { PhotonEvent } from "./photon";

// Photon webhook receiver. Verifies the signature BEFORE parsing, then feeds the same pipeline as the live socket.
// CONFIRMED 2026-10-17 against 3 real deliveries (project dubhacks-26, apiVersion 2026-07-01): Photon beta signs with the
// "standard" scheme below (webhook-id = the event id `pho_evt_…`, secret = whsec_ + base64 key). Photon's beta docs do not
// publish this, so the older Spectrum scheme is also accepted. Schemes:
//   standard : headers webhook-id / webhook-timestamp / webhook-signature ("v1,<base64 hmac>"), signed `${id}.${ts}.${body}`
//   spectrum : headers x-spectrum-timestamp / x-spectrum-signature ("v0=<hex>"),               signed `v0:${ts}:${body}`
// The shipped secret is accepted as raw string or (for standard) base64-decoded after the `whsec_` prefix.
export const TOLERANCE_SEC = 300;
export type Verify = { ok: true; scheme: "standard" | "spectrum" } | { ok: false; reason: string };

const eq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export function verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string, secrets: string[], nowSec = Math.floor(Date.now() / 1000)): Verify {
  const h = (k: string) => { const v = headers[k]; return Array.isArray(v) ? v[0] : v; };
  const keys = (s: string, decoded: boolean) => decoded ? (/^whsec_/.test(s) ? [Buffer.from(s.replace(/^whsec_/, ""), "base64")] : []) : [Buffer.from(s)];
  const id = h("webhook-id"), ts = h("webhook-timestamp"), sig = h("webhook-signature");
  const xts = h("x-spectrum-timestamp"), xsig = h("x-spectrum-signature");
  const stamp = ts ?? xts;
  if (!stamp || !(sig || xsig)) return { ok: false, reason: "missing signature headers" };
  if (!/^\d+$/.test(stamp)) return { ok: false, reason: "bad timestamp" };
  if (Math.abs(nowSec - Number(stamp)) > TOLERANCE_SEC) return { ok: false, reason: "timestamp outside 5 minute tolerance" };
  if (id && ts && sig) {
    const given = sig.split(" ").map((s) => s.replace(/^v1,/, ""));
    for (const secret of secrets) for (const decoded of [true, false]) for (const key of keys(secret, decoded)) {
      const exp = createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest("base64");
      if (given.some((g) => eq(g, exp))) return { ok: true, scheme: "standard" };
    }
  }
  if (xts && xsig) {
    for (const secret of secrets) {
      const exp = "v0=" + createHmac("sha256", secret).update(`v0:${xts}:${rawBody}`).digest("hex");
      if (eq(xsig, exp)) return { ok: true, scheme: "spectrum" };
    }
  }
  return { ok: false, reason: "signature mismatch" };
}

const readRaw = (req: IncomingMessage, max = 1_000_000) => new Promise<string>((resolve, reject) => {
  const chunks: Buffer[] = []; let n = 0;
  req.on("data", (c: Buffer) => { n += c.length; if (n > max) { reject(new Error("body too large")); req.destroy(); } else chunks.push(c); });
  req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8"))); req.on("error", reject);
});

export type WebhookOpts = {
  secrets: string[];                       // current + previous (rotation overlap)
  handler: (evt: PhotonEvent, onPersisted: () => void) => Promise<unknown>;
  log?: (m: string) => void;
  path?: string;
};

/** Raw-body HTTP receiver. 401 on bad signature (nothing parsed); 2xx once the message is durable; 500 so Photon retries if we could not persist. */
export function webhookServer(o: WebhookOpts): Server {
  const log = o.log ?? (() => {});
  const seen = new Map<string, number>();   // webhook-id -> time; cheap replay guard on top of the (channel, channelMsgId) unique index
  return createServer(async (req, res) => {
    const send = (code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    try {
      if (req.method === "GET" && req.url === "/health") return send(200, { ok: true });
      if (req.method !== "POST" || (o.path && !(req.url ?? "").startsWith(o.path))) return send(404, { error: "not found" });
      const raw = await readRaw(req);
      const v = verifyWebhook(req.headers, raw, o.secrets);
      if (!v.ok) { log(`webhook REJECTED (${v.reason})`); return send(401, { error: "invalid signature" }); }
      const evt = JSON.parse(raw) as PhotonEvent;
      const key = String(req.headers["webhook-id"] ?? evt.id);
      for (const [k, t] of seen) if (Date.now() - t > 600_000) seen.delete(k);
      if (seen.has(key)) return send(200, { ok: true, duplicate: true });
      log(`webhook ok (${v.scheme}) ${evt.type}`);
      let persisted!: () => void;
      const durable = new Promise<void>((r) => (persisted = r));
      const work = o.handler(evt, persisted);
      // answer as soon as the inbound message is stored; the agent turn keeps running
      await Promise.race([durable, work.then(() => undefined)]);
      seen.set(key, Date.now());
      work.catch((e) => log(`webhook handler error after ack: ${(e as Error).message}`));
      return send(200, { ok: true });
    } catch (e) {
      log(`webhook error: ${(e as Error).message}`);
      return send(500, { error: "could not persist; retry" });   // Photon retries non-2xx
    }
  });
}

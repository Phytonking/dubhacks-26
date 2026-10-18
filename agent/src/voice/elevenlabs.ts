import { createHmac, timingSafeEqual } from "node:crypto";

// ElevenLabs webhook signature, taken from the official SDK (@elevenlabs/elevenlabs-js 2.73.0, wrapper/webhooks.js):
//   header  ElevenLabs-Signature: t=<unix seconds>,v0=<hex>
//   signed  HMAC-SHA256(secret, `${t}.${rawBody}`), hex, prefixed "v0="; tolerance 30 minutes.
export const TOLERANCE_MS = 30 * 60_000;
export type SigResult = { ok: true } | { ok: false; reason: string };

export function verifyElevenLabsSignature(rawBody: string, header: string | undefined, secret: string, nowMs = Date.now()): SigResult {
  if (!secret) return { ok: false, reason: "webhook secret not configured" };
  if (!header) return { ok: false, reason: "missing signature header" };
  const parts = header.split(",");
  const t = parts.find((p) => p.startsWith("t="))?.slice(2);
  const sig = parts.find((p) => p.startsWith("v0="));
  if (!t || !sig) return { ok: false, reason: "no v0 signature" };
  if (!/^\d+$/.test(t)) return { ok: false, reason: "bad timestamp" };
  if (nowMs - Number(t) * 1000 > TOLERANCE_MS) return { ok: false, reason: "timestamp outside tolerance" };
  const expected = "v0=" + createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: "signature mismatch" };
}
/** Build a valid header (tests, and for replaying a captured webhook locally). */
export const signElevenLabs = (rawBody: string, secret: string, nowMs = Date.now()) => {
  const t = Math.floor(nowMs / 1000);
  return `t=${t},v0=${createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex")}`;
};

/** The agent's system prompt carries one machine-readable line, e.g. [call caller={{system__caller_id}} called={{system__called_number}} conv={{system__conversation_id}}]. */
export function extractCallInfo(messages: Array<{ role: string; content: unknown }>): { caller?: string; called?: string; conv?: string; cleaned: typeof messages } {
  const re = /\[call\s+([^\]]*)\]/;
  let info: Record<string, string> = {};
  const cleaned = messages.map((m) => {
    if (m.role !== "system" || typeof m.content !== "string") return m;
    const hit = m.content.match(re);
    if (!hit) return m;
    for (const kv of hit[1].split(/\s+/)) { const i = kv.indexOf("="); if (i > 0) info[kv.slice(0, i)] = kv.slice(i + 1); }
    return { ...m, content: m.content.replace(re, "").trim() };
  });
  const clean = (v?: string) => (v && !/^\{\{.*\}\}$/.test(v) && v !== "unknown" && v !== "null" ? v : undefined);   // unfilled template variables are not data
  return { caller: clean(info.caller), called: clean(info.called), conv: clean(info.conv), cleaned };
}

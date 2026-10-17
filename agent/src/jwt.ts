import { createHmac, timingSafeEqual } from "node:crypto";

// Minimal HS256 JWT. Enough for scoped, short-lived agent/LLM tokens (PRD §5.9).
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export type Claims = { kind: "agent" | "llm"; orgId: string; agentId: string; sandboxId?: string; exp: number } & Record<string, unknown>;

export function sign(claims: Omit<Claims, "exp">, key: string, ttlSec: number): string {
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const sig = createHmac("sha256", key).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

export function verify(token: string | undefined, key: string, kind: Claims["kind"]): Claims | null {
  if (!token) return null;
  const [h, b, s] = token.split(".");
  if (!h || !b || !s) return null;
  const want = createHmac("sha256", key).update(`${h}.${b}`).digest();
  const got = Buffer.from(s, "base64url");
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const c = JSON.parse(Buffer.from(b, "base64url").toString()) as Claims;
  if (c.kind !== kind || c.exp < Date.now() / 1000) return null;
  return c;
}

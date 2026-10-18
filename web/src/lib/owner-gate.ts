import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

// The console has no user accounts yet (decision pending). Anything that can reveal customer secrets is therefore behind a shared password
// set in FORMS_ADMIN_PASSWORD, with a signed, expiring, httpOnly cookie. If the variable is not set, reveal is OFF: safe by default.
const COOKIE = "owner_session", TTL_MS = 8 * 3600_000;
const secret = () => process.env.FORMS_SESSION_SECRET || process.env.FORMS_ADMIN_PASSWORD || "";
const sign = (exp: string) => createHmac("sha256", secret()).update(`owner:${exp}`).digest("base64url");
const eq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export const ownerAccessConfigured = () => Boolean(process.env.FORMS_ADMIN_PASSWORD);
export function checkPassword(given: string): boolean {
  const want = process.env.FORMS_ADMIN_PASSWORD; return Boolean(want) && eq(createHmac("sha256", "pw").update(given).digest("hex"), createHmac("sha256", "pw").update(want!).digest("hex"));
}
export async function startOwnerSession() {
  const exp = String(Date.now() + TTL_MS);
  (await cookies()).set(COOKIE, `${exp}.${sign(exp)}`, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: TTL_MS / 1000 });
}
export async function endOwnerSession() { (await cookies()).delete(COOKIE); }
export async function isOwner(): Promise<boolean> {
  if (!ownerAccessConfigured()) return false;
  const v = (await cookies()).get(COOKIE)?.value; if (!v) return false;
  const [exp, mac] = v.split("."); if (!exp || !mac || Number(exp) < Date.now()) return false;
  return eq(mac, sign(exp));
}

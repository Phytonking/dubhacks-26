import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { ObjectId, type Db } from "mongodb";

// One-time codes proving a person controls a phone number. The code is never stored (only a keyed hash), never logged,
// and never shown to the model: the model only learns "sent" / "verified" / "wrong".
export const LIMITS = { ttlMs: 5 * 60_000, maxAttempts: 5, cooldownMs: 30_000, perHour: 3, perDay: 10, purgeDays: 7 };

const sig = (secret: string, id: ObjectId, contactId: ObjectId, purpose: string, code: string) =>
  createHmac("sha256", secret).update(`${id}:${contactId}:${purpose}:${code}`).digest("hex");

export type IssueResult =
  | { ok: true; id: ObjectId; code: string; expiresAt: Date }
  | { ok: false; error: "cooldown" | "hourly_limit" | "daily_limit"; retryAfterSec: number };

export async function issueCode(db: Db, a: { orgId: ObjectId; contactId: ObjectId; number: string; purpose?: string; secret: string; now?: Date }): Promise<IssueResult> {
  if (!a.secret) throw new Error("verification secret is not configured");
  const now = a.now ?? new Date();
  const purpose = a.purpose ?? "identity";
  const col = db.collection("verifications");
  const recent = await col.find({ orgId: a.orgId, number: a.number, createdAt: { $gte: new Date(now.getTime() - 24 * 3600_000) } }).sort({ createdAt: -1 }).toArray();
  const last = recent[0];
  if (last && now.getTime() - last.createdAt.getTime() < LIMITS.cooldownMs) return { ok: false, error: "cooldown", retryAfterSec: Math.ceil((LIMITS.cooldownMs - (now.getTime() - last.createdAt.getTime())) / 1000) };
  const hour = recent.filter((r) => r.createdAt.getTime() >= now.getTime() - 3600_000);
  if (hour.length >= LIMITS.perHour) return { ok: false, error: "hourly_limit", retryAfterSec: Math.ceil((hour[hour.length - 1].createdAt.getTime() + 3600_000 - now.getTime()) / 1000) };
  if (recent.length >= LIMITS.perDay) return { ok: false, error: "daily_limit", retryAfterSec: Math.ceil((recent[recent.length - 1].createdAt.getTime() + 24 * 3600_000 - now.getTime()) / 1000) };

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const id = new ObjectId();
  await col.updateMany({ contactId: a.contactId, status: "pending" }, { $set: { status: "superseded" } });
  const expiresAt = new Date(now.getTime() + LIMITS.ttlMs);
  await col.insertOne({
    _id: id, orgId: a.orgId, contactId: a.contactId, number: a.number, purpose, codeHmac: sig(a.secret, id, a.contactId, purpose, code),
    status: "pending", attempts: 0, maxAttempts: LIMITS.maxAttempts, expiresAt, sentVia: null, verifiedAt: null, createdAt: now,
    purgeAt: new Date(now.getTime() + LIMITS.purgeDays * 86400_000),
  } as never);
  return { ok: true, id, code, expiresAt };
}

export async function markSent(db: Db, id: ObjectId, via: string) { await db.collection("verifications").updateOne({ _id: id }, { $set: { sentVia: via } }); }
/** The send failed: the code was never delivered, so it must not count toward the person's hourly limit or stay valid. */
export async function voidCode(db: Db, id: ObjectId) { await db.collection("verifications").deleteOne({ _id: id }); }

const WORDS: Record<string, string> = { zero: "0", oh: "0", o: "0", one: "1", two: "2", to: "2", too: "2", three: "3", four: "4", for: "4", five: "5", six: "6", seven: "7", eight: "8", ate: "8", nine: "9" };
/** Voice transcription turns "four eight two 9 one oh" into digits. Returns null unless exactly six digits result. */
export function normalizeSpokenCode(input: string): string | null {
  const parts = String(input).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const digits = parts.map((p) => (/^\d+$/.test(p) ? p : WORDS[p] ?? "")).join("");
  return /^\d{6}$/.test(digits) ? digits : null;
}

export type CheckResult =
  | { status: "verified" }
  | { status: "wrong"; triesLeft: number }
  | { status: "expired" | "locked" | "none_pending" | "bad_format" };

export async function checkCode(db: Db, a: { orgId: ObjectId; contactId: ObjectId; number: string; code: string; secret: string; method?: string; now?: Date }): Promise<CheckResult> {
  const now = a.now ?? new Date();
  const code = normalizeSpokenCode(a.code);
  if (!code) return { status: "bad_format" };                                 // asking to repeat does not consume an attempt
  const col = db.collection("verifications");
  const row = await col.findOne({ orgId: a.orgId, contactId: a.contactId, number: a.number, status: "pending" }, { sort: { createdAt: -1 } });
  if (!row) return { status: "none_pending" };
  if (row.expiresAt.getTime() <= now.getTime()) { await col.updateOne({ _id: row._id }, { $set: { status: "expired" } }); return { status: "expired" }; }
  const bumped = await col.findOneAndUpdate({ _id: row._id, status: "pending", attempts: { $lt: row.maxAttempts } }, { $inc: { attempts: 1 } }, { returnDocument: "after" });
  if (!bumped) { await col.updateOne({ _id: row._id }, { $set: { status: "locked" } }); return { status: "locked" }; }
  const expected = Buffer.from(bumped.codeHmac, "hex");
  const given = Buffer.from(sig(a.secret, row._id, a.contactId, row.purpose, code), "hex");
  if (expected.length === given.length && timingSafeEqual(expected, given)) {
    await col.updateOne({ _id: row._id }, { $set: { status: "verified", verifiedAt: now } });
    await db.collection("contacts").updateOne({ _id: a.contactId, orgId: a.orgId }, { $set: { verifiedPhone: { number: a.number, at: now, method: a.method ?? "otp" } } });
    return { status: "verified" };
  }
  if (bumped.attempts >= bumped.maxAttempts) { await col.updateOne({ _id: row._id }, { $set: { status: "locked" } }); return { status: "locked" }; }
  return { status: "wrong", triesLeft: bumped.maxAttempts - bumped.attempts };
}

import type { Db, ObjectId } from "mongodb";
import { hashToken, newToken } from "./forms-core";
import { MAX_ATTEMPTS, systemNotice, validateCard, type Brand } from "./checkout-core";

// "Change my payment method": a one-time link to a card page. Like checkout, the card exists only inside the request: the account keeps brand + last 4.
// Sandbox: nothing is verified with a bank. The same well-known test numbers as checkout pick the outcome.
export const METHOD_LINK_MINUTES = 30;

export async function createMethodRequest(db: Db, a: { orgId: ObjectId; contactId: ObjectId; conversationId: ObjectId; accountId: string; now?: Date }) {
  const now = a.now ?? new Date();
  const token = newToken();
  await db.collection("method_requests").updateMany({ orgId: a.orgId, contactId: a.contactId, status: "pending" }, { $set: { status: "revoked" } });   // one live link per customer
  const expiresAt = new Date(now.getTime() + METHOD_LINK_MINUTES * 60_000);
  const r = await db.collection("method_requests").insertOne({ orgId: a.orgId, contactId: a.contactId, conversationId: a.conversationId, accountId: a.accountId, tokenHash: hashToken(token), status: "pending", attempts: 0, expiresAt, createdAt: now, completedAt: null } as never);
  return { id: r.insertedId, token, expiresAt, minutes: METHOD_LINK_MINUTES };
}

export type MethodRender = { state: "valid"; brand: string; current: { brand: string; last4: string } | null; attemptsLeft: number } | { state: "invalid" | "expired" | "completed" | "locked" };
/** READ ONLY: link-preview bots open links. Only a saved card consumes it. */
export async function loadMethodForRender(db: Db, token: string, now = new Date()): Promise<MethodRender> {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return { state: "invalid" };
  const req: any = await db.collection("method_requests").findOne({ tokenHash: hashToken(token) });
  if (!req) return { state: "invalid" };
  if (req.status === "completed") return { state: "completed" };
  if (req.status === "locked") return { state: "locked" };
  if ((req.status !== "pending" && req.status !== "processing") || req.expiresAt.getTime() <= now.getTime()) return { state: "expired" };
  const org: any = await db.collection("orgs").findOne({ _id: req.orgId }, { projection: { name: 1 } });
  const acct: any = await db.collection("tmo_accounts").findOne({ orgId: req.orgId, accountId: req.accountId }, { projection: { "context.payment_method": 1 } });
  const cur = acct?.context?.payment_method;
  return { state: "valid", brand: org?.name ?? "", current: cur ? { brand: cur.brand, last4: cur.last4 } : null, attemptsLeft: Math.max(0, MAX_ATTEMPTS - (req.attempts ?? 0)) };
}

const FAIL: Record<string, string> = {
  declined: "That card was declined. Please try a different card.",
  insufficient_funds: "That card couldn't be verified. Please try a different card.",
  processing_error: "We couldn't verify that card right now. Please try again or use a different card.",
};
const mockCheck = (n: string): "declined" | "insufficient_funds" | "processing_error" | null =>
  n === "4000000000000002" ? "declined" : n === "4000000000009995" ? "insufficient_funds" : n === "4000000000000119" ? "processing_error" : null;

export type MethodResult =
  | { ok: true; brand: Brand; last4: string }
  | { ok: false; error: "invalid" | "expired" | "completed" | "busy" | "validation" | "declined" | "insufficient_funds" | "processing_error" | "locked"; message?: string; errors?: Record<string, string>; attemptsLeft?: number };

export async function submitMethod(db: Db, a: { token: string; raw: Record<string, unknown>; now?: Date }): Promise<MethodResult> {
  const now = a.now ?? new Date();
  const st = await loadMethodForRender(db, a.token, now);
  if (st.state === "completed") return { ok: false, error: "completed" };
  if (st.state === "locked") return { ok: false, error: "locked", message: "Too many declined attempts. Please ask for a new link." };
  if (st.state !== "valid") return { ok: false, error: st.state === "expired" ? "expired" : "invalid" };
  const v = validateCard(a.raw, now);
  if (!v.ok) return { ok: false, error: "validation", errors: v.errors };
  const claimed: any = await db.collection("method_requests").findOneAndUpdate(
    { tokenHash: hashToken(a.token), expiresAt: { $gt: now }, $or: [{ status: "pending" }, { status: "processing", processingAt: { $lt: new Date(now.getTime() - 120_000) } }] },
    { $set: { status: "processing", processingAt: now }, $inc: { attempts: 1 } }, { returnDocument: "after" });
  if (!claimed) { const again = await loadMethodForRender(db, a.token, now); return { ok: false, error: again.state === "completed" ? "completed" : "busy" }; }
  const fail = mockCheck(v.card.number);
  if (fail) {
    const attemptsLeft = Math.max(0, MAX_ATTEMPTS - claimed.attempts);
    await db.collection("method_requests").updateOne({ _id: claimed._id }, { $set: { status: attemptsLeft ? "pending" : "locked", lastFailure: fail, processingAt: null } });
    await systemNotice(db, claimed, `Payment method not updated (${FAIL[fail].replace(/\.$/, "")})${attemptsLeft ? "" : ". The link is locked after too many attempts"}`, `pm:${claimed._id}:${claimed.attempts}`, now);
    return { ok: false, error: fail, message: FAIL[fail], attemptsLeft };
  }
  // success: the account keeps brand + last 4 (never the number, expiry or CVC)
  const pm = { brand: v.card.brand, last4: v.card.last4, expMonth: v.card.expMonth, expYear: v.card.expYear, updatedAt: now, via: "secure_link" };
  await db.collection("tmo_accounts").updateOne({ orgId: claimed.orgId, accountId: claimed.accountId },
    { $set: { "context.payment_method": pm, appliedAt: now }, $push: { changeLog: { at: now, by: "customer", what: `payment method changed to ${v.card.brand} ending ${v.card.last4}` } } as never });
  await db.collection("method_requests").updateOne({ _id: claimed._id }, { $set: { status: "completed", completedAt: now, processingAt: null, brand: v.card.brand, last4: v.card.last4 } });
  await db.collection("notifications").insertOne({ orgId: claimed.orgId, contactId: claimed.contactId, conversationId: claimed.conversationId, kind: "account_change", message: `Payment method updated to ${v.card.brand} ending ${v.card.last4}`, urgency: "normal", read: false, createdAt: now } as never);
  await systemNotice(db, claimed, `Payment method updated: ${v.card.brand} ending ${v.card.last4} is now on the account`, `pm:${claimed._id}:${claimed.attempts}`, now);
  return { ok: true, brand: v.card.brand, last4: v.card.last4 };
}

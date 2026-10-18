import { ObjectId, type Document } from "mongodb";
import { getDb } from "./db";
import { getCurrentOrg } from "./queries";

// Owner actions from the console. The agent's outbound texting reads these collections;
// nothing here sends a message or touches a card by itself.

const oid = (s: string) => { if (!ObjectId.isValid(s)) throw new HttpError(400, "bad id"); return new ObjectId(s); };
export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

export async function resendApproval(id: string) {
  const { _id: orgId } = await getCurrentOrg();
  const r = await (await getDb()).collection<Document>("approvals").updateOne(
    { _id: oid(id), orgId, status: "texted" },
    { $set: { sentAt: new Date(), resend: true, updatedAt: new Date() }, $inc: { resendCount: 1 } },
  );
  if (!r.matchedCount) throw new HttpError(404, "no pending approval with that id");
  return { ok: true };
}

export async function cancelApproval(id: string) {
  const { _id: orgId } = await getCurrentOrg();
  const now = new Date();
  const r = await (await getDb()).collection<Document>("approvals").updateOne(
    { _id: oid(id), orgId, status: "texted" },
    { $set: { status: "cancelled", resolvedAt: now, resolvedBy: "human", checkout: "Visa hold released", updatedAt: now } },
  );
  if (!r.matchedCount) throw new HttpError(404, "no pending approval with that id");
  return { ok: true };
}

/** `id` is a handoffs _id or, for conversations with no handoff row yet, the conversation _id. */
export async function claimHandoff(id: string, agent: string) {
  const { _id: orgId } = await getCurrentOrg();
  const db = await getDb();
  const name = String(agent ?? "").trim().slice(0, 80);
  if (!name) throw new HttpError(400, "agent name required");
  const now = new Date();
  const handoffs = db.collection<Document>("handoffs");
  const existing = await handoffs.findOne({ _id: oid(id), orgId });
  if (existing) {
    await handoffs.updateOne({ _id: existing._id }, { $set: { claimedBy: name, claimedAt: now, updatedAt: now } });
    return { ok: true };
  }
  const conv = await db.collection<Document>("conversations").findOne({ _id: oid(id), orgId, mode: "human" });
  if (!conv) throw new HttpError(404, "no handoff with that id");
  await handoffs.updateOne({ orgId, conversationId: conv._id }, { $set: { claimedBy: name, claimedAt: now, updatedAt: now }, $setOnInsert: { createdAt: now } }, { upsert: true });
  return { ok: true };
}

export async function savePromo(body: Document) {
  const { _id: orgId } = await getCurrentOrg();
  const code = String(body.code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9_]{2,32}$/.test(code)) throw new HttpError(400, "code must be 2-32 letters, numbers or underscores");
  const maxPct = body.max_pct == null ? null : Number(body.max_pct);
  const maxCents = body.max_cents == null ? null : Math.round(Number(body.max_cents));
  if ((maxPct == null) === (maxCents == null)) throw new HttpError(400, "set exactly one of max_pct or max_cents");
  if (maxPct != null && !(maxPct > 0 && maxPct <= 100)) throw new HttpError(400, "max_pct must be between 0 and 100");
  if (maxCents != null && !(maxCents > 0)) throw new HttpError(400, "max_cents must be positive");
  const maxUses = body.max_uses == null || body.max_uses === "" ? null : Math.round(Number(body.max_uses));
  if (maxUses != null && !(maxUses > 0)) throw new HttpError(400, "max_uses must be positive");
  const now = new Date();
  const doc = { appliesTo: String(body.applies_to ?? "").slice(0, 80), maxPct, maxCents, maxUses, requires: String(body.requires ?? "").slice(0, 200), added: true, updatedAt: now };
  await (await getDb()).collection<Document>("promos").updateOne({ orgId, code }, { $set: doc, $setOnInsert: { createdAt: now } }, { upsert: true });
  return { code, applies_to: doc.appliesTo, max_pct: maxPct, max_cents: maxCents, max_uses: maxUses, requires: doc.requires, added: true };
}

export async function removePromo(code: string) {
  const { _id: orgId } = await getCurrentOrg();
  await (await getDb()).collection<Document>("promos").deleteOne({ orgId, code: code.toUpperCase() });
  return { ok: true };
}

export async function run(fn: () => Promise<unknown>) {
  try {
    return Response.json(await fn());
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return Response.json({ error: (e as Error).message }, { status });
  }
}

import type { Db, ObjectId } from "mongodb";
import type { PhotonEvent } from "./photon";

// Every event Photon sends us (socket or HTTP webhook), as one row each: "a text is arriving", "a call is ringing", what we did with it.
// The console reads this to show live inbound activity; it is also the first place to look when something seems not to arrive.
export type InboundKind = "text" | "call" | "typing" | "delivery" | "other";
export type InboundStatus = "received" | "handled" | "stale" | "unrouted" | "ignored" | "error";

export const kindOf = (type: string): InboundKind =>
  type.startsWith("call.") ? "call" : type === "message.received" ? "text" : type.startsWith("space.typing") ? "typing" : type.startsWith("message.") ? "delivery" : "other";

const mask = (a: string) => (/^\+\d{8,15}$/.test(a) ? a.replace(/^(\+\d)(\d+)(\d{4})$/, (_m, p, mid, last) => p + "*".repeat(mid.length) + last) : a.replace(/^(.{2}).*(@.*)$/, "$1***$2"));
let indexed = false;
async function ensureIndexes(db: Db) {
  if (indexed) return; indexed = true;
  const c = db.collection("inbound_events");
  await c.createIndex({ eventId: 1 }, { unique: true });
  await c.createIndex({ orgId: 1, receivedAt: -1 });
  await c.createIndex({ receivedAt: 1 }, { expireAfterSeconds: 14 * 86400 });
}

/** Where did this event go? Cheap and best-effort: tracking must never stop a message or call from being handled. */
export async function trackEvent(db: Db, evt: PhotonEvent, source: "socket" | "webhook", orgFor: (line: string) => Promise<ObjectId | null>, log: (m: string) => void = () => {}) {
  try {
    await ensureIndexes(db);
    const o = evt.data?.object ?? {};
    const inbound = o.direction !== "outbound";
    const kind = kindOf(evt.type);
    const line = String(kind === "call" ? (inbound ? o.callee?.handle : o.caller?.handle) : o.receivedBy?.handle ?? o.sentBy?.handle ?? "");
    const peer = String(kind === "call" ? (inbound ? o.caller?.handle : o.callee?.handle) : o.sentBy?.handle ?? "");
    const orgId = line ? await orgFor(line).catch(() => null) : null;
    const now = new Date();
    await db.collection("inbound_events").updateOne({ eventId: evt.id }, {
      $setOnInsert: { eventId: evt.id, orgId, type: evt.type, kind, platform: String(o.platform ?? ""), direction: kind === "delivery" || kind === "typing" ? null : inbound ? "in" : "out", line, peer: mask(peer), at: new Date(evt.timestamp), receivedAt: now, source, status: "received" as InboundStatus, refId: o.id ? String(o.id) : null },
      $inc: { seen: 1 },
    }, { upsert: true });
    return { orgId, kind, done: async (status: InboundStatus, detail?: string) => { await db.collection("inbound_events").updateOne({ eventId: evt.id }, { $set: { status, detail: detail ?? null, handledAt: new Date() } }).catch(() => {}); } };
  } catch (e) { log(`inbound tracking failed: ${(e as Error).message}`); return { orgId: null as ObjectId | null, kind: "other" as InboundKind, done: async (_s: InboundStatus, _d?: string) => {} }; }
}

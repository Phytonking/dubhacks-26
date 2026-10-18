import type { Db, ObjectId } from "mongodb";
import { resolveParty } from "./identity";
import type { PhotonEvent } from "./photon";

// Logs Photon call.* events into `calls` (one document per call) and drops a marker into the conversation timeline when the call ends.
// This logs the CALL (who, when, how long, outcome). The words spoken come later from the ElevenLabs post-call webhook.
const RANK: Record<string, number> = { ringing: 0, active: 1, completed: 2, missed: 2, failed: 2 };
const isDup = (e: unknown) => (e as { code?: number })?.code === 11000;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const d = (v: unknown, fallback?: string) => { const t = new Date(String(v ?? fallback ?? "")); return isNaN(t.getTime()) ? new Date() : t; };

export type CallResult = { ok: boolean; reason?: string; duplicate?: boolean; callId?: ObjectId; status?: string };

export async function handleCallEvent(db: Db, evt: PhotonEvent, log: (m: string) => void = () => {}): Promise<CallResult> {
  const o = evt.data?.object;
  if (!evt.type.startsWith("call.") || !o?.id) return { ok: false, reason: "not a call event" };
  const inbound = o.direction !== "outbound";
  const line = String(inbound ? o.callee?.handle : o.caller?.handle ?? "");   // our number
  const peer = String(inbound ? o.caller?.handle : o.callee?.handle ?? "");   // the customer
  if (!line || !peer) return { ok: false, reason: "call event without caller/callee handles" };

  const row = await db.collection("channel_lines").findOne({ address: line, status: "active" });   // any channel: one number serves voice, SMS and WhatsApp
  if (!row) {
    await db.collection("unrouted_events").insertOne({ evt, reason: `no business for voice line ${line}`, at: new Date() });
    log(`UNROUTED call event ${evt.type}: no business for line ${line.slice(0, 5)}***`);
    return { ok: false, reason: "unrouted" };
  }
  const orgId = row.orgId as ObjectId;
  const { contact, conversation } = await resolveParty(db, { orgId, channel: "voice", address: peer });
  const calls = db.collection("calls");
  const ts = o.timestamps ?? {};

  const existing = await calls.findOne({ provider: "photon", providerCallId: String(o.id) });
  if (existing?.events?.some((e: { eventId: string }) => e.eventId === evt.id)) return { ok: true, duplicate: true, callId: existing._id, status: existing.status };

  const answered = Boolean(ts.answeredAt || existing?.answeredAt || evt.type === "call.answered" || evt.type === "call.connected");
  let status = evt.type === "call.ended" ? (o.status === "completed" || answered ? "completed" : o.status === "failed" ? "failed" : "missed") : answered ? "active" : "ringing";
  if (existing && (RANK[existing.status] ?? 0) > (RANK[status] ?? 0)) status = existing.status;   // events can arrive late or replayed: never move backwards

  const set: Record<string, unknown> = { status, updatedAt: new Date() };
  if (ts.answeredAt) set.answeredAt = d(ts.answeredAt);
  if (evt.type === "call.ended") {
    const end = d(ts.endedAt, evt.timestamp);
    const start = ts.answeredAt ? d(ts.answeredAt) : existing?.answeredAt ? new Date(existing.answeredAt) : null;
    set.endedAt = end;
    set.durationSec = start ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000)) : 0;
    if (!existing?.outcome) set.outcome = status === "completed" ? "answered" : status;
  }
  const insertOnly = {
    orgId, contactId: contact._id, conversationId: conversation._id, direction: inbound ? "in" : "out",
    provider: "photon", providerCallId: String(o.id), startedAt: d(ts.startedAt, evt.timestamp), createdAt: new Date(),
    recordingUrl: null, summary: "", line, peer,
    ...(evt.type === "call.ended" ? {} : { durationSec: 0 }),
  };
  if (!("durationSec" in set) && !("durationSec" in insertOnly)) (insertOnly as Record<string, unknown>).durationSec = 0;
  const update = { $setOnInsert: insertOnly, $set: set, $push: { events: { eventId: evt.id, type: evt.type, at: d(evt.timestamp) } } } as never;
  let saved;
  try { saved = await calls.findOneAndUpdate({ provider: "photon", providerCallId: String(o.id) }, update, { upsert: true, returnDocument: "after" }); }
  catch (e) { if (!isDup(e)) throw e; saved = await calls.findOneAndUpdate({ provider: "photon", providerCallId: String(o.id) }, update, { returnDocument: "after" }); }
  if (!saved) return { ok: false, reason: "call not saved" };

  if (evt.type === "call.ended") {
    const dur = Number(saved.durationSec ?? 0);
    const body = status === "completed" ? `Phone call (${fmt(dur)})` : "Missed call";
    const endedAt = saved.endedAt ? new Date(saved.endedAt) : new Date();
    try {
      await db.collection("messages").insertOne({
        orgId, conversationId: conversation._id, channel: "voice", direction: inbound ? "in" : "out", sender: inbound ? "customer" : "agent",
        body, channelMsgId: `call:${o.id}`, deliveryStatus: "delivered", handling: "ignored", callId: saved._id, attempts: 0, ts: endedAt,
      } as never);
      await db.collection("conversations").updateOne({ _id: conversation._id }, { $set: { lastMessageAt: endedAt, lastMessagePreview: body, lastChannel: "voice" } });
    } catch (e) { if (!isDup(e)) throw e; }                    // marker already written (replayed ended event)
    log(`call ${String(o.id).slice(0, 12)}… ended: ${status}, ${dur}s, contact ${String(contact._id).slice(-6)}`);
  }
  return { ok: true, callId: saved._id, status };
}

import { randomUUID } from "node:crypto";
import { ObjectId, type Db } from "mongodb";
import type { AgentLink } from "./sandbox-link";
import { resolveParty } from "./identity";
import { redactSensitive } from "./sensitive";
import { clearOptOut, detectKeyword, isOptedOut, keywordReply, setOptOut } from "./optout";

// The only code path allowed to touch a channel. Every message is written to Mongo around the send (PRD §6).
export type ChannelId = "imessage" | "whatsapp" | "sms" | "voice";
/** Provider routing info carried from an inbound message to its reply (Photon: space + our agent user). */
export type ChannelRef = { spaceId?: string; senderId?: string; parentMessageId?: string };
export interface ChannelAdapter {
  channel: ChannelId;
  /** idempotencyKey = our clientMsgId, so a retry after a crash cannot double-send. */
  send(address: string, text: string, ref: ChannelRef, idempotencyKey: string): Promise<{ channelMsgId: string }>;
}

/** Real iMessage sending through Photon's HTTP API (async accept; final status arrives via delivery events). */
export class PhotonAdapter implements ChannelAdapter {
  channel: ChannelId;
  /** threads=false: do NOT send parentMessageId. Verified live 2026-10-18: Photon answers 409 SPACE_NOT_SENDABLE ("Replies are not supported
   *  for this Space") to any send carrying parentMessageId on shared iMessage lines and on SMS, even though its beta quickstart shows it.
   *  The same send without it is accepted. Re-enable only for dedicated lines after testing. */
  constructor(private photon: import("./photon").Photon, channel: ChannelId = "imessage", private threads = false) { this.channel = channel; }
  async send(_address: string, text: string, ref: ChannelRef, idempotencyKey: string) {
    if (!ref.spaceId || !ref.senderId) throw new Error("missing spaceId/senderId (a shared iMessage line cannot send an unsolicited first message)");
    const m = await this.photon.sendText({ spaceId: ref.spaceId, senderId: ref.senderId, text, parentMessageId: this.threads ? ref.parentMessageId : undefined, idempotencyKey });
    return { channelMsgId: String(m.id) };
  }
}

/** Test adapter: records what would have been sent to a real customer instead of messaging anyone. */
export class LoopbackAdapter implements ChannelAdapter {
  channel: ChannelId = "imessage";
  sent: Array<{ address: string; text: string }> = [];
  async send(address: string, text: string, _ref?: ChannelRef, _key?: string) {
    this.sent.push({ address, text });
    return { channelMsgId: `lb_${this.sent.length}_${randomUUID().slice(0, 8)}` };
  }
}

export const counters = { inReceived: 0, outAttempted: 0 };

/** Guardrails enforced outside the LLM (PRD §10). */
export function checkGuardrails(text: string, g: { maxDiscountPct: number }) {
  for (const m of text.matchAll(/(\d{1,3})\s*%\s*(off|discount)/gi)) {
    if (Number(m[1]) > g.maxDiscountPct) return { verdict: "blocked", reason: `discount ${m[1]}% exceeds max ${g.maxDiscountPct}%` };
  }
  return { verdict: "ok" } as { verdict: string; reason?: string };
}

export type WorkerOpts = {
  autoReply?: boolean;     // false: log inbound only, never answer (used while a channel is being verified)
  scheduled?: boolean;     // true: store + schedule only; the Scheduler runs the turn (engine v2). false: answer inline (legacy sandbox path, tests)
  debounceMs?: number;     // wait this long after the last message before answering, so a burst gets one reply
  maxWaitMs?: number;      // but never hold the first message longer than this
  brand?: string;          // used in STOP/START/HELP replies
  helpLine?: string | null;
};

export class Worker {
  constructor(
    private db: Db,
    private link: AgentLink,
    private adapter: ChannelAdapter,
    private ensureOnline: (orgId: ObjectId) => Promise<void>,
    private opts: WorkerOpts = {},
  ) {}

  async handleInbound(a: { orgId: ObjectId; address: string; text: string; channelMsgId: string; ref?: ChannelRef; onPersisted?: () => void }) {
    const { db } = this;
    counters.inReceived++;
    const channel = this.adapter.channel;
    // who is this? (cross-channel: the same number on SMS, iMessage, WhatsApp and voice is one contact and one conversation)
    const { contact, conversation: conv } = await resolveParty(db, { orgId: a.orgId, channel, address: a.address });
    const agent = await db.collection("agents").findOne({ orgId: a.orgId });
    // STOP / START / HELP are answered with fixed text and never reach the model; an opted-out number gets no reply at all
    const addresses: string[] = ((contact as any).handles ?? []).map((h: any) => h.address);
    const optedOut = await isOptedOut(db, a.orgId, addresses);
    const kw = detectKeyword(a.text, optedOut);
    // A card number or SSN typed into a chat is never stored or shown to the model; the customer is steered to the secure form by the assistant.
    const safe = redactSensitive(a.text);
    // 1. persist BEFORE acting (dedupe via unique (channel, channelMsgId))
    const handling = kw ? "ignored" : optedOut ? "opted_out" : conv.mode === "human" ? "human" : this.opts.autoReply === false ? "ignored" : "agent";
    try {
      await db.collection("messages").insertOne({
        orgId: a.orgId, conversationId: conv._id, channel, direction: "in", sender: "customer", body: safe.text, redacted: safe.redacted,
        channelMsgId: a.channelMsgId, deliveryStatus: "received", handling, attempts: 0, ref: a.ref ?? null, ts: new Date(),
      }, { writeConcern: { w: "majority", journal: true } });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) { a.onPersisted?.(); return { duplicate: true as const }; }
      throw e;
    }
    await db.collection("conversations").updateOne({ _id: conv._id }, { $set: { lastMessageAt: new Date(), lastMessagePreview: safe.text.slice(0, 80), lastChannel: channel } });
    a.onPersisted?.();   // webhook receivers answer 2xx here: the message is durable, the (slow) agent turn continues
    if (kw) {
      const address = normalizeFor(a.address);
      if (kw === "stop") await setOptOut(db, a.orgId, address, a.text.trim().slice(0, 20));
      if (kw === "start") await clearOptOut(db, a.orgId, address);
      const org: any = await db.collection("orgs").findOne({ _id: a.orgId }, { projection: { name: 1 } });
      const text = keywordReply(kw, this.opts.brand ?? org?.name ?? "We", this.opts.helpLine);
      const out = await this.sendReply(a.orgId, conv._id, a.address, text, `keyword:${a.channelMsgId}`, { maxDiscountPct: 100 }, { ...a.ref }, `kw:${channel}:${a.channelMsgId}`);
      return { duplicate: false as const, handling: "keyword" as const, keyword: kw, out };
    }
    if (handling === "human" || handling === "ignored" || handling === "opted_out") return { duplicate: false as const, handling };
    if (this.opts.scheduled) {   // engine v2: the lane is the queue; return in milliseconds so the Photon stream is never blocked by a model call
      await scheduleLane(db, conv._id, new Date(), this.opts.debounceMs ?? 2000, this.opts.maxWaitMs ?? 8000);
      return { duplicate: false as const, handling, scheduled: true as const };
    }
    // 2. dispatch to the agent (wake sandbox if needed)
    await this.ensureOnline(a.orgId);
    const history = (await db.collection("messages").find({ conversationId: conv._id, deliveryStatus: { $in: ["received", "sent", "delivered"] } }).sort({ ts: -1 }).limit(7).toArray())
      .reverse().slice(0, -1).map((m) => ({ role: m.direction === "in" ? "user" : "assistant", content: m.body }));
    const turnId = randomUUID();
    const [org, knowledge] = await Promise.all([
      db.collection("orgs").findOne({ _id: a.orgId }),
      db.collection("knowledge").find({ orgId: a.orgId, status: "ready" }).toArray(),
    ]);
    // config travels with the turn (fresh every time: owner edits apply without restart)
    const reply = await this.link.send(String(agent!._id), { turnId, channel, text: safe.text, history, conversationId: String(conv._id), config: { org, agent, knowledge } });
    // platform-side audit: the sandbox cannot write to Mongo, so the Worker records what it reports
    for (const tc of reply.toolCalls) {
      await db.collection("tool_calls").insertOne({ orgId: a.orgId, conversationId: conv._id, tool: tc.tool, args: (tc.args ?? {}) as object, result: tc.result ?? null, status: "ok", ms: tc.ms, approvedBy: null, ts: new Date() });
    }
    if (reply.usage) {
      await db.collection("usage").updateOne({ orgId: a.orgId, day: new Date().toISOString().slice(0, 10) },
        { $inc: { tokensIn: reply.usage.prompt_tokens ?? 0, tokensOut: reply.usage.completion_tokens ?? 0, messagesIn: 0, messagesOut: 0, sandboxSec: 0 } }, { upsert: true });
    }
    // 3. record intent, guardrail, send, confirm
    const out = await this.sendReply(a.orgId, conv._id, a.address, reply.text, turnId, agent!.guardrails, { ...a.ref, parentMessageId: a.ref?.parentMessageId ?? a.channelMsgId });
    return { duplicate: false as const, handling, reply, out };
  }

  async sendReply(orgId: ObjectId, conversationId: ObjectId, address: string, text: string, turnId: string, guardrails: { maxDiscountPct: number }, ref: ChannelRef = {}, key?: string) {
    const { db } = this;
    counters.outAttempted++;
    const g = checkGuardrails(text, guardrails);
    const clientMsgId = key ?? randomUUID();
    if (key) {   // a retried turn must not send twice: reuse the row of an earlier attempt
      const prior: any = await db.collection("messages").findOne({ clientMsgId });
      if (prior && (prior.deliveryStatus === "sent" || prior.deliveryStatus === "delivered")) return { status: "sent" as const, channelMsgId: prior.channelMsgId as string, duplicate: true as const };
      if (prior && g.verdict === "ok") return this.deliver(prior._id, orgId, conversationId, address, text, ref, clientMsgId);
    }
    const base = {
      orgId, conversationId, channel: this.adapter.channel, direction: "out" as const, sender: "agent" as const, body: text,
      channelMsgId: null, clientMsgId, agentTurnId: turnId, guardrail: g, attempts: 0, handling: "agent" as const, ts: new Date(),
    };
    const w = { writeConcern: { w: "majority" as const, journal: true } };
    const { insertedId } = await db.collection("messages").insertOne({ ...base, deliveryStatus: g.verdict === "ok" ? "queued" : "blocked" }, w);
    if (g.verdict !== "ok") return { status: "blocked" as const, reason: g.reason };
    return this.deliver(insertedId, orgId, conversationId, address, text, ref, clientMsgId);
  }

  private async deliver(rowId: ObjectId, _orgId: ObjectId, conversationId: ObjectId, address: string, text: string, ref: ChannelRef, clientMsgId: string) {
    const { db } = this;
    await db.collection("messages").updateOne({ _id: rowId }, { $set: { deliveryStatus: "sending" }, $inc: { attempts: 1 } });
    try {
      const r = await this.adapter.send(address, text, ref, clientMsgId);
      await db.collection("messages").updateOne({ _id: rowId }, { $set: { deliveryStatus: "sent", channelMsgId: r.channelMsgId, deliveryError: null } });
      await db.collection("conversations").updateOne({ _id: conversationId }, { $set: { lastMessageAt: new Date(), lastMessagePreview: text.slice(0, 80) } });
      return { status: "sent" as const, channelMsgId: r.channelMsgId };
    } catch (e) {
      await db.collection("messages").updateOne({ _id: rowId }, { $set: { deliveryStatus: "failed", deliveryError: String((e as Error).message) } });
      return { status: "failed" as const };
    }
  }

  /** Photon delivery events -> message status. Looks the message up by provider id; unknown ids are ignored (e.g. other projects' echoes). */
  async handleDelivery(type: string, msg: { id: string; failure?: { reason?: string; message?: string } | null }) {
    const status = type === "message.delivered" ? "delivered" : type === "message.failed" ? "failed" : type === "message.dispatched" || type === "message.accepted" ? "sent" : null;
    if (!status) return { matched: 0 };
    const rank = { queued: 0, sending: 1, sent: 2, delivered: 3, failed: 3 } as Record<string, number>;
    const doc = await this.db.collection("messages").findOne({ channel: this.adapter.channel, channelMsgId: msg.id });
    if (!doc) return { matched: 0 };
    if ((rank[doc.deliveryStatus] ?? 0) >= rank[status] && doc.deliveryStatus !== "sent") return { matched: 1, unchanged: true }; // never move backwards
    await this.db.collection("messages").updateOne({ _id: doc._id }, { $set: { deliveryStatus: status, ...(status === "failed" ? { deliveryError: msg.failure?.message ?? msg.failure?.reason ?? "failed" } : {}) } });
    return { matched: 1, status };
  }

  /** Reconciler (PRD §6.3): anything stuck queued/sending is surfaced. */
  async stuckSends(olderThanMs = 30_000) {
    return this.db.collection("messages").countDocuments({ deliveryStatus: { $in: ["queued", "sending"] }, ts: { $lt: new Date(Date.now() - olderThanMs) } });
  }
}

const normalizeFor = (a: string) => a;   // addresses reach the Worker already normalized by resolveParty's caller; opt-outs are stored as given

/**
 * Mark a conversation as having work due. One atomic update: the first message starts the clock, every further message pushes the due time
 * out by `debounceMs`, but never past `maxWaitMs` after the first. A stale due time left by a finished run does not count as "first".
 */
export async function scheduleLane(db: Db, conversationId: ObjectId, now: Date, debounceMs: number, maxWaitMs: number) {
  await db.collection("conversations").updateOne({ _id: conversationId }, [
    { $set: { "lane.firstAt": { $cond: [{ $or: [{ $eq: [{ $ifNull: ["$lane.dueAt", null] }, null] }, { $lte: ["$lane.dueAt", { $ifNull: ["$lane.startedAt", new Date(0)] }] }] }, now, "$lane.firstAt"] } } },
    { $set: { "lane.state": { $ifNull: ["$lane.state", "idle"] }, "lane.dueAt": { $min: [{ $add: [now, debounceMs] }, { $add: ["$lane.firstAt", maxWaitMs] }] } } },
  ] as never);
}

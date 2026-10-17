import { randomUUID } from "node:crypto";
import { ObjectId, type Db } from "mongodb";
import type { AgentLink } from "./sandbox-link";

// The only code path allowed to touch a channel. Every message is written to Mongo around the send (PRD §6).
export type ChannelId = "imessage" | "whatsapp" | "sms" | "voice";
export interface ChannelAdapter {
  channel: ChannelId;
  send(address: string, text: string): Promise<{ channelMsgId: string }>;
}

/** Test adapter: records what would have been sent to a real customer instead of messaging anyone. */
export class LoopbackAdapter implements ChannelAdapter {
  channel: ChannelId = "imessage";
  sent: Array<{ address: string; text: string }> = [];
  async send(address: string, text: string) {
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

export class Worker {
  constructor(
    private db: Db,
    private link: AgentLink,
    private adapter: ChannelAdapter,
    private ensureOnline: (orgId: ObjectId) => Promise<void>,
  ) {}

  async handleInbound(a: { orgId: ObjectId; address: string; text: string; channelMsgId: string }) {
    const { db } = this;
    counters.inReceived++;
    const channel = this.adapter.channel;
    const contact = await db.collection("contacts").findOneAndUpdate(
      { orgId: a.orgId, handles: { $elemMatch: { channel, address: a.address } } },
      { $setOnInsert: { orgId: a.orgId, handles: [{ channel, address: a.address }], name: a.address, stage: "new", score: 0, facts: [], notes: "", createdAt: new Date() } },
      { upsert: true, returnDocument: "after" },
    );
    const conv = await db.collection("conversations").findOneAndUpdate(
      { orgId: a.orgId, contactId: contact!._id },
      { $setOnInsert: { orgId: a.orgId, contactId: contact!._id, mode: "agent", lastChannel: channel, lastMessageAt: new Date(), lastMessagePreview: "" } },
      { upsert: true, returnDocument: "after" },
    );
    const agent = await db.collection("agents").findOne({ orgId: a.orgId });
    // 1. persist BEFORE acting (dedupe via unique (channel, channelMsgId))
    const handling = conv!.mode === "human" ? "human" : "agent";
    try {
      await db.collection("messages").insertOne({
        orgId: a.orgId, conversationId: conv!._id, channel, direction: "in", sender: "customer", body: a.text,
        channelMsgId: a.channelMsgId, deliveryStatus: "received", handling, attempts: 0, ts: new Date(),
      }, { writeConcern: { w: "majority", journal: true } });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) return { duplicate: true as const };
      throw e;
    }
    await db.collection("conversations").updateOne({ _id: conv!._id }, { $set: { lastMessageAt: new Date(), lastMessagePreview: a.text.slice(0, 80), lastChannel: channel } });
    if (handling === "human") return { duplicate: false as const, handling };
    // 2. dispatch to the agent (wake sandbox if needed)
    await this.ensureOnline(a.orgId);
    const history = (await db.collection("messages").find({ conversationId: conv!._id, deliveryStatus: { $in: ["received", "sent", "delivered"] } }).sort({ ts: -1 }).limit(7).toArray())
      .reverse().slice(0, -1).map((m) => ({ role: m.direction === "in" ? "user" : "assistant", content: m.body }));
    const turnId = randomUUID();
    const [org, knowledge] = await Promise.all([
      db.collection("orgs").findOne({ _id: a.orgId }),
      db.collection("knowledge").find({ orgId: a.orgId, status: "ready" }).toArray(),
    ]);
    // config travels with the turn (fresh every time: owner edits apply without restart)
    const reply = await this.link.send(String(agent!._id), { turnId, channel, text: a.text, history, conversationId: String(conv!._id), config: { org, agent, knowledge } });
    // platform-side audit: the sandbox cannot write to Mongo, so the Worker records what it reports
    for (const tc of reply.toolCalls) {
      await db.collection("tool_calls").insertOne({ orgId: a.orgId, conversationId: conv!._id, tool: tc.tool, args: (tc.args ?? {}) as object, result: tc.result ?? null, status: "ok", ms: tc.ms, approvedBy: null, ts: new Date() });
    }
    if (reply.usage) {
      await db.collection("usage").updateOne({ orgId: a.orgId, day: new Date().toISOString().slice(0, 10) },
        { $inc: { tokensIn: reply.usage.prompt_tokens ?? 0, tokensOut: reply.usage.completion_tokens ?? 0, messagesIn: 0, messagesOut: 0, sandboxSec: 0 } }, { upsert: true });
    }
    // 3. record intent, guardrail, send, confirm
    const out = await this.sendReply(a.orgId, conv!._id, a.address, reply.text, turnId, agent!.guardrails);
    return { duplicate: false as const, handling, reply, out };
  }

  async sendReply(orgId: ObjectId, conversationId: ObjectId, address: string, text: string, turnId: string, guardrails: { maxDiscountPct: number }) {
    const { db } = this;
    counters.outAttempted++;
    const g = checkGuardrails(text, guardrails);
    const clientMsgId = randomUUID();
    const base = {
      orgId, conversationId, channel: this.adapter.channel, direction: "out" as const, sender: "agent" as const, body: text,
      channelMsgId: null, clientMsgId, agentTurnId: turnId, guardrail: g, attempts: 0, handling: "agent" as const, ts: new Date(),
    };
    const w = { writeConcern: { w: "majority" as const, journal: true } };
    const { insertedId } = await db.collection("messages").insertOne({ ...base, deliveryStatus: g.verdict === "ok" ? "queued" : "blocked" }, w);
    if (g.verdict !== "ok") return { status: "blocked" as const, reason: g.reason };
    await db.collection("messages").updateOne({ _id: insertedId }, { $set: { deliveryStatus: "sending" }, $inc: { attempts: 1 } });
    try {
      const r = await this.adapter.send(address, text);
      await db.collection("messages").updateOne({ _id: insertedId }, { $set: { deliveryStatus: "sent", channelMsgId: r.channelMsgId } });
      await db.collection("conversations").updateOne({ _id: conversationId }, { $set: { lastMessageAt: new Date(), lastMessagePreview: text.slice(0, 80) } });
      return { status: "sent" as const, channelMsgId: r.channelMsgId };
    } catch (e) {
      await db.collection("messages").updateOne({ _id: insertedId }, { $set: { deliveryStatus: "failed", deliveryError: String((e as Error).message) } });
      return { status: "failed" as const };
    }
  }

  /** Reconciler (PRD §6.3): anything stuck queued/sending is surfaced. */
  async stuckSends(olderThanMs = 30_000) {
    return this.db.collection("messages").countDocuments({ deliveryStatus: { $in: ["queued", "sending"] }, ts: { $lt: new Date(Date.now() - olderThanMs) } });
  }
}

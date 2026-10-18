import { randomUUID } from "node:crypto";
import type { Db, ObjectId } from "mongodb";
import type { ChannelId } from "./identity";
import type { ChannelAdapter } from "./recorded-io";
import { isOptedOut } from "./optout";

// Every outbound text that is not a direct reply goes through here, so consent, opt-outs, rate limits, redaction and channel choice
// live in ONE place. The destination always comes from the contact's own record, never from the caller of send().
export type Purpose = "reply" | "otp" | "form_link" | "info";
export type Readiness = (channel: ChannelId, c: { orgId: ObjectId; contact: any; conversationId: ObjectId; address: string }) => Promise<{ ok: boolean; reason?: string }>;
export type MessengerCfg = {
  adapters: Partial<Record<ChannelId, ChannelAdapter>>;
  ready: Readiness;                                    // is this channel usable right now for this person? (window open, campaign approved, ...)
  limits?: { perNumberHour?: number; perNumberDay?: number; perOrgDay?: number };
  preference?: ChannelId[];                            // default order when the caller does not pass one
  now?: () => Date;
};
export type SendArgs = {
  orgId: ObjectId; contactId: ObjectId; conversationId: ObjectId; purpose: Purpose;
  body: string; redact?: string; channels?: ChannelId[]; idempotencyKey?: string; agentTurnId?: string;
};
export type SendOutcome =
  | { ok: true; channel: ChannelId; messageId: ObjectId; duplicate?: boolean }
  | { ok: false; error: "not_found" | "opted_out" | "no_consent" | "rate_limited" | "no_channel" | "send_failed"; detail?: string };

const PROACTIVE: Purpose[] = ["otp", "form_link", "info"];
const phoneOf = (contact: any): string | null => (contact.handles ?? []).map((h: any) => h.address).find((a: string) => /^\+\d{8,15}$/.test(a)) ?? null;

export class Messenger {
  constructor(private db: Db, private cfg: MessengerCfg) {}
  private now() { return this.cfg.now?.() ?? new Date(); }
  /** Can we text this person on this channel right now (window open, campaign approved, ...)? */
  isReady(channel: ChannelId, c: { orgId: ObjectId; contact: any; conversationId: ObjectId; address: string }) { return this.cfg.ready(channel, c); }

  /** Texts need consent: explicit (recorded, e.g. said yes on a call) or implicit (they texted us on that channel in the last 24 hours). */
  async hasConsent(contact: any, conversationId: ObjectId, orgId: ObjectId, channel: ChannelId): Promise<boolean> {
    if (contact.consent?.text?.granted === true) return true;
    const since = new Date(this.now().getTime() - 24 * 3600_000);
    return (await this.db.collection("messages").countDocuments({ orgId, conversationId, channel, direction: "in", sender: "customer", ts: { $gte: since }, handling: { $ne: "ignored" } }, { limit: 1 })) > 0;
  }

  async send(a: SendArgs): Promise<SendOutcome> {
    const { db } = this;
    const contact: any = await db.collection("contacts").findOne({ _id: a.contactId, orgId: a.orgId });
    if (!contact) return { ok: false, error: "not_found" };
    const addresses: string[] = (contact.handles ?? []).map((h: any) => h.address);
    if (await isOptedOut(db, a.orgId, addresses)) return { ok: false, error: "opted_out" };

    const key = a.idempotencyKey ?? randomUUID();
    const prior = await db.collection("messages").findOne({ clientMsgId: { $regex: `^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(:|$)` }, deliveryStatus: { $in: ["sent", "delivered"] } });
    if (prior) return { ok: true, channel: prior.channel, messageId: prior._id, duplicate: true };

    const now = this.now();
    if (PROACTIVE.includes(a.purpose)) {
      const L = { perNumberHour: 6, perNumberDay: 20, perOrgDay: 500, ...this.cfg.limits };
      const num = phoneOf(contact);
      if (num) {
        const mine = await db.collection("messages").find({ orgId: a.orgId, conversationId: a.conversationId, direction: "out", purpose: { $in: PROACTIVE }, ts: { $gte: new Date(now.getTime() - 24 * 3600_000) } }).project({ ts: 1 }).toArray();
        if (mine.length >= L.perNumberDay || mine.filter((m) => m.ts.getTime() >= now.getTime() - 3600_000).length >= L.perNumberHour) return { ok: false, error: "rate_limited", detail: "per-number limit" };
      }
      if ((await db.collection("messages").countDocuments({ orgId: a.orgId, direction: "out", purpose: { $in: PROACTIVE }, ts: { $gte: new Date(now.getTime() - 24 * 3600_000) } })) >= L.perOrgDay) return { ok: false, error: "rate_limited", detail: "business daily limit" };
    }

    const order = [...new Set(a.channels ?? this.cfg.preference ?? (["imessage", "whatsapp", "sms"] as ChannelId[]))];   // each channel is tried at most once
    let sawConsentGap = false; let attemptedFailure: string | undefined; let notReady: string | undefined;
    for (const channel of order) {
      const adapter = this.cfg.adapters[channel];
      if (!adapter) continue;
      const address = phoneOf(contact) ?? addresses[0];
      if (!address) continue;
      const r = await this.cfg.ready(channel, { orgId: a.orgId, contact, conversationId: a.conversationId, address });
      if (!r.ok) { notReady = `${channel}: ${r.reason ?? "not ready"}`; continue; }
      if (PROACTIVE.includes(a.purpose) && !(await this.hasConsent(contact, a.conversationId, a.orgId, channel))) { sawConsentGap = true; continue; }
      // newest inbound on this channel carries the provider routing needed to reply (space, agent user)
      const inbound: any = await db.collection("messages").findOne({ orgId: a.orgId, conversationId: a.conversationId, channel, direction: "in", ref: { $ne: null } }, { sort: { ts: -1 } });
      const clientMsgId = `${key}:${channel}`;
      const stored = a.redact ?? a.body;
      const { insertedId } = await db.collection("messages").insertOne({
        orgId: a.orgId, conversationId: a.conversationId, channel, direction: "out", sender: "agent", body: stored, redacted: a.redact != null,
        channelMsgId: null, clientMsgId, agentTurnId: a.agentTurnId ?? null, deliveryStatus: "sending", handling: "agent", purpose: a.purpose, attempts: 1, ts: now,
      } as never);
      try {
        const sent = await adapter.send(address, a.body, { ...(inbound?.ref ?? {}) }, clientMsgId);
        await db.collection("messages").updateOne({ _id: insertedId }, { $set: { deliveryStatus: "sent", channelMsgId: sent.channelMsgId } });
        await db.collection("conversations").updateOne({ _id: a.conversationId }, { $set: { lastMessageAt: now, lastMessagePreview: stored.slice(0, 80), lastChannel: channel } });
        return { ok: true, channel, messageId: insertedId };
      } catch (e) {
        attemptedFailure = `${channel}: ${(e as Error).message.slice(0, 160)}`;
        await db.collection("messages").updateOne({ _id: insertedId }, { $set: { deliveryStatus: "failed", deliveryError: attemptedFailure } });
      }
    }
    // Why nothing was sent, most specific first: a real send failed > a channel was usable but we have no consent > nothing was usable.
    if (attemptedFailure) return { ok: false, error: "send_failed", detail: attemptedFailure };
    if (sawConsentGap) return { ok: false, error: "no_consent" };
    return { ok: false, error: "no_channel", detail: notReady };
  }
}

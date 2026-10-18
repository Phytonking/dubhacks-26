import { ObjectId } from "mongodb";
import { amountsIn, checkText } from "../guardrails";
import { looksSensitive } from "../../sensitive";
import type { Tool } from "../types";
import { reachHint } from "./reach";

const tok = (s: string) => s.toLowerCase().split(/[^a-z0-9$]+/).filter((w) => w.length > 2);
const STOP = new Set(["the", "and", "for", "what", "with", "that", "this", "have", "from", "your", "about", "would", "could", "should", "there", "their", "need", "want", "does", "much", "which", "when", "will", "just", "like", "into", "than", "then", "they", "them", "how", "are", "can", "you", "get"]);

/** Scored keyword search: title hits weigh more, whole words beat substrings, rare words beat common ones. Good enough until vector search. */
export function scoreKnowledge(docs: { title: string; content: string }[], query: string, n = 4) {
  const words = [...new Set(tok(query).filter((w) => !STOP.has(w)))];
  const hay = docs.map((d) => ({ d, t: d.title.toLowerCase(), c: `${d.title} ${d.content}`.toLowerCase() }));
  const df = (w: string) => hay.filter((h) => h.c.includes(w)).length || 1;
  return hay
    .map((h) => {
      let score = 0;
      for (const w of words) {
        if (!h.c.includes(w)) continue;
        score += Math.log(1 + hay.length / df(w)) * (h.t.includes(w) ? 3 : 1) * (new RegExp(`\\b${w.replace(/[$]/g, "\\$")}\\b`).test(h.c) ? 1.5 : 1);
      }
      return { d: h.d, score };
    })
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, n).map((x) => x.d);
}

export const knowledge_search: Tool = {
  name: "knowledge_search", risk: "read", timeoutMs: 3000,
  description: "Search the business's knowledge base for plans, prices, hours, policies and FAQs. Use before stating any price, fee, hours or policy.",
  parameters: { type: "object", properties: { query: { type: "string", minLength: 2, maxLength: 200, description: "what to look up" } }, required: ["query"] },
  async run(ctx, { query }) {
    const docs = await ctx.db.collection("knowledge").find({ orgId: ctx.orgId, status: "ready" }).project({ title: 1, content: 1 }).toArray() as unknown as { title: string; content: string }[];
    const hits = scoreKnowledge(docs, query);
    if (!hits.length) return { ok: true, data: { results: [], note: "nothing found; do not guess, say you will check" } };
    return { ok: true, data: { results: hits.map((h) => ({ title: h.title, content: h.content.slice(0, 900) })) } };
  },
};

const looksLikeFact = /\$\s?\d|\b\d+\s?%|\beligible\b|\bprice[ds]?\b|\bcosts?\b/i;
export const memory_remember: Tool = {
  name: "memory_remember", risk: "write_low", timeoutMs: 3000,
  description: "Remember something the customer told you (a deadline, a preference, a household detail) so you can use it later. Never store prices, offers or eligibility; those come from tools.",
  parameters: { type: "object", properties: { fact: { type: "string", minLength: 3, maxLength: 200, description: "short statement of what the customer said" } }, required: ["fact"] },
  async run(ctx, { fact }) {
    if (looksSensitive(fact)) return { ok: false, error: "not_storable", data: { hint: "Never store passwords, PINs, SSNs or card numbers. Private details go through the secure form." }, audit: { error: "not_storable", note: "arguments withheld: looked sensitive" } };
    if (looksLikeFact.test(fact)) return { ok: false, error: "not_storable", data: { hint: "Store what the customer said about themselves, not prices, offers or eligibility." } };
    if (!ctx.sourceMessageId) return { ok: false, error: "no_source_message" };   // facts without provenance are rejected
    const c: any = await ctx.db.collection("contacts").findOne({ _id: ctx.contactId, orgId: ctx.orgId }, { projection: { facts: 1 } });
    const live = (c?.facts ?? []).filter((f: any) => !f.supersededBy);
    if (live.some((f: any) => f.text.trim().toLowerCase() === fact.trim().toLowerCase())) return { ok: true, data: { status: "already_known" } };
    if (live.length >= 50) return { ok: false, error: "memory_full" };
    await ctx.db.collection("contacts").updateOne({ _id: ctx.contactId, orgId: ctx.orgId }, { $push: { facts: { text: fact.trim(), sourceMessageId: ctx.sourceMessageId, learnedAt: ctx.now, origin: "agent" } } as never });
    return { ok: true, data: { status: "remembered" }, sideEffect: true };
  },
};

export const memory_commit: Tool = {
  name: "memory_commit", risk: "write_low", timeoutMs: 3000,
  description: "Record something YOU promised to do for the customer (for example 'check trade-in value'), so it is brought up next time.",
  parameters: { type: "object", properties: { text: { type: "string", minLength: 3, maxLength: 200 }, due_in_days: { type: "integer", minimum: 0, maximum: 90 } }, required: ["text"] },
  async run(ctx, { text, due_in_days }) {
    const c: any = await ctx.db.collection("contacts").findOne({ _id: ctx.contactId, orgId: ctx.orgId }, { projection: { memory: 1 } });
    if ((c?.memory?.openLoops ?? []).filter((l: any) => l.status !== "done").length >= 20) return { ok: false, error: "too_many_open_items" };
    const loop = { text: text.trim(), dueAt: due_in_days != null ? new Date(ctx.now.getTime() + due_in_days * 86400_000) : null, status: "open", sourceMessageId: ctx.sourceMessageId, createdAt: ctx.now };
    await ctx.db.collection("contacts").updateOne({ _id: ctx.contactId, orgId: ctx.orgId }, { $push: { "memory.openLoops": loop } as never });
    return { ok: true, data: { status: "recorded" }, sideEffect: true };
  },
};

export const contact_update_stage: Tool = {
  name: "contact_update_stage", risk: "write_low", timeoutMs: 3000,
  description: "Update where this person is in the sales process and how strong the lead is.",
  parameters: { type: "object", properties: { stage: { type: "string", enum: ["new", "engaged", "qualified", "won", "lost"] }, score: { type: "integer", minimum: 0, maximum: 100 } }, required: ["stage"] },
  async run(ctx, { stage, score }) {
    await ctx.db.collection("contacts").updateOne({ _id: ctx.contactId, orgId: ctx.orgId }, { $set: { stage, ...(score != null ? { score } : {}) } });
    return { ok: true, data: { status: "updated" }, sideEffect: true };
  },
};

export const consent_record: Tool = {
  name: "consent_record", risk: "write_low", timeoutMs: 3000,
  description: "Record that the customer agreed (or refused) to receive text messages from us, after you asked them. Required before sending a code, a link or information by text to someone who has not texted us.",
  parameters: { type: "object", properties: { granted: { type: "boolean" } }, required: ["granted"] },
  async run(ctx, { granted }) {
    await ctx.db.collection("contacts").updateOne({ _id: ctx.contactId, orgId: ctx.orgId }, { $set: { "consent.text": { granted, at: ctx.now, source: ctx.mode === "voice" ? "voice" : "inbound_text", turnId: ctx.turnId, sourceMessageId: ctx.sourceMessageId } } });
    return { ok: true, data: { status: granted ? "consent_recorded" : "refusal_recorded" }, sideEffect: true };
  },
};

export const owner_notify: Tool = {
  name: "owner_notify", risk: "write_low", timeoutMs: 3000,
  description: "Tell the business owner something they should see (a callback request, a hot lead, a problem).",
  parameters: { type: "object", properties: { message: { type: "string", minLength: 3, maxLength: 300 }, urgency: { type: "string", enum: ["low", "normal", "high"] } }, required: ["message"] },
  async run(ctx, { message, urgency }) {
    await ctx.db.collection("notifications").insertOne({ orgId: ctx.orgId, contactId: ctx.contactId, conversationId: ctx.conversationId, kind: "agent_note", message: message.trim(), urgency: urgency ?? "normal", read: false, createdAt: ctx.now } as never);
    return { ok: true, data: { status: "owner_notified" }, sideEffect: true };
  },
};

export const handoff_escalate: Tool = {
  name: "handoff_escalate", risk: "write_low", timeoutMs: 3000,
  description: "Hand this conversation to a person. Use when they ask for one, want to cancel or port out, report fraud or a lost device, have an unresolved complaint, or you are unsure. After calling it, tell the customer a person will follow up.",
  parameters: { type: "object", properties: { reason: { type: "string", minLength: 3, maxLength: 300 } }, required: ["reason"] },
  async run(ctx, { reason }) {
    await ctx.db.collection("conversations").updateOne({ _id: ctx.conversationId, orgId: ctx.orgId }, { $set: { mode: "human" } });
    await ctx.db.collection("notifications").insertOne({ orgId: ctx.orgId, contactId: ctx.contactId, conversationId: ctx.conversationId, kind: "handoff", message: reason.trim(), urgency: "high", read: false, createdAt: ctx.now } as never);
    return { ok: true, data: { status: "handed_off", next: "tell the customer a person will follow up; say nothing else about the account" }, sideEffect: true, escalate: true };
  },
};

export const text_send_info: Tool = {
  name: "text_send_info", risk: "write_high", timeoutMs: 8000,
  description: "Text the customer a short piece of information they asked to have in writing (an address, hours, a summary). Not for codes or links.",
  parameters: { type: "object", properties: { text: { type: "string", minLength: 3, maxLength: 320 } }, required: ["text"] },
  async run(ctx, { text }) {
    if (/https?:\/\/|\bwww\./i.test(text)) return { ok: false, error: "links_not_allowed", data: { hint: "Use forms_send_secure_form for links." } };
    if (/\b\d{6}\b/.test(text)) return { ok: false, error: "codes_not_allowed", data: { hint: "Use verify_send_code for codes." } };
    const g = checkText(text, ctx.guard.cfg, ctx.guard.evidence);
    if (g.verdict === "blocked") return { ok: false, error: "blocked_by_guardrail", data: { reason: g.reason } };
    const r = await ctx.messenger.send({ orgId: ctx.orgId, contactId: ctx.contactId, conversationId: ctx.conversationId, purpose: "info", body: text.trim(), agentTurnId: ctx.turnId,
      idempotencyKey: `info:${ctx.turnId}:${amountsIn(text).length}:${text.length}`, channels: ctx.channel === "voice" ? undefined : [ctx.channel, "imessage", "whatsapp", "sms"] });
    if (!r.ok && r.error === "no_channel") return { ok: false, error: "no_channel", ...(await (async () => { const h = await reachHint(ctx, "private_details"); return { data: { hint: "We cannot text them yet. Tell them which number to message, then stop.", ...h.data }, reply: h.reply }; })()), sideEffect: true };
    if (!r.ok) return { ok: false, error: r.error, data: r.error === "no_consent" ? { hint: "Ask whether you may text them, then call consent_record." } : undefined };
    return { ok: true, data: { status: "sent", via: r.channel }, sideEffect: true };
  },
};

import { ObjectId, type Db } from "mongodb";
import { buildCustomerBlock, loadCustomer, type Customer } from "../customer";
import type { ChannelId, Party } from "../identity";
import { channelStyle, loadTemplate, renderPrompt } from "../prompt";
import type { GuardCfg } from "./guardrails";
import { scoreKnowledge } from "./tools/core";
import { businessLines, contactMethodsBlock } from "../lines";
import type { ChatMessage, EngineEnv, Mode, Tool } from "./types";
import { ALL_TOOLS } from "./tools/index";

export type TurnInput = {
  orgId: ObjectId;
  conversationId: ObjectId;
  channel: ChannelId;
  mode: Mode;
  batch: { _id: ObjectId; body: string; ts: Date }[];
  historyOverride?: ChatMessage[];     // voice: ElevenLabs already sends the live transcript, so it replaces recent DB history
  passthrough?: { name: string; description: string; parameters: any }[];   // tools that ElevenLabs executes (end_call, transfer_to_number...)
  signal?: AbortSignal;
  callId?: ObjectId;                   // voice: the call this turn belongs to (so what is learned can be tied to it)
  listenOnly?: boolean;                // the reply will NOT be delivered (channel cannot send back): read, record, do not promise anything
};

export type BuiltContext = {
  party: Party; customer: Customer; messages: ChatMessage[]; evidence: string[]; guard: GuardCfg;
  agent: any; org: any; templateName: string;
};

const HISTORY_CHARS = 6000, HISTORY_MAX = 14;

export async function buildContext(db: Db, env: EngineEnv, input: TurnInput, tools: Tool[] = ALL_TOOLS): Promise<BuiltContext> {
  const now = env.now?.() ?? new Date();
  const conv: any = await db.collection("conversations").findOne({ _id: input.conversationId, orgId: input.orgId });
  if (!conv) throw new Error("conversation not found for this business");
  const contact: any = await db.collection("contacts").findOne({ _id: conv.contactId, orgId: input.orgId });
  if (!contact) throw new Error("contact not found");
  const [agent, org]: any[] = await Promise.all([db.collection("agents").findOne({ orgId: input.orgId }), db.collection("orgs").findOne({ _id: input.orgId })]);
  if (!agent || !org) throw new Error("business or agent not configured");

  const handle = (contact.handles ?? []).find((h: any) => h.channel === input.channel) ?? (contact.handles ?? []).find((h: any) => /^\+\d{8,15}$/.test(h.address)) ?? contact.handles?.[0];
  const party: Party = { contact, conversation: conv, address: handle?.address ?? "", created: false, matchedBy: "channel_handle", externalRefs: contact.externalRefs ?? [] };
  const customer = await loadCustomer(db, party, { orgId: input.orgId, now });
  const customerBlock = buildCustomerBlock(customer, { channel: input.channel });

  const batchText = input.batch.map((m) => m.body).join("\n");
  const kdocs = (await db.collection("knowledge").find({ orgId: input.orgId, status: "ready" }).project({ title: 1, content: 1 }).toArray()) as unknown as { title: string; content: string }[];
  const hits = scoreKnowledge(kdocs, batchText, 3);
  const knowledgeBlock = hits.length ? hits.map((h) => `- ${h.title}: ${h.content.slice(0, 700)}`).join("\n") : "(nothing matched this message; use knowledge_search if you need a fact)";

  const templateName: string = agent.promptTemplate ?? (org.integrations?.tmobile ? "tmobile-system" : "default-system");
  const g = agent.guardrails ?? {};
  const system = renderPrompt(loadTemplate(templateName), {
    assistant_name: agent.assistantName ?? `${org.name} assistant`, brand: org.name,
    disclosure: agent.disclosure ?? "In your first message of a new conversation, say that you are an AI assistant.",
    business_description: org.productDescription ?? "", brand_voice: org.brandVoice ?? "friendly and concise", persona: agent.persona ?? "",
    customer_block: customerBlock, knowledge_block: knowledgeBlock, tools_block: toolsBlock(tools), contact_methods: contactMethodsBlock(await businessLines(db, input.orgId)), channel_style: channelStyle(input.channel),
    max_discount: String(g.maxDiscountPct ?? 0), escalation_triggers: (g.escalateOn ?? []).join(", ") || "none beyond the above",
    now: now.toISOString().slice(0, 10), business_hours: org.hours ?? "not set",
  });

  let history: ChatMessage[];
  if (input.historyOverride) history = input.historyOverride;
  else {
    const batchIds = new Set(input.batch.map((b) => String(b._id)));
    const rows = await db.collection("messages").find({ orgId: input.orgId, conversationId: input.conversationId, handling: { $ne: "ignored" }, deliveryStatus: { $in: ["received", "sent", "delivered"] } })
      .sort({ ts: -1 }).limit(HISTORY_MAX + input.batch.length).toArray();
    let used = 0; const picked: any[] = [];
    for (const r of rows) {
      if (batchIds.has(String(r._id))) continue;
      used += String(r.body).length; if (used > HISTORY_CHARS || picked.length >= HISTORY_MAX) break;
      picked.push(r);
    }
    history = picked.reverse().map((r) => ({ role: r.direction === "in" ? "user" : "assistant", content: String(r.body) } as ChatMessage));
  }
  let otherChannels = "";
  if (input.historyOverride) {   // voice already has its live transcript; still bring in what this person said on other channels
    const rows = await db.collection("messages").find({ orgId: input.orgId, conversationId: input.conversationId, channel: { $ne: "voice" }, handling: { $ne: "ignored" }, deliveryStatus: { $in: ["received", "sent", "delivered"] } }).sort({ ts: -1 }).limit(6).toArray();
    if (rows.length) otherChannels = "\n\n# Earlier messages from this person on other channels (oldest first)\n" + rows.reverse().map((r: any) => `${r.direction === "in" ? "Customer" : "You"} (${r.channel}): ${String(r.body).slice(0, 300)}`).join("\n");
  }
  const summary: string = contact.memory?.summary ?? "";
  const messages: ChatMessage[] = [
    { role: "system", content: system + (input.listenOnly ? "\n\n# This channel is listen-only\nYour reply on this channel will NOT be delivered, and you cannot send anything to this person from here. Do not send codes or forms and do not promise a reply here. Record anything useful they told you with customer_profile_update. If they need an answer, they can call or message us on WhatsApp.\n" : "") + (summary ? `\n\n# Earlier in this conversation (summary)\n${summary}` : "") + otherChannels },
    ...history,
    { role: "user", content: batchText },
  ];
  const USER = "USER:";   // marks the customer's own words: only those may ground a bare number ("100 bucks"); a price must come in dollars from a tool or the knowledge
  const evidence = [knowledgeBlock, customerBlock, ...input.batch.map((b) => USER + b.body), ...history.map((m) => (m.role === "user" ? USER : "ASSISTANT:") + String((m as any).content))];   // earlier turns count: the customer's own words, and what we already said (it passed the same checks when it was sent)
  const guard: GuardCfg = { maxDiscountPct: Number(g.maxDiscountPct ?? 0), requireGroundedMoney: g.requireGroundedMoney ?? templateName === "tmobile-system" };
  return { party, customer, messages, evidence, guard, agent, org, templateName };
}

/** The prompt lists exactly the tools that exist, generated from the registry, so it can never name a tool the model cannot call. */
export function toolsBlock(tools: Tool[]): string {
  return tools.map((t) => `- ${t.name}: ${t.description.split(/(?<=[.!?])\s/)[0]}`).join("\n");
}

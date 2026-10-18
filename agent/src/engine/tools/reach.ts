import { computeReach, recordPendingText, type Reach } from "../../lines";
import type { Tool, ToolCtx } from "../types";

const PURPOSE_TEXT: Record<string, string> = {
  code: "Customer is moving to text to receive a verification code. When they message, send the code (verify_send_code).",
  form: "Customer is moving to text to receive a secure form. When they message, send the form (forms_send_secure_form).",
  private_details: "Customer is moving to text to give private details. When they message, send a secure form (forms_send_secure_form) instead of taking the details in chat.",
};

/**
 * The message to give the customer, built here rather than left to the model: the exact numbers, in digit groups on a call, with the
 * "different number" explanation. Models tend to skim tool results; handing them the sentence is far more reliable.
 */
export function suggestedReply(r: Reach, mode: "text" | "voice"): string {
  const num = (o: { display: string; spoken: string }) => (mode === "voice" ? o.spoken : o.display);
  const ready = r.options.filter((o) => o.readyNow), waiting = r.options.filter((o) => !o.readyNow);
  if (ready.length) return `I can text you right now from ${num(ready[0])} on ${ready[0].channel === "imessage" ? "iMessage" : "WhatsApp"}. Is that okay?`;
  if (!waiting.length) return "I can't set up a text for you right now, so I'll have someone from the team follow up with you.";
  const im = waiting.find((o) => o.channel === "imessage"), wa = waiting.find((o) => o.channel === "whatsapp");
  const bits: string[] = [];
  if (im) bits.push(`send a quick text on iMessage to ${num(im)}, which is a different number from the one you called`);
  if (wa) bits.push(`${im ? "or " : ""}send a message on WhatsApp to ${num(wa)}`);
  return `To keep your details private, please don't say them out loud. Please ${bits.join(", ")}. Once I see your message, I'll send it to you there.${mode === "voice" ? " Would you like me to repeat the number?" : ""}`;
}

/** What the model gets back: plain language and spoken forms, never anything secret. */
export function reachForModel(r: Reach, mode: "text" | "voice") {
  return {
    say_to_customer: suggestedReply(r, mode),
    call_us: r.voice ? { number: r.voice.display, say: r.voice.spoken } : null,
    text_options: r.options.map((o) => ({ channel: o.channel, number: o.display, say: o.spoken, ready_now: o.readyNow, tell_the_customer: o.howTo })),
    notes: r.notes,
    how_to_use: "Give the customer the 'say_to_customer' message (you may shorten it, but keep every number and say which app). Do not offer to text them anything else until they have messaged that number.",
  };
}

async function reachFor(ctx: ToolCtx) {
  return computeReach({ db: ctx.db, messenger: ctx.messenger, assignIMessage: ctx.env.assignIMessage }, { orgId: ctx.orgId, contact: ctx.party.contact, conversationId: ctx.conversationId });
}

/** Used by the code/form/info tools when nothing can reach the customer right now: hand the model the numbers instead of a dead end. */
export async function reachHint(ctx: ToolCtx, purpose: "code" | "form" | "private_details") {
  const r = await reachFor(ctx);
  if (r.options.length) await recordPendingText(ctx.db, { orgId: ctx.orgId, contactId: ctx.contactId, text: PURPOSE_TEXT[purpose], sourceMessageId: ctx.sourceMessageId, now: ctx.now });
  return { data: reachForModel(r, ctx.mode), reply: suggestedReply(r, ctx.mode) };
}

export const contact_options: Tool = {
  name: "contact_options", risk: "write_low", timeoutMs: 15_000,
  description: "Find out how to reach us and how this customer can continue by text. Returns our phone number (to call), and the iMessage or WhatsApp number to text, with a spoken form of each. Use it when you need private details, a code or a form from someone on a phone call, when the customer asks how to text or message us, or when anyone asks how to call us.",
  parameters: { type: "object", properties: { purpose: { type: "string", enum: ["private_details", "form", "code", "call_us", "general"], description: "why you need it" } } },
  async run(ctx, { purpose }) {
    const r = await reachFor(ctx);
    const wantsText = purpose === "private_details" || purpose === "form" || purpose === "code";
    const noneReady = !r.options.some((o) => o.readyNow);
    let recorded = false;
    if (wantsText && noneReady && r.options.length) recorded = await recordPendingText(ctx.db, { orgId: ctx.orgId, contactId: ctx.contactId, text: PURPOSE_TEXT[purpose], sourceMessageId: ctx.sourceMessageId, now: ctx.now });
    const forced = wantsText && noneReady ? suggestedReply(r, ctx.mode) : undefined;   // the customer must move to text: say exactly which number, do not leave it to the model
    return { ok: true, data: reachForModel(r, ctx.mode), audit: { purpose: purpose ?? "general", options: r.options.map((o) => ({ channel: o.channel, readyNow: o.readyNow })) }, sideEffect: recorded, ...(forced ? { reply: forced } : {}) };
  },
};

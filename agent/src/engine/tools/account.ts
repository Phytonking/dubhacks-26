import { createMethodRequest } from "../../../../web/src/lib/account-core";
import type { Tool, ToolCtx } from "../types";
import { reachHint } from "./reach";

// Changing things on the customer's own account. Only for a recognized, VERIFIED account holder, and only ever on their own account (the account is taken
// from the conversation, never from anything the model says). Every change is written to the account's change log (field names only, never values).
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const PREFS: Record<string, string> = { text: "Text", call: "Phone call", phone: "Phone call", email: "Email" };

const accountOf = (ctx: ToolCtx) => ctx.party.externalRefs.find((r) => r.system === "tmobile" && r.kind === "account");
const guard = (ctx: ToolCtx) => {
  if (!accountOf(ctx)) return { ok: false as const, error: "no_account_linked", data: { hint: "This person has no account on file. Changes like this are for existing customers; help them as a new customer instead." } };
  if (!ctx.customer.verified) return { ok: false as const, error: "not_verified", data: { hint: "Account changes need a verified customer. Texting from their own number verifies them; on a phone call send a code (verify_send_code) first." } };
  return null;
};

export const account_update_payment_method: Tool = {
  name: "account_update_payment_method", risk: "write_high", timeoutMs: 10_000,
  description: "The customer wants to change or update the card on their account. Texts them a private one-time link to a page where they enter the new card (never in chat). You never see the link or the card. When they finish, a message like \"Payment method updated: <brand> ending <last four>\" appears in the thread: confirm it to them.",
  parameters: { type: "object", properties: {} },
  async run(ctx) {
    const blocked = guard(ctx); if (blocked) return blocked;
    const ref = accountOf(ctx)!;
    const req = await createMethodRequest(ctx.db, { orgId: ctx.orgId, contactId: ctx.contactId, conversationId: ctx.conversationId, accountId: ref.id, now: ctx.now });
    const link = `${ctx.env.publicFormsBaseUrl.replace(/\/$/, "")}/pay/method/${req.token}`;
    const sent = await ctx.messenger.send({
      orgId: ctx.orgId, contactId: ctx.contactId, conversationId: ctx.conversationId, purpose: "payment_link", agentTurnId: ctx.turnId,
      body: `${ctx.env.brandFallback}: Update your payment method here: ${link} The link expires in ${req.minutes} minutes. Never send your card number by text. Reply STOP to opt out.`,
      redact: "[secure payment-method link sent]", idempotencyKey: `pm:${req.id}`, implicitConsent: true,
      channels: ctx.channel === "voice" ? undefined : [ctx.channel, "imessage", "whatsapp", "sms"],
    });
    if (!sent.ok) {
      await ctx.db.collection("method_requests").updateOne({ _id: req.id }, { $set: { status: "revoked" } });
      if (sent.error === "no_channel") { const reach = await reachHint(ctx, "form"); return { ok: false, error: "no_channel", data: { hint: "We cannot text them yet. Tell them which number to message, then stop.", ...reach.data }, sideEffect: true, reply: reach.reply }; }
      return { ok: false, error: sent.error };
    }
    return { ok: true, data: { status: "sent", via: sent.channel, expires_in_minutes: req.minutes, next: "Tell them the link is on its way and to enter the new card on that page. Never ask for card details in chat. When the 'Payment method updated' message arrives, confirm it." }, audit: { status: "sent", via: sent.channel }, sideEffect: true };
  },
};

export const account_update_details: Tool = {
  name: "account_update_details", risk: "write_high", redactArgs: true, timeoutMs: 5000,
  description: "Change details on the customer's own account: email, mailing address, preferred way to be contacted, or AutoPay on/off. Pass only what they asked to change, in their words. Applies right away. Never use this for a card (use account_update_payment_method) or for anything about a different person.",
  parameters: { type: "object", properties: {
    email: { type: "string", maxLength: 254 }, mailing_address: { type: "string", maxLength: 300 },
    preferred_contact: { type: "string", enum: ["text", "call", "email"] }, autopay: { type: "boolean", description: "true to turn AutoPay on, false to turn it off" } } },
  async run(ctx, a) {
    const blocked = guard(ctx); if (blocked) return blocked;
    const ref = accountOf(ctx)!;
    const set: Record<string, unknown> = {}; const changed: string[] = [];
    if (a.email != null) { const e = String(a.email).trim(); if (!EMAIL.test(e)) return { ok: false, error: "invalid_email", data: { hint: "That does not look like an email address. Ask them to say it again." } }; set["profile.email"] = e; changed.push("email"); }
    if (a.mailing_address != null) { const m = String(a.mailing_address).trim(); if (m.length < 6) return { ok: false, error: "invalid_address", data: { hint: "Ask for the full mailing address (street, city, state, ZIP)." } }; set["profile.mailingAddress"] = m; changed.push("mailing address"); }
    if (a.preferred_contact != null) { set["context.contact_preference"] = PREFS[String(a.preferred_contact)]; changed.push("preferred contact method"); }
    let autopayNote: string | undefined;
    if (typeof a.autopay === "boolean") {
      set["context.autopay"] = a.autopay; changed.push(`AutoPay ${a.autopay ? "on" : "off"}`);
      if (!a.autopay) autopayNote = "Our listed plan prices assume AutoPay, so without it the monthly price can be higher. Tell them that plainly.";
    }
    if (!changed.length) return { ok: false, error: "nothing_to_change", data: { hint: "Say what to change: email, mailing address, preferred contact method or AutoPay." } };
    await ctx.db.collection("tmo_accounts").updateOne({ orgId: ctx.orgId, accountId: ref.id },
      { $set: { ...set, appliedAt: ctx.now }, $push: { changeLog: { at: ctx.now, by: "agent", what: `changed ${changed.join(", ")}`, turnId: ctx.turnId } } as never });
    await ctx.db.collection("notifications").insertOne({ orgId: ctx.orgId, contactId: ctx.contactId, conversationId: ctx.conversationId, kind: "account_change", message: `Account updated by the customer: ${changed.join(", ")}`, urgency: "low", read: false, createdAt: ctx.now } as never);
    return { ok: true, data: { status: "applied", changed, ...(autopayNote ? { note: autopayNote } : {}), next: "Tell them it is done and what changed, without repeating their email or address back in full." }, audit: { status: "applied", changed }, sideEffect: true };
  },
};

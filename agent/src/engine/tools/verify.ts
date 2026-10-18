import { isVerified } from "../../customer";
import { checkCode, issueCode, markSent, voidCode } from "../../verification";
const alreadyVerified = async (ctx: import("../types").ToolCtx) => isVerified(await ctx.db.collection("contacts").findOne({ _id: ctx.contactId, orgId: ctx.orgId }), ctx.now);
import type { Tool } from "../types";

// The code never appears in: tool results, tool_calls audit rows, agent_turns, stored messages (redacted), or anything the model sees.
export const verify_send_code: Tool = {
  name: "verify_send_code", risk: "write_high", timeoutMs: 10_000,
  description: "Text a 6-digit one-time code to the number you are talking to, so they can prove it is theirs. You never see the code. Only for a recognized customer who wants account details: just send it, do not ask them to text you first and do not ask permission. Not for new people.",
  parameters: { type: "object", properties: {} },
  async run(ctx) {
    if (!ctx.party.externalRefs.some((r) => r.system === "tmobile" && r.kind === "account"))   // verification protects an existing account; a new person has none
      return { ok: false, error: "not_needed", data: { hint: "This person has no account on file, so there is nothing to verify. Help them as a new customer." } };
    if (await alreadyVerified(ctx)) return { ok: true, data: { status: "already_verified", hint: "They are already verified; do not send another code. Answer their question." } };
    const number = ctx.party.address;
    const issued = await issueCode(ctx.db, { orgId: ctx.orgId, contactId: ctx.contactId, number, secret: ctx.env.verifySecret, now: ctx.now });
    if (!issued.ok) return { ok: false, error: issued.error, data: { retryAfterSeconds: issued.retryAfterSec } };
    const brand = ctx.env.brandFallback;
    const sent = await ctx.messenger.send({
      orgId: ctx.orgId, contactId: ctx.contactId, conversationId: ctx.conversationId, purpose: "otp", agentTurnId: ctx.turnId,
      body: `${brand}: Your verification code is ${issued.code}. It expires in 5 minutes. Don't share it with anyone.`,
      redact: "[verification code sent]", idempotencyKey: `otp:${issued.id}`,
      implicitConsent: true,
      channels: ctx.channel === "voice" ? undefined : [ctx.channel, "imessage", "whatsapp", "sms"],
    });
    if (!sent.ok) {
      await voidCode(ctx.db, issued.id);   // never delivered: does not count against the person's limit and cannot be guessed
      if (sent.error === "no_channel") {   // no channel can carry a first message to this person right now (provider limits): say so plainly, do not push the work onto the caller
        const reply = "I'm not able to send a text to this number right now, so I can't open your account details here. I'm happy to help with plans, phones and prices, or I can connect you with a person for your account.";
        return { ok: false, error: "no_channel", data: { hint: "A code could not be delivered. Do not ask the caller to text us. Offer general help or a person." }, audit: { error: "no_channel" }, sideEffect: true, reply };
      }
      const hint = sent.error === "no_consent" ? "Ask if you may text them a code, then call consent_record." : undefined;
      return { ok: false, error: sent.error, data: hint ? { hint } : undefined, audit: { error: sent.error } };
    }
    await markSent(ctx.db, issued.id, sent.channel);
    return { ok: true, data: { status: "sent", via: sent.channel, expires_in_minutes: 5 }, audit: { status: "sent", via: sent.channel }, sideEffect: true };
  },
};

export const verify_check_code: Tool = {
  name: "verify_check_code", risk: "write_low", timeoutMs: 5000, redactArgs: true,
  description: "Check the 6-digit code the customer read back to you (digits or spoken words both work). Tells you only whether it was right.",
  parameters: { type: "object", properties: { code: { type: "string", minLength: 1, maxLength: 60, description: "exactly what the customer said or typed" } }, required: ["code"] },
  async run(ctx, { code }) {
    if (await alreadyVerified(ctx)) return { ok: true, data: { status: "already_verified", hint: "They are already verified. This was not a code; answer what they asked." } };
    const r = await checkCode(ctx.db, { orgId: ctx.orgId, contactId: ctx.contactId, number: ctx.party.address, code, secret: ctx.env.verifySecret, method: `otp_${ctx.channel}`, now: ctx.now });
    const audit = { status: r.status };   // the attempt text is not stored
    if (r.status === "verified") return { ok: true, data: { status: "verified", valid_minutes: 30 }, audit, sideEffect: true };
    if (r.status === "wrong") return { ok: true, data: { status: "wrong", tries_left: r.triesLeft }, audit, sideEffect: true };
    if (r.status === "bad_format") return { ok: true, data: { status: "bad_format", hint: "Ask them to read all six digits again." }, audit };
    return { ok: true, data: { status: r.status, hint: r.status === "none_pending" ? "No code is pending; offer to send one." : "Offer to send a new code or a person." }, audit };
  },
};

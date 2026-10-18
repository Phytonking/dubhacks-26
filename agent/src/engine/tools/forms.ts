import { agentViewOfForm, createFormRequest } from "../../../../web/src/lib/forms-core";
import { FORM_KEYS, FORM_TEMPLATES } from "../../../../web/src/lib/form-templates";
import type { Tool } from "../types";

export const forms_send_secure_form: Tool = {
  name: "forms_send_secure_form", risk: "write_high", timeoutMs: 10_000,
  description: `Text the customer a private link to a form for details that should not be said aloud or typed into chat. Available forms: ${FORM_KEYS.map((k) => `${k} (${FORM_TEMPLATES[k].title})`).join("; ")}. You never see the link or the sensitive answers.`,
  parameters: { type: "object", properties: { template: { type: "string", enum: FORM_KEYS } }, required: ["template"] },
  async run(ctx, { template }) {
    const req = await createFormRequest(ctx.db, { orgId: ctx.orgId, contactId: ctx.contactId, conversationId: ctx.conversationId, template, now: ctx.now });
    const link = `${ctx.env.publicFormsBaseUrl.replace(/\/$/, "")}/f/${req.token}`;
    const sent = await ctx.messenger.send({
      orgId: ctx.orgId, contactId: ctx.contactId, conversationId: ctx.conversationId, purpose: "form_link", agentTurnId: ctx.turnId,
      body: `${ctx.env.brandFallback}: Here is your private form: ${link} It expires in ${req.template.expiryMinutes} minutes. Reply STOP to opt out.`,
      redact: "[secure form link sent]", idempotencyKey: `form:${req.id}`,
      channels: ctx.channel === "voice" ? undefined : [ctx.channel, "imessage", "whatsapp", "sms"],
    });
    if (!sent.ok) {
      await ctx.db.collection("form_requests").updateOne({ _id: req.id }, { $set: { status: "revoked" } });
      return { ok: false, error: sent.error, data: sent.error === "no_consent" ? { hint: "Ask if you may text them a link, then call consent_record." } : undefined };
    }
    return { ok: true, data: { status: "sent", via: sent.channel, expires_in_minutes: req.template.expiryMinutes }, audit: { status: "sent", template, via: sent.channel }, sideEffect: true };
  },
};

export const forms_status: Tool = {
  name: "forms_status", risk: "read", timeoutMs: 3000,
  description: "Check whether the customer has completed a form you sent. You see only that it is done plus non-sensitive answers.",
  parameters: { type: "object", properties: { template: { type: "string", enum: FORM_KEYS } }, required: ["template"] },
  async run(ctx, { template }) {
    return { ok: true, data: await agentViewOfForm(ctx.db, ctx.orgId, ctx.contactId, template) };
  },
};

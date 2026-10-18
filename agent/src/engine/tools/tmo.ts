import type { Tool } from "../types";

const usd = (c: number | null | undefined) => (c == null ? null : `$${(c / 100).toFixed(2)}`);

// Read-only account context from the T-Mobile data imported into Atlas (tmo_accounts). Field names follow the import's `context` object.
// Requires a verified customer: enforced by the executor, not by the prompt. Internal churn signals are deliberately NOT returned.
export const tmo_context: Tool = {
  name: "tmo_context", risk: "read", requiresVerified: true, timeoutMs: 4000,
  description: "Get this verified customer's account: lines, plans, devices and financing, services, latest bill, recent support. Use before answering anything account-specific.",
  parameters: { type: "object", properties: {} },
  async run(ctx) {
    const ref = ctx.party.externalRefs.find((r) => r.system === "tmobile" && r.kind === "account");
    if (!ref) return { ok: false, error: "no_account_linked", data: { hint: "This person has no account on file; treat them as a prospect." } };
    const doc: any = await ctx.db.collection("tmo_accounts").findOne({ orgId: ctx.orgId, accountId: ref.id }, { projection: { context: 1, asOf: 1 } });
    const c = doc?.context;
    if (!c) return { ok: false, error: "account_data_unavailable" };
    const names = new Map<string, string>(((ctx.party.contact as any).profile?.household ?? []).map((h: any) => [h.lineId, h.name]));
    return { ok: true, data: {
      as_of: c.as_of ?? doc.asOf ?? null, segment: c.segment, tenure_months: c.tenure_months, credit_tier: c.credit_tier, autopay: Boolean(c.autopay),
      lines: (c.lines ?? []).map((l: any) => ({
        who: names.get(l.line_id) ?? l.member_label, role: l.member_role, plan: l.plan_name, data_cap_gb: l.plan_data_cap_gb ?? null, protected: Boolean(l.has_protection),
        device: l.device ? { name: l.device.name, age_months: l.device.age_months } : "own phone",
        financing: l.financing ? (l.financing.paid_off ? { paid_off: true } : { balance: usd(l.financing.balance_cents), months_remaining: l.financing.months_remaining }) : null,
      })),
      services: (c.services ?? []).map((s: any) => ({ name: s.name, monthly: usd(s.monthly_cents) })),
      active_deals: (c.deals ?? []).filter((d: any) => d.status === "active").map((d: any) => ({ plan: d.plan, lines: d.lines, monthly_total: usd(d.monthlyCents), monthly_credit: d.creditCents ? usd(d.creditCents) : null, ends: d.endsAt ? new Date(d.endsAt).toISOString().slice(0, 10) : null })),
      bill: c.billing ? { latest_total: usd(c.billing.latest_total_cents), change_vs_recent_average_pct: c.billing.change_pct_vs_prior_avg != null ? Math.round(c.billing.change_pct_vs_prior_avg * 1000) / 10 : null } : null,
      support_last_90_days: c.support ? { contacts: c.support.contacts_90d, unresolved: c.support.unresolved_90d, last_contact: c.support.last_contact_date ?? null } : null,
    } };
  },
};

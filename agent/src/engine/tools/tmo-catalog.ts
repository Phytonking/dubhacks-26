import type { Tool } from "../types";

const usd = (c: number | null | undefined) => (c == null ? null : `$${(c / 100).toFixed(2).replace(/\.00$/, "")}`);
/** Exact name first, then names that start with the query, then shorter names: "Pixel 10 Pro" must not come back as "Pixel 10 Pro XL". */
const byMatch = (q: string) => { const k = q.trim().toLowerCase(); const rank = (n: string): number => { const x = n.toLowerCase(); return x === k ? 0 : x.startsWith(k) ? 1 : 2; }; return (a: any, b: any) => rank(a.name) - rank(b.name) || a.name.length - b.name.length; };
const rx = (q: string) => new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").split(/\s+/).join(".*"), "i");

/** Monthly total for N lines from the plan's marginal line prices. Done here so the model never adds prices itself. */
export function planTotalCents(linePrices: number[], extraLineCents: number, lines: number): number {
  let t = 0;
  for (let i = 0; i < lines; i++) t += linePrices[i] ?? extraLineCents;
  return t;
}

function promoConditions(p: any): string[] {
  const c: string[] = [];
  if (p.requiresNewLine) c.push("a new line");
  if (p.requiresPortIn) c.push("moving a number in from another carrier");
  if (p.requiresTradein) c.push("a trade-in");
  if (p.newLineOrTradein) c.push("a new line or a trade-in");
  if (p.requiresDevice) c.push("buying a device");
  if (p.requiresByod) c.push("bringing your own phone");
  if (p.planFamilies?.length) c.push(`plan: ${p.planFamilies.join(" or ").replace(/_/g, " ")}`);
  if (p.minPlanCents) c.push(`plan of at least ${usd(p.minPlanCents)}/mo`);
  if (p.minLines) c.push(`at least ${p.minLines} lines`);
  if (p.minTenureMonths) c.push(`customer for ${p.minTenureMonths}+ months`);
  if (p.minDeviceAgeMonths) c.push(`current phone ${p.minDeviceAgeMonths}+ months old`);
  return c;
}

export const tmo_catalog: Tool = {
  name: "tmo_catalog", risk: "read", timeoutMs: 4000,
  description: "Look up the public catalog: plans (with the exact monthly total for a number of lines), phones (price, and trade-in estimate for a phone of a given age), promotions (value and conditions) and add-ons. Works for anyone, no verification needed. Use it for every price, fee or promo question instead of answering from memory.",
  parameters: { type: "object", properties: {
    kind: { type: "string", enum: ["plans", "devices", "promotions", "addons"] },
    query: { type: "string", description: "words from the name, e.g. 'iPhone 17' or 'protection' or 'Beyond'" },
    lines: { type: "integer", minimum: 1, maximum: 12, description: "plans: how many lines to price" },
    age_months: { type: "integer", minimum: 0, maximum: 120, description: "devices: age of the phone being traded in" },
    toward: { type: "string", description: "devices: the phone they want to buy, to get the price after the trade-in estimate" },
    limit: { type: "integer", minimum: 1, maximum: 8 },
  }, required: ["kind"] },
  async run(ctx, a) {
    const limit = Math.min(Number(a.limit ?? 5), 8); const q = a.query ? rx(String(a.query)) : null;
    const col = (n: string) => ctx.db.collection(n);
    if (a.kind === "plans") {
      const rows: any[] = await col("tmo_plans").find({ orgId: ctx.orgId, status: "current", ...(q ? { name: q } : {}) }).toArray();
      const n = Number(a.lines ?? 1);
      const fits = rows.filter((p) => n >= (p.minLines ?? 1) && (p.maxLines == null || n <= p.maxLines));
      const shown = (fits.length ? fits : rows).sort(q ? byMatch(String(a.query)) : () => 0).slice(0, limit);
      const cheapest = Math.min(...shown.map((p) => planTotalCents(p.linePrices ?? [], p.extraLineCents ?? 0, n)));
      const out = shown.map((p) => ({
        plan: p.name, lines_priced: n, fits_that_many_lines: n >= (p.minLines ?? 1) && (p.maxLines == null || n <= p.maxLines),
        monthly_total: usd(planTotalCents(p.linePrices ?? [], p.extraLineCents ?? 0, n)),
        ...(shown.length > 1 ? { more_per_month_than_the_cheapest_shown: usd(planTotalCents(p.linePrices ?? [], p.extraLineCents ?? 0, n) - cheapest) } : {}), assumes_autopay: Boolean(p.pricesIncludeAutopay),
        per_line: (p.linePrices ?? []).slice(0, n).map(usd), data: p.dataCapGb ? `${p.dataCapGb} GB premium data` : "premium data unlimited",
        hotspot_high_speed_gb: p.hotspotHighSpeedGb ?? null, canada_mexico_gb: p.canadaMexicoGb, intl_data_gb: p.intlDataGb, video: p.videoQuality,
        price_guarantee_years: p.priceGuaranteeYears, connection_charge_per_line: usd(p.deviceConnectionCents), perks: p.perks ?? [], limits: p.maxLines != null ? `${p.minLines ?? 1}-${p.maxLines} lines` : "any number of lines",
      }));
      return { ok: true, data: { results: out, note: "monthly_total is exact (sum of per-line prices); say whether it assumes AutoPay" } };
    }
    if (a.kind === "devices") {
      const rows: any[] = (await col("tmo_devices").find({ orgId: ctx.orgId, ...(q ? { name: q } : { status: "current" }) }).limit(60).toArray()).sort(q ? byMatch(String(a.query)) : () => 0);
      const age = a.age_months == null ? null : Number(a.age_months);
      const est = (d: any) => (age != null && d.tradeinCurve?.length ? d.tradeinCurve[Math.min(age, d.tradeinCurve.length - 1)] : null);
      let target: any = null;
      if (a.toward) { const t: any[] = (await col("tmo_devices").find({ orgId: ctx.orgId, name: rx(String(a.toward)) }).limit(30).toArray()).sort(byMatch(String(a.toward))); target = t[0] ?? null; }
      const first = rows[0] ? est(rows[0]) : null;
      return { ok: true, data: { results: rows.slice(0, limit).map((d) => ({
        device: d.name, maker: d.manufacturer, price: usd(d.msrpCents), status: d.status, released: d.releaseDate,
        ...(est(d) != null ? { estimated_trade_in_value_for_a_phone_this_old: usd(est(d)), phone_age_months: age } : {}),
      })), ...(target ? { buying: { device: target.name, price: usd(target.msrpCents), ...(first != null ? { price_after_the_estimated_trade_in: usd(Math.max(0, target.msrpCents - first)), trade_in_used: rows[0].name } : {}) } } : {}),
      note: "A trade-in figure is an estimate for a phone in good condition; the final value is set when the phone is checked. Quote these figures exactly; do not do your own arithmetic." } };
    }
    if (a.kind === "promotions") {
      const rows: any[] = await col("tmo_promotions").find({ orgId: ctx.orgId, ...(q ? { name: q } : {}) }).limit(limit).toArray();
      return { ok: true, data: { results: rows.map((p) => ({ promotion: p.name, kind: p.kind, value: p.percentOff != null ? `${p.percentOff}% off` : usd(p.valueCents), paid_as_bill_credits_over_months: p.payoutMonths ?? null, per: p.per, max_units: p.maxUnits, conditions: promoConditions(p), description: p.description })),
        note: "These are the conditions only. You have not checked THIS customer against them. Describe them plainly and say a person confirms final eligibility; do not say the customer qualifies." } };
    }
    const rows: any[] = await col("tmo_addons").find({ orgId: ctx.orgId, ...(q ? { name: q } : {}) }).limit(limit).toArray();
    return { ok: true, data: { results: rows.map((x) => ({ add_on: x.name, kind: x.kind, monthly: usd(x.monthlyCents), one_time: x.oneTimeCents ? usd(x.oneTimeCents) : null, per: x.per, about: x.description,
      deductible_screen: usd(x.deductibleScreenCents), deductible_damage: usd(x.deductibleDamageCents), deductible_loss_theft: usd(x.deductibleLossTheftCents) })) } };
  },
};

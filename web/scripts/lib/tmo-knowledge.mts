// @ts-nocheck  (one-off CLI: node:sqlite types need @types/node 22+; tsx runs it fine)
// Turns the migrated T-Mobile catalog into short knowledge rows the agent can keyword-search.
// Rows are small on purpose (the whole set travels with every turn) and put plan/device names in titles for retrieval.
type R = Record<string, any>;
export type KRow = { kind: "catalog" | "faq"; title: string; content: string; ref: string };

const $ = (c: number | null | undefined) => (c == null ? "n/a" : `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`);
const list = (a: string[] | null | undefined) => (a && a.length ? a.join(", ") : "");

function planTotals(p: R) {
  return [1, 2, 3, 4, 5].filter((n) => n >= p.minLines && (p.maxLines == null || n <= p.maxLines)).map((n) => {
    const parts = Array.from({ length: n }, (_, i) => p.linePrices[i] ?? p.extraLineCents);
    return `${n} line${n > 1 ? "s" : ""} ${$(parts.reduce((s: number, x: number) => s + x, 0))}/mo`;
  }).join("; ");
}

function promoConditions(p: R, nameOf: (sku: string) => string): string[] {
  const c: string[] = [];
  if (p.newLineOrTradein) c.push("needs a new line or a trade-in");
  else {
    if (p.requiresNewLine) c.push("needs a new line");
    if (p.requiresTradein) c.push("needs a trade-in");
  }
  if (p.requiresPortIn) c.push("the new line must bring a number from another carrier");
  if (p.requiresByod) c.push("new line with the customer's own phone");
  if (p.requiresDevice && !p.deviceSkus?.length) c.push("needs a phone in the order");
  if (p.deviceSkus?.length) c.push(`on: ${p.deviceSkus.map(nameOf).join(", ")}`);
  if (p.planFamilies?.length) c.push(`plan family: ${p.planFamilies.join(" or ").replaceAll("_", " ")}`);
  if (p.planVariants?.length) c.push(`plan variant: ${p.planVariants.join(" or ").replaceAll("_", " ")}`);
  if (p.minPlanCents) c.push(`first line of the plan must cost at least ${$(p.minPlanCents)}/mo`);
  if (p.discountPlanOnly) c.push("55+, Partner or Community plan only");
  if (p.discountGroups?.length) c.push(`for ${p.discountGroups.join(", ")} accounts`);
  if (p.creditTiers?.length) c.push(`credit tier: ${p.creditTiers.join(", ")}`);
  if (p.minLines > 1) c.push(`at least ${p.minLines} lines`);
  if (p.minTenureMonths) c.push(`at least ${p.minTenureMonths} months as a customer`);
  if (p.minDeviceAgeMonths) c.push(`traded-in phone at least ${p.minDeviceAgeMonths} months old`);
  if (p.minSupportContacts90d) c.push(`${p.minSupportContacts90d}+ support contacts in the last 90 days`);
  if (p.requiresAddonKind) c.push(`needs a ${String(p.requiresAddonKind).replaceAll("_", " ")} add-on`);
  if (p.minAccessories) c.push(`at least ${p.minAccessories} accessories`);
  return c;
}

export function buildKnowledge({ plans, devices, addons, promos, asOf }: { plans: R[]; devices: R[]; addons: R[]; promos: R[]; asOf: string }): KRow[] {
  const out: KRow[] = [];
  const devName = new Map(devices.map((d) => [d.sku, d.name]));
  const nameOf = (sku: string) => devName.get(sku) ?? sku;
  const stub = `Sandbox data as of ${asOf}.`;

  for (const p of plans) {
    const bits = [
      `${p.name} (${p.family.replaceAll("_", " ")}, ${p.variant.replaceAll("_", " ")}${p.status === "limited_time" ? ", limited time" : ""}).`,
      `Monthly total by line count: ${planTotals(p)}. Marginal line prices: ${p.linePrices.map($).join(", ")}, then ${$(p.extraLineCents)} for each extra line.${p.pricesIncludeAutopay ? " Prices assume AutoPay." : ""}`,
      p.minLines > 1 || p.maxLines != null ? `Lines allowed: ${p.minLines}${p.maxLines != null ? `-${p.maxLines}` : "+"}.` : "",
      p.eligibility ? `Only for accounts with discount group ${p.eligibility}.` : "",
      `Premium data: ${p.dataCapGb ? `${p.dataCapGb} GB` : "unlimited"}. Hotspot: ${p.hotspotHighSpeedGb ? `${p.hotspotHighSpeedGb} GB high-speed` : "none at high speed"}${p.hotspotUnlimited ? ", then unlimited at reduced speed" : ""}.`,
      p.canadaMexicoGb ? `Canada/Mexico data ${p.canadaMexicoGb} GB.` : "", p.intlDataGb ? `International data ${p.intlDataGb} GB (215+ countries).` : "",
      p.videoQuality ? `Streaming up to ${p.videoQuality}.` : "", p.priceGuaranteeYears ? `${p.priceGuaranteeYears}-year price guarantee.` : "",
      p.perks.length ? `Perks: ${p.perks.join(", ")}.` : "", p.upgradeNote ? `Upgrades: ${p.upgradeNote}.` : "",
      p.deviceConnectionCents ? `Connection charge ${$(p.deviceConnectionCents)} per line.` : "",
      stub,
    ].filter(Boolean);
    out.push({ kind: "catalog", title: `Plan: ${p.name}`, content: bits.join(" "), ref: `plan:${p.sku}` });
  }

  for (const p of promos) {
    const cond = promoConditions(p, nameOf);
    const value = p.kind === "bill_credit" ? `${$(p.valueCents)}/mo bill credit${p.payoutMonths ? ` for ${p.payoutMonths} months` : ", ongoing"}`
      : p.kind === "accessory_discount" ? `${p.percentOff}% off accessories`
      : `${$(p.valueCents)} ${p.kind.replaceAll("_", " ")}${p.payoutMonths ? ` over ${p.payoutMonths} months` : ""}`;
    out.push({
      kind: "catalog", title: `Offer: ${p.name}`, ref: `promo:${p.sku}`,
      content: `${value}. ${p.description ?? ""} Applies per ${p.per}${p.maxUnits ? `, up to ${p.maxUnits}` : ""}. Conditions: ${cond.length ? cond.join("; ") : "none beyond being an active customer"}. ${p.source === "stub" ? "Invented retention offer for this sandbox." : "Modeled on a published offer."} Eligibility for a specific customer is decided per cart; do not promise it.`.replace(/\s+/g, " "),
    });
  }

  const prot = addons.filter((a) => a.kind === "protection").sort((a, b) => a.protectionTier - b.protectionTier);
  const tierBand = new Map<number, string[]>();
  for (const d of devices.filter((x) => x.status === "current")) (tierBand.get(d.protectionTier) ?? tierBand.set(d.protectionTier, []).get(d.protectionTier)!).push(d.msrpCents);
  out.push({
    kind: "catalog", title: "Device protection tiers and prices", ref: "addons:protection",
    content: `Protection must match the phone's tier (per device, monthly). ${prot.map((a) => {
      const prices = tierBand.get(a.protectionTier) ?? [];
      const band = prices.length ? `phones ${$(Math.min(...prices as any))}-${$(Math.max(...prices as any))}` : "older phones";
      return `Tier ${a.protectionTier}: ${$(a.monthlyCents)}/mo (${band}; deductibles screen ${$(a.deductibleScreenCents)}, damage ${$(a.deductibleDamageCents)}, loss/theft ${$(a.deductibleLossTheftCents)})`;
    }).join(". ")}. Deductibles are illustrative. ${stub}`,
  });
  for (const kind of ["streaming", "connected_line", "home_internet"]) {
    const rows = addons.filter((a) => a.kind === kind);
    out.push({
      kind: "catalog", title: `Add-ons: ${kind.replaceAll("_", " ")}`, ref: `addons:${kind}`,
      content: rows.map((a) => `${a.name}: ${$(a.monthlyCents)}/mo${a.oneTimeCents ? ` + ${$(a.oneTimeCents)} one-time` : ""} per ${a.per}. ${a.description ?? ""}${a.eligibleFamilies.length ? ` Only on ${a.eligibleFamilies.join(", ").replaceAll("_", " ")}.` : ""}`).join(" ") + ` ${stub}`,
    });
  }
  const acc = addons.filter((a) => a.kind === "accessory");
  out.push({
    kind: "catalog", title: "Accessories (cases, screen protectors, chargers)", ref: "addons:accessory",
    content: acc.map((a) => `${a.name} ${$(a.oneTimeCents)}${a.compatibleDeviceSkus.length ? ` (fits ${a.compatibleDeviceSkus.slice(0, 3).map(nameOf).join(", ")}${a.compatibleDeviceSkus.length > 3 ? ` +${a.compatibleDeviceSkus.length - 3} more` : ""})` : ""}`).join("; ") + `. Bundle offers apply when 3+ accessories are in the cart. ${stub}`,
  });

  const byMaker = new Map<string, R[]>();
  for (const d of devices.filter((x) => x.status === "current")) (byMaker.get(d.manufacturer) ?? byMaker.set(d.manufacturer, []).get(d.manufacturer)!).push(d);
  for (const [maker, ds] of byMaker) {
    out.push({
      kind: "catalog", title: `Phones: ${maker}`, ref: `devices:${maker}`,
      content: ds.sort((a, b) => b.msrpCents - a.msrpCents).map((d) => `${d.name} ${$(d.msrpCents)} (${d.tier}, protection tier ${d.protectionTier})`).join("; ") + `. Full retail price shown; financing spreads it over 24 months by credit tier. ${stub}`,
    });
  }

  const rules: [string, string][] = [
    ["Financing by credit tier", "Phones are financed over 24 months by default. Prime: 0% APR, nothing down. Near-prime: 4.9% APR, 10% down. Subprime: 9.9% APR, 20% down. Paying in full charges the whole price today. Due today = minimum down payment; the rest is monthly."],
    ["Trade-in rules", "Trade-in credit applies to the first phone in the cart; any leftover is reported as unapplied. A phone's value falls with age (good condition; fair and poor are lower). A phone that is still being paid off charges its remaining balance today and its old monthly installment stops. A paid-off phone owes nothing. A line's phone can be traded in once."],
    ["Upgrade eligibility", "Sandbox rule: a line is upgrade-eligible when its phone has been owned 12+ months (half of a 24-month installment). Within 3 months of buying a phone, most of it is still owed: say what trading it in would charge today before suggesting an upgrade, and consider recommending waiting."],
    ["Changing plans and adding lines", "A plan change charges the difference from the line's current plan; the monthly change can be negative on a downgrade. A new line is priced by its position in the household using the plan's per-line table, so each extra line costs less. All lines on an account share one plan. New lines in the cart count toward plan limits: add them before moving existing lines onto the 4 Line Offer."],
    ["Discount plans and line limits", "55+, Partner and Community plans are sold only to accounts with a matching discount group. 55+ and Saver plans allow at most 2 lines. The Essentials 4 Line Offer needs 4 or more lines. Student accounts have their own discount group for student offers."],
    ["Promotions and conflicts", "Each offer has conditions (new line, port-in, trade-in, specific phone, plan, tenure, lines, credit tier, support contacts). Only one device-attached offer applies per phone at checkout; the most valuable assignment is used. Savings are estimates (a monthly credit counts for 12 months) and are not subtracted from cart totals. Never promise an offer without checking eligibility for that customer and cart."],
    ["Device protection rules", "Protection covers one real phone and its tier must match the phone's tier. A phone cannot be covered twice. The streaming add-on needs an Experience More or Beyond plan; the Beyond connected-device line needs a Beyond plan."],
    ["Why a bill changed", "Bill change reasons in account data: device_installment (a new phone's payment started), installment_ended (a phone is paid off and the bill fell), promo_expired (a discount ended and the bill rose to list price), stable (normal small movement). A bill is plans + protection + add-ons + device installments, minus a $15 Home Internet bundle credit for accounts with both Home Internet and a phone line."],
    ["When to hand off to a person", "Offer a human for: cancellations, switching carriers or port-out requests, billing disputes, fraud, repeated unresolved support contacts, anything the customer is upset about, or when they ask for a person. For at-risk customers prefer a human check-in over a discount."],
    ["Sandbox and honesty rules", "All prices, plans and offers here are synthetic stand-ins for a hackathon, not real T-Mobile offers. Do not state a price, discount or eligibility that is not in this knowledge or the customer's account data. If unsure, say you will check. Orders are mock: nothing is ever charged."],
    ["Account data freshness", `Customer account facts (lines, devices, bills, support history) are as of ${asOf}. Quote them with the date. Usage and bills are monthly; support history covers the last 270 days.`],
  ];
  for (const [title, content] of rules) out.push({ kind: "faq", title, content, ref: `rule:${title}` });

  return out;
}

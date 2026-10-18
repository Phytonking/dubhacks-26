import type { Db, ObjectId } from "mongodb";

// Builds the CUSTOMER section of the agent prompt from Atlas: the contact's character sheet + memory (contacts)
// and, for T-Mobile account holders, the account context imported into tmo_accounts. Returns null for contacts with
// no external ref (every other tenant), so non-T-Mobile agents are unaffected.
const $ = (c: number | null | undefined) => (c == null ? "n/a" : `$${(c / 100).toFixed(2)}`);

type Contact = { _id: ObjectId; name?: string; facts?: { text: string; learnedAt?: Date }[]; externalRefs?: { system: string; id: string; kind: string }[]; profile?: any; memory?: any };

export async function loadCustomerSection(db: Db, orgId: ObjectId, contact: Contact | null | undefined, channel?: string): Promise<string | null> {
  const ref = contact?.externalRefs?.find((r) => r.system === "tmobile");
  if (!contact || !ref) return null;
  // contacts created when a real number first links to an account have no profile of their own: use the account's
  const acctDoc = ref.kind === "account" ? await db.collection("tmo_accounts").findOne({ orgId, accountId: ref.id }, { projection: { context: 1, profile: 1 } }) : null;
  const p = contact.profile ?? acctDoc?.profile ?? {};
  const out: string[] = [];
  out.push(`Name: ${p.displayName ?? contact.name ?? "unknown"}. Language: ${p.language ?? "en"}. Tone to use: ${p.tone ?? "friendly and concise"}. Relationship: ${p.relationship ?? "unknown"}.`);
  if (p.household?.length > 1) out.push(`Household: ${p.household.map((h: any) => `${h.name} (${h.label})`).join(", ")}.`);

  if (ref.kind === "account") {
    const c = acctDoc?.context;
    if (c) {
      out.push(`ACCOUNT ${c.account_id} (data as of ${c.as_of}): ${c.segment}, ${Math.floor(c.tenure_months / 12)}y ${c.tenure_months % 12}m customer, credit ${c.credit_tier}, AutoPay ${c.autopay ? "on" : "off"}${c.discount_group ? `, discount group ${c.discount_group}` : ""}.`);
      const name = new Map<string, string>((p.household ?? []).map((h: any) => [h.lineId, h.name]));
      for (const l of c.lines) {
        const dev = l.device
          ? `${l.device.name}, ${l.device.age_months} months old${l.financing?.paid_off ? ", paid off" : `, ${$(l.financing?.balance_cents)} left over ${l.financing?.months_remaining} months (${$(l.financing?.monthly_installment_cents)}/mo)`}`
          : "own phone (BYOD)";
        out.push(`- ${name.get(l.line_id) ?? l.member_label} (${l.member_role}): ${l.plan_name}${l.plan_data_cap_gb ? `, ${l.plan_data_cap_gb} GB cap` : ""}; ${dev}; ${l.has_protection ? "protected" : "no protection"}; ${l.upgrade_eligible ? "upgrade-eligible" : "not upgrade-eligible"}${l.estimated_tradein_value_cents != null ? `; trade-in about ${$(l.estimated_tradein_value_cents)}` : ""}; ~${l.usage_3m_avg_gb ?? "?"} GB/mo.`);
      }
      if (c.services.length) out.push(`Services: ${c.services.map((s: any) => `${s.name} ${$(s.monthly_cents)}/mo`).join(", ")}.`);
      if (c.billing) out.push(`Bill: ${$(c.billing.latest_total_cents)} latest${c.billing.change_pct_vs_prior_avg != null ? `, ${(c.billing.change_pct_vs_prior_avg * 100).toFixed(1)}% vs prior average` : ""}.`);
      out.push(`Support last 90 days: ${c.support.contacts_90d} contact(s), ${c.support.unresolved_90d} unresolved; last contact ${c.support.last_contact_date ?? "never"}.`);
      if (c.signals && (c.signals.port_out_inquiry || c.signals.competitor_research_score > 0.5))
        out.push(`Signals: ${c.signals.port_out_inquiry ? "asked about porting out; " : ""}competitor research ${c.signals.competitor_research_score}.`);
    }
  }
  if (p.sensitivities?.length) out.push("Handle with care: " + p.sensitivities.join(" "));
  const facts = (contact.facts ?? []).slice(-15).map((f) => f.text);
  if (facts.length) out.push("They have told us: " + facts.join(" | "));
  const m = contact.memory ?? {};
  if (m.summary) out.push("Conversation so far: " + m.summary);
  const loops = (m.openLoops ?? []).filter((o: any) => o.status !== "done");
  if (loops.length) out.push("Open items we promised: " + loops.map((o: any) => o.text).join(" | "));
  if (p.backstory) out.push(`Background (invented colour, not account fact): ${p.backstory}`);
  if (channel === "voice" && p.voice?.notes?.length) out.push("Voice notes: " + p.voice.notes.join(" "));
  if (p.goal) out.push(`Likely situation (hypothesis; never state it as fact): ${p.goal}`);
  return out.join("\n");
}

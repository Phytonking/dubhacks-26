import type { ObjectId } from "mongodb";
import { getDb } from "./db";

// Read side for the Selldial console: T-Mobile sandbox data migrated into Atlas (tmo_* collections, see tmo-schema.ts). Every query takes orgId.

export async function hasTmoData(orgId: ObjectId) {
  const db = await getDb();
  return (await db.collection("tmo_meta").countDocuments({ orgId })) > 0;
}

// ---- console (public/selldial) customers: the T-Mobile households + prospects, shaped for its Customers screen ----
const REL_STATUS: Record<string, string> = { loyal: "Loyal", steady: "Active", "at-risk": "At risk", new: "Prospect" };
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function listTmoConsoleCustomers(orgId: ObjectId, limit = 500) {
  const db = await getDb();
  const [accounts, prospects, contacts] = await Promise.all([
    db.collection("tmo_accounts").find({ orgId }).sort({ personaOnly: -1, accountId: 1 }).limit(limit).toArray(),
    db.collection("tmo_personas").find({ orgId, kind: "prospect" }).toArray(),
    db.collection("contacts").find({ orgId, "externalRefs.system": "tmobile" }, { projection: { name: 1, handles: 1, externalRefs: 1, profile: 1, facts: 1 } }).toArray(),
  ]);
  const contactByRef = new Map<string, any>(contacts.map((c: any) => [c.externalRefs[0].id, c]));
  const personaByAccount = new Map<string, any>((await db.collection("tmo_personas").find({ orgId, kind: "customer" }).toArray()).map((p: any) => [p.accountId, p]));
  const short = (n: string) => { const p = n.trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0].toUpperCase()}.` : p[0]; };
  const phone = (c: any) => { const d = String(c?.handles?.[0]?.address ?? "").replace(/\D/g, "").slice(-10); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : "—"; };
  const out: any[] = [];
  for (const a of accounts as any[]) {
    const p = a.profile ?? {}, x = a.context ?? {}, persona = personaByAccount.get(a.accountId), contact = contactByRef.get(a.accountId);
    const lines = (x.lines ?? []) as any[];
    out.push({
      id: a.accountId, name: short(p.fullName ?? p.displayName ?? a.accountId), phone: phone(contact), region: p.region ?? "Unknown",
      status: REL_STATUS[p.relationship] ?? "Active",
      tmo: {
        account_id: a.accountId, persona: persona ? { title: persona.title, theme: persona.primaryTheme, scenario: persona.scenario } : null,
        segment: a.segment, tenure_months: a.tenureMonths, credit_tier: a.creditTier, autopay: Boolean(a.autopay), discount_group: a.discountGroup ?? null,
        language: p.voice?.language ?? a.language, relationship: p.relationship, tone: p.tone, channel_pref: p.channelPref,
        household: (p.household ?? []).map((h: any) => ({ name: h.name, label: h.label, role: h.role })),
        plan: lines[0]?.plan_name ?? null, line_count: lines.length, bill_cents: x.billing?.latest_total_cents ?? null,
        bill_change_pct: x.billing?.change_pct_vs_prior_avg ?? null,
        financing_cents: lines.reduce((n: number, l: any) => n + (l.financing?.balance_cents ?? 0), 0),
        devices: lines.map((l: any) => (l.device ? `${l.device.name} (${l.device.age_months} mo${l.financing?.paid_off ? ", paid off" : ""})` : "Own phone")),
        upgrade_lines: x.eligibility?.upgrade_eligible_lines ?? 0, support_90d: x.support?.contacts_90d ?? null, unresolved_90d: x.support?.unresolved_90d ?? null,
        sensitivities: p.sensitivities ?? [], backstory: p.backstory ?? "", backstory_source: p.backstorySource ?? "rule", voice_notes: p.voice?.notes ?? [],
        facts: (contact?.facts ?? []).map((f: any) => f.text),
      },
    });
  }
  for (const pr of prospects as any[]) {
    const contact = contactByRef.get(pr.personaId), p = contact?.profile ?? {};
    out.push({
      id: pr.personaId, name: short(p.fullName ?? contact?.name ?? pr.personaId), phone: phone(contact), region: p.region ?? "Unknown", status: "Prospect",
      tmo: {
        account_id: null, persona: { title: pr.title, theme: pr.primaryTheme, scenario: pr.scenario }, segment: "prospect", language: p.voice?.language ?? "en",
        relationship: "new", tone: p.tone, channel_pref: p.channelPref, household: [], plan: null, line_count: pr.statedLines ?? null, bill_cents: pr.statedBudgetCents ?? null,
        devices: [], sensitivities: [], backstory: p.backstory ?? "", backstory_source: p.backstorySource ?? "rule", voice_notes: p.voice?.notes ?? [],
        facts: (contact?.facts ?? []).map((f: any) => f.text),
      },
    });
  }
  return out;
}

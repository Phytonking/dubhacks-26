import type { Db } from "mongodb";
import type { Party } from "./identity";
import { missingIntake } from "./engine/tools/intake";

// Who are we talking to, what do we know, and what may the model SEE?
//  - The prompt asks the model to be careful; the tool layer ENFORCES it. This module also keeps account details out of the prompt
//    until the person is verified, so a prompt injection cannot extract what was never there.
export type Customer = {
  status: "linked_account" | "prospect" | "unknown";
  refs: Party["externalRefs"];
  firstName: string | null;
  profile: Record<string, any> | null;
  facts: string[];
  openLoops: string[];
  verified: boolean;
  verifiedAt: Date | null;
  negotiation: { round: number; plan: string; lines: number; lastCreditCents: number; gives: string[]; at: Date } | null;   // open negotiation (last 24h)
  offers: { summary: string; at: Date }[];                                                                                      // concessions already agreed
  canText: boolean;                       // they have agreed to texts (said so, or texted us)
  intake: Record<string, any> | null;   // what they have told us about themselves (contacts.intake)
  channels: string[];                 // channels this person has used (from their handles)
  account: { asOf: string | null; segment: string | null; tenureMonths: number | null; lineCount: number; lineRoles: string[]; supportContacts90d: number | null; billChangePct: number | null; internal: string[] } | null;
};

/** Verified = proved control of one of the contact's own numbers within the last 30 minutes. Re-evaluated before every protected tool call. */
export function isVerified(contact: any, now = new Date()): boolean {
  const v = contact?.verifiedPhone;
  if (!v?.at || !v?.number) return false;
  return now.getTime() - new Date(v.at).getTime() <= VERIFY_TTL_MIN * 60_000 && (contact.handles ?? []).some((h: any) => h.address === v.number);
}
export const VERIFY_TTL_MIN = 30;     // verification stays valid this long (shorter for high-risk actions, enforced in tools)

export async function loadCustomer(db: Db, party: Party, opts: { now?: Date; orgId: Party["contact"]["orgId"] }): Promise<Customer> {
  const now = opts.now ?? new Date();
  const c: any = party.contact;
  const account = party.externalRefs.find((r) => r.kind === "account");
  const prospect = party.externalRefs.find((r) => r.kind === "prospect");
  const status: Customer["status"] = account ? "linked_account" : prospect ? "prospect" : "unknown";

  const vAt: Date | null = c.verifiedPhone?.at ? new Date(c.verifiedPhone.at) : null;
  const verified = isVerified(c, now);

  let acct: Customer["account"] = null;
  if (account) {
    const doc: any = await db.collection("tmo_accounts").findOne({ orgId: opts.orgId, accountId: account.id }).catch(() => null);
    if (doc) {
      const x = doc.context ?? {};
      const internal: string[] = [];
      if (x.signals?.port_out_inquiry) internal.push("asked about porting out");
      if ((x.signals?.competitor_research_score ?? 0) > 0.6) internal.push("researching competitors");
      acct = {
        asOf: doc.asOf ?? x.as_of ?? null, segment: doc.segment ?? x.segment ?? null, tenureMonths: x.tenure_months ?? null,
        lineCount: (doc.lines ?? []).length, lineRoles: (doc.lines ?? []).map((l: any) => l.memberRole).filter(Boolean),
        supportContacts90d: x.support?.contacts_90d ?? null, billChangePct: x.billing?.change_pct_vs_prior_avg ?? null, internal,
      };
    }
  }
  const facts = [...(c.facts ?? [])].filter((f: any) => !f.supersededBy).sort((a: any, b: any) => +new Date(b.learnedAt) - +new Date(a.learnedAt)).slice(0, 15).map((f: any) => f.text);
  const loops = (c.memory?.openLoops ?? []).filter((l: any) => l.status !== "done").map((l: any) => l.text);
  const profile = c.profile ?? null;
  return {
    status, refs: party.externalRefs, firstName: profile?.displayName ?? (c.name && !String(c.name).startsWith("+") && !c.name.includes("@") ? String(c.name).split(" ")[0] : null),
    profile, facts, openLoops: loops, verified, verifiedAt: vAt, canText: Boolean(c.consent?.text?.granted), negotiation: c.memory?.negotiation && now.getTime() - new Date(c.memory.negotiation.at).getTime() < 24 * 3600_000 ? c.memory.negotiation : null, offers: (c.memory?.offers ?? []).slice(-3), intake: c.intake ?? null, channels: [...new Set<string>((c.handles ?? []).map((h: any) => h.channel))], account: acct,
  };
}

/** The text that replaces {{customer_block}}. Account details appear ONLY when verified. */
export function buildCustomerBlock(c: Customer, ctx: { channel: string }): string {
  const L: string[] = [];
  const who = c.status === "linked_account" ? `RECOGNIZED CUSTOMER (account ${c.refs.find((r) => r.kind === "account")!.id})`
    : c.status === "prospect" ? "PROSPECT (not a customer yet; no account on file)" : "UNKNOWN NUMBER (no record; treat as a prospect, never guess an account)";
  L.push(`Who: ${who}`);
  L.push(`Verified: ${c.verified ? `yes, by one-time code at ${c.verifiedAt!.toISOString()}. Do NOT send or ask for another code; answer what they ask` : "NO. Account details are withheld until verified." + (c.status === "linked_account" ? " When they ask about their account, call verify_send_code immediately; do not ask permission and do not ask them to text first." : "")}`);
  L.push(`Reaching us on: ${ctx.channel}${c.channels.filter((x) => x !== ctx.channel).length ? ` (also used: ${c.channels.filter((x) => x !== ctx.channel).join(", ")})` : ""}`);
  if (c.firstName) L.push(`Name: ${c.firstName}`);
  const p = c.profile;
  if (p) {
    const notes = [p.tone && `tone: ${p.tone}`, p.relationship && `relationship: ${p.relationship}`, p.language && p.language !== "en" && `language: ${p.language}`, p.channelPref && `prefers: ${p.channelPref}`].filter(Boolean);
    if (notes.length) L.push(`Character notes (how to talk, never to quote): ${notes.join("; ")}`);
    if (p.sensitivities?.length) L.push(`Handle with care: ${p.sensitivities.join(" | ")}`);
    if (p.synthetic) L.push("Names and backstory are invented demo colour; never use them as evidence for a price or eligibility.");
  }
  const k = c.intake;
  if (k) {
    const known = [k.first_name && `name ${k.first_name}`, k.current_carrier && `carrier ${k.current_carrier}`, k.current_plan && `plan ${k.current_plan}`, k.monthly_bill_usd != null && `pays about $${k.monthly_bill_usd}/mo`,
      k.line_count && `${k.line_count} line(s)`, k.devices?.length && `phones: ${k.devices.join("; ")}`, k.budget_usd != null && `budget about $${k.budget_usd}/mo`, k.needs && `needs: ${k.needs}`, k.interests?.length && `interested in ${k.interests.join(", ")}`].filter(Boolean);
    if (known.length) L.push(`What they have told us (their words, not verified): ${known.join("; ")}`);
  }
  if (c.negotiation) { const n = c.negotiation; L.push(`Negotiation in progress: round ${n.round} on ${n.plan} (${n.lines} line${n.lines === 1 ? "" : "s"}); last credit you offered: ${n.lastCreditCents ? `$${(n.lastCreditCents / 100).toFixed(0)}/month` : "none yet"}${n.gives?.length ? `; they agreed to give: ${n.gives.join(", ").replace(/_/g, " ")}` : ""}. Do not offer more than negotiation_offer returns.`); }
  if (c.offers.length) L.push(`Already agreed with this customer: ${c.offers.map((o) => o.summary).join(" | ")}`);
  if (c.status !== "linked_account") { const m = missingIntake(k); if (m.length) L.push(`Not known yet (learn naturally, one at a time, only when it helps them): ${m.join(", ")}`); }
  if (c.canText) L.push("Texting: they have agreed to be texted, so send what they ask for without asking again.");
  if (c.openLoops.length) L.push(`Open commitments (bring up first): ${c.openLoops.join(" | ")}`);
  if (c.facts.length) L.push(`Remembered from earlier: ${c.facts.join(" | ")}`);
  if (c.account) {
    if (c.verified) {
      const a = c.account;
      L.push(`Account snapshot (as of ${a.asOf ?? "unknown"}; quote with this date): segment ${a.segment ?? "?"}; ${a.tenureMonths ?? "?"} months a customer; ${a.lineCount} line(s)${a.lineRoles.length ? ` (${a.lineRoles.join(", ")})` : ""}; support contacts in last 90 days: ${a.supportContacts90d ?? "?"}${a.billChangePct != null ? `; latest bill vs recent average: ${(a.billChangePct * 100).toFixed(0)}%` : ""}. For plan, devices, balances and eligibility call tmo_context and tmo_catalog.`);
      if (a.internal.length) L.push(`Internal context, never mention to the customer: ${a.internal.join("; ")}`);
    } else L.push("An account is on file. You may say so, but share nothing about it until they are verified.");
  }
  return L.join("\n");
}

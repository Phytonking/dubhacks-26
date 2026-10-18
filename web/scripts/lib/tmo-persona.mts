// @ts-nocheck  (one-off CLI: node:sqlite types need @types/node 22+; tsx runs it fine)
// Deterministic character sheets for the 50 T-Mobile personas. Same persona id -> same person, every run.
// Dataset-derived fields (language, channel preference, tone, relationship, sensitivities) are recomputed from real
// data; invented colour (names, backstory) is flagged synthetic and must never be used as evidence for prices/eligibility.

const FIRST = [
  "Maya", "Jordan", "Priya", "Marcus", "Elena", "Dev", "Sofia", "Tyrone", "Mei", "Carlos", "Amara", "Noah", "Hana",
  "Luis", "Grace", "Omar", "Ivy", "Raj", "Tessa", "Andre", "Lucia", "Ben", "Yuki", "Fatima", "Sam", "Nadia", "Theo",
  "Rosa", "Kofi", "Anya", "Eli", "Zoe", "Mateo", "Leila", "Jonah", "Camila", "Idris", "Nora", "Wen", "Paolo",
];
const REGIONS = ["Seattle", "Bellevue", "Tacoma", "Everett", "Spokane", "Portland"]; // synthetic, Pacific Northwest like the demo line
const LAST = ["Rivera", "Chen", "Patel", "Brooks", "Nguyen", "Okafor", "Silva", "Kim", "Hart", "Moreau", "Haddad", "Reyes", "Lindqvist", "Ortiz", "Tran", "Walker"];

function seeded(str: string) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fictional 555-01xx demo number (reserved range) per persona. 0101-0142 customers, 0143-0150 prospects. */
export function demoHandle(personaId: string): string {
  const n = Number(personaId.split("-").pop());
  const slot = personaId.startsWith("PROSPECT") ? 42 + n : n;
  return `+1206555${String(100 + slot).padStart(4, "0")}`;
}

const BACKSTORY: Record<string, string> = {
  student: "Student who watches every dollar and lives on their phone between classes.",
  single: "Lives on their own; the phone is their main screen.",
  couple: "Shares the plan with their partner and likes things split fairly.",
  family: "Runs a busy household and wants one simple bill.",
  smb: "Runs a small business where phones are tools and downtime costs money.",
  senior: "Prefers plain answers, no pressure, and a real person when it matters.",
};

/** p = persona row, or null for a plain account (then the account id seeds the person and there is no scenario). */
export function buildProfile(p: Record<string, any> | null, acct: Record<string, any> | null, related: Record<string, any> | null) {
  const seedKey: string = p?.personaId ?? acct!.accountId;
  const rnd = seeded(seedKey);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const used = new Set<string>();
  const first = () => { let n = pick(FIRST); while (used.has(n)) n = pick(FIRST); used.add(n); return n; };
  const displayName = first();
  const lastName = LAST[Math.floor(rnd() * LAST.length)];
  const region = REGIONS[Math.floor(rnd() * REGIONS.length)];
  const ctx = acct?.context ?? null;

  const household = (acct?.lines ?? []).map((l: any, i: number) => ({
    lineId: l.lineId, label: l.memberLabel, role: l.memberRole, name: i === 0 ? displayName : first(),
  }));

  const language: string = ctx?.language ?? "en";
  const channelPref: string = ctx?.contact_preference ?? "sms";
  const sup = ctx?.support, sig = ctx?.signals;

  const sensitivities: string[] = [];
  if (acct) {
    const byTopic = new Map<string, { n: number; open: number }>();
    for (const s of acct.support) {
      const t = byTopic.get(s.topic) ?? { n: 0, open: 0 };
      t.n++; if (!s.resolved) t.open++;
      byTopic.set(s.topic, t);
    }
    for (const [topic, t] of byTopic) {
      if (t.open > 0 || t.n >= 3) sensitivities.push(`${topic.replace("_", " ")}: ${t.n} contact(s) in the last 9 months${t.open ? `, ${t.open} unresolved` : ""}. Do not open with a sales pitch.`);
    }
    if (sig?.port_out_inquiry) sensitivities.push("Asked about porting their number away. Offer a human, not a discount.");
    if (ctx.billing?.change_pct_vs_prior_avg > 0.1) sensitivities.push("Latest bill rose sharply versus recent months. Be ready to explain why.");
  }

  let relationship = "new";
  if (acct) {
    if (sig?.port_out_inquiry || sup.contacts_90d >= 4 || (sig?.competitor_research_score > 0.6 && sup.contacts_90d >= 2)) relationship = "at-risk";
    else if (ctx.tenure_months >= 48 && sup.contacts_90d === 0) relationship = "loyal";
    else relationship = "steady";
  }

  let tone = "friendly and concise";
  if (acct) {
    if (relationship === "at-risk" || (sup.contacts_90d > 0 && sup.avg_sentiment !== null && sup.avg_sentiment < -0.2)) tone = "careful and empathetic; acknowledge before suggesting anything";
    else if (ctx.segment === "senior") tone = "patient, plain words, no jargon, one thing at a time";
    else if (ctx.segment === "smb") tone = "brisk and practical; lead with cost and downtime";
    else if (ctx.segment === "student") tone = "casual and quick; mind the budget";
    else if (relationship === "loyal") tone = "warm and unhurried; recognise their loyalty";
  } else if (p?.statedUsage === "heavy") tone = "direct and specific; they know what they want";

  const voice = buildVoice({ language, channelPref, tone, relationship, segment: ctx?.segment ?? null, name: displayName, bill: ctx?.billing?.latest_total_cents ?? null });
  const dataDerived = { language, channelPref, tone, relationship, sensitivities, voice };
  const tenure = ctx ? `Customer for ${Math.floor(ctx.tenure_months / 12)} year(s) ${ctx.tenure_months % 12} month(s).` : "Not a customer yet.";
  return {
    displayName, lastName, fullName: `${displayName} ${lastName}`, region, household,
    ...dataDerived, dataDerived,
    goal: p?.scenario ?? null, theme: p?.primaryTheme ?? null, secondaryThemes: p?.secondaryThemes ?? [],
    persona: p ? { id: p.personaId, title: p.title, kind: p.kind } : null,
    relatedAccountId: related?.accountId ?? null,
    backstory: `${BACKSTORY[ctx?.segment ?? "single"] ?? BACKSTORY.single} ${tenure}`,
    backstorySource: "rule",   // "llm" once profile-tmobile.mts replaces it with a written one (the rule text is kept in backstoryRule)
    synthetic: true, // names/backstory are invented; never evidence for price or eligibility
  };
}

/**
 * Notes a voice agent (ElevenLabs) adopts for this person: language, pace, register, how to open, how to say numbers.
 * Rule-based from dataset fields only, so they stay true. `notes` are plain imperative sentences ready to paste into a prompt.
 */
export function buildVoice(a: { language: string; channelPref: string; tone: string; relationship: string; segment: string | null; name: string; bill: number | null }) {
  const notes: string[] = [];
  const locale = a.language === "es" ? "es-US" : a.language === "en" ? "en-US" : null;
  if (a.language === "es") {
    notes.push("Speak Spanish (US, neutral Latin American). Open: 'Hola " + a.name + ", soy el asistente de T-Mobile.' Offer to switch to English once, then follow their lead.");
    notes.push("Keep plan and product names in English (Experience Beyond, Essentials) and say them clearly. Say amounts in Spanish, e.g. 'sesenta y seis dólares con seis centavos'.");
    notes.push("Use 'usted' until they use 'tú'. Avoid slang and regionalisms.");
  } else if (a.language === "other") {
    notes.push("Preferred language is not English or Spanish and is not on file. Open in simple English, then ask which language they would like and offer a human interpreter if you cannot help in it.");
    notes.push("Speak slowly, avoid idioms and phrasal verbs, confirm understanding after each key point, and repeat numbers digit by digit.");
  } else {
    notes.push("Speak US English. Open: 'Hi " + a.name + ", it's the T-Mobile assistant.'");
  }
  if (a.segment === "senior") notes.push("Slow pace, short sentences, one idea at a time. Repeat key amounts and dates, and pause for questions.");
  else if (a.segment === "student") notes.push("Quick, casual, upbeat. Keep it short; mention cost early.");
  else if (a.segment === "smb") notes.push("Brisk and practical. Lead with the monthly cost and any downtime, then the options.");
  else if (a.segment === "family") notes.push("Warm and organised. Check who in the household you are talking to before discussing other members' lines.");
  if (a.relationship === "at-risk") notes.push("Slower, softer, lower energy. Acknowledge their frustration first. No sales pitch and no discount offers; offer a human specialist early.");
  else if (a.relationship === "loyal") notes.push("Warm and unhurried. Thank them for being a long-time customer once, briefly.");
  else if (a.relationship === "new") notes.push("They are not a customer yet: friendly, no assumptions about their account, ask a question at a time.");
  if (a.channelPref === "call") notes.push("They prefer phone calls: a call is a good place to handle anything complicated, and it is fine to suggest one.");
  if (a.channelPref === "app") notes.push("They use the app a lot: you can point them to the T-Mobile app for self-serve steps.");
  if (a.language === "es") notes.push("Di las fechas como 'primero de octubre'. Sin listas ni markdown; una pregunta a la vez.");
  else notes.push("Read money aloud in full ('sixty-six dollars and six cents'), never as symbols. Say dates as 'October first'. No lists or markdown, one question at a time.");
  return { language: a.language, locale, tone: a.tone, notes };
}

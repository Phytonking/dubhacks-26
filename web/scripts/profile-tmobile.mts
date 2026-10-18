// @ts-nocheck  (one-off CLI)
// Writes a profile (name, household, tone, relationship, sensitivities, voice notes, backstory) onto EVERY T-Mobile account
// (tmo_accounts.profile) and refreshes the persona contacts. Some backstories are LLM-written, the rest are rule-based:
//   LLM: all 50 personas + every account whose id hashes into the first LLM_PCT percent (default 10), deterministic.
//   pnpm tsx --env-file=.env.local scripts/profile-tmobile.mts [--llm-pct 10] [--regen-llm] [--no-llm] [--dry]
// Idempotent. Existing LLM backstories are kept unless --regen-llm. Dataset-derived fields are always recomputed.
import { getDb } from "../src/lib/db";
import { buildProfile } from "./lib/tmo-persona.mts";

const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const flag = (n: string) => process.argv.includes(n);
const PCT = Number(arg("--llm-pct") ?? 10);
const MODEL = process.env.TMO_PROFILE_MODEL ?? "Qwen/Qwen3.8-2.4T-A95B";
const { MODAL_API_ENDPOINT: EP, MODAL_PROXY_TOKEN_ID: ID, MODAL_PROXY_TOKEN_SECRET: SECRET } = process.env;
const useLlm = !flag("--no-llm") && EP && ID && SECRET;
if (!useLlm && !flag("--no-llm")) console.warn("MODAL_* not set: all backstories will be rule-based.");

const db = await getDb();
const org = await db.collection("orgs").findOne({ name: "T-Mobile" });
if (!org) { console.error("No T-Mobile org. Run seed-tmobile first."); process.exit(1); }
const orgId = org._id;
const accounts = db.collection("tmo_accounts"), contacts = db.collection("contacts");

const personas = await db.collection("tmo_personas").find({ orgId }).toArray();
const personaByAccount = new Map(personas.filter((p) => p.accountId).map((p) => [p.accountId, p]));
const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) % 100; };
const wantsLlm = (id: string, isPersona: boolean) => useLlm && (isPersona || hash(id) < PCT);

// ---- LLM backstory (dataset facts in, 2-3 sentences out; never numbers, eligibility or anything checkable) ----
async function writeBackstory(profile: any, acct: any): Promise<string | null> {
  const ctx = acct?.context;
  const facts = [
    `First name: ${profile.displayName}. Household: ${profile.household.map((h: any) => `${h.name} (${h.role})`).join(", ") || "n/a"}.`,
    ctx ? `${ctx.segment}, customer ${Math.floor(ctx.tenure_months / 12)} years, language ${ctx.language}, prefers ${ctx.contact_preference}.` : "Prospect, not a customer yet.",
    ctx ? `Phones: ${ctx.lines.map((l: any) => l.device ? `${l.device.name} (${l.device.age_months} months)` : "own phone").join(", ")}.` : "",
    `Relationship with us: ${profile.relationship}. Mood notes: ${profile.sensitivities.join(" ") || "none"}.`,
    profile.goal ? `What's going on right now: ${profile.goal}` : "",
  ].filter(Boolean).join("\n");
  const prompt = `Write a 2-3 sentence background for a fictional mobile-phone customer, used to help a support assistant sound like it knows them. Use ONLY the facts below plus light everyday colour (job type, habits, what they care about). Do not invent money amounts, plan names, dates, addresses, employers' names or anything about their account. No medical or political detail. Present tense, third person, plain words, no name repeated more than once.\n\n${facts}\n\nBackground:`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`${EP.replace(/\/$/, "")}/chat/completions`, {
        method: "POST", signal: AbortSignal.timeout(40_000),
        headers: { "content-type": "application/json", authorization: `Bearer ${ID}.${SECRET}` },
        body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: prompt }], temperature: 0.7, max_tokens: 160, reasoning_effort: "none", stream: false }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      let t: string = (await r.json()).choices?.[0]?.message?.content ?? "";
      t = t.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^[\s\S]*<\/think>/, "").replace(/^(background|backstory)\s*:\s*/i, "").replace(/^["'\s]+|["'\s]+$/g, "").replace(/\s+/g, " ");
      if (t.length < 40 || t.length > 800 || /\$\d|\d{3}/.test(t)) throw new Error("rejected(" + t.length + "): " + (t.match(/\$\d|\d{3}/) ?? ["len"])[0] + " " + t.slice(0, 30));
      return t;
    } catch (e) { if (attempt === 2) { console.warn("  llm failed:", profile.displayName, String(e.message).slice(0, 80)); return null; } await new Promise((r) => setTimeout(r, 500 * (attempt + 1))); }
  }
  return null;
}

// ---- accounts ----
const all = await accounts.find({ orgId }, { projection: { accountId: 1, context: 1, lines: 1, support: 1, profile: 1, personaId: 1 } }).sort({ accountId: 1 }).toArray();
const byId = new Map(all.map((a) => [a.accountId, a]));
const LASTS = ["Rivera", "Chen", "Patel", "Brooks", "Nguyen", "Okafor", "Silva", "Kim", "Hart", "Moreau", "Haddad", "Reyes", "Lindqvist", "Ortiz", "Tran", "Walker"];
const takenNames = new Set<string>(); // demo personas must have distinct "First L." names
function uniqueName(profile: any) {
  let n = 0;
  const short = () => `${profile.displayName} ${profile.lastName[0]}.`;
  while (takenNames.has(short()) && n < LASTS.length * 2) { profile.lastName = LASTS[(LASTS.indexOf(profile.lastName) + 1 + n++) % LASTS.length]; }
  takenNames.add(short()); profile.fullName = `${profile.displayName} ${profile.lastName}`;
}
let llmN = 0, ruleN = 0, kept = 0, failed = 0;
const queue = all.slice();
const stats = { llmChosen: 0 };
async function work() {
  for (let a; (a = queue.shift()); ) {
    const persona = personaByAccount.get(a.accountId) ?? null;
    const related = persona?.relatedAccountId ? byId.get(persona.relatedAccountId) : null;
    const profile = buildProfile(persona, a, related ? { accountId: related.accountId } : null);
    const prev = a.profile;
    if (persona) uniqueName(profile);
    profile.backstoryRule = profile.backstory;
    if (wantsLlm(a.accountId, !!persona)) {
      stats.llmChosen++;
      if (prev?.backstorySource === "llm" && !flag("--regen-llm")) { profile.backstory = prev.backstory; profile.backstorySource = "llm"; profile.backstoryModel = prev.backstoryModel; kept++; }
      else {
        const t = await writeBackstory(profile, a);
        if (t) { profile.backstory = t; profile.backstorySource = "llm"; profile.backstoryModel = MODEL; llmN++; } else { failed++; ruleN++; }
      }
    } else ruleN++;
    profile.updatedAt = new Date();
    if (!flag("--dry")) await accounts.updateOne({ _id: a._id }, { $set: { profile } });
    a._profile = profile;
    if ((llmN + kept + ruleN) % 500 === 0) console.log(`  ${llmN + kept + ruleN}/${all.length}`);
  }
}
await Promise.all(Array.from({ length: 6 }, work));
console.log(`accounts: ${all.length} profiled. backstory: ${llmN} new LLM, ${kept} kept LLM, ${ruleN} rule-based (${failed} LLM failures fell back to rule)`);

// ---- persona contacts: take the account's profile (customers) or build one (prospects) ----
let cn = 0;
for (const p of personas) {
  const c = await contacts.findOne({ orgId, "externalRefs.id": p.personaId });
  if (!c) continue;
  let profile;
  if (p.accountId) profile = byId.get(p.accountId)._profile;
  else {
    profile = buildProfile(p, null, null);
    uniqueName(profile);
    profile.backstoryRule = profile.backstory;
    const prev = c.profile;
    if (useLlm && prev?.backstorySource === "llm" && !flag("--regen-llm")) { profile.backstory = prev.backstory; profile.backstorySource = "llm"; profile.backstoryModel = prev.backstoryModel; }
    else if (useLlm) { const t = await writeBackstory(profile, null); if (t) { profile.backstory = t; profile.backstorySource = "llm"; profile.backstoryModel = MODEL; } }
    profile.updatedAt = new Date();
  }
  // keep any learned facts / memory on the contact; only the profile is rewritten
  if (!flag("--dry")) await contacts.updateOne({ _id: c._id }, { $set: { name: profile.fullName, ...Object.fromEntries(Object.entries(profile).map(([k, v]) => [`profile.${k}`, v])) } });
  cn++;
}
console.log(`persona contacts refreshed: ${cn}`);
process.exit(0);

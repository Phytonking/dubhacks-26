// @ts-nocheck  (one-off CLI: node:sqlite types need @types/node 22+; tsx runs it fine)
// Migrates the T-Mobile hackathon sandbox (SQLite, synthetic) into Atlas for the "T-Mobile" tenant.
//   pnpm db:seed:tmobile -- --db /path/to/dubhacks/data/sandbox.db            (or TMO_DB_PATH=...)
// Idempotent: upserts by natural key, skips when the dataset checksum is unchanged (--force to redo).
// Never drops anything. Touches only documents of the T-Mobile org. Sunrise Bike Shop data is left alone.
//   --reset-personas   also restore persona contacts' profile + memory to the seeded state (wipes learned facts/open loops)
import { DatabaseSync } from "node:sqlite";
import { ObjectId } from "mongodb";
import { getDb } from "../src/lib/db";
import { applySchema } from "../src/lib/schema";
import { buildKnowledge } from "./lib/tmo-knowledge.mts";
import { buildProfile, demoHandle } from "./lib/tmo-persona.mts";

const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const flag = (n: string) => process.argv.includes(n);
const dbPath = arg("--db") ?? process.env.TMO_DB_PATH;
if (!dbPath) { console.error("Pass --db <path to dubhacks data/sandbox.db> or set TMO_DB_PATH."); process.exit(1); }

const src = new DatabaseSync(dbPath, { readOnly: true });
const all = <T = Record<string, any>>(sql: string, ...p: any[]) => src.prepare(sql).all(...p) as T[];
const meta = Object.fromEntries(all<{ key: string; value: string }>("select key,value from metadata").map((r) => [r.key, r.value]));
const asOf = meta.as_of;

const db = await getDb();
await applySchema(db); // additive: creates tmo_* collections/indexes if missing, re-applies validators
const now = new Date();

// ---------- helpers ----------
const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const BOOLS = new Set([
  "autopay", "byod", "tradein_eligible", "resolved", "port_out_inquiry", "hotspot_unlimited", "priority_network",
  "prices_include_autopay", "requires_new_line", "requires_port_in", "requires_tradein", "new_line_or_tradein",
  "requires_device", "requires_byod", "discount_plan_only",
]);
const LISTS = new Set([
  "perks", "eligible_families", "compatible_device_skus", "device_skus", "plan_families", "plan_variants",
  "discount_groups", "credit_tiers", "secondary_themes",
]);
const conv = (row: Record<string, any>) => {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "line_prices") out.linePrices = String(v).split(",").map(Number);
    else if (LISTS.has(k)) out[camel(k)] = v == null || v === "" ? [] : String(v).split(",").map((x) => x.trim());
    else if (BOOLS.has(k)) out[camel(k)] = Boolean(v);
    else out[camel(k)] = v;
  }
  return out;
};
const months = (a: string, b: string) => {
  const [ay, am] = a.split("-").map(Number), [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
};
const dayShift = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86400_000).toISOString().slice(0, 10);

async function upsertMany(coll: string, key: string, orgId: ObjectId, docs: Record<string, any>[], batch = 500) {
  const c = db.collection(coll);
  for (let i = 0; i < docs.length; i += batch) {
    // $set (not replace): fields added by other scripts (e.g. tmo_accounts.profile from profile-tmobile.mts) survive a re-import
    const ops = docs.slice(i, i + batch).map((d) => ({
      updateOne: { filter: { orgId, [key]: d[key] }, update: { $set: { ...d, orgId, importedAt: now } }, upsert: true },
    }));
    await c.bulkWrite(ops, { ordered: false });
  }
  return docs.length;
}

// ---------- org + agent (find-or-create; never overwrite owner edits) ----------
const ORG_NAME = "T-Mobile";
let org = await db.collection("orgs").findOne({ name: ORG_NAME });
if (!org) {
  const _id = new ObjectId();
  await db.collection("orgs").insertOne({
    _id, name: ORG_NAME,
    productDescription:
      "T-Mobile wireless: phones, plans (Essentials, Experience More, Experience Beyond and discount variants), device protection, Home Internet, trade-ins and upgrades. This workspace runs on sandbox data: every price and offer is a synthetic stand-in, not an official T-Mobile offer.",
    brandVoice:
      "Direct, warm and plain-spoken. Short replies, no jargon. Always say what it costs per month and what is due today. Never pushy: if waiting is the better move for the customer, say so. Never describe a stub offer as real.",
    hours: "Text any time. Care specialists and store hours vary.",
    plan: "pro", createdAt: now,
  } as any);
  org = (await db.collection("orgs").findOne({ _id }))!;
  console.log("Created org", ORG_NAME);
}
const orgId = org._id as ObjectId;

if (!(await db.collection("agents").findOne({ orgId }))) {
  await db.collection("agents").insertOne({
    _id: new ObjectId(), orgId, status: "draft", harness: null,
    persona:
      "You are the T-Mobile assistant, texting on behalf of T-Mobile. Help customers and prospects with plans, phones, trade-ins, upgrades, add-ons and bills. Use the CUSTOMER section when present: greet by first name, respect their language and tone preferences, and answer from their actual lines, devices and bills. Use the knowledge section for plan, promo and policy details. Quote figures only if they appear there, and say 'as of <date>' for account data. If a figure is missing, say you will check. This is a sandbox: never present an offer as real. Hand off to a person for cancellations, port-outs, billing disputes, or when the customer asks for one.",
    guardrails: {
      maxDiscountPct: 0,
      escalateOn: ["cancel", "port out", "switch carriers", "dispute", "fraud", "speak to a person", "complaint"],
    },
    enabledChannels: { imessage: true, whatsapp: false, sms: true, voice: false },
    sandboxId: null, updatedAt: now,
  } as any);
  console.log("Created agent (draft)");
}

// ---------- skip when unchanged ----------
const prev = await db.collection("tmo_meta").findOne({ orgId });
if (prev?.contentSha256 === meta.content_sha256 && !flag("--force") && !flag("--reset-personas")) {
  console.log(`Dataset ${meta.content_sha256.slice(0, 12)} already imported at ${prev.importedAt.toISOString()}. Use --force to redo.`);
  process.exit(0);
}

// ---------- catalog ----------
const devices = all("select * from devices").map(conv);
const curves = new Map<string, number[]>();
for (const r of all<{ device_sku: string; age_months: number; value_cents: number }>("select * from tradein_curves order by device_sku, age_months")) {
  (curves.get(r.device_sku) ?? curves.set(r.device_sku, []).get(r.device_sku)!)[r.age_months] = r.value_cents;
}
for (const d of devices) d.tradeinCurve = curves.get(d.sku) ?? []; // index = device age in months (0-60), cents, good condition
const plans = all("select * from plans").map(conv);
const addons = all("select * from addons").map(conv);
const promos = all("select * from promotions").map(conv);
const nDev = await upsertMany("tmo_devices", "sku", orgId, devices);
const nPlan = await upsertMany("tmo_plans", "sku", orgId, plans);
const nAdd = await upsertMany("tmo_addons", "sku", orgId, addons);
const nPromo = await upsertMany("tmo_promotions", "sku", orgId, promos);
console.log(`catalog: ${nDev} devices, ${nPlan} plans, ${nAdd} add-ons, ${nPromo} promotions`);

// ---------- accounts (one doc per household) ----------
const planBySku = new Map(plans.map((p) => [p.sku, p]));
const devBySku = new Map(devices.map((d) => [d.sku, d]));
const addonBySku = new Map(addons.map((a) => [a.sku, a]));
const group = <T extends Record<string, any>>(rows: T[], key: string) => {
  const m = new Map<string, T[]>();
  for (const r of rows) (m.get(r[key]) ?? m.set(r[key], []).get(r[key])!).push(r);
  return m;
};
const linesBy = group(all("select * from lines order by line_id"), "account_id");
const usageBy = group(all("select * from usage_monthly order by line_id, month"), "line_id");
const laBy = group(all("select * from line_addons"), "line_id");
const aaBy = group(all("select * from account_addons"), "account_id");
const billBy = group(all("select * from billing_history order by month"), "account_id");
const supBy = group(all("select * from support_interactions order by interaction_date desc, interaction_id desc"), "account_id");
const sigBy = new Map(all("select * from account_signals").map((r) => [r.account_id, r]));
// SQLite's AVG sums with compensation; recomputing in JS differs in the last bit and flips rounding ties, so reuse SQLite's value
const avgSentBy = new Map(all<{ account_id: string; a: number }>("select account_id, avg(sentiment) a from support_interactions group by account_id").map((r) => [r.account_id, r.a]));
const personaRows = all("select * from personas");
const personaByAccount = new Map(personaRows.filter((p) => p.account_id).map((p) => [p.account_id, p.persona_id]));

const SUPPORT_WINDOW_DAYS = 90, UPGRADE_MIN_AGE = 12, TRADEIN_MAX_AGE = 60;
const cutoff = dayShift(asOf, -SUPPORT_WINDOW_DAYS);
// Python round(): exact-decimal, ties (only possible for dyadic values like 0.0625) go to even; JS toFixed ties go up
const round = (x: number, n: number) => {
  const scaled = Math.abs(x) * 10 ** n;
  const tie = Number.isInteger(scaled * 2) && !Number.isInteger(scaled) && Number.isInteger(Math.abs(x) * 2 ** 24);
  if (!tie) return Number(x.toFixed(n));
  const lo = Math.floor(scaled);
  return (Math.sign(x) * (lo % 2 === 0 ? lo : lo + 1)) / 10 ** n;
};

function buildAccount(a: Record<string, any>) {
  const lines = (linesBy.get(a.account_id) ?? []).map((l) => {
    const plan = planBySku.get(l.plan_sku)!, dev = l.device_sku ? devBySku.get(l.device_sku) : null;
    const usage = (usageBy.get(l.line_id) ?? []).map(({ line_id, ...u }) => conv(u));
    return { ...conv(l), usage, addonSkus: (laBy.get(l.line_id) ?? []).map((x) => x.addon_sku), _plan: plan, _dev: dev };
  });
  const sup = (supBy.get(a.account_id) ?? []).map(({ account_id, ...s }) => conv(s));
  const bill = (billBy.get(a.account_id) ?? []).map(({ account_id, ...b }) => conv(b));
  const sig = sigBy.get(a.account_id);
  const accountAddons = (aaBy.get(a.account_id) ?? []).map((x) => x.addon_sku);

  // context: identical shape + values to GET /v1/customers/{id}/context (verified by scripts/verify-tmobile.mts)
  const ctxLines = lines.map((l) => {
    const age = l._dev ? months(l.devicePurchaseDate, asOf) : null;
    const tradeinEligible = l.tradeinEligible;
    const recent = l.usage.slice(-3).map((u: any) => u.dataGb);
    return {
      line_id: l.lineId, member_label: l.memberLabel, member_role: l.memberRole, plan_sku: l.planSku,
      plan_name: l._plan.name, plan_tier: l._plan.tier, plan_family: l._plan.family, plan_variant: l._plan.variant,
      plan_data_cap_gb: l._plan.dataCapGb, byod: l.byod,
      device: l._dev ? { sku: l._dev.sku, name: l._dev.name, tier: l._dev.tier, purchase_date: l.devicePurchaseDate, age_months: age } : null,
      financing: l.byod ? null : {
        balance_cents: l.financingBalanceCents, months_remaining: l.financingMonthsRemaining,
        monthly_installment_cents: l.monthlyInstallmentCents, paid_off: l.financingBalanceCents === 0,
      },
      has_protection: l.addonSkus.some((s: string) => addonBySku.get(s)?.kind === "protection"),
      tradein_eligible: tradeinEligible,
      upgrade_eligible: age !== null && age >= UPGRADE_MIN_AGE,
      estimated_tradein_value_cents: l._dev && tradeinEligible ? (l._dev.tradeinCurve[Math.min(age!, TRADEIN_MAX_AGE)] ?? null) : null,
      usage_3m_avg_gb: recent.length ? round(recent.reduce((s: number, x: number) => s + x, 0) / recent.length, 2) : null,
    };
  });
  const totals = bill.map((b: any) => b.totalCents);
  const prior = totals.slice(0, -1), priorAvg = prior.length ? prior.reduce((s: number, x: number) => s + x, 0) / prior.length : 0;
  const recentSup = sup.filter((s: any) => s.interactionDate >= cutoff);
  const context = {
    as_of: asOf, account_id: a.account_id, segment: a.segment, tenure_months: a.tenure_months, language: a.language,
    contact_preference: a.contact_preference, credit_tier: a.credit_tier, autopay: Boolean(a.autopay),
    discount_group: a.discount_group, persona_note: a.persona_note,
    services: accountAddons.slice().sort().map((s) => { const x = addonBySku.get(s)!; return { sku: x.sku, name: x.name, kind: x.kind, monthly_cents: x.monthlyCents }; }),
    lines: ctxLines,
    billing: totals.length ? {
      latest_total_cents: totals.at(-1),
      change_pct_vs_prior_avg: priorAvg ? round(totals.at(-1) / priorAvg - 1, 4) : null,
      months_available: totals.length,
    } : null,
    support: {
      contacts_90d: recentSup.length, unresolved_90d: recentSup.filter((s: any) => !s.resolved).length,
      last_contact_date: sup.length ? sup[0].interactionDate : null,
      avg_sentiment: sup.length ? round(avgSentBy.get(a.account_id)!, 3) : null,
    },
    signals: sig ? { competitor_research_score: sig.competitor_research_score, port_out_inquiry: Boolean(sig.port_out_inquiry), app_sessions_30d: sig.app_sessions_30d } : null,
    eligibility: {
      line_count: ctxLines.length,
      upgrade_eligible_lines: ctxLines.filter((l) => l.upgrade_eligible).length,
      tradein_eligible_lines: ctxLines.filter((l) => l.tradein_eligible).length,
    },
  };
  const personaId = personaByAccount.get(a.account_id) ?? null;
  return {
    ...conv(a),
    personaId, personaOnly: personaId !== null,
    lines: lines.map(({ _plan, _dev, ...l }) => l),
    accountAddonSkus: accountAddons, billing: bill, support: sup,
    signals: sig ? (({ account_id, ...r }) => conv(r))(sig) : null,
    context,
  };
}
const accountRows = all("select * from accounts order by account_id");
const accountDocs = accountRows.map(buildAccount);
const nAcc = await upsertMany("tmo_accounts", "accountId", orgId, accountDocs);
console.log(`accounts: ${nAcc} households, ${accountDocs.reduce((s, d) => s + d.lines.length, 0)} lines`);

// ---------- personas ----------
const personaDocs = personaRows.map((p) => ({
  ...conv(p), startingCart: p.starting_cart ? JSON.parse(p.starting_cart) : null,
}));
const nPersona = await upsertMany("tmo_personas", "personaId", orgId, personaDocs);
console.log(`personas: ${nPersona}`);

await db.collection("tmo_meta").replaceOne({ orgId }, {
  orgId, importedAt: now, source: "github.com/mageshkumarj/dubhacks", dataSource: meta.data_source, seed: Number(meta.seed),
  asOf, schemaVersion: Number(meta.schema_version), contentSha256: meta.content_sha256,
  counts: { devices: nDev, plans: nPlan, addons: nAdd, promotions: nPromo, accounts: nAcc, personas: nPersona },
}, { upsert: true });

// ---------- knowledge (replace this org's T-Mobile import set, keep owner-authored rows) ----------
const kn = buildKnowledge({ plans, devices, addons, promos, asOf });
const knowColl = db.collection("knowledge"), chunkColl = db.collection("knowledge_chunks");
const old = await knowColl.find({ orgId, "source.system": "tmobile" }, { projection: { _id: 1 } }).toArray();
if (old.length) {
  await chunkColl.deleteMany({ orgId, knowledgeId: { $in: old.map((o) => o._id) } });
  await knowColl.deleteMany({ orgId, "source.system": "tmobile" });
}
const kdocs = kn.map((k) => ({
  _id: new ObjectId(), orgId, kind: k.kind, title: k.title, content: k.content, sourceUrl: null, version: 1,
  status: "ready", source: { system: "tmobile", ref: k.ref, sha: meta.content_sha256 }, createdAt: now,
}));
await knowColl.insertMany(kdocs as any);
const chunks = kdocs.flatMap((d) =>
  d.content.split(/\n+/).filter(Boolean).map((text, idx) => ({ _id: new ObjectId(), orgId, knowledgeId: d._id, idx, text, embedding: null, createdAt: now })));
await chunkColl.insertMany(chunks as any);
console.log(`knowledge: ${kdocs.length} rows, ${chunks.length} chunks`);

// ---------- persona contacts (character sheet + memory) ----------
const contacts = db.collection("contacts"), convs = db.collection("conversations");
let created = 0, reset = 0, kept = 0;
for (const p of personaDocs) {
  const acct = p.accountId ? accountDocs.find((a) => a.accountId === p.accountId)! : null;
  const rel = p.relatedAccountId ? accountDocs.find((a) => a.accountId === p.relatedAccountId) : null;
  const profile = buildProfile(p, acct, rel);
  const refs = [{ system: "tmobile", id: p.personaId, kind: p.kind === "prospect" ? "prospect" : "account" }];
  const seedFacts = p.kind === "prospect" ? prospectFacts(p) : [];
  const existing = await contacts.findOne({ orgId, "externalRefs.id": p.personaId });
  if (!existing) {
    const _id = new ObjectId();
    await contacts.insertOne({
      _id, orgId, name: profile.displayName, stage: p.kind === "prospect" ? "new" : "engaged", score: p.kind === "prospect" ? 30 : 50,
      notes: `${p.title}. ${p.scenario}`, facts: seedFacts, handles: [{ channel: "sms", address: demoHandle(p.personaId) }],
      externalRefs: refs, profile, memory: emptyMemory(), createdAt: now,
    } as any);
    // no conversation row: the agent creates one on the first message (an empty one would show up as a blank thread in the console)
    created++;
  } else if (flag("--reset-personas")) {
    await contacts.updateOne({ _id: existing._id }, { $set: { name: profile.displayName, notes: `${p.title}. ${p.scenario}`, facts: seedFacts, externalRefs: refs, profile, memory: emptyMemory() } });
    reset++;
  } else {
    // keep learned facts + memory; refresh only the dataset-derived character sheet
    const d = profile.dataDerived;
    await contacts.updateOne({ _id: existing._id }, { $set: {
      externalRefs: refs, "profile.dataDerived": d, "profile.language": d.language, "profile.channelPref": d.channelPref,
      "profile.tone": d.tone, "profile.voice": d.voice, "profile.relationship": d.relationship, "profile.sensitivities": d.sensitivities,
    } });
    kept++;
  }
}
console.log(`persona contacts: ${created} created, ${kept} kept (memory preserved), ${reset} reset`);
console.log(`Done. org=${orgId} db=${db.databaseName} dataset=${meta.content_sha256.slice(0, 12)}`);
process.exit(0);

function emptyMemory() {
  return { summary: "", summaryUpToMsgId: null, openLoops: [], seedVersion: 1 };
}
function prospectFacts(p: Record<string, any>) {
  const out: { text: string; sourceMessageId: null; learnedAt: Date; origin: string }[] = [];
  const add = (text: string) => out.push({ text, sourceMessageId: null, learnedAt: now, origin: "seed" });
  if (p.statedLines) add(`Needs ${p.statedLines} line(s).`);
  if (p.statedBudgetCents) add(`Budget about $${(p.statedBudgetCents / 100).toFixed(0)}/month.`);
  if (p.statedUsage) add(`Usage: ${p.statedUsage}.`);
  if (p.statedNotes) add(String(p.statedNotes));
  return out;
}

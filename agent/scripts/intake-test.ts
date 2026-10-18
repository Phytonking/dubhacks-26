// T-Mobile data tools, new-customer intake, post-call extraction, listen-only SMS.   pnpm exec tsx scripts/intake-test.ts
import { ObjectId } from "mongodb";
import { buildContext } from "../src/engine/context";
import { executeTool, runTurn } from "../src/engine/turn";
import { planTotalCents } from "../src/engine/tools/tmo-catalog";
import { applyExtraction, extractIntake, parseJsonObject, sanitizeExtracted } from "../src/intake-extract";
import { importCallEvent } from "../src/voice/bridge";
import { Scheduler } from "../src/scheduler";
import { Worker } from "../src/recorded-io";
import { computeReach } from "../src/lines";
import { suggestedReply, reachForModel } from "../src/engine/tools/reach";
import { ScriptedLlm, ok, t, finish, makeKit } from "./_testkit";

const kit = await makeKit({ template: "tmobile-system", groundMoney: true });
const { db, orgId } = kit; const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
await db.collection("tmo_plans").insertMany([
  { orgId, importedAt: kit.now.t, sku: "P1", name: "Experience Beyond 2.0", family: "experience_beyond", variant: "standard", tier: "premium", linePrices: [10500, 7500, 5000, 5000, 5000], extraLineCents: 5000, minLines: 1, maxLines: null, dataCapGb: null, hotspotHighSpeedGb: 250, pricesIncludeAutopay: true, perks: [], status: "current" },
  { orgId, importedAt: kit.now.t, sku: "P2", name: "Essentials Saver 2.0", family: "essentials", variant: "saver", tier: "basic", linePrices: [5500, 3500], extraLineCents: 3500, minLines: 1, maxLines: 2, dataCapGb: 50, pricesIncludeAutopay: true, perks: [], status: "current" },
] as never);
await db.collection("tmo_devices").insertOne({ orgId, importedAt: kit.now.t, sku: "D1", name: "iPhone 17", manufacturer: "Apple", tier: "flagship", msrpCents: 92999, releaseDate: "2025-09-19", status: "current", tradeinCurve: [72539, 70536, 68589, 66000], protectionTier: 5 } as never);
await db.collection("tmo_promotions").insertOne({ orgId, importedAt: kit.now.t, sku: "PR1", name: "iPhone 17 credit", kind: "device_credit", valueCents: 80000, payoutMonths: 24, per: "device", maxUnits: 2, requiresNewLine: true, requiresPortIn: false, requiresTradein: true, planFamilies: ["experience_beyond"], minPlanCents: 10000 } as never);
await db.collection("tmo_addons").insertOne({ orgId, importedAt: kit.now.t, sku: "A1", name: "Device Protection Tier 1", kind: "protection", monthlyCents: 700, oneTimeCents: 0, per: "device", description: "Damage, loss and theft", deductibleScreenCents: 1900, deductibleDamageCents: 2900, deductibleLossTheftCents: 4900 } as never);

const mkCtx = async (o: Record<string, unknown> = {}) => {
  const contact: any = await db.collection("contacts").findOne({ _id: kit.contactId });
  const d = kit.deps(new ScriptedLlm([]));
  return { d, ctx: { db, orgId, contactId: kit.contactId, conversationId: kit.conversationId, channel: "voice" as const, mode: "voice" as const, party: { contact, conversation: {} as never, address: kit.phone, created: false, matchedBy: "channel_handle" as const, externalRefs: contact.externalRefs ?? [] },
    customer: {} as never, turnId: "t", sourceMessageId: new ObjectId(), now: kit.now.t, messenger: kit.messenger, env: d.env, guard: { cfg: { maxDiscountPct: 0 }, evidence: [] as string[] }, calls: new Map(), ...o } };
};
const run = async (name: string, args: unknown, o: Record<string, unknown> = {}) => { const { d, ctx } = await mkCtx(o); return executeTool(d, ctx as never, { id: "x", type: "function", function: { name, arguments: JSON.stringify(args) } }); };

await t("plan totals are summed in code from the marginal line prices, including lines past the table", async () => {
  ok(planTotalCents([10500, 7500, 5000, 5000, 5000], 5000, 3) === 23000, "3 lines = $230");
  ok(planTotalCents([10500, 7500, 5000, 5000, 5000], 5000, 7) === 43000, "7 lines = $430");
});
await t("tmo_catalog plans: exact monthly total for the line count, a plan that cannot take that many lines is left out", async () => {
  const r = await run("tmo_catalog", { kind: "plans", lines: 3 }); ok(r.result.ok, "ok");
  const res = (r.result.data as any).results; ok(res.length === 1 && res[0].plan === "Experience Beyond 2.0" && res[0].monthly_total === "$230", JSON.stringify(res));
  const one = (await run("tmo_catalog", { kind: "plans", lines: 1 })).result.data as any; ok(one.results.length === 2 && one.results.find((p: any) => p.plan.startsWith("Essentials")).monthly_total === "$55", JSON.stringify(one));
  ok(res[0].assumes_autopay === true, "autopay flag");
});
await t("tmo_catalog devices: price and a trade-in estimate for the phone's age; promotions: conditions in words and NOT a claim of eligibility", async () => {
  const d = (await run("tmo_catalog", { kind: "devices", query: "iPhone 17", age_months: 2 })).result.data as any;
  ok(d.results[0].price === "$929.99" && d.results[0].estimated_trade_in_value_for_a_phone_this_old === "$685.89", JSON.stringify(d));
  const p = (await run("tmo_catalog", { kind: "promotions" })).result.data as any;
  ok(p.results[0].value === "$800" && p.results[0].conditions.includes("a new line") && p.results[0].conditions.includes("a trade-in") && /do not say the customer qualifies/.test(p.note), JSON.stringify(p));
  const a = (await run("tmo_catalog", { kind: "addons", query: "protection" })).result.data as any; ok(a.results[0].monthly === "$7" && a.results[0].deductible_screen === "$19", JSON.stringify(a));
});
await t("tmo_catalog works for an unverified stranger (public data), tmo_context still does not", async () => {
  ok((await run("tmo_catalog", { kind: "plans" })).result.ok, "catalog open");
  const r = await run("tmo_context", {}); ok(!r.result.ok, "context closed to the unverified");
});

await t("customer_profile_update: saves what they said, turns an unknown number into a tracked prospect, names them, ties it to the call", async () => {
  const callId = new ObjectId();
  const r = await run("customer_profile_update", { first_name: "Dana", current_carrier: "Verizon", line_count: 3, devices: ["iPhone 13, about 3 years old"], budget_usd: 150 }, { callId });
  ok(r.result.ok && r.result.sideEffect, JSON.stringify(r.result));
  const c: any = await db.collection("contacts").findOne({ _id: kit.contactId });
  ok(c.intake.current_carrier === "Verizon" && c.intake.line_count === 3 && c.intake.devices.length === 1 && c.intake.budget_usd === 150, JSON.stringify(c.intake));
  ok(c.profile.displayName === "Dana", "named");
  ok(c.externalRefs.some((x: any) => x.kind === "prospect" && x.system === "tmobile"), "tracked as a prospect");
  ok(String(c.intake.sources[0].callId) === String(callId), "provenance: the call");
});
await t("customer_profile_update: later answers replace scalars, lists accumulate without duplicates, secrets and empties are refused", async () => {
  await run("customer_profile_update", { current_carrier: "AT&T", devices: ["iPhone 13, about 3 years old", "Pixel 8"] });
  const c: any = await db.collection("contacts").findOne({ _id: kit.contactId });
  ok(c.intake.current_carrier === "AT&T" && c.intake.devices.length === 2, JSON.stringify(c.intake));
  ok(c.externalRefs.filter((x: any) => x.kind === "prospect").length === 1, "one prospect ref");
  const bad = await run("customer_profile_update", { note: "my PIN is 4821 and ssn 123-45-6789" }); ok(!bad.result.ok && bad.result.error === "not_storable", JSON.stringify(bad.result));
  const none = await run("customer_profile_update", {}); ok(!none.result.ok && none.result.error === "nothing_to_save", "empty refused");
  const after: any = await db.collection("contacts").findOne({ _id: kit.contactId }); ok(!JSON.stringify(after).includes("4821"), "secret never stored");
});
await t("the prompt shows what we know and what is still unknown (so the model asks one natural thing), and drops the questions once known", async () => {
  const msg = await kit.addInbound(kit.conversationId, "what is my best plan?");
  const sys = (await buildContext(db, kit.deps(new ScriptedLlm([])).env, { orgId, conversationId: kit.conversationId, channel: "imessage", mode: "text", batch: [{ _id: msg, body: "x", ts: kit.now.t }] })).messages[0].content as string;
  ok(/What they have told us[^\n]*carrier AT&T[^\n]*3 line/.test(sys) && /Not known yet[^\n]*current plan or monthly bill/.test(sys) && !/Not known yet[^\n]*first name/.test(sys), sys.split("\n").filter((l) => /told us|Not known/.test(l)).join(" | "));
  ok(/customer_profile_update/.test(sys) && /tmo_catalog/.test(sys) && /Getting to know someone/.test(sys) && /On a phone call/.test(sys), "prompt teaches the tools and the manner");
});
await t("an engine turn can use the tools end to end: the model records what a stranger said, looks up the price, and answers with the exact total", async () => {
  const { contactId, conversationId } = await kit.newContact("+14255550999");
  const msg = await kit.addInbound(conversationId, "Hi, I'm Sam, 3 lines on T-Mobile now, what would Beyond cost?");
  const llm = new ScriptedLlm([
    { tools: [{ name: "customer_profile_update", args: { first_name: "Sam", line_count: 3, current_carrier: "T-Mobile" } }, { name: "tmo_catalog", args: { kind: "plans", query: "Beyond", lines: 3 } }] },
    { content: "Nice to meet you Sam. For 3 lines, Experience Beyond 2.0 is $230 a month with AutoPay." },
  ]);
  const r = await runTurn(kit.deps(llm), { orgId, conversationId, channel: "imessage", mode: "text", batch: [{ _id: msg, body: "Hi, I'm Sam, 3 lines on T-Mobile now, what would Beyond cost?", ts: kit.now.t }] });
  ok(r.outcome === "reply" && /\$230/.test(r.text), r.outcome + " " + r.text);
  const c: any = await db.collection("contacts").findOne({ _id: contactId }); ok(c.intake?.first_name === "Sam" && c.intake.line_count === 3, JSON.stringify(c.intake));
});

await t("extraction: only valid, non-secret fields survive; JSON is found inside chatter and reasoning tags", async () => {
  const s = sanitizeExtracted({ first_name: "Lee", monthly_bill_usd: 180, line_count: 0, devices: ["iPhone 12", "my card is 4242 4242 4242 4242"], budget_usd: -5, preferred_contact: "carrier pigeon", junk: 1, interests: ["Hotspot"] });
  ok(s.first_name === "Lee" && s.monthly_bill_usd === 180 && s.line_count === undefined && s.budget_usd === undefined && s.preferred_contact === undefined && !("junk" in s), JSON.stringify(s));
  ok(s.devices?.length === 1 && s.devices[0] === "iPhone 12" && s.interests?.[0] === "hotspot", JSON.stringify(s));
  ok(parseJsonObject('<think>hmm {x}</think> Here: {"first_name":"Lee"} done').first_name === "Lee", "json found");
  ok(Object.keys(parseJsonObject("no json here")).length === 0, "garbage becomes empty");
});
await t("applyExtraction fills gaps and never overwrites what is already recorded; the call keeps its own copy", async () => {
  const { contactId } = await kit.newContact("+14255550888", { intake: { current_carrier: "Verizon", devices: ["iPhone 14"] } });
  const callId = new ObjectId(); await db.collection("calls").insertOne({ _id: callId, orgId, contactId, conversationId: new ObjectId(), direction: "in", durationSec: 0, startedAt: kit.now.t, status: "completed" } as never);
  const added = await applyExtraction(db, { orgId, callId, contactId, ex: { current_carrier: "AT&T", line_count: 2, devices: ["iPhone 14", "Galaxy S24"] }, now: kit.now.t });
  const c: any = await db.collection("contacts").findOne({ _id: contactId });
  ok(c.intake.current_carrier === "Verizon" && c.intake.line_count === 2 && c.intake.devices.join() === "iPhone 14,Galaxy S24" && added.includes("line_count") && !added.includes("current_carrier"), JSON.stringify(c.intake));
  ok(c.externalRefs.some((x: any) => x.kind === "prospect"), "now tracked as a prospect");
  const call: any = await db.collection("calls").findOne({ _id: callId }); ok(call.extracted.current_carrier === "AT&T", "call keeps what the transcript said");
});
await t("post-call webhook: transcript is saved AND the caller's plan, device and lines are read from it and attached to the new customer", async () => {
  const { contactId, conversationId } = await kit.newContact("+14255550777");
  const callId = new ObjectId(); await db.collection("calls").insertOne({ _id: callId, orgId, contactId, conversationId, direction: "in", durationSec: 0, provider: "elevenlabs", providerCallId: "conv_1", providerConversationId: "conv_1", status: "active", startedAt: new Date(kit.now.t.getTime() - 120_000), line: "+12065550100", peer: "+14255550777" } as never);
  const llm = new ScriptedLlm([{ content: 'Sure: {"first_name":"Priya","current_carrier":"Verizon","current_plan":"Unlimited Plus","line_count":4,"devices":["iPhone 14 Pro","iPhone 11"],"monthly_bill_usd":240}' }]);
  const evt = { type: "post_call_transcription", data: { conversation_id: "conv_1", metadata: { call_duration_secs: 95 }, analysis: { transcript_summary: "Prospect comparing plans" }, transcript: [
    { role: "agent", message: "Hi, thanks for calling. Who am I speaking with?", time_in_call_secs: 0 }, { role: "user", message: "Priya. I have four lines on Verizon Unlimited Plus, about $240 a month.", time_in_call_secs: 4 },
    { role: "agent", message: "Got it. What phones are on those lines?", time_in_call_secs: 8 }, { role: "user", message: "An iPhone 14 Pro and an iPhone 11 mostly.", time_in_call_secs: 12 } ] } };
  const logs: string[] = []; const r = await importCallEvent(db, evt, kit.now.t, (m) => logs.push(m), llm);
  ok(r.handled === "transcript" && r.imported === 4, JSON.stringify(r));
  const c: any = await db.collection("contacts").findOne({ _id: contactId });
  ok(c.intake.first_name === "Priya" && c.intake.current_plan === "Unlimited Plus" && c.intake.line_count === 4 && c.intake.devices.length === 2 && c.intake.monthly_bill_usd === 240, JSON.stringify(c.intake));
  ok(c.externalRefs.some((x: any) => x.kind === "prospect") && String(c.intake.sources.at(-1).callId) === String(callId), "attached to the new customer, tied to the call");
  const sent = JSON.stringify(llm.requests[0].messages); ok(/CALLER: Priya/.test(sent) && /AGENT: Hi/.test(sent), "model reads the labelled transcript");
  // the model failing must not lose the transcript
  const { contactId: c2, conversationId: v2 } = await kit.newContact("+14255550666");
  await db.collection("calls").insertOne({ orgId, contactId: c2, conversationId: v2, direction: "in", durationSec: 0, provider: "elevenlabs", providerCallId: "conv_2", providerConversationId: "conv_2", status: "active", startedAt: kit.now.t, line: "+12065550100", peer: "+14255550666" } as never);
  const bad = await importCallEvent(db, { ...evt, data: { ...evt.data, conversation_id: "conv_2" } }, kit.now.t, () => {}, new ScriptedLlm([{ throws: "model down" }]));
  ok(bad.handled === "transcript" && bad.imported === 4, "transcript saved even when extraction fails");
});
await t("extractIntake sends nothing to the model when the caller never spoke", async () => {
  const llm = new ScriptedLlm([{ content: "{}" }]); const r = await extractIntake(llm, [{ role: "agent", message: "Hello?" }]);
  ok(Object.keys(r).length === 0 && llm.requests.length === 0, "no call");
});

await t("reach: a caller is offered the call number to text details to, with the honest limit; iMessage is NOT auto-assigned without an assigner", async () => {
  const mkLine = (channel: string, address: string, extra = {}) => db.collection("channel_lines").insertOne({ orgId, channel, provider: "photon", photonLineId: null, address, status: "active", capabilities: [], createdAt: kit.now.t, ...extra } as never);
  await mkLine("voice", "+12065550100", { capabilities: ["pstn_voice"] }); await mkLine("sms", "+12065550100", { capabilities: ["sms"] }); await mkLine("whatsapp", "+12065550100");
  kit.ready.imessage = { ok: false }; kit.ready.whatsapp = { ok: false };
  const contact: any = await db.collection("contacts").findOne({ _id: kit.contactId });
  const r = await computeReach({ db, messenger: kit.messenger }, { orgId, contact, conversationId: kit.conversationId });
  ok(!r.options.some((o) => o.channel === "imessage"), "no iMessage option without an assigner");
  ok(r.textIn?.number === "+12065550100" && r.options.some((o) => o.channel === "whatsapp"), JSON.stringify(r));
  const m: any = reachForModel(r, "voice"); ok(/cannot text back/.test(m.text_us_info_only.limits) && /never use it for codes/i.test(m.text_us_info_only.limits), JSON.stringify(m.text_us_info_only));
  ok(/WhatsApp/.test(suggestedReply(r, "voice")), "codes and forms route through WhatsApp");
  const noWa = suggestedReply({ ...r, options: [] }, "voice"); ok(/can't text you back/.test(noWa) && /two zero six/.test(noWa), noWa);
});

await t("listen-only SMS: the message is stored and the model learns from it, but nothing is ever sent back", async () => {
  const phone = "+14255550555";
  const w = new Worker(db, {} as never, kit.adapters.sms, async () => {}, { scheduled: true, listenOnly: true, debounceMs: 30, maxWaitMs: 200, brand: "T-Mobile" });
  const llm = new ScriptedLlm([{ tools: [{ name: "customer_profile_update", args: { first_name: "Jo", current_carrier: "Mint" } }] }, { content: "Thanks Jo, I'll remember that." }]);
  const sched = new Scheduler({ db, engine: kit.deps(llm), workers: { sms: w }, pollMs: 20, leaseMs: 5000, heartbeatMs: 1000 }); sched.start();
  await w.handleInbound({ orgId, address: phone, text: "Hi it's Jo, I'm on Mint right now", channelMsgId: "sms_1", ref: {} });
  await sleep(1200); await sched.stop();
  ok(kit.adapters.sms.sent.length === 0, "nothing sent");
  const c: any = await db.collection("contacts").findOne({ "handles.address": phone }); ok(c?.intake?.first_name === "Jo" && c.intake.current_carrier === "Mint", JSON.stringify(c?.intake));
  ok(/listen-only/i.test(JSON.stringify(llm.requests[0].messages[0])), "model is told its reply will not be delivered");
  const out = await db.collection("messages").countDocuments({ direction: "out", channel: "sms" }); ok(out === 0, "no outbound row");
  await w.handleInbound({ orgId, address: phone, text: "STOP", channelMsgId: "sms_2", ref: {} }); ok(kit.adapters.sms.sent.length === 0, "STOP/HELP replies cannot go out either");
});
await finish(kit);

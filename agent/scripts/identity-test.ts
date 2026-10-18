// Offline tests (in-memory Mongo, no network): who-is-this resolution, call logging, WhatsApp log-only.  pnpm exec tsx scripts/identity-test.ts
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, ObjectId } from "mongodb";
import { applySchema } from "../../web/src/lib/schema";
import { normalizeAddress, resolveParty } from "../src/identity";
import { handleCallEvent } from "../src/calls";
import { LoopbackAdapter, Worker } from "../src/recorded-io";
import { loadCustomer, buildCustomerBlock } from "../src/customer";
import { renderPrompt, loadTemplate, channelStyle } from "../src/prompt";

let pass = 0, fail = 0;
const t = async (name: string, f: () => Promise<string | void>) => { try { const d = await f(); pass++; console.log("PASS", name, d ?? ""); } catch (e) { fail++; console.log("FAIL", name, (e as Error).message); } };
const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };

const mongo = await MongoMemoryServer.create();
const client = await new MongoClient(mongo.getUri()).connect();
const db = client.db("t");
await applySchema(db);
const orgId = new ObjectId();
await db.collection("orgs").insertOne({ _id: orgId, name: "T", productDescription: "x", brandVoice: "x", hours: "x", plan: "pro", createdAt: new Date() });
await db.collection("channel_lines").insertOne({ orgId, channel: "sms", provider: "photon", photonLineId: null, address: "+12065550000", status: "active", capabilities: [], createdAt: new Date() });
const PHONE = "+14255550123";

await t("normalizeAddress: formats collapse to E.164", async () => {
  for (const x of ["(425) 555-0123", "425-555-0123", "1 425 555 0123", "+1 (425) 555-0123", "4255550123"]) ok(normalizeAddress(x) === PHONE, `${x} -> ${normalizeAddress(x)}`);
  ok(normalizeAddress(" Person@Example.COM ") === "person@example.com", "email");
});
await t("new texter becomes one contact and one conversation", async () => {
  const p = await resolveParty(db, { orgId, channel: "sms", address: "(425) 555-0123" });
  ok(p.created && p.matchedBy === "new", "should be new");
  ok(p.contact.handles[0].address === PHONE, "stored as E.164");
  ok(p.externalRefs.length === 0, "unknown person has no account link");
});
await t("same person on iMessage, WhatsApp and voice is the SAME contact and conversation", async () => {
  const sms = await resolveParty(db, { orgId, channel: "sms", address: PHONE });
  const im = await resolveParty(db, { orgId, channel: "imessage", address: PHONE });
  const wa = await resolveParty(db, { orgId, channel: "whatsapp", address: "+1 425 555 0123" });
  const vo = await resolveParty(db, { orgId, channel: "voice", address: PHONE });
  ok(String(sms.contact._id) === String(im.contact._id) && String(im.contact._id) === String(wa.contact._id) && String(wa.contact._id) === String(vo.contact._id), "contacts differ");
  ok(String(sms.conversation._id) === String(vo.conversation._id), "conversations differ");
  ok(im.matchedBy === "other_channel_handle", "first iMessage should match via the SMS handle, got " + im.matchedBy);
  const c = await db.collection("contacts").findOne({ _id: sms.contact._id });
  ok(c!.handles.length === 4, "expected 4 handles, got " + c!.handles.length);
  ok((await db.collection("contacts").countDocuments({ orgId })) === 1, "duplicate contacts");
});
await t("20 simultaneous first messages from a new number create exactly one contact and one conversation", async () => {
  const addr = "+14255559999";
  const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => resolveParty(db, { orgId, channel: i % 2 ? "sms" : "imessage", address: addr })));
  ok(new Set(rs.map((r) => String(r.contact._id))).size === 1, "multiple contacts");
  ok(new Set(rs.map((r) => String(r.conversation._id))).size === 1, "multiple conversations");
  ok((await db.collection("contacts").countDocuments({ orgId, "handles.address": addr })) === 1, "db has duplicates");
});
await t("a contact with an external account link exposes it; an unknown number never does", async () => {
  await db.collection("contacts").updateOne({ orgId, "handles.address": PHONE }, { $set: { externalRefs: [{ system: "tmobile", id: "ACC-PERSONA-03", kind: "account" }] } });
  const known = await resolveParty(db, { orgId, channel: "voice", address: PHONE });
  ok(known.externalRefs[0]?.id === "ACC-PERSONA-03", "link missing");
  const stranger = await resolveParty(db, { orgId, channel: "sms", address: "+14255551111" });
  ok(stranger.externalRefs.length === 0, "stranger must not inherit an account");
});

const ev = (type: string, id: string, extra: Record<string, unknown> = {}, ts = "2026-10-18T01:00:00.000Z") => ({
  id: `evt_${type}_${id}`, type, apiVersion: "2026-07-01", timestamp: ts,
  data: { projectId: "p", object: { id, direction: "inbound", caller: { handle: PHONE }, callee: { handle: "+12065550000" }, ...extra } },
});
const seq = (id: string, answered: boolean) => [
  ev("call.started", id, { timestamps: { startedAt: "2026-10-18T01:00:00.000Z" } }, "2026-10-18T01:00:00.000Z"),
  ev("call.ringing", id, { timestamps: { startedAt: "2026-10-18T01:00:00.000Z", ringingAt: "2026-10-18T01:00:00.020Z" } }, "2026-10-18T01:00:00.020Z"),
  ...(answered ? [
    ev("call.answered", id, { timestamps: { startedAt: "2026-10-18T01:00:00.000Z", answeredAt: "2026-10-18T01:00:00.700Z" } }, "2026-10-18T01:00:00.700Z"),
    ev("call.connected", id, { timestamps: { startedAt: "2026-10-18T01:00:00.000Z", answeredAt: "2026-10-18T01:00:00.700Z", connectedAt: "2026-10-18T01:00:00.720Z" } }, "2026-10-18T01:00:00.720Z"),
  ] : []),
  ev("call.ended", id, { status: answered ? "completed" : "canceled", timestamps: { startedAt: "2026-10-18T01:00:00.000Z", ...(answered ? { answeredAt: "2026-10-18T01:00:00.700Z" } : {}), endedAt: "2026-10-18T01:00:09.700Z" } }, "2026-10-18T01:00:09.700Z"),
];
await t("an answered call is logged once: status, 9 s duration, caller linked to the existing contact, marker in the timeline", async () => {
  for (const e of seq("call_A", true)) ok((await handleCallEvent(db, e as never)).ok, "event rejected");
  const c = await db.collection("calls").findOne({ providerCallId: "call_A" });
  ok(c && c.status === "completed" && c.durationSec === 9 && c.direction === "in", JSON.stringify({ s: c?.status, d: c?.durationSec }));
  ok(c!.events.length === 5, "events " + c!.events.length);
  const contact = await db.collection("contacts").findOne({ "handles.address": PHONE });
  ok(String(c!.contactId) === String(contact!._id), "call not linked to the known contact");
  const m = await db.collection("messages").findOne({ channelMsgId: "call:call_A" });
  ok(m && m.channel === "voice" && m.body === "Phone call (0:09)", "marker: " + m?.body);
  const conv = await db.collection("conversations").findOne({ _id: c!.conversationId });
  ok(conv!.lastChannel === "voice" && conv!.lastMessagePreview === "Phone call (0:09)", "conversation not updated");
});
await t("replaying every event, and out-of-order delivery, creates no duplicates and never moves the status backwards", async () => {
  for (const e of [...seq("call_A", true)].reverse()) await handleCallEvent(db, e as never);
  ok((await db.collection("calls").countDocuments({ providerCallId: "call_A" })) === 1, "duplicate call doc");
  ok((await db.collection("messages").countDocuments({ channelMsgId: "call:call_A" })) === 1, "duplicate marker");
  ok((await db.collection("calls").findOne({ providerCallId: "call_A" }))!.status === "completed", "status moved backwards");
});
await t("an unanswered call is logged as missed with zero duration", async () => {
  for (const e of seq("call_B", false)) await handleCallEvent(db, e as never);
  const c = await db.collection("calls").findOne({ providerCallId: "call_B" });
  ok(c!.status === "missed" && c!.durationSec === 0, `${c!.status}/${c!.durationSec}`);
  ok((await db.collection("messages").findOne({ channelMsgId: "call:call_B" }))!.body === "Missed call", "marker");
});
await t("a call to a number we do not serve is parked in unrouted_events, not attached to any business", async () => {
  const bad = ev("call.started", "call_C"); (bad.data.object as any).callee = { handle: "+19995550000" };
  const r = await handleCallEvent(db, bad as never);
  ok(!r.ok && r.reason === "unrouted", "should be unrouted");
  ok((await db.collection("unrouted_events").countDocuments({})) === 1, "not parked");
  ok((await db.collection("calls").countDocuments({ providerCallId: "call_C" })) === 0, "call created for unknown line");
});
await t("WhatsApp in log-only mode stores the message, never calls the agent, never sends", async () => {
  await db.collection("agents").insertOne({ orgId, status: "running", persona: "p", guardrails: { maxDiscountPct: 10, escalateOn: [] }, enabledChannels: { imessage: true, whatsapp: true, sms: false, voice: false }, sandboxId: null, updatedAt: new Date() });
  let agentCalls = 0;
  const link = { online: async () => true, waitOnline: async () => {}, send: async () => { agentCalls++; throw new Error("agent must not be called"); } };
  const lb = new LoopbackAdapter(); (lb as any).channel = "whatsapp";
  const w = new Worker(db, link as never, lb, async () => {}, { autoReply: false });
  const r: any = await w.handleInbound({ orgId, address: "+16465554168", text: "Continue setting up your account", channelMsgId: "wa_1" });
  ok(r.handling === "ignored", "handling " + r.handling);
  ok(agentCalls === 0 && lb.sent.length === 0, "agent called or message sent");
  const m = await db.collection("messages").findOne({ channelMsgId: "wa_1" });
  ok(m && m.channel === "whatsapp" && m.handling === "ignored" && m.deliveryStatus === "received", "not stored properly");
});
await t("WhatsApp from a known number lands in the SAME conversation", async () => {
  const w = new Worker(db, { online: async () => true } as never, Object.assign(new LoopbackAdapter(), { channel: "whatsapp" as const }), async () => {}, { autoReply: false });
  await w.handleInbound({ orgId, address: PHONE, text: "hi on whatsapp", channelMsgId: "wa_2" });
  const m = await db.collection("messages").findOne({ channelMsgId: "wa_2" });
  const contact = await db.collection("contacts").findOne({ "handles.address": PHONE });
  const conv = await db.collection("conversations").findOne({ contactId: contact!._id });
  ok(String(m!.conversationId) === String(conv!._id), "different conversation");
});


// ---------- customer context + system prompt ----------
const TMO = new ObjectId();
await t("customer: linked account + persona is recognized; unverified output withholds ALL account details", async () => {
  await db.collection("tmo_accounts").insertOne({ orgId, accountId: "ACC-PERSONA-03", importedAt: new Date(), segment: "family", asOf: "2026-10-01", lines: [{ lineId: "L1", memberLabel: "Line 1", memberRole: "primary" }, { lineId: "L2", memberLabel: "Teen A", memberRole: "teen" }],
    context: { tenure_months: 40, support: { contacts_90d: 2 }, billing: { change_pct_vs_prior_avg: 0.18 }, signals: { port_out_inquiry: 1, competitor_research_score: 0.7 } } });
  await db.collection("contacts").updateOne({ orgId, "handles.address": PHONE }, { $set: {
    externalRefs: [{ system: "tmobile", id: "ACC-PERSONA-03", kind: "account" }],
    profile: { displayName: "Maya", tone: "careful and empathetic", relationship: "at-risk", language: "en", channelPref: "sms", sensitivities: ["billing: 3 contacts, 1 unresolved. Do not open with a sales pitch."], synthetic: true },
    memory: { openLoops: [{ text: "check trade-in value on iPhone 13", status: "open" }, { text: "old done thing", status: "done" }] },
    facts: [{ text: "moving in January", learnedAt: new Date(), sourceMessageId: null }, { text: "old wrong fact", learnedAt: new Date(0), sourceMessageId: null, supersededBy: new ObjectId() }] } });
  const party = await resolveParty(db, { orgId, channel: "voice", address: PHONE });
  const cust = await loadCustomer(db, party, { orgId });
  ok(cust.status === "linked_account" && cust.firstName === "Maya" && !cust.verified, "status/name/verified");
  ok(cust.facts.join() === "moving in January", "superseded fact leaked: " + cust.facts.join());
  ok(cust.openLoops.join() === "check trade-in value on iPhone 13", "open loops: " + cust.openLoops.join());
  const block = buildCustomerBlock(cust, { channel: "voice" });
  ok(/RECOGNIZED CUSTOMER \(account ACC-PERSONA-03\)/.test(block) && /Verified: NO/.test(block), "header");
  ok(/An account is on file/.test(block), "should only say an account exists");
  for (const leak of ["family", "40 months", "teen", "18%", "port", "competitor", "2026-10-01"]) ok(!block.toLowerCase().includes(leak.toLowerCase()), `unverified prompt leaks "${leak}"`);
  ok(/bring up first/.test(block) && /moving in January/.test(block), "memory should still be present");
});
await t("customer: after one-time-code verification the snapshot appears with its as-of date and internal signals are marked do-not-mention", async () => {
  await db.collection("contacts").updateOne({ orgId, "handles.address": PHONE }, { $set: { verifiedPhone: { number: PHONE, at: new Date(), method: "sms_otp" } } });
  const party = await resolveParty(db, { orgId, channel: "voice", address: PHONE });
  const cust = await loadCustomer(db, party, { orgId });
  ok(cust.verified, "should be verified");
  const block = buildCustomerBlock(cust, { channel: "voice" });
  ok(/as of 2026-10-01/.test(block) && /2 line\(s\)/.test(block) && /40 months/.test(block), "snapshot missing: " + block);
  ok(/Internal context, never mention to the customer: asked about porting out; researching competitors/.test(block), "internal signals");
});
await t("customer: verification expires after 30 minutes and does not carry to a different number", async () => {
  const party = await resolveParty(db, { orgId, channel: "voice", address: PHONE });
  ok(!(await loadCustomer(db, party, { orgId, now: new Date(Date.now() + 31 * 60_000) })).verified, "still verified after 31 min");
  await db.collection("contacts").updateOne({ _id: party.contact._id }, { $set: { "verifiedPhone.number": "+19998887777" } });
  const p2 = await resolveParty(db, { orgId, channel: "voice", address: PHONE });
  ok(!(await loadCustomer(db, p2, { orgId })).verified, "verification of another number must not count");
});
await t("customer: unknown number is a prospect-like stranger with no account and no snapshot", async () => {
  const party = await resolveParty(db, { orgId, channel: "sms", address: "+14255552222" });
  const cust = await loadCustomer(db, party, { orgId });
  const block = buildCustomerBlock(cust, { channel: "sms" });
  ok(cust.status === "unknown" && cust.account === null, "should be unknown");
  ok(/UNKNOWN NUMBER/.test(block) && /never guess an account/.test(block), block);
});
await t("prompt: renders fully, no placeholder left, channel style applied, and a missing value is an error", async () => {
  const tpl = loadTemplate("tmobile-system");
  const vars = { assistant_name: "Magenta Assistant", brand: "T-Mobile (demo)", disclosure: "Say you are an AI assistant in your first message.", customer_block: "Who: UNKNOWN NUMBER", knowledge_block: "- Tune-up: $89", tools_block: "- knowledge_search: look things up", channel_style: channelStyle("voice"), max_discount: "0", escalation_triggers: "cancellation inquiry in the last 30 days", now: "2026-10-18", business_hours: "24/7" };
  const out = renderPrompt(tpl, vars);
  ok(!/\{\{\w+\}\}/.test(out), "placeholder left");
  ok(/Phone call: spoken style/.test(out) && /not a person/.test(out) && /handoff_escalate/.test(out), "content");
  let threw = false; try { renderPrompt(tpl, { ...vars, brand: undefined as never }); } catch { threw = true; }
  ok(threw, "missing value must throw");
  const words = out.split(/\s+/).length;
  return `${words} words (~${Math.round(words * 1.35)} tokens)`;
});

console.log(`\n${pass} passed, ${fail} failed`);
await client.close(); await mongo.stop();
process.exit(fail ? 1 : 0);

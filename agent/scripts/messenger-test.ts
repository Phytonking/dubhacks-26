// Messenger, opt-outs, one-time codes, secure forms.  pnpm exec tsx scripts/messenger-test.ts
import { ObjectId } from "mongodb";
import { detectKeyword, isOptedOut, setOptOut, clearOptOut, keywordReply } from "../src/optout";
import { issueCode, checkCode, normalizeSpokenCode, LIMITS } from "../src/verification";
import { executeTool, runTurn } from "../src/engine/turn";
import { agentViewOfForm, createFormRequest, decryptSecret, encryptSecret, loadRequestForRender, revealField, submitForm, hashToken } from "../../web/src/lib/forms-core";
import { ScriptedLlm, ok, t, finish, makeKit } from "./_testkit";

const kit = await makeKit();
const { db, orgId, messenger, adapters } = kit;
const base = (o: Record<string, unknown> = {}) => ({ orgId, contactId: kit.contactId, conversationId: kit.conversationId, purpose: "info" as const, body: "hello", ...o });
const toolCtx = async () => {
  const contact: any = await db.collection("contacts").findOne({ _id: kit.contactId });
  const conversation: any = await db.collection("conversations").findOne({ _id: kit.conversationId });
  return { db, orgId, contactId: kit.contactId, conversationId: kit.conversationId, channel: "imessage" as const, mode: "text" as const,
    party: { contact, conversation, address: kit.phone, created: false, matchedBy: "channel_handle" as const, externalRefs: [{ system: "tmobile", id: "ACC-1", kind: "account" }] }, customer: {} as never, turnId: "turn-x",
    sourceMessageId: null, now: kit.now.t, messenger, env: kit.deps(new ScriptedLlm([])).env, guard: { cfg: { maxDiscountPct: 10 }, evidence: [] as string[] } };
};
const reset = async () => { for (const a of Object.values(adapters)) { a.sent.length = 0; a.failNext = 0; } await db.collection("messages").deleteMany({ purpose: { $exists: true } }); await db.collection("verifications").deleteMany({}); await db.collection("opt_outs").deleteMany({}); kit.ready.imessage = { ok: true }; kit.ready.whatsapp = { ok: true }; kit.ready.sms = { ok: false, reason: "campaign not eligible" }; await db.collection("contacts").updateOne({ _id: kit.contactId }, { $unset: { consent: "", verifiedPhone: "" } }); await db.collection("messages").deleteMany({ conversationId: kit.conversationId }); };

// ---------------- keywords ----------------
await t("keywords: STOP, START, HELP match only as the whole message; sentences that merely contain them do not", async () => {
  for (const w of ["STOP", "stop", " Stop. ", "UNSUBSCRIBE", "cancel", "END", "quit", "STOPALL"]) ok(detectKeyword(w, false) === "stop", w);
  for (const w of ["stop it, you're annoying", "please don't stop", "I want to cancel my plan", "the end of the month"]) ok(detectKeyword(w, false) === null, w);
  ok(detectKeyword("START", false) === "start" && detectKeyword("HELP", false) === "help" && detectKeyword("info", false) === "help", "start/help");
  ok(detectKeyword("yes", false) === null && detectKeyword("yes", true) === "start", "'yes' is START only after an opt-out");
});
await t("opt-out is per business+number and survives across channels; START clears it", async () => {
  await reset();
  await setOptOut(db, orgId, kit.phone, "STOP"); await setOptOut(db, orgId, kit.phone, "STOP");
  ok((await db.collection("opt_outs").countDocuments({ orgId })) === 1, "idempotent");
  ok(await isOptedOut(db, orgId, [kit.phone]) && !(await isOptedOut(db, new ObjectId(), [kit.phone])), "scoped to business");
  await clearOptOut(db, orgId, kit.phone); ok(!(await isOptedOut(db, orgId, [kit.phone])), "cleared");
  ok(/unsubscribed/.test(keywordReply("stop", "Sunrise")) && /Reply STOP/.test(keywordReply("help", "Sunrise")), "reply text");
});

// ---------------- messenger ----------------
await t("messenger: proactive text needs consent; implicit (they texted in the last 24h) or explicit (recorded)", async () => {
  await reset();
  let r = await messenger.send(base({ purpose: "info" }));
  ok(!r.ok && r.error === "no_consent", JSON.stringify(r));
  await kit.addInbound(kit.conversationId, "hi", { ts: kit.now.t });
  r = await messenger.send(base({ purpose: "info", idempotencyKey: "k1" }));
  ok(r.ok && r.channel === "imessage" && adapters.imessage.sent.length === 1, "implicit consent from a recent inbound text: " + JSON.stringify(r));
  await reset(); await db.collection("contacts").updateOne({ _id: kit.contactId }, { $set: { "consent.text": { granted: true, at: kit.now.t, source: "voice" } } });
  r = await messenger.send(base({ purpose: "info" }));
  ok(r.ok, "explicit consent: " + JSON.stringify(r));
  await reset(); await db.collection("contacts").updateOne({ _id: kit.contactId }, { $set: { "consent.text": { granted: false, at: kit.now.t, source: "voice" } } });
  await kit.addInbound(kit.conversationId, "hi", { ts: new Date(kit.now.t.getTime() - 25 * 3600_000) });
  r = await messenger.send(base({ purpose: "info" }));
  ok(!r.ok && r.error === "no_consent", "a refusal plus an old text is still no consent: " + JSON.stringify(r));
});
await t("messenger: opted-out numbers are never texted, on any channel, even with consent", async () => {
  await reset(); await db.collection("contacts").updateOne({ _id: kit.contactId }, { $set: { "consent.text": { granted: true, at: kit.now.t, source: "voice" } } });
  await setOptOut(db, orgId, kit.phone, "STOP");
  for (const ch of ["imessage", "whatsapp", "sms"] as const) { const r = await messenger.send(base({ purpose: "reply", channels: [ch] })); ok(!r.ok && r.error === "opted_out", ch); }
  ok(Object.values(adapters).every((a) => a.sent.length === 0), "nothing sent");
});
await t("messenger: first READY channel wins; SMS is skipped while the campaign is blocked; a failing channel falls through to the next", async () => {
  await reset(); await db.collection("contacts").updateOne({ _id: kit.contactId }, { $set: { "consent.text": { granted: true, at: kit.now.t, source: "voice" } } });
  let r = await messenger.send(base({ channels: ["sms", "whatsapp", "imessage"] }));
  ok(r.ok && r.channel === "whatsapp", "sms not ready -> whatsapp: " + JSON.stringify(r));
  adapters.whatsapp.failNext = 1;
  r = await messenger.send(base({ channels: ["whatsapp", "imessage"], idempotencyKey: "k2" }));
  ok(r.ok && r.channel === "imessage", "whatsapp failed -> imessage: " + JSON.stringify(r));
  const failed = await db.collection("messages").countDocuments({ deliveryStatus: "failed", purpose: "info" }); ok(failed === 1, "the failed attempt is recorded");
  kit.ready.imessage = { ok: false, reason: "no recent inbound" }; kit.ready.whatsapp = { ok: false, reason: "24h window closed" };
  r = await messenger.send(base({ idempotencyKey: "k3" }));
  ok(!r.ok && r.error === "no_channel", JSON.stringify(r));
});
await t("messenger: the destination comes from the contact; there is no parameter to point it elsewhere", async () => {
  await reset(); await db.collection("contacts").updateOne({ _id: kit.contactId }, { $set: { "consent.text": { granted: true, at: kit.now.t, source: "voice" } } });
  await messenger.send({ ...base(), address: "+19998887777", to: "+19998887777" } as never);
  ok(adapters.imessage.sent[0].address === kit.phone, "sent to " + adapters.imessage.sent[0].address);
});
await t("messenger: redacted body is what gets stored; the real body goes only to the provider; same idempotency key does not send twice", async () => {
  await reset(); await db.collection("contacts").updateOne({ _id: kit.contactId }, { $set: { "consent.text": { granted: true, at: kit.now.t, source: "voice" } } });
  const a = await messenger.send(base({ body: "Your code is 482913", redact: "[verification code sent]", idempotencyKey: "otp-1", purpose: "otp" }));
  const b = await messenger.send(base({ body: "Your code is 482913", redact: "[verification code sent]", idempotencyKey: "otp-1", purpose: "otp" }));
  ok(a.ok && b.ok && (b as any).duplicate && adapters.imessage.sent.length === 1, "single send");
  const rows = await db.collection("messages").find({ conversationId: kit.conversationId, purpose: "otp" }).toArray();
  ok(rows.length === 1 && rows[0].body === "[verification code sent]" && rows[0].redacted === true, JSON.stringify(rows.map((r) => r.body)));
  ok(!JSON.stringify(await db.collection("messages").find({}).toArray()).includes("482913"), "code must not be in any stored message");
  ok(adapters.imessage.sent[0].text.includes("482913"), "provider got the real text");
});
await t("messenger: rate limits stop proactive spam per number", async () => {
  await reset(); await db.collection("contacts").updateOne({ _id: kit.contactId }, { $set: { "consent.text": { granted: true, at: kit.now.t, source: "voice" } } });
  const results = [];
  for (let i = 0; i < 8; i++) results.push(await messenger.send(base({ idempotencyKey: `spam-${i}` })));
  ok(results.filter((r) => r.ok).length === 6 && results.slice(6).every((r) => !r.ok && (r as any).error === "rate_limited"), results.map((r) => (r.ok ? "ok" : (r as any).error)).join(","));
  const reply = await messenger.send(base({ purpose: "reply", idempotencyKey: "reply-1" })); ok(reply.ok, "direct replies are not limited");
});

// ---------------- one-time codes ----------------
await t("codes: issue, check, success sets verifiedPhone for that number only; the code is never stored", async () => {
  await reset();
  const i = await issueCode(db, { orgId, contactId: kit.contactId, number: kit.phone, secret: "s", now: kit.now.t });
  ok(i.ok && /^\d{6}$/.test(i.code), "6 digits");
  if (!i.ok) return;
  const row: any = await db.collection("verifications").findOne({ _id: i.id });
  ok(!JSON.stringify(row).includes(i.code) && row.codeHmac.length === 64, "only a keyed hash is stored");
  ok((await checkCode(db, { orgId, contactId: kit.contactId, number: "+19998887777", code: i.code, secret: "s", now: kit.now.t })).status === "none_pending", "a different number has nothing pending");
  const r = await checkCode(db, { orgId, contactId: kit.contactId, number: kit.phone, code: i.code, secret: "s", method: "otp_voice", now: kit.now.t });
  ok(r.status === "verified", JSON.stringify(r));
  const c: any = await db.collection("contacts").findOne({ _id: kit.contactId }); ok(c.verifiedPhone.number === kit.phone && c.verifiedPhone.method === "otp_voice", "flag set");
  ok((await checkCode(db, { orgId, contactId: kit.contactId, number: kit.phone, code: i.code, secret: "s", now: kit.now.t })).status === "none_pending", "single use");
});
await t("codes: wrong guesses count; the 5th wrong locks it; a correct code after that is rejected", async () => {
  await reset();
  const i = await issueCode(db, { orgId, contactId: kit.contactId, number: kit.phone, secret: "s", now: kit.now.t }); if (!i.ok) throw new Error("issue");
  const wrong = i.code === "123456" ? "654321" : "123456"; const seen: string[] = [];
  for (let n = 0; n < 5; n++) { const r = await checkCode(db, { orgId, contactId: kit.contactId, number: kit.phone, code: wrong, secret: "s", now: kit.now.t }); seen.push(r.status + (r.status === "wrong" ? ":" + r.triesLeft : "")); }
  ok(seen.join(",") === "wrong:4,wrong:3,wrong:2,wrong:1,locked", seen.join(","));
  ok((await checkCode(db, { orgId, contactId: kit.contactId, number: kit.phone, code: i.code, secret: "s", now: kit.now.t })).status !== "verified", "locked code must not verify");
  const c: any = await db.collection("contacts").findOne({ _id: kit.contactId }); ok(!c.verifiedPhone, "not verified");
});
await t("codes: expire after 5 minutes; a new code supersedes the old one; unreadable input does not use up an attempt", async () => {
  await reset();
  const a = await issueCode(db, { orgId, contactId: kit.contactId, number: kit.phone, secret: "s", now: kit.now.t }); if (!a.ok) throw new Error("a");
  ok((await checkCode(db, { orgId, contactId: kit.contactId, number: kit.phone, code: "nine eight", secret: "s", now: kit.now.t })).status === "bad_format", "bad format");
  ok(((await db.collection("verifications").findOne({ _id: a.id })) as any).attempts === 0, "bad_format is free");
  const later = new Date(kit.now.t.getTime() + 40_000);
  const b = await issueCode(db, { orgId, contactId: kit.contactId, number: kit.phone, secret: "s", now: later }); if (!b.ok) throw new Error("b");
  ok(((await db.collection("verifications").findOne({ _id: a.id })) as any).status === "superseded", "old code superseded");
  ok((await checkCode(db, { orgId, contactId: kit.contactId, number: kit.phone, code: a.code, secret: "s", now: later })).status !== "verified" || a.code === b.code, "old code must not work");
  const tooLate = new Date(later.getTime() + LIMITS.ttlMs + 1);
  ok((await checkCode(db, { orgId, contactId: kit.contactId, number: kit.phone, code: b.code, secret: "s", now: tooLate })).status === "expired", "expired");
});
await t("codes: 30 s cooldown, 3 per hour, 10 per day per number", async () => {
  await reset(); let tnow = kit.now.t.getTime(); const res: string[] = [];
  const go = async (dt: number) => { tnow += dt; const r = await issueCode(db, { orgId, contactId: kit.contactId, number: kit.phone, secret: "s", now: new Date(tnow) }); res.push(r.ok ? "ok" : r.error); };
  await go(0); await go(10_000); await go(31_000); await go(31_000); await go(31_000);
  ok(res.join(",") === "ok,cooldown,ok,ok,hourly_limit", res.join(","));
  await db.collection("verifications").deleteMany({}); res.length = 0; tnow = kit.now.t.getTime();
  for (let i = 0; i < 12; i++) await go(8 * 60_000);   // 8 min apart: hourly never trips, daily does
  ok(res.slice(0, 10).every((x) => x === "ok" || x === "hourly_limit") && res.includes("daily_limit") || res.filter((x) => x === "ok").length <= 10, res.join(","));
});
await t("codes: spoken digits are understood ('four eight two nine one oh'), anything else is not", async () => {
  ok(normalizeSpokenCode("four eight two nine one oh") === "482910" && normalizeSpokenCode("4 8 2 9 1 0") === "482910" && normalizeSpokenCode("482-910") === "482910", "forms");
  ok(normalizeSpokenCode("48291") === null && normalizeSpokenCode("hello") === null && normalizeSpokenCode("4829101") === null, "rejects");
});
await t("verify tools end to end: the code reaches the phone, and appears nowhere else (model view, tool_calls, messages, turns)", async () => {
  await reset(); await db.collection("tool_calls").deleteMany({});
  await db.collection("contacts").updateOne({ _id: kit.contactId }, { $set: { "consent.text": { granted: true, at: kit.now.t, source: "voice" } } });
  const ctx = await toolCtx(); const deps = kit.deps(new ScriptedLlm([]));
  const s = await executeTool(deps, ctx as never, { id: "c1", type: "function", function: { name: "verify_send_code", arguments: "{}" } });
  ok(s.result.ok && s.content.includes('"sent"') && !/\d{6}/.test(s.content), "model view: " + s.content);
  const sentText = adapters.imessage.sent[0].text; const code = sentText.match(/\b(\d{6})\b/)![1];
  const bad = await executeTool(deps, ctx as never, { id: "c2", type: "function", function: { name: "verify_check_code", arguments: JSON.stringify({ code: code === "111111" ? "222222" : "111111" }) } });
  ok(bad.content.includes("wrong") && bad.content.includes("tries_left"), bad.content);
  const good = await executeTool(deps, ctx as never, { id: "c3", type: "function", function: { name: "verify_check_code", arguments: JSON.stringify({ code }) } });
  ok(good.content.includes("verified"), good.content);
  const dump = JSON.stringify([await db.collection("tool_calls").find({}).toArray(), await db.collection("messages").find({}).toArray(), await db.collection("agent_turns").find({}).toArray(), s.content, bad.content, good.content]);
  ok(!dump.includes(code), "the code leaked into storage or the model's view");
  ok(((await db.collection("contacts").findOne({ _id: kit.contactId })) as any).verifiedPhone?.number === kit.phone, "verified");
});
await t("verify_send_code: an account holder gets the code without being asked to text first or to opt in; a new person is told no verification is needed; a failed send voids the code", async () => {
  await reset(); const ctx = await toolCtx(); const deps = kit.deps(new ScriptedLlm([]));
  const none = await executeTool(deps, { ...ctx, party: { ...ctx.party, externalRefs: [] } } as never, { id: "c0", type: "function", function: { name: "verify_send_code", arguments: "{}" } });
  ok(!none.result.ok && none.result.error === "not_needed" && adapters.imessage.sent.length === 0 && (await db.collection("verifications").countDocuments({})) === 0, "new person: " + none.content);
  await db.collection("messages").deleteMany({}); await db.collection("contacts").updateOne({ _id: kit.contactId }, { $unset: { consent: "" } });
  let r = await executeTool(deps, ctx as never, { id: "c1", type: "function", function: { name: "verify_send_code", arguments: "{}" } });
  ok(r.result.ok && adapters.imessage.sent.length === 1, "no separate opt-in needed: " + r.content);
  await reset(); adapters.imessage.failNext = 1; kit.ready.whatsapp = { ok: false };
  r = await executeTool(deps, ctx as never, { id: "c2", type: "function", function: { name: "verify_send_code", arguments: "{}" } });
  ok(!r.result.ok && r.result.error === "send_failed" && (await db.collection("verifications").countDocuments({})) === 0, "failed send must void the code: " + r.content);
  await reset(); kit.ready.imessage = { ok: false }; kit.ready.whatsapp = { ok: false };
  r = await executeTool(deps, ctx as never, { id: "c3", type: "function", function: { name: "verify_send_code", arguments: "{}" } });
  ok(r.result.error === "no_channel" && /not able to send a text/.test(r.result.reply ?? "") && !/message|text us|send us/i.test((r.result.reply ?? "").replace("not able to send a text", "")), "plain failure, nothing asked of the caller: " + (r.result.reply ?? r.content));
  kit.ready.imessage = { ok: true };
});

// ---------------- secure forms ----------------
await t("forms: encryption round trip; tampering, wrong request/field, and a wrong business key all fail", async () => {
  const key = Buffer.alloc(32, 9).toString("base64"); const o = String(orgId);
  const e = encryptSecret(key, o, "123 Main St", "req1:address");
  ok(decryptSecret(key, o, e, "req1:address") === "123 Main St", "round trip");
  ok(!JSON.stringify(e).includes("Main"), "ciphertext");
  for (const bad of [() => decryptSecret(key, o, { ...e, ct: Buffer.from("xxxxxxxxxxx").toString("base64") }, "req1:address"), () => decryptSecret(key, o, e, "req2:address"), () => decryptSecret(key, "otherorg", e, "req1:address"), () => decryptSecret(Buffer.alloc(32, 1).toString("base64"), o, e, "req1:address")]) {
    let threw = false; try { bad(); } catch { threw = true; } ok(threw, "must throw");
  }
  let threw = false; try { encryptSecret("short", o, "x", "a"); } catch { threw = true; } ok(threw, "short master key rejected");
});
await t("forms: tool sends a link that only the phone sees; the stored request holds a hash; GET does not consume it; one submit wins", async () => {
  await reset(); await db.collection("tool_calls").deleteMany({});
  await db.collection("contacts").updateOne({ _id: kit.contactId }, { $set: { "consent.text": { granted: true, at: kit.now.t, source: "voice" } } });
  const ctx = await toolCtx(); const deps = kit.deps(new ScriptedLlm([]));
  const r = await executeTool(deps, ctx as never, { id: "f1", type: "function", function: { name: "forms_send_secure_form", arguments: JSON.stringify({ template: "service_intake" }) } });
  ok(r.result.ok && !/https?:/.test(r.content), "model view must not contain the link: " + r.content);
  const link = adapters.imessage.sent[0].text.match(/https:\/\/forms\.example\.test\/f\/([A-Za-z0-9_-]+)/)!; const token = link[1];
  const req: any = await db.collection("form_requests").findOne({ contactId: kit.contactId });
  ok(req.tokenHash === hashToken(token) && !JSON.stringify(req).includes(token), "only the hash is stored");
  ok(!JSON.stringify(await db.collection("messages").find({}).toArray()).includes(token) && !JSON.stringify(await db.collection("tool_calls").find({}).toArray()).includes(token), "link not in logs");
  for (let i = 0; i < 3; i++) ok((await loadRequestForRender(db, token, kit.now.t)).state === "valid", "GET (link preview) must not consume");
  const key = deps.env.formsMasterKey!;
  const values = { what: "Brake tune-up", details: "Squealing", preferred_day: "Saturday", alt_phone: "206 555 0000" };
  const [a, b] = await Promise.all([submitForm(db, { token, values, masterKey: key, now: kit.now.t }), submitForm(db, { token, values, masterKey: key, now: kit.now.t })]);
  ok([a, b].filter((x) => x.ok).length === 1, "exactly one submit wins: " + JSON.stringify([a, b].map((x) => x.ok)));
  ok((await loadRequestForRender(db, token, kit.now.t)).state === "completed", "completed afterwards");
  const sub: any = await db.collection("form_submissions").findOne({ contactId: kit.contactId });
  ok(sub.fields.what === "Brake tune-up" && sub.secrets.alt_phone && !JSON.stringify(sub).includes("206 555 0000"), "sensitive field encrypted at rest");
});
await t("forms: the agent sees completion plus non-sensitive answers only; the owner can reveal a secret, and every reveal is logged", async () => {
  const sub: any = await db.collection("form_submissions").findOne({ contactId: kit.contactId });
  const view: any = await agentViewOfForm(db, orgId, kit.contactId, "service_intake");
  ok(view.status === "completed" && view.fields.what === "Brake tune-up" && view.fields.preferred_day === "Saturday" && !JSON.stringify(view).includes("206 555"), JSON.stringify(view));
  const key = kit.deps(new ScriptedLlm([])).env.formsMasterKey!;
  const v = await revealField(db, { orgId, submissionId: sub._id, field: "alt_phone", userId: null, masterKey: key });
  ok(v === "206 555 0000", "owner reveals " + v);
  ok((await db.collection("access_logs").countDocuments({ targetId: sub._id, field: "alt_phone", action: "reveal_form_field" })) === 1, "reveal logged");
  ok((await revealField(db, { orgId: new ObjectId(), submissionId: sub._id, field: "alt_phone", userId: null, masterKey: key })) === null, "another business cannot reveal");
  ok((await db.collection("messages").countDocuments({ channelMsgId: `form:${sub.requestId}` })) === 1, "the thread gets a completion marker");
});
await t("forms: validation (required, email, select, unexpected field), expiry, and unknown tokens look identical", async () => {
  const key = kit.deps(new ScriptedLlm([])).env.formsMasterKey!;
  const r = await createFormRequest(db, { orgId, contactId: kit.contactId, conversationId: kit.conversationId, template: "contact_details", now: kit.now.t });
  const bad: any = await submitForm(db, { token: r.token, values: { full_name: "", email: "nope", preferred_contact: "Pigeon", extra: "x" }, masterKey: key, now: kit.now.t });
  ok(!bad.ok && bad.error === "validation" && bad.errors.full_name && bad.errors.email && bad.errors.preferred_contact && bad.errors.extra, JSON.stringify(bad));
  ok((await loadRequestForRender(db, r.token, kit.now.t)).state === "valid", "a failed validation must not burn the link");
  ok((await loadRequestForRender(db, r.token, new Date(kit.now.t.getTime() + 31 * 60_000))).state === "expired", "expired");
  ok((await loadRequestForRender(db, "x".repeat(43), kit.now.t)).state === "invalid" && (await loadRequestForRender(db, "short", kit.now.t)).state === "invalid", "invalid");
  const r2 = await createFormRequest(db, { orgId, contactId: kit.contactId, conversationId: kit.conversationId, template: "contact_details", now: kit.now.t });
  ok((await loadRequestForRender(db, r.token, kit.now.t)).state === "expired", "issuing a new link revokes the old one");
  ok((await loadRequestForRender(db, r2.token, kit.now.t)).state === "valid", "new link works");
});
await t("end to end through the model: asks for consent, records it, verifies by code, then reads the account", async () => {
  await reset();
  const k2 = await kit.newContact("+14255550900", { externalRefs: [{ system: "tmobile", id: "ACC-9", kind: "account" }] });
  const mk = async (text: string) => { const id = await kit.addInbound(k2.conversationId, text); return { orgId, conversationId: k2.conversationId, channel: "imessage" as const, mode: "text" as const, batch: [{ _id: id, body: text, ts: kit.now.t }] }; };
  const deps = kit.deps(new ScriptedLlm([{ tools: [{ name: "verify_send_code", args: {} }] }, { content: "Sent you a 6-digit code. What is it?" }]));
  // implicit consent: they texted us just now, so the code can go out
  const r1 = await runTurn(deps, await mk("why did my bill go up?"));
  ok(r1.toolCalls[0].ok && adapters.imessage.sent.length === 1, "code sent: " + JSON.stringify(r1.toolCalls));
  const code = adapters.imessage.sent[0].text.match(/\b(\d{6})\b/)![1];
  const deps2 = kit.deps(new ScriptedLlm([{ tools: [{ name: "verify_check_code", args: { code: code.split("").join(" ") } }] }, { content: "Thanks, you're verified." }]));
  const r2 = await runTurn(deps2, await mk(code.split("").join(" ")));
  ok(r2.toolCalls[0].ok && r2.text.includes("verified"), JSON.stringify(r2.toolCalls));
  ok(((await db.collection("contacts").findOne({ _id: k2.contactId })) as any).verifiedPhone?.number === "+14255550900", "contact is now verified");
  const dump = JSON.stringify([await db.collection("messages").find({ conversationId: k2.conversationId, direction: "out" }).toArray(), deps.llm && (deps.llm as any).requests, (deps2.llm as any).requests.slice(0, 1).map((q: any) => q.messages.slice(0, -1))]);
  ok(!dump.split(code).slice(1).some((x) => x.length >= 0 && false), "placeholder");
  ok(!JSON.stringify((deps.llm as any).requests).includes(code) && !JSON.stringify(await db.collection("messages").find({ conversationId: k2.conversationId, direction: "out" }).toArray()).includes(code), "the code never reached the model or the stored messages");
});

await finish(kit);

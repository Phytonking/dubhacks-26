// Account changes: payment method link, details, and the rules around them.   pnpm exec tsx scripts/account-test.ts
import { ObjectId } from "mongodb";
import { executeTool } from "../src/engine/turn";
import { loadMethodForRender, submitMethod } from "../../web/src/lib/account-core";
import { ScriptedLlm, ok, t, finish, makeKit } from "./_testkit";

const kit = await makeKit({ template: "tmobile-system", groundMoney: true });
const { db, orgId } = kit; const now = kit.now.t;
const CARD = { name: "Maya Test", number: "4242 4242 4242 4242", exp: "12/30", cvc: "123", zip: "98105" };
const mk = async (phone: string, id: string, verified: boolean) => {
  const c = await kit.newContact(phone, { externalRefs: [{ system: "tmobile", id, kind: "account" }], ...(verified ? { verifiedPhone: { number: phone, at: now, method: "otp" } } : {}) });
  await db.collection("tmo_accounts").insertOne({ orgId, accountId: id, importedAt: now, segment: "single", lines: [], billing: [], support: [], context: { as_of: "2026-10-01", autopay: true, lines: [] } } as never);
  return c;
};
const run = async (c: { contactId: ObjectId; conversationId: ObjectId }, name: string, args: unknown) => {
  const contact: any = await db.collection("contacts").findOne({ _id: c.contactId });
  const d = kit.deps(new ScriptedLlm([]));
  const verified = Boolean(contact.verifiedPhone);
  const ctx = { db, orgId, contactId: c.contactId, conversationId: c.conversationId, channel: "imessage" as const, mode: "text" as const, party: { contact, conversation: {} as never, address: contact.handles[0].address, created: false, matchedBy: "channel_handle" as const, externalRefs: contact.externalRefs ?? [] },
    customer: { verified, status: "linked_account" } as never, turnId: "t1", sourceMessageId: new ObjectId(), now, messenger: kit.messenger, env: d.env, guard: { cfg: { maxDiscountPct: 15 }, evidence: [] }, calls: new Map(), callId: null };
  const r = await executeTool(d, ctx as never, { id: "x", type: "function", function: { name, arguments: JSON.stringify(args) } });
  return { ...r, data: (() => { try { return JSON.parse(r.content); } catch { return {}; } })() as any };
};
const tokenFrom = (text: string) => text.match(/\/pay\/method\/([A-Za-z0-9_-]+)/)?.[1] ?? "";
const everything = async () => JSON.stringify(await Promise.all((await db.listCollections().toArray()).map(async (c) => db.collection(c.name).find({}).toArray())));

await t("an unverified customer, or one with no account, cannot change anything", async () => {
  const u = await mk("+14255550871", "ACC-M1", false);
  const r = await run(u, "account_update_details", { autopay: false }); ok(!r.result.ok && r.result.error === "not_verified", r.content);
  const p = await run(u, "account_update_payment_method", {}); ok(!p.result.ok && p.result.error === "not_verified", p.content);
  const n = await kit.newContact("+14255550872"); const x = await run(n, "account_update_details", { autopay: false }); ok(!x.result.ok && x.result.error === "no_account_linked", x.content);
  ok(!(await db.collection("tmo_accounts").findOne({ accountId: "ACC-M1", changeLog: { $exists: true } })), "nothing written");
});
await t("details: email, address, contact preference and AutoPay apply at once; the change log names fields, never values; bad input is refused", async () => {
  const v = await mk("+14255550873", "ACC-M2", true);
  const bad = await run(v, "account_update_details", { email: "not-an-email" }); ok(!bad.result.ok && bad.result.error === "invalid_email", bad.content);
  const r = await run(v, "account_update_details", { email: "maya@example.com", mailing_address: "12 Oak St, Seattle, WA 98105", preferred_contact: "text", autopay: false });
  ok(r.result.ok && r.data.status === "applied" && r.data.changed.length === 4 && /higher/.test(r.data.note), r.content);
  const a: any = await db.collection("tmo_accounts").findOne({ accountId: "ACC-M2" });
  ok(a.profile.email === "maya@example.com" && a.profile.mailingAddress.includes("Oak St") && a.context.contact_preference === "Text" && a.context.autopay === false, JSON.stringify(a));
  ok(a.changeLog.length === 1 && !JSON.stringify(a.changeLog).includes("maya@example.com") && !JSON.stringify(a.changeLog).includes("Oak St"), "change log has no values");
  const tc: any = await db.collection("tool_calls").findOne({ tool: "account_update_details", conversationId: v.conversationId }); ok(tc && JSON.stringify(tc.args) === "{}", "tool arguments are not stored: " + JSON.stringify(tc?.args));
  const none = await run(v, "account_update_details", {}); ok(!none.result.ok && none.result.error === "nothing_to_change", none.content);
});
await t("payment method: a link is texted (never given to the model); the card goes on the page; the account keeps brand + last 4 only", async () => {
  const v = await mk("+14255550874", "ACC-M3", true);
  kit.adapters.imessage.sent.length = 0; kit.ready.imessage = { ok: true };
  const r = await run(v, "account_update_payment_method", {}); ok(r.result.ok && r.data.status === "sent" && !/pay\/method/.test(r.content), r.content);
  const text = kit.adapters.imessage.sent.map((m) => m.text).find((x) => /pay\/method/.test(x)) ?? ""; const token = tokenFrom(text); ok(token.length > 30, "link texted: " + text.slice(0, 80));
  ok((await loadMethodForRender(db, token, now)).state === "valid", "GET is read-only and valid");
  ok((await loadMethodForRender(db, token, now)).state === "valid", "a preview bot opening it twice does not burn it");
  const bad = await submitMethod(db, { token, raw: { ...CARD, number: "4242 4242 4242 4241" }, now }); ok(!bad.ok && bad.error === "validation", "bad number: " + JSON.stringify(bad));
  const r2 = await submitMethod(db, { token, raw: CARD, now }); ok(r2.ok && r2.last4 === "4242" && r2.brand === "visa", JSON.stringify(r2));
  const a: any = await db.collection("tmo_accounts").findOne({ accountId: "ACC-M3" });
  ok(a.context.payment_method.last4 === "4242" && a.context.payment_method.brand === "visa" && a.changeLog.length === 1, JSON.stringify(a.context.payment_method));
  const every = await everything(); ok(!every.includes("4242424242424242") && !every.includes("4242 4242 4242 4242") && !/"cvc"/.test(every), "no card number or CVC anywhere in the database");
  const note: any = await db.collection("messages").findOne({ conversationId: v.conversationId, body: /^Payment method updated/ }); ok(note && note.handling === "agent", "the agent is told: " + note?.body);
  const again = await submitMethod(db, { token, raw: CARD, now }); ok(!again.ok && again.error === "completed", "a used link cannot be used again");
  const seen = await run(v, "tmo_context", {}); ok(seen.data.payment_method?.last4 === "4242" && seen.data.payment_method.brand === "visa" && !JSON.stringify(seen.data).includes("4242424242424242"), "the agent can see brand + last 4: " + seen.content.slice(0, 300));
});
await t("payment method: a declined card keeps the link usable, the third failure locks it, and an expired link is refused", async () => {
  const v = await mk("+14255550875", "ACC-M4", true); kit.adapters.imessage.sent.length = 0;
  await run(v, "account_update_payment_method", {}); const token = tokenFrom(kit.adapters.imessage.sent.map((m) => m.text).find((x) => /pay\/method/.test(x)) ?? "");
  const d1 = await submitMethod(db, { token, raw: { ...CARD, number: "4000000000000002" }, now }); ok(!d1.ok && d1.error === "declined" && d1.attemptsLeft === 2, JSON.stringify(d1));
  ok((await loadMethodForRender(db, token, now)).state === "valid", "still usable");
  await submitMethod(db, { token, raw: { ...CARD, number: "4000000000009995" }, now }); const d3 = await submitMethod(db, { token, raw: { ...CARD, number: "4000000000000002" }, now });
  ok(!d3.ok && d3.attemptsLeft === 0 && (await loadMethodForRender(db, token, now)).state === "locked", "locked after 3");
  ok(!((await db.collection("tmo_accounts").findOne({ accountId: "ACC-M4" })) as any).context.payment_method, "nothing saved");
  kit.adapters.imessage.sent.length = 0; await run(v, "account_update_payment_method", {}); const t2 = tokenFrom(kit.adapters.imessage.sent.map((m) => m.text).find((x) => /pay\/method/.test(x)) ?? "");
  const late = await submitMethod(db, { token: t2, raw: CARD, now: new Date(now.getTime() + 31 * 60_000) }); ok(!late.ok && late.error === "expired", "expired");
  ok((await loadMethodForRender(db, "short")).state === "invalid", "garbage token");
});
await t("a new link revokes the old one", async () => {
  const v = await mk("+14255550876", "ACC-M5", true); kit.adapters.imessage.sent.length = 0;
  await run(v, "account_update_payment_method", {}); const t1 = tokenFrom(kit.adapters.imessage.sent.map((m) => m.text).find((x) => /pay\/method/.test(x)) ?? "");
  kit.adapters.imessage.sent.length = 0; kit.now.t = new Date(now.getTime() + 61_000);
  await run(v, "account_update_payment_method", {}); const t2 = tokenFrom(kit.adapters.imessage.sent.map((m) => m.text).find((x) => /pay\/method/.test(x)) ?? "");
  ok(t1 && t2 && t1 !== t2 && (await loadMethodForRender(db, t1, kit.now.t)).state === "expired", "the first link is dead");
  kit.now.t = now;
});
await finish(kit);

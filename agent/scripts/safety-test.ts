// Private numbers and secrets: redaction at the door, no storing of secrets, the assistant never asks for one.   pnpm exec tsx scripts/safety-test.ts
import { ObjectId } from "mongodb";
import { asksForSecrets, looksSensitive, redactSensitive, TEXT_REDIRECT } from "../src/sensitive";
import { executeTool, runTurn, streamTurn } from "../src/engine/turn";
import { Scheduler } from "../src/scheduler";
import { Worker } from "../src/recorded-io";
import { ScriptedLlm, ok, t, finish, makeKit } from "./_testkit";

const kit = await makeKit({ groundMoney: true }); const { db, orgId, adapters } = kit;

await t("redaction: SSNs and valid card numbers are removed; phone numbers, order numbers, amounts and invalid long numbers are left alone", async () => {
  const cases: Array<[string, boolean, string?]> = [
    ["my ssn is 123-45-6789", true, "[redacted SSN]"], ["social security number 123456789 please", true, "[redacted SSN]"], ["123 45 6789", true],
    ["card 4242 4242 4242 4242 exp 12/28", true, "[redacted card number]"], ["4242-4242-4242-4242", true], ["378282246310005", true],
    ["call me at 425-555-0123", false], ["+1 (425) 555-0123", false], ["order 1234567890123456 shipped", false], ["it costs $1,450.00 for 12 months", false], ["my zip is 98101-1234", false],
  ];
  for (const [text, should, marker] of cases) { const r = redactSensitive(text); ok(r.redacted === should, `${text} -> ${r.text}`); if (marker) ok(r.text.includes(marker), r.text); if (should) ok(!/\d{4}[- ]?\d{4}[- ]?\d{4}|\d{3}-\d{2}-\d{4}/.test(r.text), "digits remain: " + r.text); }
});
await t("looksSensitive catches words as well as numbers; asksForSecrets recognises a REQUEST, not a warning", async () => {
  for (const s of ["my password is hunter2", "pin 4821", "the cvv is on the back", "ssn 123-45-6789"]) ok(looksSensitive(s), s);
  ok(!looksSensitive("I am moving to Portland in January"), "ordinary fact");
  for (const ask of ["What is your PIN?", "Can I get your social security number?", "Please read me your full card number.", "I'll need your account password.", "Tell me your SSN."]) ok(asksForSecrets(ask), ask);
  for (const fine of ["Please don't share your PIN here.", "I can't take your social security number on this chat.", "Never tell anyone your password.", "Your plan is $60 a month.", "What is your favorite color?", "Do you have a PIN reset email?"]) ok(!asksForSecrets(fine), fine);
});
await t("memory_remember refuses secrets, and the attempt is audited WITHOUT the arguments", async () => {
  const k2 = await kit.newContact("+14255550901"); await db.collection("tool_calls").deleteMany({});
  const llm = new ScriptedLlm([{ tools: [{ name: "memory_remember", args: { fact: "customer ssn is 123-45-6789" } }] }, { content: "I can't store that, please use the secure form." }]);
  const id = await kit.addInbound(k2.conversationId, "ssn is 123-45-6789");
  const r = await runTurn(kit.deps(llm), { orgId, conversationId: k2.conversationId, channel: "imessage", mode: "text", batch: [{ _id: id, body: "ssn is 123-45-6789", ts: kit.now.t }] });
  ok(!r.toolCalls[0].ok, "refused");
  ok(((await db.collection("contacts").findOne({ _id: k2.contactId })) as any).facts.length === 0, "nothing stored");
  ok(!JSON.stringify(await db.collection("tool_calls").find({}).toArray()).includes("123-45-6789"), "audit row must not contain the SSN");
});

const mkWorker = () => new Worker(db, {} as never, adapters.imessage, async () => {}, { scheduled: true, debounceMs: 20, maxWaitMs: 100, brand: "Sunrise" });
await t("a card number or SSN typed into a text is redacted before it is stored, shown in the inbox, or sent to the model", async () => {
  await db.collection("messages").deleteMany({}); const w = mkWorker();
  const llm = new ScriptedLlm([{ content: "Please don't send that here. I can text you a private form instead if you'd like." }]);
  const s = new Scheduler({ db, engine: kit.deps(llm), workers: { imessage: w }, pollMs: 10 });
  await w.handleInbound({ orgId, address: kit.phone, text: "sure, my card is 4242 4242 4242 4242 and my ssn is 123-45-6789", channelMsgId: "sens1", ref: { spaceId: "s", senderId: "u" } });
  await new Promise((r) => setTimeout(r, 40)); await s.drain();
  const m: any = await db.collection("messages").findOne({ channelMsgId: "sens1" });
  ok(m.redacted === true && m.body.includes("[redacted card number]") && m.body.includes("[redacted SSN]") && !/4242|6789/.test(m.body), m.body);
  const conv: any = await db.collection("conversations").findOne({ _id: kit.conversationId }); ok(!/4242|6789/.test(conv.lastMessagePreview), "inbox preview: " + conv.lastMessagePreview);
  ok(!JSON.stringify(llm.requests).match(/4242|123-45-6789/), "the model never saw the numbers");
  ok(!JSON.stringify(await db.collection("agent_turns").find({}).toArray()).match(/4242|6789/), "turn log clean");
});
await t("the assistant asking for a PIN / SSN / card number in a TEXT is replaced by the secure-form redirect, and is flagged", async () => {
  const k2 = await kit.newContact("+14255550902"); const id = await kit.addInbound(k2.conversationId, "I want to check my account");
  const r = await runTurn(kit.deps(new ScriptedLlm([{ content: "Sure. What is your PIN? Then I can look it up." }])), { orgId, conversationId: k2.conversationId, channel: "imessage", mode: "text", batch: [{ _id: id, body: "I want to check my account", ts: kit.now.t }] });
  ok(r.text === TEXT_REDIRECT && r.sideEffects, r.text);
  const fine = await runTurn(kit.deps(new ScriptedLlm([{ content: "Please don't share your PIN here." }])), { orgId, conversationId: k2.conversationId, channel: "imessage", mode: "text", batch: [{ _id: id, body: "x", ts: kit.now.t }] });
  ok(fine.text === "Please don't share your PIN here.", "a warning is left alone: " + fine.text);
});
await t("on a PHONE call, asking for a secret is replaced by the 'text this number instead' message, and the rest of that reply is not spoken", async () => {
  await db.collection("channel_lines").insertMany([{ orgId, channel: "whatsapp", provider: "photon", photonLineId: null, address: "+12065550100", status: "active", capabilities: [], createdAt: kit.now.t }, { orgId, channel: "voice", provider: "photon", photonLineId: null, address: "+12065550100", status: "active", capabilities: ["pstn_voice"], createdAt: kit.now.t }] as never);
  kit.ready.imessage = { ok: false }; kit.ready.whatsapp = { ok: false };
  const k2 = await kit.newContact("+14255550903"); const id = await kit.addInbound(k2.conversationId, "check my account", { channel: "voice" });
  const d = kit.deps(new ScriptedLlm([{ content: "Happy to help. What's your social security number? Then I will look you up. Thanks." }])); d.env.assignIMessage = async () => "+16289990001";
  const out: string[] = []; let done: any;
  for await (const ev of streamTurn(d, { orgId, conversationId: k2.conversationId, channel: "voice", mode: "voice", batch: [{ _id: id, body: "check my account", ts: kit.now.t }] })) { if (ev.type === "sentence") out.push(ev.text); if (ev.type === "done") done = ev; }
  const said = out.join(" ");
  ok(out[0] === "Happy to help." && !/social security/i.test(said) && !/look you up|Thanks\./.test(said) && /iMessage to six two eight, nine nine nine, zero zero zero one/.test(said) && /WhatsApp to two zero six/.test(said), said);
  ok(done.result.sideEffects && /moved to text/.test(done.result.note), done.result.note);
  const r2 = await runTurn(kit.deps(new ScriptedLlm([{ content: "Of course. Could you read me your full card number?" }])), { orgId, conversationId: k2.conversationId, channel: "voice", mode: "voice", batch: [{ _id: id, body: "check my account", ts: kit.now.t }] });
  ok(!/card number/i.test(r2.text) && /message/i.test(r2.text), r2.text);
});
await t("an unsupported amount in one sentence no longer costs the customer the whole answer: the supported sentences are sent", async () => {
  const k2 = await kit.newContact("+14255550904");
  await db.collection("knowledge").insertOne({ orgId, kind: "faq", title: "Tune-up pricing", content: "A basic tune-up is $89.", sourceUrl: null, version: 1, status: "ready", createdAt: kit.now.t } as never);
  const id = await kit.addInbound(k2.conversationId, "tune-up price?");
  const bad = { content: "A basic tune-up is $89. Rush service would be $24 extra." };
  const r = await runTurn(kit.deps(new ScriptedLlm([bad, bad])), { orgId, conversationId: k2.conversationId, channel: "imessage", mode: "text", batch: [{ _id: id, body: "tune-up price?", ts: kit.now.t }] });
  ok(r.outcome === "reply" && r.text === "A basic tune-up is $89." && /sanitized/.test(r.note ?? ""), JSON.stringify({ t: r.text, n: r.note }));
  const allBad = { content: "That is $24. Or maybe $31." };
  const r2 = await runTurn(kit.deps(new ScriptedLlm([allBad, allBad])), { orgId, conversationId: k2.conversationId, channel: "imessage", mode: "text", batch: [{ _id: id, body: "tune-up price?", ts: kit.now.t }] });
  ok(r2.outcome === "blocked" && !/\$/.test(r2.text), "if nothing supported remains: fallback + person, no invented amounts: " + r2.text);
});

await finish(kit);

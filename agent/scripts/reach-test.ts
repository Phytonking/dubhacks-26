// Reach: which number to call, which number to text, spoken forms, assignment on request, hints when nothing can text the caller.
//   pnpm exec tsx scripts/reach-test.ts
import { ObjectId } from "mongodb";
import { buildContext } from "../src/engine/context";
import { executeTool, runTurn, streamTurn } from "../src/engine/turn";
import { businessLines, computeReach, contactMethodsBlock, displayNumber, spokenNumber } from "../src/lines";
import { ScriptedLlm, ok, t, finish, makeKit } from "./_testkit";

const kit = await makeKit({ groundMoney: true });
const { db, orgId, adapters } = kit;
const VOICE = "+12065550100", WA = "+12065550100", IM = "+16289990000";
const line = (channel: string, address: string, extra: Record<string, unknown> = {}) => db.collection("channel_lines").insertOne({ orgId, channel, provider: "photon", photonLineId: null, address, status: "active", capabilities: [], createdAt: kit.now.t, ...extra } as never);
await line("voice", VOICE, { capabilities: ["pstn_voice"] }); await line("whatsapp", WA, { capabilities: ["session"] }); await line("imessage", IM, { handles: ["+14255559999"] });

const notReady = () => { kit.ready.imessage = { ok: false, reason: "no recent message" }; kit.ready.whatsapp = { ok: false, reason: "window closed" }; };
const deps = (assign?: (a: { orgId: ObjectId; handle: string; firstName?: string }) => Promise<string | null>) => { const d = kit.deps(new ScriptedLlm([])); d.env.assignIMessage = assign; return d; };
const ctxFor = async (contactId = kit.contactId, conversationId = kit.conversationId, channel: "voice" | "imessage" = "voice") => {
  const contact: any = await db.collection("contacts").findOne({ _id: contactId }); const conversation: any = await db.collection("conversations").findOne({ _id: conversationId });
  return { db, orgId, contactId, conversationId, channel, mode: channel === "voice" ? "voice" as const : "text" as const, party: { contact, conversation, address: kit.phone, created: false, matchedBy: "channel_handle" as const, externalRefs: [] },
    customer: {} as never, turnId: "t1", sourceMessageId: new ObjectId(), now: kit.now.t, messenger: kit.messenger, env: deps().env, guard: { cfg: { maxDiscountPct: 10 }, evidence: [] as string[] } };
};
const call = async (name: string, args: unknown, d = deps(), c?: Awaited<ReturnType<typeof ctxFor>>) => executeTool(d, { ...(c ?? await ctxFor()), env: d.env, calls: new Map() } as never, { id: "x", type: "function", function: { name, arguments: JSON.stringify(args) } });

await t("number formats: written for texts, spoken in digit groups for calls", async () => {
  ok(displayNumber("+16289988199") === "+1 (628) 998-8199", displayNumber("+16289988199"));
  ok(spokenNumber("+16289988199") === "six two eight, nine nine eight, eight one nine nine", spokenNumber("+16289988199"));
  ok(spokenNumber("+12065550100") === "two zero six, five five five, zero one zero zero", "zeros are spoken as zero");
  ok(displayNumber("+4420794600") === "+4420794600", "non-US numbers pass through unformatted");
});
await t("business lines: the voice number is found by its own row, or by the phone capability on an older row", async () => {
  const l = await businessLines(db, orgId); ok(l.voice === VOICE && l.whatsapp === WA && l.imessage[0] === IM, JSON.stringify(l));
  const org2 = new ObjectId(); await db.collection("channel_lines").insertOne({ orgId: org2, channel: "sms", provider: "photon", photonLineId: null, address: "+12065550777", status: "active", capabilities: ["pstn_voice", "sms"], createdAt: kit.now.t } as never);
  ok((await businessLines(db, org2)).voice === "+12065550777", "capability fallback");
  ok((await businessLines(db, new ObjectId())).voice === null, "none configured");
});
await t("the prompt always carries the real phone and WhatsApp numbers, and the rules for private details and for 'how do I call you'", async () => {
  const inp = { orgId, conversationId: kit.conversationId, channel: "imessage" as const, mode: "text" as const, batch: [{ _id: await kit.addInbound(kit.conversationId, "how do I call you?"), body: "how do I call you?", ts: kit.now.t }] };
  const sys = (await buildContext(db, deps().env, inp)).messages[0].content as string;
  ok(sys.includes("+1 (206) 555-0100") && sys.includes("two zero six, five five five, zero one zero zero"), "voice number written and spoken");
  ok(/WhatsApp: \+1 \(206\) 555-0100/.test(sys) && /contact_options/.test(sys), "whatsapp + tool pointer");
  ok(/never ask the customer to say passwords/i.test(sys) && /DIFFERENT number/.test(sys) && /asks to call or speak/i.test(sys), "the three rules");
  const none = contactMethodsBlock({ voice: null, whatsapp: null, imessage: [], sms: null }); ok(/no phone number is configured/.test(none) && /not available/.test(none), "honest when nothing is configured");
});

await t("reach for a phone caller who never texted us: an iMessage line is assigned and named (a DIFFERENT number), plus the WhatsApp number; nothing is ready yet", async () => {
  notReady(); const seen: string[] = [];
  const contact: any = await db.collection("contacts").findOne({ _id: kit.contactId });
  const r = await computeReach({ db, messenger: kit.messenger, assignIMessage: async (a) => { seen.push(a.handle); return "+16289990001"; } }, { orgId, contact, conversationId: kit.conversationId });
  ok(seen.join() === kit.phone, "assignment asked once, for the caller's own number: " + seen.join());
  const im = r.options.find((o) => o.channel === "imessage")!, wa = r.options.find((o) => o.channel === "whatsapp")!;
  ok(im.number === "+16289990001" && !im.readyNow && /different number/.test(im.howTo) && im.display === "+1 (628) 999-0001" && im.spoken.startsWith("six two eight"), JSON.stringify(im));
  ok(wa.number === WA && !wa.readyNow && /WhatsApp/.test(wa.howTo), JSON.stringify(wa));
  ok(r.voice?.number === VOICE, "and the number to call");
});
await t("an existing iMessage assignment is reused (no new assignment), and shared pool numbers can serve several people", async () => {
  notReady(); await db.collection("channel_lines").updateOne({ channel: "imessage", address: IM }, { $addToSet: { handles: kit.phone } });
  let calls = 0; const contact: any = await db.collection("contacts").findOne({ _id: kit.contactId });
  const r = await computeReach({ db, messenger: kit.messenger, assignIMessage: async () => { calls++; return "+16289990002"; } }, { orgId, contact, conversationId: kit.conversationId });
  ok(calls === 0 && r.options[0].channel === "imessage" && r.options[0].number === IM, `calls=${calls} ${JSON.stringify(r.options[0])}`);
  await db.collection("channel_lines").updateOne({ channel: "imessage", address: IM }, { $pull: { handles: kit.phone } as never });
});
await t("if we can already text them (they messaged recently) the option says so and no assignment is made", async () => {
  kit.ready.imessage = { ok: true }; kit.ready.whatsapp = { ok: true }; let calls = 0; const contact: any = await db.collection("contacts").findOne({ _id: kit.contactId });
  const r = await computeReach({ db, messenger: kit.messenger, assignIMessage: async () => { calls++; return null; } }, { orgId, contact, conversationId: kit.conversationId });
  ok(calls === 0 && r.options.every((o) => o.readyNow) && /I can text you/.test(r.options[0].howTo), JSON.stringify(r.options.map((o) => o.howTo)));
});
await t("assignment refused (capacity) or failing: WhatsApp is still offered, with a note, and no number is invented", async () => {
  notReady(); const contact: any = await db.collection("contacts").findOne({ _id: kit.contactId });
  for (const assign of [async () => null, async () => { throw new Error("boom"); }]) {
    const r = await computeReach({ db, messenger: kit.messenger, assignIMessage: assign as never }, { orgId, contact, conversationId: kit.conversationId });
    ok(r.options.length === 1 && r.options[0].channel === "whatsapp" && r.notes.some((n) => /No iMessage line/.test(n)), JSON.stringify({ o: r.options.map((x) => x.channel), n: r.notes }));
  }
});
await t("a person with no phone number on file cannot be texted: honest note, offer a person", async () => {
  const c = await kit.newContact("someone@example.com"); await db.collection("contacts").updateOne({ _id: c.contactId }, { $set: { handles: [{ channel: "imessage", address: "someone@example.com" }] } });
  const contact: any = await db.collection("contacts").findOne({ _id: c.contactId });
  const r = await computeReach({ db, messenger: kit.messenger }, { orgId, contact, conversationId: c.conversationId });
  ok(r.options.length === 0 && r.notes.some((n) => /no phone number/.test(n)) && r.voice?.number === VOICE, JSON.stringify(r.notes));
});

await t("contact_options tool: numbers in written and spoken form, and the move-to-text is remembered once so the next text finishes the job", async () => {
  await db.collection("contacts").updateOne({ _id: kit.contactId }, { $set: { "memory.openLoops": [] } }); notReady();
  const d = deps(async () => "+16289990001");
  const r = await call("contact_options", { purpose: "form" }, d); const data: any = JSON.parse(r.content);
  ok(r.result.ok && data.call_us.number === "+1 (206) 555-0100" && data.text_options.length === 2, r.content);
  ok(data.text_options[0].say.includes("six two eight") && data.text_options[0].tell_the_customer.includes("different number") && data.text_options.every((o: any) => o.ready_now === false), r.content);
  const loops = ((await db.collection("contacts").findOne({ _id: kit.contactId })) as any).memory.openLoops; ok(loops.length === 1 && loops[0].kind === "continue_by_text" && /secure form/.test(loops[0].text), JSON.stringify(loops));
  await call("contact_options", { purpose: "form" }, d); ok(((await db.collection("contacts").findOne({ _id: kit.contactId })) as any).memory.openLoops.length === 1, "not duplicated");
  const call_us: any = JSON.parse((await call("contact_options", { purpose: "call_us" }, d)).content); ok(call_us.call_us.say.includes("two zero six"), "call_us gives the voice number");
});
await t("the tool hands the model the exact sentence to say: spoken digit groups on a call, written numbers in a text; says which app and that it is a different number", async () => {
  notReady(); const d = deps(async () => "+16289990001");
  const v: any = JSON.parse((await call("contact_options", { purpose: "private_details" }, d, await ctxFor(kit.contactId, kit.conversationId, "voice"))).content);
  ok(/please don't say them out loud/.test(v.say_to_customer) && /iMessage to six two eight, nine nine nine, zero zero zero one/.test(v.say_to_customer) && /different number from the one you called/.test(v.say_to_customer) && /WhatsApp to two zero six, five five five, zero one zero zero/.test(v.say_to_customer) && /repeat the number/.test(v.say_to_customer), v.say_to_customer);
  const x: any = JSON.parse((await call("contact_options", { purpose: "private_details" }, d, await ctxFor(kit.contactId, kit.conversationId, "imessage"))).content);
  ok(x.say_to_customer.includes("+1 (628) 999-0001") && x.say_to_customer.includes("+1 (206) 555-0100") && !/repeat the number/.test(x.say_to_customer), x.say_to_customer);
  kit.ready.imessage = { ok: true }; kit.ready.whatsapp = { ok: true };
  const rdy: any = JSON.parse((await call("contact_options", { purpose: "form" }, d, await ctxFor(kit.contactId, kit.conversationId, "voice"))).content);
  ok(/^I can text you right now from .* on iMessage\. Is that okay\?/.test(rdy.say_to_customer), rdy.say_to_customer);
  notReady();
  const none: any = JSON.parse((await call("contact_options", { purpose: "form" }, deps(async () => null), await ctxFor())).content);
  ok(/please don't say them out loud. Please send a message on WhatsApp to/.test(none.say_to_customer), none.say_to_customer);
});
await t("the remembered move-to-text appears at the top of the next turn, so a customer who texts 'hi' gets the form without starting over", async () => {
  const id = await kit.addInbound(kit.conversationId, "hi, it's me", { channel: "imessage" });
  const ctx = await buildContext(db, deps().env, { orgId, conversationId: kit.conversationId, channel: "imessage", mode: "text", batch: [{ _id: id, body: "hi, it's me", ts: kit.now.t }] });
  ok(/Open commitments \(bring up first\): .*moving to text to receive a secure form.*forms_send_secure_form/.test(ctx.messages[0].content as string), ((ctx.messages[0].content as string).match(/Open commitments[^\n]*/)?.[0] ?? "none"));
});
await t("verify_send_code from a caller nobody can text yet: the code is voided, and the model is handed the numbers to read out (instead of a dead end)", async () => {
  notReady(); await db.collection("verifications").deleteMany({}); await db.collection("contacts").updateOne({ _id: kit.contactId }, { $set: { "memory.openLoops": [] } });
  const r = await call("verify_send_code", {}, deps(async () => "+16289990001")); const data: any = JSON.parse(r.content);
  ok(!r.result.ok && r.result.error === "no_channel" && data.text_options?.length === 2 && data.text_options[0].say && /message/.test(data.hint), r.content);
  ok((await db.collection("verifications").countDocuments({})) === 0 && adapters.imessage.sent.length === 0, "no code outstanding, nothing sent");
  ok(((await db.collection("contacts").findOne({ _id: kit.contactId })) as any).memory.openLoops.some((l: any) => /verification code/.test(l.text)), "move-to-text remembered");
});
await t("forms_send_secure_form with nowhere to send: link revoked, numbers returned", async () => {
  notReady(); await db.collection("form_requests").deleteMany({});
  const r = await call("forms_send_secure_form", { template: "contact_details" }, deps(async () => "+16289990001")); const data: any = JSON.parse(r.content);
  ok(!r.result.ok && data.text_options?.length === 2, r.content);
  ok((await db.collection("form_requests").countDocuments({ status: "pending" })) === 0, "no live link left behind");
});
await t("once they message us, the same tools just work: WhatsApp session open -> the form goes out on WhatsApp from the WhatsApp number", async () => {
  kit.ready.imessage = { ok: false }; kit.ready.whatsapp = { ok: true }; adapters.whatsapp.sent.length = 0;
  await db.collection("contacts").updateOne({ _id: kit.contactId }, { $set: { "consent.text": { granted: true, at: kit.now.t, source: "voice" } } });
  await kit.addInbound(kit.conversationId, "hello on whatsapp", { channel: "whatsapp" });
  const r = await call("forms_send_secure_form", { template: "contact_details" }, deps(), await ctxFor(kit.contactId, kit.conversationId, "imessage"));
  ok(r.result.ok && adapters.whatsapp.sent.length === 1 && /private form/.test(adapters.whatsapp.sent[0].text), r.content);
  ok(!/https?:/.test(r.content), "the model never sees the link");
});

const voiceInput = async (text: string, channel: "voice" | "imessage" = "voice") => {
  const id = await kit.addInbound(kit.conversationId, text, { channel });
  return { orgId, conversationId: kit.conversationId, channel, mode: channel === "voice" ? "voice" as const : "text" as const, batch: [{ _id: id, body: text, ts: kit.now.t }] };
};
const EXPECT_VOICE = "To keep your details private, please don't say them out loud. Please send a quick text on iMessage to six two eight, nine nine nine, zero zero zero one, which is a different number from the one you called, or send a message on WhatsApp to two zero six, five five five, zero one zero zero. Once I see your message, I'll send it to you there. Would you like me to repeat the number?";
await t("DETERMINISTIC: when a caller must move to text, the reply is exactly the prepared message (numbers cannot be paraphrased or skipped) and the model is not asked again", async () => {
  notReady(); await db.collection("contacts").updateOne({ _id: kit.contactId }, { $set: { "memory.openLoops": [] } });
  const llm = new ScriptedLlm([{ content: "I'm an AI.", tools: [{ name: "contact_options", args: { purpose: "private_details" } }] }, { content: "WRONG: offer to text a code to your number on file" }]);
  const d = kit.deps(llm); d.env.assignIMessage = async () => "+16289990001";
  const r = await runTurn(d, await voiceInput("I want to give you my social security number"));
  ok(r.text === EXPECT_VOICE && r.outcome === "reply" && llm.requests.length === 1, `${llm.requests.length} model call(s): ${r.text}`);
});
await t("same on a streamed phone call: the prepared sentences are spoken in order and the model is not called again", async () => {
  notReady(); const llm = new ScriptedLlm([{ tools: [{ name: "contact_options", args: { purpose: "form" } }] }, { content: "WRONG" }]);
  const d = kit.deps(llm); d.env.assignIMessage = async () => "+16289990001"; const out: string[] = [];
  for await (const ev of streamTurn(d, await voiceInput("can I fill out a form?"))) if (ev.type === "sentence") out.push(ev.text);
  ok(out.join(" ") === EXPECT_VOICE && llm.requests.length === 1, `${llm.requests.length} calls: ${out.join(" | ")}`);
});
await t("in a text conversation the same message uses written numbers, not spoken ones", async () => {
  notReady(); const llm = new ScriptedLlm([{ tools: [{ name: "contact_options", args: { purpose: "private_details" } }] }]);
  const d = kit.deps(llm); d.env.assignIMessage = async () => "+16289990001";
  const r = await runTurn(d, await voiceInput("can I send you my address?", "imessage"));
  ok(r.text.includes("+1 (628) 999-0001") && r.text.includes("+1 (206) 555-0100") && !/six two eight/.test(r.text) && !/repeat the number/.test(r.text), r.text);
});
await t("verify_send_code when nobody can text the caller yet also answers with the prepared message (code voided, nothing sent)", async () => {
  notReady(); await db.collection("verifications").deleteMany({}); adapters.imessage.sent.length = 0;
  const llm = new ScriptedLlm([{ tools: [{ name: "verify_send_code", args: {} }] }, { content: "WRONG" }]);
  const d = kit.deps(llm); d.env.assignIMessage = async () => "+16289990001";
  const r = await runTurn(d, await voiceInput("please send me the code"));
  ok(r.text === EXPECT_VOICE && llm.requests.length === 1 && (await db.collection("verifications").countDocuments({})) === 0 && adapters.imessage.sent.length === 0, r.text);
});
await t("asking how to CALL is not forced: the model gets the phone number and phrases the answer itself", async () => {
  notReady(); const llm = new ScriptedLlm([{ tools: [{ name: "contact_options", args: { purpose: "call_us" } }] }, { content: "You can call us at +1 (206) 555-0100." }]);
  const r = await runTurn(kit.deps(llm), await voiceInput("what number do I call?", "imessage"));
  ok(r.text === "You can call us at +1 (206) 555-0100." && llm.requests.length === 2, `${llm.requests.length}: ${r.text}`);
});

await finish(kit);

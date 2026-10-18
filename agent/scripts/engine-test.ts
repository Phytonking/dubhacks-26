// Engine tests: tool loop, argument safety, isolation, verification gating, guardrails, streaming. pnpm exec tsx scripts/engine-test.ts
import { ObjectId } from "mongodb";
import { buildContext, toolsBlock } from "../src/engine/context";
import { readdirSync, readFileSync } from "node:fs";
import { checkGroundedMoney, takeSentences } from "../src/engine/guardrails";
import { ALL_TOOLS, validateRegistry } from "../src/engine/tools/index";
import { dedupeSentences, dropMeta, empathyLead, limitQuestions, MAX_ROUNDS, runTurn, streamTurn, SAFE_FALLBACK, cleanReply } from "../src/engine/turn";
import { stripThinking } from "../src/engine/llm";
import { FORM_TEMPLATES } from "../../web/src/lib/form-templates";
import { ScriptedLlm, ok, t, finish, makeKit } from "./_testkit";

const kit = await makeKit({ groundMoney: true });
const { db, orgId } = kit;
const input = async (text: string, o: { conversationId?: ObjectId; channel?: "imessage" | "sms" } = {}) => {
  const conversationId = o.conversationId ?? kit.conversationId;
  const id = await kit.addInbound(conversationId, text);
  return { orgId, conversationId, channel: o.channel ?? ("imessage" as const), mode: "text" as const, batch: [{ _id: id, body: text, ts: kit.now.t }] };
};
const vinput = async (text: string, conversationId: ObjectId) => ({ orgId, conversationId, channel: "voice" as const, mode: "voice" as const, batch: [{ _id: await kit.addInbound(conversationId, text, { channel: "voice" }), body: text, ts: kit.now.t }] });
const lastUser = (req: any) => req.messages[req.messages.length - 1];

await t("registry: every tool name is a valid function name and the schema is an object", async () => {
  validateRegistry(ALL_TOOLS);
  for (const x of ALL_TOOLS) ok(x.parameters.type === "object", x.name);
  ok(ALL_TOOLS.length >= 12, "tools " + ALL_TOOLS.length);
  return `${ALL_TOOLS.length} tools: ${ALL_TOOLS.map((x) => x.name).join(", ")}`;
});
await t("form templates: a field the agent may see is never sensitive", async () => {
  for (const tpl of Object.values(FORM_TEMPLATES)) for (const f of tpl.fields) ok(!(f.agentVisible && f.sensitive), `${tpl.key}.${f.key}`);
});

await t("tool loop: model asks for knowledge, gets the result, answers with it; every call is logged", async () => {
  const llm = new ScriptedLlm([{ tools: [{ name: "knowledge_search", args: { query: "tune-up price" } }] }, { content: "A basic tune-up is $89 and takes 2 days." }]);
  const r = await runTurn(kit.deps(llm), await input("how much is a tune-up?"));
  ok(r.outcome === "reply" && r.rounds === 2 && r.text.includes("$89"), JSON.stringify({ o: r.outcome, rounds: r.rounds, t: r.text }));
  ok(r.toolCalls.length === 1 && r.toolCalls[0].name === "knowledge_search" && r.toolCalls[0].ok, "trace");
  const second = llm.requests[1].messages; const tool = second[second.length - 1] as any;
  ok(tool.role === "tool" && tool.content.includes("$89"), "tool result must reach the model");
  ok((await db.collection("tool_calls").countDocuments({ orgId, tool: "knowledge_search" })) === 1, "tool_calls row");
  ok(r.usage.prompt_tokens === 200, "usage summed " + r.usage.prompt_tokens);
});
await t("prompt context: customer block, knowledge excerpts and channel style are in the system message; the new message is the last user turn", async () => {
  const llm = new ScriptedLlm([{ content: "Hi!" }]);
  await runTurn(kit.deps(llm), await input("what are your hours on sunday?"));
  const sys = llm.requests[0].messages[0].content as string;
  ok(/Sunrise Bike Shop assistant/.test(sys) && /Closed Sunday/.test(sys) && /Text message style/.test(sys) && /UNKNOWN NUMBER|RECOGNIZED/.test(sys), sys.slice(0, 300));
  ok(!/\{\{/.test(sys), "unrendered placeholder");
  ok(lastUser(llm.requests[0]).content === "what are your hours on sunday?", "last user turn");
});
await t("model mistakes become error results, not crashes: unknown tool, bad JSON, wrong type, extra argument, missing argument", async () => {
  const llm = new ScriptedLlm([
    { tools: [{ name: "does_not_exist", args: {} }, { name: "knowledge_search", args: "{not json" }, { name: "knowledge_search", args: { query: 42 } }, { name: "memory_remember", args: { fact: "likes red", contact_id: "someone-else" } }, { name: "knowledge_search", args: {} }] },
    { content: "Sorry, let me try that differently." },
  ]);
  const r = await runTurn(kit.deps(llm), await input("hello"));
  ok(r.outcome === "reply" && r.toolCalls.length === 5 && r.toolCalls.every((c) => !c.ok), JSON.stringify(r.toolCalls));
  const errs = (llm.requests[1].messages.filter((m: any) => m.role === "tool") as any[]).map((m) => m.content);
  ok(errs[0].includes("unknown_tool") && errs[1].includes("invalid_arguments") && errs[3].includes("unknown argument") && errs[4].includes("missing required"), errs.join(" | "));
});
await t("the model cannot choose whose data a tool touches: ids come from the thread, an id argument is rejected", async () => {
  const other = await kit.newContact("+14255559999");
  const llm = new ScriptedLlm([{ tools: [{ name: "memory_remember", args: { fact: "wants a red bike", contactId: String(other.contactId) } }] }, { content: "ok" }]);
  const r = await runTurn(kit.deps(llm), await input("remember I want red"));
  ok(!r.toolCalls[0].ok, "must be rejected");
  const o: any = await db.collection("contacts").findOne({ _id: other.contactId }); ok(o.facts.length === 0, "other contact was touched");
});
await t("round limit: a model that never stops calling tools gets a safe fallback, the team is told, and the customer is NOT locked out", async () => {
  const k2 = await kit.newContact("+14255550777");
  const llm = new ScriptedLlm([{ tools: [{ name: "knowledge_search", args: { query: "loop" } }] }]);
  const r = await runTurn(kit.deps(llm), await input("loop forever", { conversationId: k2.conversationId }));
  ok(r.outcome === "escalated" && r.text === SAFE_FALLBACK && r.rounds === MAX_ROUNDS && /max rounds/.test(r.note ?? ""), JSON.stringify({ o: r.outcome, rounds: r.rounds, n: r.note }));
  ok(((await db.collection("conversations").findOne({ _id: k2.conversationId })) as any).mode === "agent", "a system fault never locks the chat to a person");
  ok((await db.collection("notifications").countDocuments({ conversationId: k2.conversationId, kind: "handoff", cause: "system" })) === 1, "team told");
});
await t("model outage: fallback text, handoff, no crash", async () => {
  const k2 = await kit.newContact("+14255550778");
  const r = await runTurn(kit.deps(new ScriptedLlm([{ throws: "model HTTP 503" }])), await input("hi", { conversationId: k2.conversationId }));
  ok(r.outcome === "escalated" && r.text === SAFE_FALLBACK && /503/.test(r.note ?? ""), JSON.stringify(r));
});
await t("handoff tool: conversation goes to a person, owner notified, outcome is escalated", async () => {
  const k2 = await kit.newContact("+14255550779");
  const llm = new ScriptedLlm([{ tools: [{ name: "handoff_escalate", args: { reason_type: "cancel_or_port_out", reason: "wants to cancel" } }] }, { content: "I will connect you with a person now." }]);
  const r = await runTurn(kit.deps(llm), await input("I want to cancel", { conversationId: k2.conversationId }));
  ok(r.outcome === "escalated" && r.escalated && r.sideEffects, "flags");
  const n: any = await db.collection("notifications").findOne({ conversationId: k2.conversationId }); ok(n.urgency === "high" && /cancel/.test(n.message) && n.cause === "policy", "notification");
  ok(((await db.collection("conversations").findOne({ _id: k2.conversationId })) as any).mode === "human", "a real reason does lock the chat to a person");
});
await t("handoff is evidence-gated: the model cannot hand off because it is unsure, a tool failed, or the customer never said it", async () => {
  const k = await kit.newContact("+14255550741");
  const llm = new ScriptedLlm([{ tools: [{ name: "handoff_escalate", args: { reason_type: "asked_for_person", reason: "not sure how to answer" } }] }, { content: "Let me look at that for you. A basic tune-up is $89." }]);
  const r = await runTurn(kit.deps(llm), await input("how much is a tune-up?", { conversationId: k.conversationId }));
  ok(!r.toolCalls[0].ok && r.toolCalls[0].error === "not_what_the_customer_said" && r.outcome === "reply" && /\$89/.test(r.text), JSON.stringify({ t: r.toolCalls, o: r.outcome, x: r.text }));
  ok(((await db.collection("conversations").findOne({ _id: k.conversationId })) as any).mode === "agent", "still with the agent");
  for (const [rt, said] of [["asked_for_person", "can I talk to a real person"], ["cancel_or_port_out", "I want to port my number to Verizon"], ["fraud_or_theft", "my phone was stolen"], ["legal", "I'll call my lawyer"], ["accessibility", "I'm deaf, I need a relay service"], ["unresolved_complaint", "I've called three times and nobody fixed it"]] as const) {
    const k2 = await kit.newContact("+1425555" + String(7000 + Math.floor(Math.random() * 999)));
    const r2 = await runTurn(kit.deps(new ScriptedLlm([{ tools: [{ name: "handoff_escalate", args: { reason_type: rt, reason: "customer said so" } }] }, { content: "A person will follow up." }])), await input(said, { conversationId: k2.conversationId }));
    ok(r2.toolCalls[0].ok, `${rt} is valid when they say "${said}": ${JSON.stringify(r2.toolCalls)}`);
  }
});
await t("guardrail (money): an amount that is not in this turn's evidence is rewritten once, then accepted if grounded", async () => {
  const llm = new ScriptedLlm([{ content: "A tune-up is only $59 today." }, { content: "A basic tune-up is $89." }]);
  const r = await runTurn(kit.deps(llm), await input("tune-up price?"));
  ok(r.outcome === "reply" && r.text.includes("$89") && /guardrail retry/.test(r.note ?? ""), JSON.stringify({ t: r.text, n: r.note }));
  ok(llm.requests[1].messages.some((m: any) => m.role === "user" && /rejected/.test(m.content)), "correction note was sent");
});
await t("guardrail (money): still ungrounded after the retry -> a plain 'someone will confirm' reply, the team is told, the customer stays with the agent; the invented price is never returned", async () => {
  const k2 = await kit.newContact("+14255550780");
  const llm = new ScriptedLlm([{ content: "It is $12.34." }, { content: "Honestly just $7." }]);
  const r = await runTurn(kit.deps(llm), await input("price?", { conversationId: k2.conversationId }));
  ok(r.outcome === "blocked" && /someone confirm/.test(r.text) && !r.text.includes("$") && !r.text.includes("12.34"), JSON.stringify(r));
  ok(((await db.collection("conversations").findOne({ _id: k2.conversationId })) as any).mode === "agent", "stays with the agent");
  ok((await db.collection("notifications").countDocuments({ conversationId: k2.conversationId, kind: "handoff" })) === 1, "team told");
});
await t("guardrail (discount): 50% off is blocked when the ceiling is 10%", async () => {
  const llm = new ScriptedLlm([{ content: "Sure, 50% off today!" }, { content: "I can't discount that, but I can check promos." }]);
  const r = await runTurn(kit.deps(llm), await input("give me a deal"));
  ok(r.outcome === "reply" && !/50%/.test(r.text), r.text);
});
await t("a price the assistant quoted earlier in the same conversation may be repeated later without being treated as invented", async () => {
  const k2 = await kit.newContact("+14255550860");
  await db.collection("messages").insertOne({ orgId, conversationId: k2.conversationId, channel: "imessage", direction: "out", sender: "agent", body: "The Trailhead bike is $1,450.", channelMsgId: "prev1", deliveryStatus: "sent", handling: "agent", ts: new Date(kit.now.t.getTime() - 1000) } as never);
  const llm = new ScriptedLlm([{ content: "Like I said, it is $1,450." }]);
  const r = await runTurn(kit.deps(llm), await input("what was that price again?", { conversationId: k2.conversationId }));
  ok(r.outcome === "reply" && r.text.includes("$1,450"), JSON.stringify(r));
});
await t("guardrail (discount): REFUSING a discount is allowed; an offer above the ceiling is still blocked even when a refusal sits in the same sentence", async () => {
  const { checkDiscount } = await import("../src/engine/guardrails");
  for (const refusal of ["I can't do 50% off, sorry.", "I'm not able to offer a 50% discount.", "We don't give 30% off on that plan.", "Unfortunately 50% off isn't something I can do."]) ok(checkDiscount(refusal, 10).verdict === "ok", refusal);
  for (const offer of ["Sure, 50% off today!", "I can't do 5% but I can do 50% off.", "No problem. I can give you 40% off.", "Okay, 20% discount for you.", "I can offer 50% off and can't do more than that."]) ok(checkDiscount(offer, 10).verdict === "blocked", offer);
  ok(checkDiscount("You get 10% off.", 10).verdict === "ok", "at the ceiling is allowed");
});
await t("grounding helper: formats compare equal ($1,450 = 1450 = $1450.00); unrelated amounts do not", async () => {
  ok(checkGroundedMoney("It costs $1,450.", ["Trailhead is $1450.00"]).verdict === "ok", "format");
  ok(checkGroundedMoney("It costs $1,451.", ["Trailhead is $1,450"]).verdict === "blocked", "off by one");
  ok(checkGroundedMoney("No prices here.", []).verdict === "ok", "no amounts");
});
await t("memory tools: remember stores the customer's words with provenance; prices and duplicates are refused; commitments are recorded", async () => {
  const k2 = await kit.newContact("+14255550781");
  const llm = new ScriptedLlm([{ tools: [
    { name: "memory_remember", args: { fact: "moving to Portland in January" } }, { name: "memory_remember", args: { fact: "moving to Portland in January" } },
    { name: "memory_remember", args: { fact: "the plan costs $50" } }, { name: "memory_commit", args: { text: "check trade-in value on iPhone 13", due_in_days: 2 } },
    { name: "contact_update_stage", args: { stage: "qualified", score: 70 } }] }, { content: "Noted." }]);
  const inp = await input("I'm moving to Portland in January", { conversationId: k2.conversationId });
  const r = await runTurn(kit.deps(llm), inp);
  const c: any = await db.collection("contacts").findOne({ _id: k2.contactId });
  ok(c.facts.length === 1 && String(c.facts[0].sourceMessageId) === String(inp.batch[0]._id), "one fact with provenance: " + JSON.stringify(c.facts));
  ok(c.memory.openLoops.length === 1 && c.memory.openLoops[0].status === "open" && c.memory.openLoops[0].dueAt, "open loop");
  ok(c.stage === "qualified" && c.score === 70, "stage");
  const msgs = (llm.requests[1].messages.filter((m: any) => m.role === "tool") as any[]).map((m) => m.content);
  ok(msgs[1].includes("already called") && msgs[2].includes("not_storable"), msgs.join(" | "));   // same call twice in one turn: reminder, not a re-run
  const llm2 = new ScriptedLlm([{ tools: [{ name: "memory_remember", args: { fact: "moving to Portland in January" } }] }, { content: "Noted." }]);
  await runTurn(kit.deps(llm2), await input("as I said, Portland in January", { conversationId: k2.conversationId }));
  ok((llm2.requests[1].messages.find((m: any) => m.role === "tool") as any).content.includes("already_known") && ((await db.collection("contacts").findOne({ _id: k2.contactId })) as any).facts.length === 1, "a repeat in a LATER turn is recognized as already known");
  ok(r.sideEffects, "side effects flagged");
});
await t("ISOLATION CANARY: a secret fact stored for contact A never appears in any model request for contact B", async () => {
  const a = await kit.newContact("+14255550801", { facts: [{ text: "secret-canary-7731 lives at 12 Oak St", sourceMessageId: null, learnedAt: kit.now.t }], memory: { summary: "A said secret-canary-7731", openLoops: [{ text: "call A about secret-canary-7731", status: "open" }] } });
  const b = await kit.newContact("+14255550802");
  const llm = new ScriptedLlm([{ tools: [{ name: "knowledge_search", args: { query: "secret-canary-7731" } }] }, { content: "I don't have that." }]);
  await runTurn(kit.deps(llm), await input("what do you know about secret canary", { conversationId: b.conversationId }));
  ok(!JSON.stringify(llm.requests).includes("secret-canary-7731") || llm.requests.every((rq) => !rq.messages.slice(0, -1).some((m: any) => String(m.content).includes("12 Oak St"))), "A's data leaked into B's context");
  ok(!JSON.stringify(llm.requests.map((q) => q.messages.filter((m: any) => m.role !== "user"))).includes("12 Oak St"), "A's fact leaked");
  // and the same contact A does see their own memory
  const llmA = new ScriptedLlm([{ content: "ok" }]);
  await runTurn(kit.deps(llmA), await input("hi", { conversationId: a.conversationId }));
  ok(JSON.stringify(llmA.requests[0].messages[0]).includes("12 Oak St"), "A should see their own fact");
});
await t("verification gating: tmo_context is refused for an unverified customer, works once verified, and never leaks signals", async () => {
  const k2 = await kit.newContact("+14255550810", { externalRefs: [{ system: "tmobile", id: "ACC-1", kind: "account" }], profile: { displayName: "Maya", household: [{ lineId: "L1", name: "Maya" }] } });
  await db.collection("tmo_accounts").insertOne({ orgId, accountId: "ACC-1", importedAt: kit.now.t, segment: "family", asOf: "2026-10-01", lines: [], billing: [], support: [], context: {
    as_of: "2026-10-01", segment: "family", tenure_months: 40, credit_tier: "A", autopay: true, lines: [{ line_id: "L1", member_label: "Line 1", member_role: "primary", plan_name: "Essentials", plan_data_cap_gb: 50, has_protection: true, device: { name: "iPhone 13", age_months: 40 }, financing: { paid_off: true } }],
    services: [{ name: "Netflix", monthly_cents: 1000 }], billing: { latest_total_cents: 12000, change_pct_vs_prior_avg: 0.18 }, support: { contacts_90d: 2, unresolved_90d: 1, last_contact_date: "2026-09-20" }, signals: { port_out_inquiry: 1, competitor_research_score: 0.9 } } } as never);
  const llm1 = new ScriptedLlm([{ tools: [{ name: "tmo_context", args: {} }] }, { content: "I need to verify you first." }]);
  const inp = await input("why did my bill go up?", { conversationId: k2.conversationId, channel: "sms" });
  await runTurn(kit.deps(llm1), inp);
  const toolMsg = (llm1.requests[1].messages.find((m: any) => m.role === "tool") as any).content;
  ok(toolMsg.includes("not_verified") && !toolMsg.includes("iPhone"), toolMsg);
  ok(!JSON.stringify(llm1.requests[0].messages[0]).includes("iPhone 13") && /Verified: NO/.test(llm1.requests[0].messages[0].content as string), "prompt must not contain account details");
  await db.collection("contacts").updateOne({ _id: k2.contactId }, { $set: { verifiedPhone: { number: "+14255550810", at: kit.now.t, method: "otp_imessage" } } });
  const llm2 = new ScriptedLlm([{ tools: [{ name: "tmo_context", args: {} }] }, { content: "Your latest bill is $120.00." }]);
  const r = await runTurn(kit.deps(llm2), await input("why did my bill go up?", { conversationId: k2.conversationId, channel: "sms" }));
  const ok2 = (llm2.requests[1].messages.find((m: any) => m.role === "tool") as any).content;
  ok(ok2.includes("iPhone 13") && ok2.includes("$120.00") && !/port_out|porting|competitor|signals/i.test(ok2), ok2);
  ok(r.outcome === "reply" && r.text.includes("$120.00"), "a number from the tool result is allowed in the reply: " + r.text);
});
await t("a text from their own number on iMessage verifies them (a code to the same thread proves nothing); only a phone call needs the code", async () => {
  const mk = async (phone: string, id: string) => { const c = await kit.newContact(phone, { externalRefs: [{ system: "tmobile", id, kind: "account" }] }); await db.collection("contacts").updateOne({ _id: c.contactId }, { $set: { handles: [{ channel: "imessage", address: phone }, { channel: "sms", address: phone }, { channel: "voice", address: phone }] } }); return c; };
  const verifiedAfter = async (c: { contactId: ObjectId; conversationId: ObjectId }, channel: "imessage" | "sms" | "voice") => {
    const id = await kit.addInbound(c.conversationId, "tell me about my plan", { channel });
    const b = await buildContext(db, kit.deps(new ScriptedLlm([])).env, { orgId, conversationId: c.conversationId, channel, mode: channel === "voice" ? "voice" : "text", batch: [{ _id: id, body: "tell me about my plan", ts: kit.now.t }] });
    return b.customer.verified;
  };
  ok(await verifiedAfter(await mk("+14255550851", "ACC-V1"), "imessage"), "iMessage from their own number is verified");
  ok(await verifiedAfter(await mk("+14255550852", "ACC-V2"), "sms"), "SMS from their own number is verified too");
  ok(!(await verifiedAfter(await mk("+14255550853", "ACC-V3"), "voice")), "a phone call still needs the code");
});
await t("a tool call with arguments that are not valid JSON is answered with an error, and the broken string is NOT echoed back (the provider answers HTTP 400 to that and the customer would hear a fallback)", async () => {
  const llm = new ScriptedLlm([{ tools: [{ name: "memory_commit", args: '{"summary": "oops' }] }, { content: "Sorry, one moment. How can I help?" }]);
  const r = await runTurn(kit.deps(llm), await input("hi there"));
  ok(r.outcome === "reply" && /How can I help/.test(r.text), JSON.stringify({ o: r.outcome, t: r.text }));
  const echoed = llm.requests[1].messages.find((m: any) => m.role === "assistant" && m.tool_calls) as any;
  ok(echoed && JSON.parse(echoed.tool_calls[0].function.arguments) !== undefined, "the echoed arguments parse: " + JSON.stringify(echoed?.tool_calls?.[0]?.function));
  const tool = llm.requests[1].messages.find((m: any) => m.role === "tool") as any; ok(/invalid_arguments/.test(tool.content), tool.content);
});
await t("verification applies to the tool even if the prompt were ignored: no account link -> no_account_linked", async () => {
  const k2 = await kit.newContact("+14255550811", { verifiedPhone: { number: "+14255550811", at: kit.now.t, method: "otp" } });
  const llm = new ScriptedLlm([{ tools: [{ name: "tmo_context", args: {} }] }, { content: "I don't see an account for this number." }]);
  await runTurn(kit.deps(llm), await input("my account?", { conversationId: k2.conversationId }));
  ok((llm.requests[1].messages.find((m: any) => m.role === "tool") as any).content.includes("no_account_linked"), "should say no account");
});
await t("passthrough tools (ElevenLabs end_call) are returned to the caller, never executed", async () => {
  const llm = new ScriptedLlm([{ content: "Goodbye!", tools: [{ name: "end_call", args: { reason: "done" } }] }]);
  const r = await runTurn(kit.deps(llm), { ...(await input("bye")), passthrough: [{ name: "end_call", description: "end the call", parameters: { type: "object", properties: {} } }] });
  ok(r.passthrough.length === 1 && r.passthrough[0].name === "end_call" && r.text === "Goodbye!", JSON.stringify(r.passthrough));
  ok(r.toolCalls.length === 0, "must not run");
});
await t("context: recent history across channels, summary, redacted bodies; the new message is not duplicated", async () => {
  const k2 = await kit.newContact("+14255550820", { memory: { summary: "Asked about gravel bikes last week.", openLoops: [] } });
  const m = (ch: string, dir: string, body: string, ts: number, extra = {}) => db.collection("messages").insertOne({ orgId, conversationId: k2.conversationId, channel: ch, direction: dir, sender: dir === "in" ? "customer" : "agent", body, deliveryStatus: dir === "in" ? "received" : "sent", handling: "agent", ts: new Date(kit.now.t.getTime() + ts), channelMsgId: `x${ts}${ch}`, ...extra } as never);
  await m("sms", "in", "do you sell gravel bikes", 1); await m("sms", "out", "yes, the Trailhead GX", 2); await m("voice", "in", "Phone call (0:40)", 3, { handling: "ignored" }); await m("imessage", "out", "[verification code sent]", 4, { redacted: true });
  const inp = await input("what size should I get?", { conversationId: k2.conversationId });
  const ctx = await buildContext(db, kit.deps(new ScriptedLlm([])).env, inp);
  const roles = ctx.messages.map((x: any) => `${x.role}:${String((x as any).content).slice(0, 28)}`);
  ok(ctx.messages[0].role === "system" && /Asked about gravel bikes last week/.test(ctx.messages[0].content as string), "summary in system");
  ok(roles.some((r) => r.includes("do you sell gravel")) && roles.some((r) => r.includes("verification code sent")) && !roles.some((r) => r.includes("Phone call")), roles.join(" | "));
  ok(roles.filter((r) => r.includes("what size should")).length === 1, "batch message must appear once");
});
await t("streaming: sentences are released one by one as they complete; decimals are not split", async () => {
  const llm = new ScriptedLlm([{ content: "Sure thing. A basic tune-up is $89.00 and takes two days! Want me to book it?" }]);
  const out: string[] = []; let doneEv: any;
  for await (const ev of streamTurn(kit.deps(llm), { ...(await input("tune up?")), mode: "voice" })) { if (ev.type === "sentence") out.push(ev.text); if (ev.type === "done") doneEv = ev; }
  ok(out.length === 3 && out[1].includes("$89.00 and takes two days!"), JSON.stringify(out));
  ok(doneEv.result.outcome === "reply" && doneEv.result.effort === "none", "voice uses effort none");
});
await t("streaming: an ungrounded sentence is replaced by a safe line before it is spoken; the others pass", async () => {
  const llm = new ScriptedLlm([{ content: "Happy to help. That tune-up is only $12.34 today. Anything else?" }]);
  const out: any[] = [];
  for await (const ev of streamTurn(kit.deps(llm), { ...(await input("price?")), mode: "voice" })) if (ev.type === "sentence") out.push(ev);
  ok(out.length === 3 && out[1].replaced && !JSON.stringify(out).includes("12.34"), JSON.stringify(out));
});
await t("streaming: a tool call mid-stream runs, and the reply continues after it", async () => {
  const llm = new ScriptedLlm([{ content: "Let me check.", tools: [{ name: "knowledge_search", args: { query: "tune-up" } }] }, { content: "It is $89." }]);
  const out: string[] = [];
  for await (const ev of streamTurn(kit.deps(llm), { ...(await input("tune-up price?")), mode: "voice" })) if (ev.type === "sentence") out.push(ev.text);
  ok(out.join(" ") === "Let me check. It is $89.", out.join(" | "));
});
await t("streaming: hanging up cancels the turn promptly and reports it as interrupted", async () => {
  const ac = new AbortController();
  const llm = new ScriptedLlm([{ content: "This is a very long answer that keeps going. And going. And going. And going. And going. And going." }]);
  let n = 0; let doneEv: any;
  for await (const ev of streamTurn(kit.deps(llm), { ...(await input("talk")), mode: "voice", signal: ac.signal })) {
    if (ev.type === "sentence" && ++n === 1) ac.abort();
    if (ev.type === "done") doneEv = ev;
  }
  ok(doneEv.result.note === "interrupted" && n < 6, `n=${n} note=${doneEv.result.note}`);
});
await t("takeSentences: abbreviations in the middle stay together, trailing fragment is held until flushed", async () => {
  const [a, rest] = takeSentences("Hello there. It costs $41.51 a month. And then");
  ok(a.length === 2 && a[1] === "It costs $41.51 a month." && rest === "And then", JSON.stringify({ a, rest }));
});

await t("reasoning never reaches the customer: stray closing tag, complete pairs, unmatched opener, repeated answer; normal text and markdown handled", async () => {
  const leaked = "I should say I do not have it.\nLet me draft.\n\nI don't have pricing for that.\n</think>\n\nI don't have pricing for that.";
  ok(stripThinking(leaked) === "I don't have pricing for that.", JSON.stringify(stripThinking(leaked)));
  ok(stripThinking("<think>secret plan</think>Hello there") === "Hello there", "pair");
  ok(stripThinking("Answer first <think>and then more thinking with no end") === "Answer first", "unmatched opener");
  ok(stripThinking("It is $89.\n\nIt is $89.") === "It is $89.", "repeated paragraph collapsed");
  ok(stripThinking("Line one.\n\nLine two.") === "Line one.\n\nLine two.", "different paragraphs untouched");
  ok(cleanReply("**Great** question:\n- It is $89\n- Two days") === "Great question:\nIt is $89\nTwo days", JSON.stringify(cleanReply("**Great** question:\n- It is $89\n- Two days")));
  ok(stripThinking(null) === "" && stripThinking("") === "", "empty");
});
await t("a leaked-reasoning reply from the model is cleaned before it is returned or grounded-checked", async () => {
  const llm = new ScriptedLlm([{ content: "Let me think: the price is probably $59.\n</think>\n\nA basic tune-up is $89." }]);
  const r = await runTurn(kit.deps(llm), await input("tune-up price?"));
  ok(r.text === "A basic tune-up is $89." && r.outcome === "reply", JSON.stringify(r.text));
});

await t("a model that calls the same tool with the same arguments again in one turn is not re-run; it is reminded to answer (stops loops seen with the real model)", async () => {
  const k2 = await kit.newContact("+14255550870");
  const same = { name: "memory_commit", args: { text: "check trade-in value" } };
  const llm = new ScriptedLlm([{ tools: [same] }, { tools: [same] }, { tools: [same] }, { content: "I have noted that." }]);
  const r = await runTurn(kit.deps(llm), await input("remind me", { conversationId: k2.conversationId }));
  const c: any = await db.collection("contacts").findOne({ _id: k2.contactId });
  ok(r.outcome === "reply" && c.memory.openLoops.length === 1, `loops=${c.memory.openLoops.length} outcome=${r.outcome}`);
  const reminders = (llm.requests[2].messages.filter((m: any) => m.role === "tool") as any[]).filter((m) => m.content.includes("already called"));
  ok(reminders.length >= 1, "the model was told it already has the result");
});
await t("PROMPT DRIFT GUARD: every tool a prompt mentions exists in the registry, and the generated tool list matches the registry exactly", async () => {
  const names = new Set(ALL_TOOLS.map((x) => x.name));
  for (const f of readdirSync(new URL("../prompts/", import.meta.url))) {
    const raw = readFileSync(new URL(`../prompts/${f}`, import.meta.url), "utf8"); const text = raw.replace(/\{\{\w+\}\}/g, "");   // placeholders are not tool names
    const mentioned = [...new Set(text.match(/\b(?:tmo|verify|forms|memory|contact|owner|handoff|consent|text|knowledge)_[a-z_]+\b/g) ?? [])].filter((x) => !x.endsWith("_"));
    const phantom = mentioned.filter((m) => !names.has(m));
    ok(!phantom.length, `${f} mentions tools that do not exist: ${phantom.join(", ")}`);
    ok(/\{\{tools_block\}\}/.test(raw), `${f} must include {{tools_block}}`);
  }
  const block = toolsBlock(ALL_TOOLS); ok(ALL_TOOLS.every((x) => block.includes(`- ${x.name}:`)) && block.split("\n").length === ALL_TOOLS.length, "block lists every registered tool once");
});
await t("empty reply (the model spent its whole budget thinking): retried once with reasoning off, with tools still offered, and the customer gets a real answer", async () => {
  const llm = new ScriptedLlm([{ content: "" }, { content: "A basic tune-up is $89." }]);
  const r = await runTurn(kit.deps(llm), await input("tune-up price?"));
  ok(r.text === "A basic tune-up is $89." && r.outcome === "reply", JSON.stringify(r.text));
  ok(llm.requests[1].effort === "none" && llm.requests[1].maxTokens === llm.requests[0].maxTokens * 2 && (llm.requests[1].tools?.length ?? 0) > 0, "retry: effort none, double budget, tools kept");
});
await t("a reply cut off by the token limit is retried, and if it is still cut off only complete sentences are sent", async () => {
  const cut = (c: string) => ({ content: c, finish: "length" } as never);
  const llm = new (class extends ScriptedLlm { async chat(req: any) { const r = await super.chat(req); if ((r.message.content ?? "").includes("CUT")) r.finish = "length"; return r; } })([{ content: "A basic tune-up is $89 and takes CUT" }, { content: "A basic tune-up is $89. It takes about CUT" }]);
  void cut;
  const r = await runTurn(kit.deps(llm), await input("tune-up price?"));
  ok(r.text === "A basic tune-up is $89." && !/CUT|about/.test(r.text), JSON.stringify(r.text));
});
await t("tool syntax printed as text (<tool_call>, <function=...>) is never sent to a customer; the turn is retried and, failing that, falls back to a person", async () => {
  const llm = new ScriptedLlm([{ content: "<tool_call>\n<function=tmo_billing>\n</function>\n</tool_call>" }, { content: "Let me check on that for you." }]);
  const r = await runTurn(kit.deps(llm), await input("bill?"));
  ok(r.text === "Let me check on that for you." && !/tool_call/.test(r.text), r.text);
  const k2 = await kit.newContact("+14255550850");
  const bad = new ScriptedLlm([{ content: "<tool_call><function=x></function></tool_call>" }]);
  const r2 = await runTurn(kit.deps(bad), await input("bill?", { conversationId: k2.conversationId }));
  ok(r2.outcome === "escalated" && r2.text === SAFE_FALLBACK, JSON.stringify(r2.text));
});
await t("streaming: tool markup is skipped and a sentence cut off by the token limit is not spoken", async () => {
  const llm = new ScriptedLlm([{ content: "Sure thing. <tool_call><function=x></function></tool_call> That costs $89. And then the" }]);
  const finishLen = Object.assign(llm, {});
  const orig = llm.stream.bind(llm); llm.stream = async function* (req: any) { for await (const d of orig(req)) yield d.type === "done" ? { ...d, finish: "length" } : d; } as never;
  const out: string[] = []; for await (const ev of streamTurn(kit.deps(finishLen), { ...(await input("tune-up price")), mode: "voice" })) if (ev.type === "sentence") out.push(ev.text);
  ok(out.join(" ") === "Sure thing. That costs $89.", JSON.stringify(out));
});

await t("deep work: a model that needs many tool calls still answers, because the last round has no tools (text and voice); a loop that never stops still falls back", async () => {
  const mk = () => { let n = 0; return new ScriptedLlm([(req) => (req.tools && n++ < MAX_ROUNDS + 3 ? { tools: [{ name: "knowledge_search", args: { query: `tune-up pricing ${n}` } }] } : { content: "Here is what I found: a basic tune-up is $89." })]); };
  const k = await kit.newContact("+14255550701"); const llm = mk();
  const r = await runTurn(kit.deps(llm), await input("research this deeply", { conversationId: k.conversationId }));
  ok(r.outcome === "reply" && /\$89/.test(r.text) && r.rounds === MAX_ROUNDS, JSON.stringify({ o: r.outcome, r: r.rounds, t: r.text }));
  const last = llm.requests[llm.requests.length - 1]; ok(!last.tools && JSON.stringify(last.messages).includes("tool budget"), "final round withheld the tools and told the model to answer");
  const k2 = await kit.newContact("+14255550702"); const llm2 = mk(); const id = await kit.addInbound(k2.conversationId, "research this deeply", { channel: "voice" });
  let spoken = ""; let res: any;
  for await (const ev of streamTurn(kit.deps(llm2), { orgId: kit.orgId, conversationId: k2.conversationId, channel: "voice", mode: "voice", batch: [{ _id: id, body: "research this deeply", ts: kit.now.t }] })) { if (ev.type === "sentence") spoken += ev.text + " "; if (ev.type === "done") res = ev.result; }
  ok(res.outcome === "reply" && /\$89/.test(spoken) && !res.escalated, JSON.stringify({ o: res.outcome, spoken }));
});
await t("a failed turn on a CALL tells the team but does not lock the caller out of the agent; a failed text turn still hands to a person", async () => {
  const k = await kit.newContact("+14255550703"); const id = await kit.addInbound(k.conversationId, "hello", { channel: "voice" });
  const llm = new ScriptedLlm([{ throws: "model down" }]); let res: any;
  for await (const ev of streamTurn(kit.deps(llm), { orgId: kit.orgId, conversationId: k.conversationId, channel: "voice", mode: "voice", batch: [{ _id: id, body: "hello", ts: kit.now.t }] })) if (ev.type === "done") res = ev.result;
  ok(res.escalated && ((await db.collection("conversations").findOne({ _id: k.conversationId })) as any).mode === "agent", "call: still agent mode");
  ok((await db.collection("notifications").countDocuments({ conversationId: k.conversationId, kind: "handoff" })) === 1, "team notified");
});
await t("money: a whole-dollar rounding of an exact amount is fine ($107 for $106.98); a different amount still is not; one blocked sentence is replaced once", async () => {
  const { checkGroundedMoney } = await import("../src/engine/guardrails");
  ok(checkGroundedMoney("Your bill is about $107.", ["latest_total: $106.98"]).verdict === "ok", "rounded");
  ok(checkGroundedMoney("Your bill is $110.", ["latest_total: $106.98"]).verdict === "blocked", "different");
  ok(checkGroundedMoney("Your bill is $107.50.", ["latest_total: $106.98"]).verdict === "blocked", "not a whole-dollar rounding");
  ok(checkGroundedMoney("That plan is $50.", ['{"plan":"Saver","monthly_total":"$55","lines":50}']).verdict === "blocked", "a bare 50 inside a tool result does not make $50 a quoted price");
  ok(checkGroundedMoney("So about $100 a month.", ["USER:I pay like 100 bucks for one line"]).verdict === "ok", "the customer's own bare number does");
});
await t("someone who says money is tight hears something human first; markdown emphasis is stripped", async () => {
  ok(empathyLead("I lost my job and need the cheapest plan", "The cheapest is $55 a month.", "a")?.length! > 10, "lead added");
  ok(empathyLead("I lost my job", "I'm sorry to hear that. The cheapest is $55.", "a") === null, "already empathetic: untouched");
  ok(empathyLead("how much is the iPhone", "It is $929.99.", "a") === null, "no hardship, no lead");
  ok(cleanReply("What I *can* do is **really** help.") === "What I can do is really help.", cleanReply("What I *can* do is **really** help."));
});
await t("a legal threat goes straight to a person (text and voice) without asking the model; word-for-word repeats are dropped", async () => {
  const k = await kit.newContact("+14255550721"); const llm = new ScriptedLlm([{ content: "should never be asked" }]);
  const r = await runTurn(kit.deps(llm), await input("I'm going to call my lawyer about this", { conversationId: k.conversationId }));
  ok(r.outcome === "escalated" && /bringing in a person/.test(r.text) && llm.requests.length === 0 && ((await db.collection("conversations").findOne({ _id: k.conversationId })) as any).mode === "human", JSON.stringify({ o: r.outcome, t: r.text, calls: llm.requests.length }));
  const k2 = await kit.newContact("+14255550722"); const id = await kit.addInbound(k2.conversationId, "I will sue you people", { channel: "voice" }); let spoken = "";
  for await (const ev of streamTurn(kit.deps(new ScriptedLlm([{ content: "nope" }])), { orgId: kit.orgId, conversationId: k2.conversationId, channel: "voice", mode: "voice", batch: [{ _id: id, body: "I will sue you people", ts: kit.now.t }] })) if (ev.type === "sentence") spoken += ev.text + " ";
  ok(/bringing in a person/.test(spoken) && ((await db.collection("conversations").findOne({ _id: k2.conversationId })) as any).mode === "human", spoken);
  ok(dedupeSentences("I can look into that. I can look into that. Sending it now.") === "I can look into that. Sending it now.", "dedupe");
});
await t("saying 'I'm texting you a code' without sending one is backed up with a real send (and a plain message if it cannot be sent)", async () => {
  const k = await kit.newContact("+14255550723", { externalRefs: [{ system: "tmobile", id: "ACC-Q", kind: "account" }] });
  kit.adapters.imessage.sent.length = 0; kit.ready.imessage = { ok: true }; // a caller on the phone: caller ID is not proof, so the code is still needed (iMessage verifies by channel)
  await db.collection("contacts").updateOne({ _id: k.contactId }, { $set: { handles: [{ channel: "voice", address: "+14255550723" }, { channel: "imessage", address: "+14255550723" }] } });
  const llm = new ScriptedLlm([{ content: "To keep your account safe, I'm texting a 6-digit code to the number on file now." }]);
  const r = await runTurn(kit.deps(llm), await vinput("why is my bill high?", k.conversationId));
  ok(r.toolCalls.some((t) => t.name === "verify_send_code" && t.ok) && kit.adapters.imessage.sent.some((m) => m.address === "+14255550723" && /verification code/.test(m.text)), JSON.stringify(r.toolCalls));
  const k3 = await kit.newContact("+14255550725", { externalRefs: [{ system: "tmobile", id: "ACC-Q3", kind: "account" }] }); await db.collection("contacts").updateOne({ _id: k3.contactId }, { $set: { handles: [{ channel: "voice", address: "+14255550725" }, { channel: "imessage", address: "+14255550725" }] } }); kit.adapters.imessage.sent.length = 0;
  const r3 = await runTurn(kit.deps(new ScriptedLlm([{ content: "Here is what I can see. Want me to text a code to the number on file so I can check more?" }])), await vinput("any deals on my plan?", k3.conversationId));
  ok(/just sent a 6-digit code/.test(r3.text) && !/Want me to text/.test(r3.text) && kit.adapters.imessage.sent.some((m) => m.address === "+14255550725"), "asking permission is replaced by sending: " + r3.text);
  const k2 = await kit.newContact("+14255550724", { externalRefs: [{ system: "tmobile", id: "ACC-Q2", kind: "account" }] }); await db.collection("contacts").updateOne({ _id: k2.contactId }, { $set: { handles: [{ channel: "voice", address: "+14255550724" }, { channel: "imessage", address: "+14255550724" }] } }); kit.ready.imessage = { ok: false }; kit.ready.whatsapp = { ok: false };
  const r2 = await runTurn(kit.deps(new ScriptedLlm([{ content: "I'm texting a code to your number now." }])), await vinput("check my bill", k2.conversationId));
  ok(/not able to send a text/.test(r2.text), r2.text); kit.ready.imessage = { ok: true }; kit.ready.whatsapp = { ok: true };
});
await t("a reply that says 'someone from the team' (even a goodbye) tells the team but NEVER locks the customer out of the agent; a handoff nobody picked up expires", async () => {
  const k = await kit.newContact("+14255550731");
  const r = await runTurn(kit.deps(new ScriptedLlm([{ content: "No problem at all. Let me connect you with someone from the team." }])), await input("that's all, thanks", { conversationId: k.conversationId }));
  ok(r.outcome === "reply" && ((await db.collection("conversations").findOne({ _id: k.conversationId })) as any).mode === "agent", "chat stays with the agent");
  ok((await db.collection("notifications").countDocuments({ conversationId: k.conversationId, kind: "handoff" })) === 1, "team still told");
  // a conversation left in human mode with no recent handoff and no message from a person returns to the agent
  const { resumeIfStale } = await import("../src/identity");
  const k2 = await kit.newContact("+14255550732"); await db.collection("conversations").updateOne({ _id: k2.conversationId }, { $set: { mode: "human" } });
  await db.collection("notifications").insertOne({ orgId: kit.orgId, conversationId: k2.conversationId, kind: "handoff", cause: "customer_request", message: "x", urgency: "high", read: false, createdAt: new Date(kit.now.t.getTime() - 3 * 3600_000) } as never);
  const c2: any = await db.collection("conversations").findOne({ _id: k2.conversationId });
  ok((await resumeIfStale(db, c2, kit.now.t)).mode === "agent" && ((await db.collection("conversations").findOne({ _id: k2.conversationId })) as any).mode === "agent", "stale handoff: agent resumes");
  const k3 = await kit.newContact("+14255550733"); await db.collection("conversations").updateOne({ _id: k3.conversationId }, { $set: { mode: "human" } });
  await db.collection("notifications").insertOne({ orgId: kit.orgId, conversationId: k3.conversationId, kind: "handoff", cause: "customer_request", message: "x", urgency: "high", read: false, createdAt: new Date(kit.now.t.getTime() - 30 * 60_000) } as never);
  const c3: any = await db.collection("conversations").findOne({ _id: k3.conversationId });
  ok((await resumeIfStale(db, c3, kit.now.t)).mode === "human", "a fresh handoff stays with the person");
});
await t("the model's narrated reasoning never reaches the customer", async () => {
  const leaked = "Let me pull up the exact total first. The customer is on a voice call and wants it texted. They're a new/unknown number, so I need consent before texting. The total is $140 a month.";
  ok(dropMeta(leaked) === "Let me pull up the exact total first. The total is $140 a month.", dropMeta(leaked));
  ok(dropMeta("Our customer service team is open 24/7. The customer service line is free.") === "Our customer service team is open 24/7. The customer service line is free.", "normal sentences about customer service untouched");
});
await t("a fraud or stolen-phone report goes straight to a person (the model is not asked), and a parenthetical question mark is not a second question", async () => {
  const k = await kit.newContact("+14255550751"); const llm = new ScriptedLlm([{ content: "never asked" }]);
  const r = await runTurn(kit.deps(llm), await input("someone is using my account, I think it's fraud", { conversationId: k.conversationId }));
  ok(r.outcome === "escalated" && /secure your account/.test(r.text) && llm.requests.length === 0 && ((await db.collection("conversations").findOne({ _id: k.conversationId })) as any).mode === "human", r.text);
  ok(limitQuestions("What does the other offer include? (Lines, data, taxes/fees?) That helps me compare.") === "What does the other offer include? (Lines, data, taxes/fees) That helps me compare.", limitQuestions("What does the other offer include? (Lines, data, taxes/fees?) That helps me compare."));
});
await t("one question per reply: statements stay, later questions go", async () => {
  ok(limitQuestions("Got it, Priya. Who are you with now? And how many lines?") === "Got it, Priya. Who are you with now?", limitQuestions("Got it, Priya. Who are you with now? And how many lines?"));
  ok(limitQuestions("Beyond is $280 a month. Want me to check promos?") === "Beyond is $280 a month. Want me to check promos?", "single question untouched");
  ok(limitQuestions("It is $55. That includes AutoPay.") === "It is $55. That includes AutoPay.", "no question untouched");
});
await finish(kit);

// Engine tests: tool loop, argument safety, isolation, verification gating, guardrails, streaming. pnpm exec tsx scripts/engine-test.ts
import { ObjectId } from "mongodb";
import { buildContext, toolsBlock } from "../src/engine/context";
import { readdirSync, readFileSync } from "node:fs";
import { checkGroundedMoney, takeSentences } from "../src/engine/guardrails";
import { ALL_TOOLS, validateRegistry } from "../src/engine/tools/index";
import { MAX_ROUNDS, runTurn, streamTurn, SAFE_FALLBACK, cleanReply } from "../src/engine/turn";
import { stripThinking } from "../src/engine/llm";
import { FORM_TEMPLATES } from "../../web/src/lib/form-templates";
import { ScriptedLlm, ok, t, finish, makeKit } from "./_testkit";

const kit = await makeKit({ groundMoney: true });
const { db, orgId } = kit;
const input = async (text: string, o: { conversationId?: ObjectId } = {}) => {
  const conversationId = o.conversationId ?? kit.conversationId;
  const id = await kit.addInbound(conversationId, text);
  return { orgId, conversationId, channel: "imessage" as const, mode: "text" as const, batch: [{ _id: id, body: text, ts: kit.now.t }] };
};
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
await t("round limit: a model that never stops calling tools gets a safe fallback and a person", async () => {
  const k2 = await kit.newContact("+14255550777");
  const llm = new ScriptedLlm([{ tools: [{ name: "knowledge_search", args: { query: "loop" } }] }]);
  const r = await runTurn(kit.deps(llm), await input("loop forever", { conversationId: k2.conversationId }));
  ok(r.outcome === "escalated" && r.text === SAFE_FALLBACK && r.rounds === MAX_ROUNDS && /max rounds/.test(r.note ?? ""), JSON.stringify({ o: r.outcome, rounds: r.rounds, n: r.note }));
  ok(((await db.collection("conversations").findOne({ _id: k2.conversationId })) as any).mode === "human", "should be handed to a person");
  ok((await db.collection("notifications").countDocuments({ conversationId: k2.conversationId, kind: "handoff" })) === 1, "owner notified");
});
await t("model outage: fallback text, handoff, no crash", async () => {
  const k2 = await kit.newContact("+14255550778");
  const r = await runTurn(kit.deps(new ScriptedLlm([{ throws: "model HTTP 503" }])), await input("hi", { conversationId: k2.conversationId }));
  ok(r.outcome === "escalated" && r.text === SAFE_FALLBACK && /503/.test(r.note ?? ""), JSON.stringify(r));
});
await t("handoff tool: conversation goes to a person, owner notified, outcome is escalated", async () => {
  const k2 = await kit.newContact("+14255550779");
  const llm = new ScriptedLlm([{ tools: [{ name: "handoff_escalate", args: { reason: "wants to cancel" } }] }, { content: "I will connect you with a person now." }]);
  const r = await runTurn(kit.deps(llm), await input("I want to cancel", { conversationId: k2.conversationId }));
  ok(r.outcome === "escalated" && r.escalated && r.sideEffects, "flags");
  const n: any = await db.collection("notifications").findOne({ conversationId: k2.conversationId }); ok(n.urgency === "high" && /cancel/.test(n.message), "notification");
});
await t("guardrail (money): an amount that is not in this turn's evidence is rewritten once, then accepted if grounded", async () => {
  const llm = new ScriptedLlm([{ content: "A tune-up is only $59 today." }, { content: "A basic tune-up is $89." }]);
  const r = await runTurn(kit.deps(llm), await input("tune-up price?"));
  ok(r.outcome === "reply" && r.text.includes("$89") && /guardrail retry/.test(r.note ?? ""), JSON.stringify({ t: r.text, n: r.note }));
  ok(llm.requests[1].messages.some((m: any) => m.role === "system" && /rejected/.test(m.content)), "correction note was sent");
});
await t("guardrail (money): still ungrounded after the retry -> safe fallback and a person, the invented price is never returned", async () => {
  const k2 = await kit.newContact("+14255550780");
  const llm = new ScriptedLlm([{ content: "It is $12.34." }, { content: "Honestly just $7." }]);
  const r = await runTurn(kit.deps(llm), await input("price?", { conversationId: k2.conversationId }));
  ok(r.outcome === "blocked" && r.text === SAFE_FALLBACK && !r.text.includes("$"), JSON.stringify(r));
  ok(((await db.collection("conversations").findOne({ _id: k2.conversationId })) as any).mode === "human", "handed to a person");
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
  const inp = await input("why did my bill go up?", { conversationId: k2.conversationId });
  await runTurn(kit.deps(llm1), inp);
  const toolMsg = (llm1.requests[1].messages.find((m: any) => m.role === "tool") as any).content;
  ok(toolMsg.includes("not_verified") && !toolMsg.includes("iPhone"), toolMsg);
  ok(!JSON.stringify(llm1.requests[0].messages[0]).includes("iPhone 13") && /Verified: NO/.test(llm1.requests[0].messages[0].content as string), "prompt must not contain account details");
  await db.collection("contacts").updateOne({ _id: k2.contactId }, { $set: { verifiedPhone: { number: "+14255550810", at: kit.now.t, method: "otp_imessage" } } });
  const llm2 = new ScriptedLlm([{ tools: [{ name: "tmo_context", args: {} }] }, { content: "Your latest bill is $120.00." }]);
  const r = await runTurn(kit.deps(llm2), await input("why did my bill go up?", { conversationId: k2.conversationId }));
  const ok2 = (llm2.requests[1].messages.find((m: any) => m.role === "tool") as any).content;
  ok(ok2.includes("iPhone 13") && ok2.includes("$120.00") && !/port_out|porting|competitor|signals/i.test(ok2), ok2);
  ok(r.outcome === "reply" && r.text.includes("$120.00"), "a number from the tool result is allowed in the reply: " + r.text);
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

await finish(kit);

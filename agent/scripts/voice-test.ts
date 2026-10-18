// Voice server: streaming format, identification, linking, interruption, signed webhook, transcript import.  pnpm exec tsx scripts/voice-test.ts
import { startVoiceServer } from "../src/voice/bridge";
import { extractCallInfo, signElevenLabs, verifyElevenLabsSignature } from "../src/voice/elevenlabs";
import { ScriptedLlm, ok, t, finish, makeKit } from "./_testkit";

const kit = await makeKit({ groundMoney: true });
const { db, orgId } = kit;
const LINE = "+12065550000", CALLER = "+14255550123", SECRET = "whsec_test", PATH = "pathsecret123";
await db.collection("channel_lines").insertOne({ orgId, channel: "sms", provider: "photon", photonLineId: null, address: LINE, status: "active", capabilities: [], createdAt: kit.now.t } as never);
await db.collection("contacts").updateOne({ _id: kit.contactId }, { $set: { handles: [{ channel: "imessage", address: CALLER }], facts: [{ text: "wants a gravel bike for commuting", sourceMessageId: null, learnedAt: kit.now.t }] } });
await db.collection("messages").insertOne({ orgId, conversationId: kit.conversationId, channel: "imessage", direction: "in", sender: "customer", body: "Hi, I texted yesterday about gravel bikes", channelMsgId: "old1", deliveryStatus: "received", handling: "agent", handledByTurn: "old", ts: new Date(kit.now.t.getTime() - 3600_000) } as never);

let llm = new ScriptedLlm([{ content: "A basic tune-up is $89 and takes two days. Want me to book it?" }]);
const logs: string[] = [];
const start = () => startVoiceServer({ db, engine: kit.deps(llm), port: 0, pathSecret: PATH, webhookSecret: SECRET, log: (m) => logs.push(m) });   // real clock: webhook signatures are time-bound
let srv = await start();
const url = (p: string) => `http://127.0.0.1:${srv.port}/voice/${PATH}${p}`;
const sys = (conv: string, caller = CALLER, called = LINE) => `You are the phone agent. [call caller=${caller} called=${called} conv=${conv}] Be brief.`;
const body = (conv: string, utterance: string, extra: Record<string, unknown> = {}) => JSON.stringify({ model: "x", stream: true, messages: [{ role: "system", content: sys(conv) }, { role: "assistant", content: "Hi, thanks for calling Sunrise Bike Shop." }, { role: "user", content: utterance }], ...extra });
async function sseCall(b: string, headers: Record<string, string> = {}) {
  const r = await fetch(url("/v1/chat/completions"), { method: "POST", headers: { "content-type": "application/json", ...headers }, body: b });
  const text = await r.text(); const events = text.split("\n\n").filter(Boolean).map((e) => e.replace(/^data: /, ""));
  const chunks = events.filter((e) => e !== "[DONE]").map((e) => JSON.parse(e));
  return { status: r.status, ct: r.headers.get("content-type"), raw: text, events, chunks, content: chunks.map((c) => c.choices[0].delta.content ?? "").join("").trim(), last: events[events.length - 1] };
}
const waitFor = async (f: () => Promise<boolean>, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await new Promise((r) => setTimeout(r, 20)); } return false; };

await t("signature: valid accepted; forged, tampered, stale, unsigned, wrong-scheme and empty-secret all rejected (format taken from the official SDK)", async () => {
  const raw = '{"type":"post_call_transcription"}'; const now = Date.now();
  const h = signElevenLabs(raw, SECRET, now);
  ok(verifyElevenLabsSignature(raw, h, SECRET, now).ok, "valid");
  ok(!verifyElevenLabsSignature(raw + " ", h, SECRET, now).ok, "tampered body");
  ok(!verifyElevenLabsSignature(raw, h, "other", now).ok, "wrong secret");
  ok(!verifyElevenLabsSignature(raw, signElevenLabs(raw, SECRET, now - 31 * 60_000), SECRET, now).ok, "stale (31 min)");
  ok(verifyElevenLabsSignature(raw, signElevenLabs(raw, SECRET, now - 29 * 60_000), SECRET, now).ok, "29 min is inside the tolerance");
  ok(!verifyElevenLabsSignature(raw, undefined, SECRET, now).ok && !verifyElevenLabsSignature(raw, "t=1", SECRET, now).ok && !verifyElevenLabsSignature(raw, h.replace("v0=", "v1="), SECRET, now).ok, "missing / malformed");
  ok(!verifyElevenLabsSignature(raw, h, "", now).ok, "unset secret must never pass");
});
await t("call info line: parsed from the system prompt and removed before the model sees it; unfilled template variables count as missing", async () => {
  const r = extractCallInfo([{ role: "system", content: "Hi [call caller=+14255550123 called=+12065550000 conv=abc] there" }, { role: "user", content: "x" }]);
  ok(r.caller === "+14255550123" && r.called === "+12065550000" && r.conv === "abc" && !(r.cleaned[0].content as string).includes("[call"), JSON.stringify(r));
  const u = extractCallInfo([{ role: "system", content: "[call caller={{system__caller_id}} called=unknown conv=c1]" }]);
  ok(u.caller === undefined && u.called === undefined && u.conv === "c1", JSON.stringify(u));
});
await t("endpoint: wrong or missing secret path returns 404 and reveals nothing", async () => {
  for (const p of ["/voice/wrong/v1/chat/completions", "/v1/chat/completions", "/voice/chat/completions"]) { const r = await fetch(`http://127.0.0.1:${srv.port}${p}`, { method: "POST", body: "{}" }); ok(r.status === 404 && (await r.text()) === "", p); }
  ok((await fetch(`http://127.0.0.1:${srv.port}/health`)).status === 200, "health");
});
await t("streaming reply: OpenAI chunk format with a role chunk first, sentences as separate chunks, a stop chunk, and [DONE]", async () => {
  const r = await sseCall(body("conv_1", "How much is a tune-up?"));
  ok(r.status === 200 && r.ct?.startsWith("text/event-stream"), `${r.status} ${r.ct}`);
  ok(r.chunks[0].choices[0].delta.role === "assistant" && r.chunks[0].object === "chat.completion.chunk", "first chunk");
  ok(r.content === "A basic tune-up is $89 and takes two days. Want me to book it?", r.content);
  ok(r.chunks.filter((c) => c.choices[0].delta.content).length === 2, "one chunk per sentence");
  ok(r.chunks[r.chunks.length - 1].choices[0].finish_reason === "stop" && r.last === "[DONE]", "ends with stop + [DONE]");
});
await t("the caller is recognized: the model sees their name-less profile, facts and earlier texts from OTHER channels, and the call line is not shown to it", async () => {
  const sysMsg = llm.requests[0].messages[0].content as string;
  ok(/wants a gravel bike for commuting/.test(sysMsg), "fact present");
  ok(/Earlier messages from this person on other channels/.test(sysMsg) && /texted yesterday about gravel bikes/.test(sysMsg), "cross-channel history");
  ok(!sysMsg.includes("[call ") && !sysMsg.includes("conv_1"), "internal marker must not reach the model");
  ok(/Phone call: spoken style/.test(sysMsg) && llm.requests[0].effort === "none", "voice style + effort none");
  ok(llm.requests[0].messages.some((m: any) => m.role === "assistant" && /thanks for calling/.test(m.content)), "live transcript used as history");
  ok(/Verified: NO/.test(sysMsg), "a caller is not verified just because of caller ID");
});
await t("everything is recorded: caller turn, spoken reply, call record, turn log; one contact and one conversation for this person", async () => {
  ok(await waitFor(async () => (await db.collection("messages").countDocuments({ channel: "voice", direction: "out" })) === 1), "assistant row");
  const u: any = await db.collection("messages").findOne({ channelMsgId: "el:conv_1:u1" }); const a: any = await db.collection("messages").findOne({ channelMsgId: "el:conv_1:a1" });
  ok(u.body === "How much is a tune-up?" && String(u.conversationId) === String(kit.conversationId) && a.body.startsWith("A basic tune-up"), "rows");
  const calls = await db.collection("calls").find({}).toArray(); ok(calls.length === 1 && calls[0].provider === "elevenlabs" && calls[0].providerConversationId === "conv_1" && calls[0].peer === CALLER, JSON.stringify(calls.map((c) => c.provider)));
  const turn: any = await db.collection("agent_turns").findOne({ channel: "voice" }); ok(turn && turn.mode === "voice" && turn.outcome === "reply", JSON.stringify(turn));
  ok((await db.collection("contacts").countDocuments({ "handles.address": CALLER })) === 1, "same person");
});
await t("second turn of the same call reuses the call record and the numbering continues (u2/a2)", async () => {
  llm.i = 0; llm.script = [{ content: "Sure, I can help with that." }];
  const b = JSON.stringify({ stream: true, messages: [{ role: "system", content: sys("conv_1") }, { role: "assistant", content: "Hi" }, { role: "user", content: "How much is a tune-up?" }, { role: "assistant", content: "A basic tune-up is $89." }, { role: "user", content: "Yes please book it" }] });
  await sseCall(b);
  ok(await waitFor(async () => !!(await db.collection("messages").findOne({ channelMsgId: "el:conv_1:a2" }))), "a2 stored");
  ok((await db.collection("calls").countDocuments({})) === 1 && !!(await db.collection("messages").findOne({ channelMsgId: "el:conv_1:u2" })), "same call, u2 stored");
});
await t("a retried request (ElevenLabs retries) does not duplicate the caller's turn", async () => {
  llm.i = 0; await sseCall(body("conv_1", "How much is a tune-up?"));
  ok((await db.collection("messages").countDocuments({ channelMsgId: "el:conv_1:u1" })) === 1, "u1 once");
});
await t("Photon already logged the call: the ElevenLabs conversation is attached to THAT call, not a second record", async () => {
  await db.collection("calls").insertOne({ orgId, contactId: kit.contactId, conversationId: kit.conversationId, direction: "in", provider: "photon", providerCallId: "pho_call_1", status: "active", startedAt: new Date(Date.now() - 5000), endedAt: null, durationSec: 0, recordingUrl: null, summary: "", outcome: "", line: LINE, peer: CALLER, createdAt: kit.now.t } as never);
  llm.i = 0; await sseCall(body("conv_2", "Hello?"));
  const photon: any = await db.collection("calls").findOne({ providerCallId: "pho_call_1" });
  ok(photon.providerConversationId === "conv_2", "linked: " + JSON.stringify(photon.providerConversationId));
  ok((await db.collection("calls").countDocuments({ providerConversationId: "conv_2" })) === 1, "no duplicate record");
});
await t("unknown called number or empty speech: a polite spoken apology, and the model is not called", async () => {
  const before = llm.requests.length;
  const r = await sseCall(JSON.stringify({ stream: true, messages: [{ role: "system", content: sys("conv_x", CALLER, "+19995550000") }, { role: "user", content: "hello" }] }));
  ok(/can't take your call/.test(r.content) && r.last === "[DONE]" && llm.requests.length === before, r.content);
});
await t("a conversation locked to a person does NOT block a phone call: nobody can take over a live call through this system, so the agent keeps answering", async () => {
  await db.collection("conversations").updateOne({ _id: kit.conversationId }, { $set: { mode: "human" } }); await db.collection("notifications").insertOne({ orgId: kit.orgId, conversationId: kit.conversationId, kind: "handoff", cause: "customer_request", message: "taken over", urgency: "high", read: false, createdAt: new Date() } as never);
  const before = llm.requests.length; llm.i = 0; llm.script = [{ content: "Sure, I can help with that." }];
  const r = await sseCall(body("conv_3", "Hi")); ok(/can help/.test(r.content) && llm.requests.length > before, r.content);
  await db.collection("conversations").updateOne({ _id: kit.conversationId }, { $set: { mode: "agent" } });
});
await t("ElevenLabs system tools: end_call is passed back as a tool call for ElevenLabs to execute, never run here", async () => {
  llm.i = 0; llm.script = [{ content: "Thanks for calling, goodbye!", tools: [{ name: "end_call", args: { reason: "done" } }] }];
  const r = await sseCall(body("conv_4", "That's all, thanks", { tools: [{ type: "function", function: { name: "end_call", description: "End the call", parameters: { type: "object", properties: { reason: { type: "string" } } } } }] }));
  const tc = r.chunks.find((c) => c.choices[0].delta.tool_calls);
  ok(tc && tc.choices[0].delta.tool_calls[0].function.name === "end_call" && r.chunks[r.chunks.length - 1].choices[0].finish_reason === "tool_calls", r.raw.slice(0, 400));
  ok(/goodbye/.test(r.content), "says goodbye first");
  ok((await db.collection("tool_calls").countDocuments({ tool: "end_call" })) === 0, "not executed locally");
});
await t("ungrounded money is never spoken: the sentence is replaced before it reaches the caller", async () => {
  llm.i = 0; llm.script = [{ content: "Great question. That would be only $12.34 today. Anything else?" }];
  const r = await sseCall(body("conv_5", "what does a tune up cost"));
  ok(!r.raw.includes("12.34") && /double-check/.test(r.content) && /Anything else/.test(r.content), r.content);
});
await t("hanging up (client disconnects mid-sentence) stops the model call and records the turn as interrupted", async () => {
  llm.i = 0; llm.script = [{ content: "This is a long answer. ".repeat(40) }];
  const ac = new AbortController(); const r = await fetch(url("/v1/chat/completions"), { method: "POST", body: body("conv_6", "talk a lot"), signal: ac.signal });
  const reader = r.body!.getReader(); await reader.read(); ac.abort();
  ok(await waitFor(async () => !!(await db.collection("agent_turns").findOne({ note: "interrupted" }))), "turn marked interrupted");
  const row: any = await db.collection("messages").findOne({ channelMsgId: "el:conv_6:a1" }); ok(!row || row.interrupted === true, "partial reply flagged if stored");
});

await t("a card number or SSN SPOKEN on the call is redacted before it is stored or sent to the model, in the new turn and in the call history ElevenLabs sends", async () => {
  llm.i = 0; llm.script = [{ content: "Please don't say that out loud." }]; const before = llm.requests.length;
  const b = JSON.stringify({ stream: true, messages: [{ role: "system", content: sys("conv_7") }, { role: "user", content: "my social is 123-45-6789" }, { role: "assistant", content: "Please don't share that." }, { role: "user", content: "ok my card is 4242 4242 4242 4242" }] });
  await sseCall(b);
  const sent = JSON.stringify(llm.requests.slice(before)); ok(!/4242|6789/.test(sent), "the model never saw the numbers");
  ok(await waitFor(async () => !!(await db.collection("messages").findOne({ channelMsgId: "el:conv_7:u2" }))), "stored");
  const rows = await db.collection("messages").find({ channelMsgId: /^el:conv_7:/ }).toArray(); ok(rows.length >= 2 && !JSON.stringify(rows).match(/4242|6789/), JSON.stringify(rows.map((r) => r.body)));
});

// ---------------- post-call webhook ----------------
const post = async (evt: unknown, header?: string) => {
  const raw = JSON.stringify(evt);
  return fetch(url("/webhooks/elevenlabs"), { method: "POST", headers: { "content-type": "application/json", ...(header !== undefined ? { "elevenlabs-signature": header } : {}) }, body: raw });
};
const transcript = (conv: string) => ({ type: "post_call_transcription", event_timestamp: Math.floor(Date.now() / 1000), data: { agent_id: "ag1", conversation_id: conv, status: "done",
  transcript: [{ role: "agent", message: "Hi, thanks for calling Sunrise Bike Shop.", time_in_call_secs: 0 }, { role: "user", message: "How much is a tune-up?", time_in_call_secs: 3 }, { role: "agent", message: "A basic tune-up is $89.", time_in_call_secs: 5 }, { role: "user", message: "Great, thanks.", time_in_call_secs: 12 }, { role: "agent", message: "You're welcome!", time_in_call_secs: 14 }],
  metadata: { call_duration_secs: 42, cost: 31, termination_reason: "end_call tool" }, analysis: { call_successful: "success", transcript_summary: "Asked about tune-up price; $89; wants to book." }, conversation_initiation_client_data: { dynamic_variables: {} } } });
await t("webhook auth: unsigned, forged, stale and tampered requests get 401 and change nothing", async () => {
  const evt = transcript("conv_1"); const raw = JSON.stringify(evt); const before = await db.collection("messages").countDocuments({});
  ok((await post(evt)).status === 401, "unsigned");
  ok((await post(evt, signElevenLabs(raw, "wrong-secret"))).status === 401, "forged");
  ok((await post(evt, signElevenLabs(raw, SECRET, Date.now() - 40 * 60_000))).status === 401, "stale");
  ok((await post({ ...evt, extra: 1 }, signElevenLabs(raw, SECRET))).status === 401, "tampered");
  ok((await db.collection("messages").countDocuments({})) === before, "nothing stored");
});
await t("webhook: a valid transcript is imported once, the spoken text wins over what we streamed, the call is completed with duration and summary", async () => {
  const evt = transcript("conv_1"); const raw = JSON.stringify(evt);
  const r = await post(evt, signElevenLabs(raw, SECRET)); ok(r.status === 200, "status " + r.status);
  const rows = await db.collection("messages").find({ channel: "voice", channelMsgId: /^el:conv_1:/ }).sort({ ts: 1 }).toArray();
  ok(rows.map((x) => x.channelMsgId).join() === "el:conv_1:a0,el:conv_1:u1,el:conv_1:a1,el:conv_1:u2,el:conv_1:a2", rows.map((x) => x.channelMsgId).join());
  ok(rows.find((x) => x.channelMsgId === "el:conv_1:a1")!.body === "A basic tune-up is $89.", "authoritative agent text replaced our streamed version");
  const call: any = await db.collection("calls").findOne({ providerConversationId: "conv_1" });
  ok(call.status === "completed" && call.durationSec === 42 && /tune-up price/.test(call.summary) && call.outcome === "success", JSON.stringify({ s: call.status, d: call.durationSec }));
  const c: any = await db.collection("contacts").findOne({ _id: kit.contactId }); ok(/tune-up price/.test(c.memory.lastCall.summary), "summary kept on the contact");
  const again = await post(evt, signElevenLabs(raw, SECRET)); ok(again.status === 200 && (await db.collection("messages").countDocuments({ channel: "voice", channelMsgId: /^el:conv_1:/ })) === 5, "replay adds nothing");
  ok((await db.collection("usage").findOne({ voiceSec: { $gt: 0 } })) !== null, "voice seconds metered");
});
await t("webhook: a transcript for a call we never served, or a failure event, is acknowledged and parked, not lost and not attached to the wrong person", async () => {
  const e1 = transcript("conv_unknown"); const r1 = await post(e1, signElevenLabs(JSON.stringify(e1), SECRET)); ok(r1.status === 200, "ack");
  ok((await db.collection("unrouted_events").countDocuments({ reason: /never served/ })) === 1, "parked");
  const e2 = { type: "call_initiation_failure", data: { conversation_id: "conv_2", failure_reason: "no-answer" } };
  ok((await post(e2, signElevenLabs(JSON.stringify(e2), SECRET))).status === 200, "ack failure");
  ok(((await db.collection("calls").findOne({ providerConversationId: "conv_2" })) as any).status === "failed", "call marked failed");
  const e3 = { type: "post_call_audio", data: { conversation_id: "conv_1", full_audio: "AAAA" } };
  ok((await post(e3, signElevenLabs(JSON.stringify(e3), SECRET))).status === 200, "audio ignored, acknowledged");
  ok(!JSON.stringify(await db.collection("messages").find({}).toArray()).includes("AAAA"), "audio never stored");
});

await srv.close();
await finish(kit);

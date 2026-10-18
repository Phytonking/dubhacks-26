import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ObjectId, type Db } from "mongodb";
import { randomUUID } from "node:crypto";
import { streamTurn, SAFE_FALLBACK, type EngineDeps } from "../engine/turn";
import type { ChatMessage, LlmPort } from "../engine/types";
import { applyExtraction, extractIntake } from "../intake-extract";
import { normalizeAddress, resolveParty } from "../identity";
import { redactSensitive } from "../sensitive";
import { extractCallInfo, verifyElevenLabsSignature } from "./elevenlabs";

// Voice server: ElevenLabs does the listening and speaking; for every caller turn it calls this endpoint (an OpenAI-style chat completions
// URL, "Custom LLM") and we answer with the same engine, tools and memory the text channels use, streamed sentence by sentence.
// The hot path does one Mongo read set, the model stream, and fire-and-forget-style writes only AFTER the words are out.
export type VoiceCfg = {
  db: Db; engine: EngineDeps; port: number; pathSecret: string; bearer?: string; webhookSecret: string;
  log?: (m: string) => void; now?: () => Date; host?: string;
};
const HANDOFF_LINE = "Let me connect you with someone from the team.";
const SORRY_LINE = "I'm sorry, I can't take your call right now. Please try again in a moment.";

const readRaw = (req: IncomingMessage, max = 2_000_000) => new Promise<string>((resolve, reject) => {
  const chunks: Buffer[] = []; let n = 0;
  req.on("data", (c: Buffer) => { n += c.length; if (n > max) { reject(new Error("body too large")); req.destroy(); } else chunks.push(c); });
  req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8"))); req.on("error", reject);
});
const textOf = (c: unknown): string => typeof c === "string" ? c : Array.isArray(c) ? c.map((p: any) => (typeof p === "string" ? p : p?.text ?? "")).join("") : "";

export function startVoiceServer(cfg: VoiceCfg): Promise<{ server: Server; port: number; close: () => Promise<void> }> {
  const { db, engine } = cfg; const log = cfg.log ?? (() => {}); const now = () => cfg.now?.() ?? new Date();
  const prefix = `/voice/${cfg.pathSecret}`;

  const sse = (res: ServerResponse) => {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no" });
    const id = "chatcmpl-" + randomUUID().slice(0, 12); const created = Math.floor(Date.now() / 1000); let first = true;
    const chunk = (delta: Record<string, unknown>, finish: string | null = null) => {
      if (res.writableEnded || res.destroyed) return;
      res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: engine.llm.model, choices: [{ index: 0, delta: first ? { role: "assistant", ...delta } : delta, finish_reason: finish }] })}\n\n`); first = false;
    };
    return {
      say: (text: string) => chunk({ content: text + " " }),
      tools: (calls: { id: string; name: string; arguments: string }[]) => chunk({ tool_calls: calls.map((c, i) => ({ index: i, id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) }),
      end: (finish: string) => { chunk({}, finish); if (!res.writableEnded) { res.write("data: [DONE]\n\n"); res.end(); } },
    };
  };

  async function chatCompletions(req: IncomingMessage, res: ServerResponse) {
    const body = JSON.parse(await readRaw(req));
    const out = sse(res);
    const { caller, called, conv, cleaned } = extractCallInfo(body.messages ?? []);
    const userMsgs = cleaned.filter((m) => m.role === "user");
    const utterance = redactSensitive(textOf(userMsgs[userMsgs.length - 1]?.content).trim()).text;   // a spoken card number / SSN is never stored or sent to the model
    const line = called ? normalizeAddress(called) : undefined;
    const lineRow: any = line ? await db.collection("channel_lines").findOne({ address: line, status: "active" }) : null;
    if (!lineRow || !utterance) { log(`voice: cannot route (called=${called ?? "?"}, utterance=${utterance ? "yes" : "no"})`); out.say(SORRY_LINE); return out.end("stop"); }
    const orgId: ObjectId = lineRow.orgId;
    const convId = conv ?? `anon-${randomUUID().slice(0, 8)}`;
    const peer = caller && /^\+?\d[\d\s().-]{6,}$/.test(caller) ? normalizeAddress(caller) : `anon:${convId}`;
    const party = await resolveParty(db, { orgId, channel: "voice", address: peer });
    if ((party.conversation as any).mode === "human") { out.say(HANDOFF_LINE); return out.end("stop"); }

    const idx = userMsgs.length;                                   // 1-based number of this caller turn within the call
    const turnId = `el:${convId}`;
    const call = await linkCall(db, { orgId, line: line!, peer, convId, contactId: party.contact._id, conversationId: party.conversation._id, now: now() });
    const userKey = `el:${convId}:u${idx}`;
    const ts = now();
    let userRowId: ObjectId;
    try { userRowId = (await db.collection("messages").insertOne({ orgId, conversationId: party.conversation._id, channel: "voice", direction: "in", sender: "customer", body: utterance,
      channelMsgId: userKey, deliveryStatus: "received", handling: "agent", handledByTurn: turnId, callId: call, attempts: 0, ts } as never)).insertedId; }
    catch (e) { if ((e as { code?: number }).code !== 11000) throw e; userRowId = ((await db.collection("messages").findOne({ channelMsgId: userKey, channel: "voice" })) as any)._id; }

    // live transcript from ElevenLabs replaces recent DB history (it is exact and includes this call's greeting)
    const live: ChatMessage[] = cleaned.filter((m) => m.role === "user" || m.role === "assistant").slice(0, -1).map((m) => ({ role: m.role as "user" | "assistant", content: redactSensitive(textOf(m.content)).text })).filter((m) => (m as any).content);
    const passthrough = (body.tools ?? []).filter((t: any) => t?.type === "function" && t.function?.name).map((t: any) => ({ name: t.function.name, description: t.function.description ?? "", parameters: t.function.parameters ?? { type: "object", properties: {} } }));
    const ac = new AbortController(); let finished = false;
    res.on("close", () => { if (!finished) ac.abort(); });         // the caller talked over us or hung up: stop the model call now

    const started = ts;
    let result: any; let spoken = "";
    for await (const ev of streamTurn(engine, { orgId, conversationId: party.conversation._id, channel: "voice", mode: "voice", batch: [{ _id: userRowId, body: utterance, ts }], historyOverride: live, passthrough, callId: call, signal: ac.signal })) {
      if (ev.type === "sentence") out.say(ev.text);
      else if (ev.type === "passthrough") out.tools(ev.calls);
      else { result = ev.result; spoken = ev.spoken; }
    }
    finished = true;
    out.end(result?.passthrough?.length ? "tool_calls" : "stop");

    // after the words are out: persist what was said and the turn record
    try {
      const interrupted = result?.note === "interrupted";
      if (spoken) await db.collection("messages").insertOne({ orgId, conversationId: party.conversation._id, channel: "voice", direction: "out", sender: "agent", body: spoken, channelMsgId: `el:${convId}:a${idx}`,
        deliveryStatus: "delivered", handling: "agent", handledByTurn: turnId, callId: call, attempts: 0, interrupted, ts: now() } as never).catch((e) => { if (e.code !== 11000) throw e; });
      if (result) {
        await db.collection("agent_turns").insertOne({ orgId, conversationId: party.conversation._id, contactId: party.contact._id, turnId: result.turnId, channel: "voice", mode: "voice", batchMessageIds: [userRowId], rounds: result.rounds,
          outcome: result.outcome === "failed" ? "failed" : result.outcome, model: result.model, effort: result.effort, tokensIn: result.usage.prompt_tokens, tokensOut: result.usage.completion_tokens, ms: result.ms,
          attempts: 1, note: result.note ?? null, toolCalls: result.toolCalls.map((t: any) => ({ name: t.name, ok: t.ok, ms: t.ms })), startedAt: started } as never);
        await db.collection("usage").updateOne({ orgId, day: now().toISOString().slice(0, 10) }, { $inc: { tokensIn: result.usage.prompt_tokens, tokensOut: result.usage.completion_tokens, messagesIn: 1, messagesOut: spoken ? 1 : 0, sandboxSec: 0 } }, { upsert: true });
      }
      await db.collection("conversations").updateOne({ _id: party.conversation._id }, { $set: { lastMessageAt: now(), lastMessagePreview: (spoken || utterance).slice(0, 80), lastChannel: "voice" } });
    } catch (e) { log(`voice persist failed: ${(e as Error).message}`); }
  }

  async function webhook(req: IncomingMessage, res: ServerResponse) {
    const raw = await readRaw(req);
    const sig = verifyElevenLabsSignature(raw, req.headers["elevenlabs-signature"] as string | undefined, cfg.webhookSecret, now().getTime());
    if (!sig.ok) { log(`voice webhook rejected: ${sig.reason}`); res.writeHead(401, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: "invalid signature" })); }
    const evt = JSON.parse(raw);
    const r = await importCallEvent(db, evt, now(), log, engine.llm);
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, ...r }));
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      if (req.method === "GET" && url.pathname === "/health") { res.writeHead(200); return res.end("ok"); }
      if (!url.pathname.startsWith(prefix + "/")) { res.writeHead(404); return res.end(); }                       // wrong or missing secret path: reveal nothing
      if (cfg.bearer && req.headers.authorization !== `Bearer ${cfg.bearer}` && url.pathname.endsWith("/chat/completions")) { res.writeHead(401); return res.end(); }
      const route = url.pathname.slice(prefix.length);
      if (req.method === "POST" && (route === "/v1/chat/completions" || route === "/chat/completions")) return await chatCompletions(req, res);
      if (req.method === "POST" && route === "/webhooks/elevenlabs") return await webhook(req, res);
      res.writeHead(404); res.end();
    } catch (e) {
      log(`voice server error: ${(e as Error).message}`);
      if (!res.headersSent) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "internal" })); }
      else if (!res.writableEnded) { try { res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: SAFE_FALLBACK + " " }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`); } catch { /* socket gone */ } res.end(); }
    }
  });
  return new Promise((resolve) => server.listen(cfg.port, cfg.host ?? "127.0.0.1", () => {
    const addr = server.address(); const port = typeof addr === "object" && addr ? addr.port : cfg.port;
    resolve({ server, port, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) });
  }));
}

/** Tie the ElevenLabs conversation to the call Photon already logged (same line, same caller, still ringing/active); otherwise create one. */
export async function linkCall(db: Db, a: { orgId: ObjectId; line: string; peer: string; convId: string; contactId: ObjectId; conversationId: ObjectId; now: Date }): Promise<ObjectId> {
  const calls = db.collection("calls");
  const existing: any = await calls.findOne({ $or: [{ providerConversationId: a.convId }, { provider: "elevenlabs", providerCallId: a.convId }] });
  if (existing) return existing._id;
  const photon: any = await calls.findOneAndUpdate(
    { provider: "photon", orgId: a.orgId, line: a.line, peer: a.peer, status: { $in: ["ringing", "active"] }, startedAt: { $gte: new Date(a.now.getTime() - 30 * 60_000) }, providerConversationId: { $exists: false } },
    { $set: { providerConversationId: a.convId } }, { sort: { startedAt: -1 }, returnDocument: "after" });
  if (photon) return photon._id;
  try {
    return (await calls.insertOne({ orgId: a.orgId, contactId: a.contactId, conversationId: a.conversationId, direction: "in", provider: "elevenlabs", providerCallId: a.convId, providerConversationId: a.convId,
      status: "active", startedAt: a.now, endedAt: null, durationSec: 0, recordingUrl: null, summary: "", outcome: "", line: a.line, peer: a.peer, createdAt: a.now } as never)).insertedId;
  } catch (e) { if ((e as { code?: number }).code !== 11000) throw e; return ((await calls.findOne({ provider: "elevenlabs", providerCallId: a.convId })) as any)._id; }
}

/** post_call_transcription: store what was actually said (idempotent, authoritative), summary, duration. call_initiation_failure: mark failed. */
export async function importCallEvent(db: Db, evt: any, now: Date, log: (m: string) => void = () => {}, llm?: LlmPort): Promise<{ handled: string; imported?: number }> {
  const d = evt?.data ?? {}; const conv: string | undefined = d.conversation_id;
  if (!conv) return { handled: "ignored" };
  const call: any = await db.collection("calls").findOne({ $or: [{ providerConversationId: conv }, { provider: "elevenlabs", providerCallId: conv }] });
  if (evt.type === "call_initiation_failure") {
    if (call) await db.collection("calls").updateOne({ _id: call._id }, { $set: { status: "failed", outcome: String(d.failure_reason ?? "failed"), updatedAt: now } });
    else await db.collection("unrouted_events").insertOne({ evt, reason: "call_initiation_failure without a matching call", at: now } as never);
    return { handled: "failure" };
  }
  if (evt.type !== "post_call_transcription") return { handled: "ignored" };
  if (!call) { await db.collection("unrouted_events").insertOne({ evt: { type: evt.type, conversation_id: conv }, reason: "transcript for a conversation we never served", at: now } as never); return { handled: "unmatched" }; }

  let imported = 0, userN = 0, agentN = 0;
  const lastAgentIdx = new Map<number, number>();
  for (const turn of d.transcript ?? []) {
    const body = typeof turn.message === "string" ? redactSensitive(turn.message.trim()).text : "";
    if (turn.role === "user") userN++;
    if (!body || (turn.role !== "user" && turn.role !== "agent")) continue;
    let key: string;
    if (turn.role === "user") key = `el:${conv}:u${userN}`;
    else { const n = (lastAgentIdx.get(userN) ?? 0); lastAgentIdx.set(userN, n + 1); key = n === 0 ? `el:${conv}:a${userN}` : `el:${conv}:a${userN}.${n}`; agentN++; }
    const row = { orgId: call.orgId, conversationId: call.conversationId, channel: "voice", direction: turn.role === "user" ? "in" : "out", sender: turn.role === "user" ? "customer" : "agent",
      channelMsgId: key, deliveryStatus: turn.role === "user" ? "received" : "delivered", handling: "agent", handledByTurn: `el:${conv}`, callId: call._id, attempts: 0,
      ts: new Date((call.startedAt as Date).getTime() + Math.round((turn.time_in_call_secs ?? 0) * 1000)) };
    // the caller's words never change after the fact; for the agent, what was actually SPOKEN (the transcript) wins over what we streamed
    const update = turn.role === "agent" ? { $setOnInsert: row, $set: { body } } : { $setOnInsert: { ...row, body } };
    const r = await db.collection("messages").updateOne({ channel: "voice", channelMsgId: key }, update as never, { upsert: true });
    if (r.upsertedCount) imported++;
  }
  const dur = Number(d.metadata?.call_duration_secs ?? 0);
  await db.collection("calls").updateOne({ _id: call._id }, { $set: {
    status: "completed", durationSec: dur || call.durationSec || 0, endedAt: call.endedAt ?? new Date((call.startedAt as Date).getTime() + dur * 1000),
    summary: d.analysis?.transcript_summary ?? call.summary ?? "", outcome: String(d.analysis?.call_successful ?? call.outcome ?? "completed"),
    terminationReason: d.metadata?.termination_reason ?? null, costCents: d.metadata?.cost ?? null, transcriptImportedAt: now, updatedAt: now } });
  if (d.analysis?.transcript_summary) await db.collection("contacts").updateOne({ _id: call.contactId }, { $set: { "memory.lastCall": { at: now, callId: call._id, summary: String(d.analysis.transcript_summary).slice(0, 600) } } });
  if (dur) await db.collection("usage").updateOne({ orgId: call.orgId, day: now.toISOString().slice(0, 10) }, { $inc: { voiceSec: dur, tokensIn: 0, tokensOut: 0, messagesIn: 0, messagesOut: 0, sandboxSec: 0 } }, { upsert: true });
  if (llm) {   // read the whole call once and record what the caller said about themselves (fills gaps only); a failure here must not lose the transcript
    try { const added = await applyExtraction(db, { orgId: call.orgId, callId: call._id, contactId: call.contactId, ex: await extractIntake(llm, d.transcript ?? []), now }); if (added.length) log(`voice: recorded ${added.join(", ")} for the caller from call ${conv}`); }
    catch (e) { log(`voice: post-call extraction failed (${(e as Error).message.slice(0, 100)}); transcript is saved`); }
  }
  log(`voice: imported ${imported} new turn(s) for ${conv}`);
  void agentN;
  return { handled: "transcript", imported };
}

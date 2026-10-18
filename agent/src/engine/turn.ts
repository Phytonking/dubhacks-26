import { randomUUID } from "node:crypto";
import { type Db } from "mongodb";
import { isVerified } from "../customer";
import type { Messenger } from "../messenger";
import { buildContext, type BuiltContext, type TurnInput } from "./context";
import { checkText, takeSentences, type GuardCfg } from "./guardrails";
import { stripThinking } from "./llm";
import { asksForSecrets, looksSensitive, TEXT_REDIRECT } from "../sensitive";
import { reachHint } from "./tools/reach";
import { recordHandoff } from "../handoff";
import { toolByName } from "./tools/index";
import type { ChatMessage, EngineEnv, LlmPort, Tool, ToolCallReq, ToolCtx, ToolResult, ToolSpec, Usage } from "./types";
import { validateArgs } from "./validate";

export const MAX_ROUNDS = 6;   // the last round has no tools: the model must answer with what it has
const VOICE_MAX_WORDS = 60;
const WRAP_UP = "You have used your tool budget for this turn. Answer the customer now in your own words using only the tool results above. Do not call any more tools.";
export type EngineDeps = { db: Db; llm: LlmPort; tools: Tool[]; messenger: Messenger; env: EngineEnv; log?: (m: string) => void };
export type TraceCall = { name: string; ok: boolean; ms: number; error?: string };
export type TurnResult = {
  turnId: string; outcome: "reply" | "escalated" | "blocked" | "failed"; text: string; rounds: number; toolCalls: TraceCall[]; usage: Usage;
  sideEffects: boolean; escalated: boolean; passthrough: { id: string; name: string; arguments: string }[]; note?: string; ms: number; model: string; effort: string;
};

export const SAFE_FALLBACK = "Sorry, I hit a snag on my end. I've let the team know, and you're welcome to ask me again.";
const SAFE_LINE = "Let me double-check that and have someone confirm.";

const spec = (t: Tool): ToolSpec => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } });
const effortFor = (mode: string) => (mode === "voice" ? ("none" as const) : ("low" as const));
// At effort "low" the model can spend several hundred tokens reasoning before it writes; leave room so answers are not cut off.
const maxTokensFor = (mode: string) => (mode === "voice" ? 160 : 900);
const TOOL_MARKUP = /<\/?tool_call>|<function=|<\/function>|^#{1,3}\s+\S.*\n|\((?:about )?\d+ \w+ ago\)/m;   // also: the model echoing a transcript ("## Conversation Timeline", "User (about 2 months ago)") instead of answering
/** Remove tool syntax the model printed as text, keeping any real words around it. */
export const stripToolMarkup = (s: string) => s.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").replace(/<function=[^>]*>[\s\S]*?<\/function>/g, "").replace(/<\/?(tool_call|function[^>]*)>/g, "").replace(/\s{2,}/g, " ").trim();
/** Keep only the sentences that pass the checks (an unsupported amount in one sentence should not cost the customer the rest of a good answer). */
export function keepPassingSentences(text: string, cfg: GuardCfg, evidence: string[]): string {
  const [sents] = takeSentences(text, true);
  return sents.filter((x) => checkText(x, cfg, evidence).verdict === "ok").join(" ").trim();
}
export function trimToSentence(text: string): string {
  const m = text.match(/^[\s\S]*[.!?](?=\s|$)/);
  return m ? m[0].trim() : "";
}

const PERSON = /\b(i'?ll|i will|we'?ll|we will|let me) (get|bring|connect|have|find|send) (someone|a person|a human|a team member|a specialist|somebody)\b|\b(connect|put|bring|get|transfer|hand|pass)\b[^.?!]{0,30}\b(you|this|that)\b[^.?!]{0,25}\b(person|someone|human|team|specialist|representative|agent)\b|\ba (person|human|team member|specialist|representative|someone) (will|is going to|from the team will)\b|\bfollow up with you\b/i;
const OFFER = /\b(would you like|want me to|do you want|shall i|should i|if you'?d like|if you would like|i can (also )?(connect|bring|get|have)|happy to (connect|bring|get)|prefer|which would)\b/i;
/** The reply PROMISES a person (not just offers one): then a person must actually be told. */
export const promisesPerson = (text: string) => takeSentences(text, true)[0].some((s) => PERSON.test(s) && !OFFER.test(s) && !/\?\s*$/.test(s));

/** The team was already told this turn (handoff, an accepted deal, an owner notice): a promise that a person will follow up needs nothing more. */
const teamTold = (trace: { name: string; ok: boolean }[]) => trace.some((t) => t.ok && ["handoff_escalate", "negotiation_accept", "owner_notify"].includes(t.name));

const HARDSHIP = /\b(lost (my|his|her) job|laid off|got fired|can'?t afford|cannot afford|money is (really )?tight|tight on money|on a (really )?(tight )?budget|struggling|broke\b|hardship|behind on (bills|rent)|out of work|unemployed)/i;
const EMPATHY = /\b(sorry|i understand|i hear you|that'?s (a )?(tough|rough|hard|difficult)|tough spot|that must be|appreciate you (telling|sharing))\b/i;
const LEADS = ["I'm sorry, that's a tough spot.", "I'm sorry you're dealing with that.", "That sounds really hard, and I'm glad you told me."];
/** Someone who says money is tight hears something human first, whatever the model wrote. */
export function empathyLead(customerText: string, reply: string, seed: string): string | null {
  if (!HARDSHIP.test(customerText) || EMPATHY.test(reply)) return null;
  return LEADS[[...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % LEADS.length];
}

const LEGAL = /\b(my|a|the) (lawyer|attorney)\b|\bsue (you|t-?mobile|them)\b|\blawsuit\b|\blegal action\b|\btake (you|this|t-?mobile) to court\b|\bfile a (suit|lawsuit)\b|\b(fcc|attorney general) complaint\b/i;
const FRAUD = /\b(fraud(ulent)?|scam(med)?|identity theft|sim ?swap|hacked|stolen (phone|device|sim)|phone (was|got|is) stolen|someone (is )?(using|got into|has (got )?access to) my (account|phone|number|line))\b/i;
const FRAUD_REPLY = "I'm so sorry, that sounds stressful. I'm bringing in a person on our team right now to help secure your account, and they'll follow up with you directly.";
const LEGAL_REPLY = "I understand, and I'm taking this seriously. I'm bringing in a person on our team right now who can help, and they'll follow up with you directly.";
const CLAIMS_CODE = /\b(i('m| am|'ve| have|'ll| will)?|we('re| are|'ve| have)?) (just )?(texting|sending|sent)\b[^.?!]{0,40}\bcode\b|\bcode (is|was) (on its way|sent)|\bsent (you )?(a|the) (6|six)[- ]digit code/i;
const ASKS_CODE = /\b(want|would you like|shall|should|ok(ay)? if|may|can) (me |i )?(to )?(text|send)\b[^.?!]{0,40}\bcode\b|\bcode\b[^.?!]{0,40}\b(ok(ay)?|alright|sound good)\s?\?/i;
/** Repeating a sentence word for word is a model glitch, never intent. */
export function dedupeSentences(text: string): string {
  const [sents] = takeSentences(text, true); const seen = new Set<string>();
  const out = sents.filter((s) => { const k = s.toLowerCase().replace(/\s+/g, " "); if (seen.has(k)) return false; seen.add(k); return true; });
  return out.length === sents.length ? text : out.join(" ").trim();
}
/** A reply that says "I'm texting you a code" without having sent one is a lie to the customer: send it for real (or say plainly that it could not be sent). */
async function backUpCodeClaim(deps: EngineDeps, ctx: ToolCtx, text: string, trace: TraceCall[], suppressedAsk = false): Promise<{ failure: string | null; asked: boolean } | null> {
  const asked = suppressedAsk || takeSentences(text, true)[0].some((x) => ASKS_CODE.test(x)); const claimed = CLAIMS_CODE.test(text);
  if (!claimed && !asked) return null;
  if (trace.some((t) => t.name === "verify_send_code" && t.ok)) return null;
  if (!ctx.party.externalRefs.some((r) => r.system === "tmobile" && r.kind === "account") || ctx.customer.verified) return null;
  const r = await executeTool(deps, ctx, { id: `auto_${ctx.turnId.slice(0, 8)}`, type: "function", function: { name: "verify_send_code", arguments: "{}" } });
  trace.push(r.trace);
  return { failure: r.result.ok ? null : (r.result.reply ?? null), asked };
}
const CODE_SENT = "I've just sent a 6-digit code to the number on file. What's the code?";

/** At most ONE question per reply: statements are kept, questions after the first are dropped (a questionnaire is both annoying and, on a call, hard to answer). */
export function limitQuestions(text: string): string {
  text = text.replace(/\?(?=[^()]*\))/g, "");   // a question mark inside parentheses is not a second question
  const [sents] = takeSentences(text, true); let asked = false;
  const out = sents.filter((s) => { if (!/\?["')]*$/.test(s)) return true; if (asked) return false; asked = true; return true; });
  return out.length === sents.length ? text : out.join(" ").trim();
}

/** The model sometimes narrates its own reasoning in the reply ("The customer is on a voice call and wants it texted. They're a new number, so I need consent."). Customers never see that. */
const META = /\b(the|this) (customer|caller|user|person)( is| was| wants| asked| said| has| needs| will| hasn'?t| doesn'?t| did| seems| sounds)\b|\b(they'?re|they are) (a )?(new|unknown|existing|returning)\b[^.?!]{0,30}\b(number|customer|caller|prospect)\b|\bunknown number\b|\bi (need|should|must|have) to (check|verify|confirm|ask)[^.?!]{0,40}\b(consent|tool|system)\b|\blet me (think|reason|figure out)\b/i;
export function dropMeta(text: string): string {
  const [sents] = takeSentences(text, true); const keep = sents.filter((x) => !META.test(x));
  return keep.length === sents.length ? text : keep.join(" ").trim();
}

/** Plain text only: no markdown emphasis, no bullets, no stray whitespace. */
export function cleanReply(text: string): string {
  return dropMeta(stripThinking(text)).replace(/^[ \t]*#{1,6}[ \t]+.*$/gm, "").replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1").replace(/\*\*|__|`/g, "").replace(/^\s*[-*•]\s+/gm, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function makeCtx(deps: EngineDeps, input: TurnInput, b: BuiltContext, turnId: string): ToolCtx {
  return {
    db: deps.db, orgId: input.orgId, contactId: b.party.contact._id, conversationId: input.conversationId, channel: input.channel, mode: input.mode,
    party: b.party, customer: b.customer, turnId, sourceMessageId: input.batch[input.batch.length - 1]?._id ?? null,
    now: deps.env.now?.() ?? new Date(), messenger: deps.messenger, env: deps.env, guard: { cfg: b.guard, evidence: b.evidence }, calls: new Map(), callId: input.callId ?? null,
  };
}

/** Run one tool call the model asked for. Everything the model can get wrong is turned into an error result, never a crash. */
export async function executeTool(deps: EngineDeps, ctx: ToolCtx, call: ToolCallReq): Promise<{ content: string; result: ToolResult; trace: TraceCall }> {
  const t0 = Date.now();
  const tool = toolByName(deps.tools, call.function.name);
  let result: ToolResult; let args: any = {};
  const dupKey = `${call.function.name}:${call.function.arguments}`;
  if (ctx.calls?.has(dupKey)) {   // same tool, same arguments, same turn: do not run it again, tell the model to answer
    const r: ToolResult = { ok: true, data: { note: "You already called this with the same arguments in this turn. Use the earlier result and answer the customer now." } };
    return { content: JSON.stringify(r.data), result: r, trace: { name: call.function.name, ok: true, ms: 0, error: "repeated_call" } };
  }
  ctx.calls?.set(dupKey, "1");
  if (!tool) result = { ok: false, error: "unknown_tool" };
  else {
    try { args = call.function.arguments ? JSON.parse(call.function.arguments) : {}; } catch { args = null; }
    const bad = args === null ? "arguments are not valid JSON" : validateArgs(tool.parameters, args);
    if (bad) result = { ok: false, error: "invalid_arguments", data: { detail: bad } };
    else if (tool.requiresVerified && !isVerified(await deps.db.collection("contacts").findOne({ _id: ctx.contactId, orgId: ctx.orgId }), ctx.now)) {
      result = { ok: false, error: "not_verified", data: { hint: "The customer is not verified. Offer a one-time code (verify_send_code); until then share only general information." } };
    } else {
      try {
        result = await Promise.race([
          tool.run(ctx, args),
          new Promise<ToolResult>((_, rej) => setTimeout(() => rej(new Error("tool timed out")), tool.timeoutMs ?? 5000)),
        ]);
      } catch (e) { result = { ok: false, error: "tool_failed", data: { detail: (e as Error).message.slice(0, 120) } }; }
    }
  }
  const ms = Date.now() - t0;
  const modelView = result.ok ? (result.data ?? { ok: true }) : { error: result.error, ...(typeof result.data === "object" && result.data ? (result.data as object) : {}) };
  const content = JSON.stringify(modelView).slice(0, 3500);
  if (result.ok && result.data !== undefined) ctx.guard.evidence.push(content);   // what tools returned this turn is what replies may quote
  try {
    await deps.db.collection("tool_calls").insertOne({
      orgId: ctx.orgId, conversationId: ctx.conversationId, contactId: ctx.contactId, tool: call.function.name, args: tool?.redactArgs || looksSensitive(JSON.stringify(args ?? {})) ? {} : (args && typeof args === "object" ? args : {}),
      result: result.audit ?? (result.ok ? result.data ?? null : { error: result.error }), status: result.ok ? "ok" : (result.error === "blocked_by_guardrail" || result.error === "not_verified") ? "blocked" : "error",
      ms, approvedBy: null, ts: new Date(), turnId: ctx.turnId,
    } as never);
  } catch (e) { deps.log?.(`tool_calls write failed: ${(e as Error).message}`); }
  return { content, result, trace: { name: call.function.name, ok: result.ok, ms, ...(result.error ? { error: result.error } : {}) } };
}

/** A fault in OUR system (or a heuristic) tells the team and nothing else: the customer is never locked out of the agent for it. */
async function notifyTeam(ctx: ToolCtx, why: string) {
  try { await recordHandoff(ctx.db, { orgId: ctx.orgId, contactId: ctx.contactId, conversationId: ctx.conversationId, cause: "system", reason: why, now: ctx.now }); } catch { /* best effort */ }
}
async function escalateFallback(deps: EngineDeps, ctx: ToolCtx, why: string) {
  try { await recordHandoff(ctx.db, { orgId: ctx.orgId, contactId: ctx.contactId, conversationId: ctx.conversationId, cause: "system", reason: why, now: ctx.now, log: deps.log }); }
  catch (e) { deps.log?.(`fallback note failed: ${(e as Error).message}`); }
}

const add = (u: Usage, v?: Usage) => { if (v) { u.prompt_tokens += v.prompt_tokens; u.completion_tokens += v.completion_tokens; } };

/** One non-streaming turn (text channels). */
export async function runTurn(deps: EngineDeps, input: TurnInput): Promise<TurnResult> {
  const t0 = Date.now(); const turnId = randomUUID();
  const b = await buildContext(deps.db, deps.env, input);
  const ctx = makeCtx(deps, input, b, turnId);
  const messages: ChatMessage[] = [...b.messages];
  const specs = [...deps.tools.map(spec), ...(input.passthrough ?? []).map((p) => ({ type: "function" as const, function: p }))];
  const passNames = new Set((input.passthrough ?? []).map((p) => p.name));
  const usage: Usage = { prompt_tokens: 0, completion_tokens: 0 };
  const trace: TraceCall[] = []; let sideEffects = false, escalated = false; const effort = effortFor(input.mode);
  /** The assistant must never ask for a password, PIN, SSN or card number in the conversation. Replace such a reply with the move-to-text message. */
  const noSecretRequests = async (text: string) => {
    if (!takeSentences(text, true)[0].some(asksForSecrets)) return limitQuestions(dedupeSentences(text));
    sideEffects = true;
    if (input.mode === "voice") return (await reachHint(ctx, "private_details")).reply;
    return TEXT_REDIRECT;
  };
  const userSaid = input.batch.map((m) => m.body).join(" ");
  const done = (r: Partial<TurnResult> & Pick<TurnResult, "outcome" | "text" | "rounds">): TurnResult => {
    if (r.text) r = { ...r, text: stripToolMarkup(r.text) };
    const lead = r.outcome === "reply" && r.text ? empathyLead(userSaid, r.text, turnId) : null;
    return { turnId, toolCalls: trace, usage, sideEffects, escalated, passthrough: [], ms: Date.now() - t0, model: deps.llm.model, effort, ...r, ...(lead ? { text: `${lead} ${r.text}` } : {}) };
  };

  if (LEGAL.test(userSaid) || FRAUD.test(userSaid)) {   // legal threats and fraud reports go to a person at once; the model is not asked
    const legal = LEGAL.test(userSaid);
    await recordHandoff(ctx.db, { orgId: ctx.orgId, contactId: ctx.contactId, conversationId: ctx.conversationId, cause: "policy", reason: legal ? "The customer mentioned legal action" : "The customer reported fraud or a stolen phone", now: ctx.now, log: deps.log }); trace.push({ name: "handoff_escalate", ok: true, ms: 0 });
    return done({ outcome: "escalated", text: legal ? LEGAL_REPLY : FRAUD_REPLY, rounds: 0, escalated: true, sideEffects: true, note: "keyword handoff" });
  }
  let final: string | null = null; let rounds = 0; let lastFinish = "";
  let effortNow = effort, maxNow = maxTokensFor(input.mode), recovered = false;
  try {
    while (rounds < MAX_ROUNDS) {
      rounds++;
      if (rounds === MAX_ROUNDS) messages.push({ role: "user", content: `[note to assistant, not from the customer] ${WRAP_UP}` });
      const resp = await deps.llm.chat({ messages, tools: rounds === MAX_ROUNDS ? undefined : specs, effort: effortNow, maxTokens: maxNow, temperature: 0.3, signal: input.signal });
      add(usage, resp.usage); lastFinish = resp.finish;
      const calls = resp.message.tool_calls ?? [];
      if (!calls.length) {
        const text = cleanReply(resp.message.content ?? "");
        const markup = TOOL_MARKUP.test(text), truncated = resp.finish === "length";
        if ((!text || markup || truncated) && !recovered) {   // empty (all budget spent thinking), cut off mid-sentence, or tool syntax printed as text: ask again with reasoning off and more room, tools still available
          recovered = true; effortNow = "none"; maxNow = maxNow * 2; continue;
        }
        final = markup ? "" : truncated ? trimToSentence(text) : text;
        break;
      }
      const pass = calls.filter((c) => passNames.has(c.function.name));
      if (pass.length) return done({ outcome: "reply", text: cleanReply(resp.message.content ?? ""), rounds, passthrough: pass.map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments })) });
      messages.push({ role: "assistant", content: resp.message.content ?? null, tool_calls: calls });
      let forced: string | undefined;
      for (const call of calls) {
        const r = await executeTool(deps, ctx, call);
        trace.push(r.trace); sideEffects ||= Boolean(r.result.sideEffect); escalated ||= Boolean(r.result.escalate);
        messages.push({ role: "tool", tool_call_id: call.id, content: r.content });
        forced ??= r.result.reply;
      }
      if (forced) { final = cleanReply(forced); break; }   // a tool supplied the exact words (e.g. which number to text): no further model call, nothing to paraphrase
    }
  } catch (e) {
    if (input.signal?.aborted) return done({ outcome: "failed", text: "", rounds, note: "cancelled" });
    deps.log?.(`turn ${turnId} model/tool error: ${(e as Error).message}`);
    await escalateFallback(deps, ctx, `model error: ${(e as Error).message.slice(0, 80)}`);
    return done({ outcome: "escalated", text: SAFE_FALLBACK, rounds, escalated: true, sideEffects: true, note: `error: ${(e as Error).message.slice(0, 120)}` });
  }
  if (final === null || !final) {
    await escalateFallback(deps, ctx, final === null ? "tool loop did not finish" : "empty reply");
    return done({ outcome: "escalated", text: SAFE_FALLBACK, rounds, escalated: true, sideEffects: true, note: final === null ? "max rounds" : `empty reply (finish=${lastFinish})` });
  }

  // guardrails in code, outside the model. One corrective retry, then a safe fallback and a person.
  let verdict = checkText(final, b.guard, ctx.guard.evidence);
  if (verdict.verdict === "blocked") {
    const reason = verdict.reason;
    try {
      messages.push({ role: "assistant", content: final });
      messages.push({ role: "user", content: `[note to assistant, not from the customer] Your draft was rejected: ${reason}. Rewrite it using only facts from the tools, the knowledge, or the customer's own words. Do not mention this note.` });
      const again = await deps.llm.chat({ messages, effort, maxTokens: maxTokensFor(input.mode), temperature: 0.2, signal: input.signal });
      add(usage, again.usage);
      const retry = cleanReply(again.message.content ?? "");
      verdict = retry ? checkText(retry, b.guard, ctx.guard.evidence) : verdict;
      if (retry && verdict.verdict === "ok") return done({ outcome: escalated ? "escalated" : "reply", text: await noSecretRequests(retry), rounds: rounds + 1, note: `guardrail retry: ${reason}` });
      const kept = keepPassingSentences(retry || final, b.guard, ctx.guard.evidence);   // still failing: send only the sentences that pass, if any remain
      if (kept) return done({ outcome: escalated ? "escalated" : "reply", text: await noSecretRequests(kept), rounds: rounds + 1, note: `sanitized (dropped unsupported sentence): ${reason}` });
    } catch { /* fall through to the safe fallback */ }
    if (verdict.verdict === "blocked" && verdict.kind === "ungrounded_amount") {   // a number we could not back up: do not hand the whole conversation to a person for that; tell the team and stay on
      await notifyTeam(ctx, `held back an answer it could not back up (${reason})`);
      return done({ outcome: "blocked", text: "I want to be sure I give you the right number, so I'll have someone confirm that for you. Is there anything else I can help with in the meantime?", rounds, sideEffects: true, note: `blocked: ${reason}` });
    }
    await escalateFallback(deps, ctx, `guardrail: ${reason}`);
    return done({ outcome: "blocked", text: SAFE_FALLBACK, rounds, escalated: true, sideEffects: true, note: `blocked: ${reason}` });
  }
  if (!escalated && !teamTold(trace) && promisesPerson(final)) { await notifyTeam(ctx, "the reply told the customer a person would follow up"); sideEffects = true; }   // never promise a person without telling the team (the chat stays with the agent)
  const gap = await backUpCodeClaim(deps, ctx, final, trace);
  if (gap) { sideEffects = true; if (gap.failure) final = gap.failure; else if (gap.asked) final = `${takeSentences(final, true)[0].filter((x) => !ASKS_CODE.test(x) && !(/\?["')]*$/.test(x) && x.split(/\s+/).length <= 8)).join(" ")} ${CODE_SENT}`.trim(); }
  return done({ outcome: escalated ? "escalated" : "reply", text: await noSecretRequests(final), rounds });
}

// ---------------------------------------------------------------------------------------------------------------------------
export type StreamEvent =
  | { type: "sentence"; text: string; replaced?: boolean }
  | { type: "passthrough"; calls: { id: string; name: string; arguments: string }[] }
  | { type: "done"; result: TurnResult; spoken: string };

/** Streaming turn (voice): yields complete sentences as soon as they pass the guardrails. Cancel with input.signal when the caller talks over us. */
export async function* streamTurn(deps: EngineDeps, input: TurnInput): AsyncGenerator<StreamEvent> {
  const t0 = Date.now(); const turnId = randomUUID();
  const b = await buildContext(deps.db, deps.env, input);
  const ctx = makeCtx(deps, input, b, turnId);
  const messages: ChatMessage[] = [...b.messages];
  const specs = [...deps.tools.map(spec), ...(input.passthrough ?? []).map((p) => ({ type: "function" as const, function: p }))];
  const passNames = new Set((input.passthrough ?? []).map((p) => p.name));
  const usage: Usage = { prompt_tokens: 0, completion_tokens: 0 };
  const trace: TraceCall[] = []; let sideEffects = false, escalated = false; let spoken = ""; let note: string | undefined; let rounds = 0; let flagged = false;
  const effort = effortFor(input.mode);
  const finish = (outcome: TurnResult["outcome"], extra: Partial<TurnResult> = {}): StreamEvent => ({ type: "done", spoken, result: {
    turnId, outcome, text: spoken, rounds, toolCalls: trace, usage, sideEffects, escalated, passthrough: [], note, ms: Date.now() - t0, model: deps.llm.model, effort, ...extra } });

  let askedOne = false; let leadDone = false; let askedCode = false; const spokenKeys = new Set<string>();
  let muted = false;   // set once the assistant tries to ask for a secret: the redirect is spoken instead and nothing more from the model is
  const say = async function* (sentences: string[], forced = false): AsyncGenerator<StreamEvent> {
    for (const raw of sentences) {
      if (muted) return;
      const s = stripToolMarkup(cleanReply(raw)); if (!s) continue;   // tool syntax is never spoken; real words around it still are
      if (asksForSecrets(s)) {   // "What's your PIN?" must never be spoken: move the customer to text instead
        muted = true; sideEffects = true; note = "asked for a secret; moved to text";
        const msg = input.mode === "voice" ? (await reachHint(ctx, "private_details")).reply : TEXT_REDIRECT;
        for (const part of takeSentences(msg, true)[0]) { spoken += (spoken ? " " : "") + part; yield { type: "sentence", text: part, replaced: true }; }
        return;
      }
      if (!forced && ASKS_CODE.test(s) && ctx.party.externalRefs.some((r) => r.system === "tmobile" && r.kind === "account") && !ctx.customer.verified && !trace.some((t) => t.name === "verify_send_code" && t.ok)) { askedCode = true; continue; }
      if (askedCode && !forced && /\?["')]*$/.test(s) && s.split(/\s+/).length <= 8) continue;   // never ask permission to send a code: it is sent instead (below)
      { const k = s.toLowerCase().replace(/\s+/g, " "); if (!forced && spokenKeys.has(k)) continue; spokenKeys.add(k); }
      if (!forced && !spoken && !leadDone) { leadDone = true; const lead = empathyLead(input.batch.map((m) => m.body).join(" "), s, turnId); if (lead) { spoken += lead; yield { type: "sentence", text: lead, replaced: true }; } }
      if (!forced && /\?["')]*$/.test(s)) { if (askedOne) continue; askedOne = true; }   // one question per reply
      if (!forced && input.mode === "voice" && spoken && (spoken + " " + s).split(/\s+/).length > VOICE_MAX_WORDS) continue;   // a call is not a lecture: stop at a sentence boundary
      const v = checkText(s, b.guard, ctx.guard.evidence);
      if (v.verdict === "blocked") { flagged = true; note = `sentence blocked: ${v.reason}`; if (!spoken.endsWith(SAFE_LINE)) { spoken += (spoken ? " " : "") + SAFE_LINE; yield { type: "sentence", text: SAFE_LINE, replaced: true }; } }
      else { spoken += (spoken ? " " : "") + s; yield { type: "sentence", text: s }; }
    }
  };

  if (LEGAL.test(input.batch.map((m) => m.body).join(" ")) || FRAUD.test(input.batch.map((m) => m.body).join(" "))) {
    const legal = LEGAL.test(input.batch.map((m) => m.body).join(" "));
    await recordHandoff(ctx.db, { orgId: ctx.orgId, contactId: ctx.contactId, conversationId: ctx.conversationId, cause: "policy", reason: legal ? "The customer mentioned legal action" : "The customer reported fraud or a stolen phone", now: ctx.now, log: deps.log }); trace.push({ name: "handoff_escalate", ok: true, ms: 0 });
    escalated = true; sideEffects = true; note = "keyword handoff"; yield* say(takeSentences(legal ? LEGAL_REPLY : FRAUD_REPLY, true)[0], true); yield finish("escalated"); return;
  }
  try {
    while (rounds < MAX_ROUNDS) {
      rounds++;
      if (rounds === MAX_ROUNDS) messages.push({ role: "user", content: `[note to assistant, not from the customer] ${WRAP_UP}` });
      let buf = ""; let content = "";
      const acc = new Map<number, { id: string; name: string; args: string }>(); let streamFinish = "";
      for await (const d of deps.llm.stream({ messages, tools: rounds === MAX_ROUNDS ? undefined : specs, effort, maxTokens: maxTokensFor(input.mode), temperature: 0.3, signal: input.signal })) {
        if (d.type === "content") { buf += d.text; content += d.text; const [sents, rest] = takeSentences(buf); buf = rest; yield* say(sents); }
        else if (d.type === "tool") { const a = acc.get(d.index) ?? { id: "", name: "", args: "" }; if (d.id) a.id = d.id; if (d.name) a.name += d.name; if (d.args) a.args += d.args; acc.set(d.index, a); }
        else { add(usage, d.usage); streamFinish = d.finish; }
      }
      if (streamFinish !== "length") { const [tail] = takeSentences(buf, true); yield* say(tail); }   // a fragment cut off by the token limit is not spoken
      if (muted) break;
      const calls: ToolCallReq[] = [...acc.values()].filter((a) => a.name).map((a, i) => ({ id: a.id || `call_${turnId.slice(0, 8)}_${rounds}_${i}`, type: "function", function: { name: a.name, arguments: a.args || "{}" } }));
      if (!calls.length) break;
      const pass = calls.filter((c) => passNames.has(c.function.name));
      if (pass.length) { const p = pass.map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments })); yield { type: "passthrough", calls: p }; yield finish(escalated ? "escalated" : "reply", { passthrough: p }); return; }
      messages.push({ role: "assistant", content: content || null, tool_calls: calls });
      let forced: string | undefined;
      for (const call of calls) {
        const r = await executeTool(deps, ctx, call);
        trace.push(r.trace); sideEffects ||= Boolean(r.result.sideEffect); escalated ||= Boolean(r.result.escalate);
        messages.push({ role: "tool", tool_call_id: call.id, content: r.content });
        forced ??= r.result.reply;
      }
      if (forced) { yield* say(takeSentences(cleanReply(forced), true)[0], true); break; }
      if (rounds === MAX_ROUNDS) throw new Error("tool loop did not finish");   // only if the model ignored the no-tools round
    }
    if (!spoken) throw new Error("empty reply");
    { const gap = await backUpCodeClaim(deps, ctx, spoken, trace, askedCode); if (gap) { sideEffects = true; yield* say(takeSentences(gap.failure ?? (gap.asked ? CODE_SENT : ""), true)[0], true); } }
    if (!escalated && !teamTold(trace) && promisesPerson(spoken)) { await notifyTeam(ctx, "the reply told the customer a person would follow up"); sideEffects = true; }
    yield finish(flagged ? "blocked" : escalated ? "escalated" : "reply");
  } catch (e) {
    if (input.signal?.aborted) { note = "interrupted"; yield finish("failed"); return; }
    deps.log?.(`stream turn ${turnId} error: ${(e as Error).message}`);
    await escalateFallback(deps, ctx, `voice error: ${(e as Error).message.slice(0, 80)}`);
    escalated = true; sideEffects = true; note = `error: ${(e as Error).message.slice(0, 120)}`;
    spoken += (spoken ? " " : "") + SAFE_FALLBACK; yield { type: "sentence", text: SAFE_FALLBACK, replaced: true };
    yield finish("escalated");
  }
}

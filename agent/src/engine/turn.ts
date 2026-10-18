import { randomUUID } from "node:crypto";
import { type Db } from "mongodb";
import { isVerified } from "../customer";
import type { Messenger } from "../messenger";
import { buildContext, type BuiltContext, type TurnInput } from "./context";
import { checkText, takeSentences, type GuardCfg } from "./guardrails";
import { stripThinking } from "./llm";
import { handoff_escalate } from "./tools/core";
import { toolByName } from "./tools/index";
import type { ChatMessage, EngineEnv, LlmPort, Tool, ToolCallReq, ToolCtx, ToolResult, ToolSpec, Usage } from "./types";
import { validateArgs } from "./validate";

export const MAX_ROUNDS = 4;
export type EngineDeps = { db: Db; llm: LlmPort; tools: Tool[]; messenger: Messenger; env: EngineEnv; log?: (m: string) => void };
export type TraceCall = { name: string; ok: boolean; ms: number; error?: string };
export type TurnResult = {
  turnId: string; outcome: "reply" | "escalated" | "blocked" | "failed"; text: string; rounds: number; toolCalls: TraceCall[]; usage: Usage;
  sideEffects: boolean; escalated: boolean; passthrough: { id: string; name: string; arguments: string }[]; note?: string; ms: number; model: string; effort: string;
};

export const SAFE_FALLBACK = "I'm having trouble with that right now. I'll get a person to follow up with you.";
const SAFE_LINE = "Let me double-check that and have someone confirm.";

const spec = (t: Tool): ToolSpec => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } });
const effortFor = (mode: string) => (mode === "voice" ? ("none" as const) : ("low" as const));
// At effort "low" the model can spend several hundred tokens reasoning before it writes; leave room so answers are not cut off.
const maxTokensFor = (mode: string) => (mode === "voice" ? 160 : 900);
const TOOL_MARKUP = /<\/?tool_call>|<function=|<\/function>/;
/** Remove tool syntax the model printed as text, keeping any real words around it. */
export const stripToolMarkup = (s: string) => s.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").replace(/<function=[^>]*>[\s\S]*?<\/function>/g, "").replace(/<\/?(tool_call|function[^>]*)>/g, "").replace(/\s{2,}/g, " ").trim();
export function trimToSentence(text: string): string {
  const m = text.match(/^[\s\S]*[.!?](?=\s|$)/);
  return m ? m[0].trim() : "";
}

/** Plain text only: no markdown emphasis, no bullets, no stray whitespace. */
export function cleanReply(text: string): string {
  return stripThinking(text).replace(/\*\*|__|`/g, "").replace(/^\s*[-*•]\s+/gm, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function makeCtx(deps: EngineDeps, input: TurnInput, b: BuiltContext, turnId: string): ToolCtx {
  return {
    db: deps.db, orgId: input.orgId, contactId: b.party.contact._id, conversationId: input.conversationId, channel: input.channel, mode: input.mode,
    party: b.party, customer: b.customer, turnId, sourceMessageId: input.batch[input.batch.length - 1]?._id ?? null,
    now: deps.env.now?.() ?? new Date(), messenger: deps.messenger, env: deps.env, guard: { cfg: b.guard, evidence: b.evidence },
  };
}

/** Run one tool call the model asked for. Everything the model can get wrong is turned into an error result, never a crash. */
export async function executeTool(deps: EngineDeps, ctx: ToolCtx, call: ToolCallReq): Promise<{ content: string; result: ToolResult; trace: TraceCall }> {
  const t0 = Date.now();
  const tool = toolByName(deps.tools, call.function.name);
  let result: ToolResult; let args: any = {};
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
      orgId: ctx.orgId, conversationId: ctx.conversationId, contactId: ctx.contactId, tool: call.function.name, args: tool?.redactArgs ? {} : (args && typeof args === "object" ? args : {}),
      result: result.audit ?? (result.ok ? result.data ?? null : { error: result.error }), status: result.ok ? "ok" : (result.error === "blocked_by_guardrail" || result.error === "not_verified") ? "blocked" : "error",
      ms, approvedBy: null, ts: new Date(), turnId: ctx.turnId,
    } as never);
  } catch (e) { deps.log?.(`tool_calls write failed: ${(e as Error).message}`); }
  return { content, result, trace: { name: call.function.name, ok: result.ok, ms, ...(result.error ? { error: result.error } : {}) } };
}

async function escalateFallback(deps: EngineDeps, ctx: ToolCtx, why: string) {
  try { await handoff_escalate.run(ctx, { reason: `Automatic handoff: ${why}` }); } catch (e) { deps.log?.(`fallback handoff failed: ${(e as Error).message}`); }
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
  const done = (r: Partial<TurnResult> & Pick<TurnResult, "outcome" | "text" | "rounds">): TurnResult => ({
    turnId, toolCalls: trace, usage, sideEffects, escalated, passthrough: [], ms: Date.now() - t0, model: deps.llm.model, effort, ...r });

  let final: string | null = null; let rounds = 0; let lastFinish = "";
  let effortNow = effort, maxNow = maxTokensFor(input.mode), recovered = false;
  try {
    while (rounds < MAX_ROUNDS) {
      rounds++;
      const resp = await deps.llm.chat({ messages, tools: specs, effort: effortNow, maxTokens: maxNow, temperature: 0.3, signal: input.signal });
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
      for (const call of calls) {
        const r = await executeTool(deps, ctx, call);
        trace.push(r.trace); sideEffects ||= Boolean(r.result.sideEffect); escalated ||= Boolean(r.result.escalate);
        messages.push({ role: "tool", tool_call_id: call.id, content: r.content });
      }
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
      messages.push({ role: "system", content: `Your draft was rejected: ${reason}. Rewrite it using only facts from the tools, the knowledge, or the customer's own words. Do not mention this note.` });
      const again = await deps.llm.chat({ messages, effort, maxTokens: maxTokensFor(input.mode), temperature: 0.2, signal: input.signal });
      add(usage, again.usage);
      const retry = cleanReply(again.message.content ?? "");
      verdict = retry ? checkText(retry, b.guard, ctx.guard.evidence) : verdict;
      if (retry && verdict.verdict === "ok") return done({ outcome: escalated ? "escalated" : "reply", text: retry, rounds: rounds + 1, note: `guardrail retry: ${reason}` });
    } catch { /* fall through to the safe fallback */ }
    await escalateFallback(deps, ctx, `guardrail: ${reason}`);
    return done({ outcome: "blocked", text: SAFE_FALLBACK, rounds, escalated: true, sideEffects: true, note: `blocked: ${reason}` });
  }
  return done({ outcome: escalated ? "escalated" : "reply", text: final, rounds });
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

  const say = function* (sentences: string[]): Generator<StreamEvent> {
    for (const raw of sentences) {
      const s = stripToolMarkup(cleanReply(raw)); if (!s) continue;   // tool syntax is never spoken; real words around it still are
      const v = checkText(s, b.guard, ctx.guard.evidence);
      if (v.verdict === "blocked") { flagged = true; note = `sentence blocked: ${v.reason}`; spoken += (spoken ? " " : "") + SAFE_LINE; yield { type: "sentence", text: SAFE_LINE, replaced: true }; }
      else { spoken += (spoken ? " " : "") + s; yield { type: "sentence", text: s }; }
    }
  };

  try {
    while (rounds < MAX_ROUNDS) {
      rounds++;
      let buf = ""; let content = "";
      const acc = new Map<number, { id: string; name: string; args: string }>(); let streamFinish = "";
      for await (const d of deps.llm.stream({ messages, tools: specs, effort, maxTokens: maxTokensFor(input.mode), temperature: 0.3, signal: input.signal })) {
        if (d.type === "content") { buf += d.text; content += d.text; const [sents, rest] = takeSentences(buf); buf = rest; yield* say(sents); }
        else if (d.type === "tool") { const a = acc.get(d.index) ?? { id: "", name: "", args: "" }; if (d.id) a.id = d.id; if (d.name) a.name += d.name; if (d.args) a.args += d.args; acc.set(d.index, a); }
        else { add(usage, d.usage); streamFinish = d.finish; }
      }
      if (streamFinish !== "length") { const [tail] = takeSentences(buf, true); yield* say(tail); }   // a fragment cut off by the token limit is not spoken
      const calls: ToolCallReq[] = [...acc.values()].filter((a) => a.name).map((a, i) => ({ id: a.id || `call_${turnId.slice(0, 8)}_${rounds}_${i}`, type: "function", function: { name: a.name, arguments: a.args || "{}" } }));
      if (!calls.length) break;
      const pass = calls.filter((c) => passNames.has(c.function.name));
      if (pass.length) { const p = pass.map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments })); yield { type: "passthrough", calls: p }; yield finish(escalated ? "escalated" : "reply", { passthrough: p }); return; }
      messages.push({ role: "assistant", content: content || null, tool_calls: calls });
      for (const call of calls) {
        const r = await executeTool(deps, ctx, call);
        trace.push(r.trace); sideEffects ||= Boolean(r.result.sideEffect); escalated ||= Boolean(r.result.escalate);
        messages.push({ role: "tool", tool_call_id: call.id, content: r.content });
      }
      if (rounds === MAX_ROUNDS) throw new Error("tool loop did not finish");
    }
    if (!spoken) throw new Error("empty reply");
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

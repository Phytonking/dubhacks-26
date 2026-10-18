import type { ChatRequest, ChatResponse, Delta, LlmPort, ToolCallReq, Usage } from "./types";

// Modal-hosted Qwen behind an OpenAI-compatible endpoint. Verified live (2026-10-18): function calling works, tool results are accepted,
// streams carry tool-call deltas, and reasoning_effort accepts none | low | medium (not "minimal"). Whole short reply: ~215-325 ms.
export type ModalCfg = { endpoint: string; id: string; secret: string; model: string; timeoutMs?: number };

/**
 * The model's private reasoning must never reach a customer. Normally it arrives in a separate field, but under a long prompt it has been seen
 * leaking into the message as "...reasoning...</think> answer" (a closing tag with no opener) and sometimes repeats the answer. Rules:
 * anything before the LAST closing tag is reasoning; complete <think>..</think> pairs are removed; a stray opener drops the rest; and an
 * answer that was repeated back to back is collapsed to one copy.
 */
export function stripThinking(input: string | null | undefined): string {
  let s = input ?? "";
  const close = s.lastIndexOf("</think>");
  if (close >= 0) s = s.slice(close + "</think>".length);
  s = s.replace(/<think>[\s\S]*?<\/think>/g, "");
  const open = s.indexOf("<think>");
  if (open >= 0) s = s.slice(0, open);
  const paras = s.trim().split(/\n{2,}/);
  const out: string[] = [];
  for (const p of paras) if (!out.length || out[out.length - 1].trim() !== p.trim()) out.push(p);
  return out.join("\n\n").trim();
}

export class ModalLlm implements LlmPort {
  model: string;
  constructor(private cfg: ModalCfg) { this.model = cfg.model; }

  private body(req: ChatRequest, stream: boolean) {
    return JSON.stringify({
      model: this.cfg.model, messages: req.messages, stream, max_tokens: req.maxTokens, temperature: req.temperature, reasoning_effort: req.effort,
      ...(req.tools?.length ? { tools: req.tools, tool_choice: "auto" } : {}),
    });
  }
  private async post(req: ChatRequest, stream: boolean): Promise<Response> {
    const url = `${this.cfg.endpoint.replace(/\/$/, "")}/chat/completions`;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const timeout = AbortSignal.timeout(this.cfg.timeoutMs ?? 20_000);
      const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
      try {
        const r = await fetch(url, { method: "POST", signal, headers: { "content-type": "application/json", authorization: `Bearer ${this.cfg.id}.${this.cfg.secret}` }, body: this.body(req, stream) });
        if (r.ok) return r;
        const text = (await r.text()).slice(0, 200);
        lastErr = new Error(`model HTTP ${r.status}: ${text}`);
        if (r.status < 500 && r.status !== 429) throw lastErr;          // 4xx: our request is wrong, retrying will not help
      } catch (e) {
        if (req.signal?.aborted) throw e;                                  // caller cancelled (e.g. the caller hung up): do not retry
        lastErr = e;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const j: any = await (await this.post(req, false)).json();
    const c = j.choices?.[0];
    if (!c) throw new Error("model returned no choices");
    if (process.env.DEBUG_LLM && !c.message?.tool_calls?.length && !String(c.message?.content ?? "").trim()) console.error("[DEBUG_LLM] empty reply, raw choice:", JSON.stringify(c).slice(0, 1500));
    if (process.env.TRACE_LLM) console.error(`[TRACE_LLM] effort=${req.effort} finish=${c.finish_reason} content=${JSON.stringify(String(c.message?.content ?? "").slice(0, 100))} calls=${JSON.stringify((c.message?.tool_calls ?? []).map((t: any) => t.function?.name + t.function?.arguments))}`);
    const calls: ToolCallReq[] | undefined = c.message?.tool_calls?.map((t: any) => ({ id: t.id, type: "function", function: { name: t.function?.name, arguments: t.function?.arguments ?? "{}" } }));
    return {
      message: { role: "assistant", content: c.message?.content == null ? null : stripThinking(c.message.content), ...(calls?.length ? { tool_calls: calls } : {}) },
      usage: { prompt_tokens: j.usage?.prompt_tokens ?? 0, completion_tokens: j.usage?.completion_tokens ?? 0 },
      finish: c.finish_reason ?? "stop",
    };
  }

  async *stream(req: ChatRequest): AsyncIterable<Delta> {
    const r = await this.post(req, true);
    if (!r.body) throw new Error("model stream has no body");
    const reader = r.body.getReader(); const dec = new TextDecoder();
    let buf = ""; let finish = "stop"; let usage: Usage | undefined; let think = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let k: number;
      while ((k = buf.indexOf("\n\n")) >= 0) {
        const ev = buf.slice(0, k); buf = buf.slice(k + 2);
        if (!ev.startsWith("data:")) continue;
        const d = ev.slice(5).trim();
        if (d === "[DONE]") continue;
        let j: any; try { j = JSON.parse(d); } catch { continue; }
        if (j.usage) usage = { prompt_tokens: j.usage.prompt_tokens ?? 0, completion_tokens: j.usage.completion_tokens ?? 0 };
        const ch = j.choices?.[0]; if (!ch) continue;
        if (ch.finish_reason) finish = ch.finish_reason;
        const dl = ch.delta ?? {};
        if (typeof dl.content === "string" && dl.content) {
          // drop inline <think> blocks if the model emits them in-band; reasoning_content is a separate field and is never forwarded
          let t: string = dl.content;
          if (t.includes("</think>") && !think) t = t.split("</think>").pop() ?? "";   // leaked reasoning ended here: keep only what follows
          if (t.includes("<think>")) { think = true; t = t.split("<think>")[0]; }
          if (think) { if (dl.content.includes("</think>")) { think = false; t = dl.content.split("</think>").pop() ?? ""; } else if (!t) continue; }
          if (t) yield { type: "content", text: t };
        }
        for (const tc of dl.tool_calls ?? []) yield { type: "tool", index: tc.index ?? 0, id: tc.id, name: tc.function?.name, args: tc.function?.arguments };
      }
    }
    yield { type: "done", finish, usage };
  }
}

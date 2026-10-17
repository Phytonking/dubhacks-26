import type { Daytona } from "@daytona/sdk";

// Talks to agentd through Daytona's own preview URL for the sandbox: no tunnel, no inbound port on our side.
// (Production design is the outbound Hub in platform.ts; this is the no-public-host path. PRD §5.2.)
export type TurnReply = {
  text: string; usage?: { prompt_tokens?: number; completion_tokens?: number };
  toolCalls: Array<{ tool: string; args: unknown; result: unknown; ms: number }>; ms: number;
};
export interface AgentLink {
  online(agentId: string): Promise<boolean>;
  waitOnline(agentId: string, timeoutMs: number): Promise<void>;
  send(agentId: string, turn: Record<string, unknown>): Promise<TurnReply>;
}

export const AGENT_PORT = 8080;
/** Host-side Modal call (we hold the credential; clamps live here). */
export type LlmCall = (messages: unknown[], opts: { channel: string }) => Promise<any>;

export class SandboxLink implements AgentLink {
  secrets = new Map<string, string>();   // agentId -> per-sandbox turn secret
  names = new Map<string, string>();     // agentId -> daytona sandbox name
  constructor(private daytona: Daytona, private llm: LlmCall) {}

  register(agentId: string, sandboxName: string, turnSecret: string) { this.names.set(agentId, sandboxName); this.secrets.set(agentId, turnSecret); }

  private async target(agentId: string) {
    const sb: any = await this.daytona.get(this.names.get(agentId)!);
    if (sb.state !== "started") throw new Error(`sandbox ${sb.state}`);
    const p: any = await sb.getPreviewLink(AGENT_PORT);
    return { url: String(p.url).replace(/\/$/, ""), headers: { "x-daytona-preview-token": String(p.token ?? ""), "x-daytona-skip-preview-warning": "true", authorization: `Bearer ${this.secrets.get(agentId)}` } as Record<string, string> };
  }

  async online(agentId: string) {
    try {
      const t = await this.target(agentId);
      const r = await fetch(t.url + "/health", { headers: t.headers, signal: AbortSignal.timeout(8000) });
      return r.ok && ((await r.json()) as any).agentId === agentId;
    } catch { return false; }
  }

  async waitOnline(agentId: string, timeoutMs: number) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) { if (await this.online(agentId)) return; await new Promise((r) => setTimeout(r, 1000)); }
    throw new Error(`agent ${agentId} not reachable via preview URL within ${timeoutMs}ms`);
  }

  async send(agentId: string, turn: Record<string, unknown>): Promise<TurnReply> {
    const t0 = Date.now();
    const t = await this.target(agentId);
    const post = async (path: string, body: unknown) => {
      const r = await fetch(t.url + path, { method: "POST", headers: { ...t.headers, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
      if (!r.ok) throw new Error(`agent ${path} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return (await r.json()) as any;
    };
    console.log(`  [link] -> sandbox /turn (channel=${turn.channel})`);
    const prep = await post("/turn", turn);                                   // 1. sandbox: prompt + tools
    const completion = await this.llm(prep.messages, { channel: String(turn.channel) }); // 2. host: Modal
    console.log(`  [link] -> Modal chat/completions (${(prep.messages ?? []).length} msgs) ... ${completion.usage?.prompt_tokens}+${completion.usage?.completion_tokens} tokens, finish=${completion.choices?.[0]?.finish_reason}`);
    const fin = await post("/finalize", { completion });                      // 3. sandbox: sanitize
    return { text: fin.text, usage: completion.usage, toolCalls: prep.toolCalls ?? [], ms: Date.now() - t0 };
  }
}

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ObjectId, type Db } from "mongodb";
import { WebSocketServer, type WebSocket } from "ws";
import { verify } from "./jwt";

// One process hosting: LLM gateway (/llm), Agent API (/agent) and Agent Hub (/hub). PRD §4, §5.2, §5.10.
export type PlatformOpts = {
  db: Db;
  port: number;
  jwtKey: string;
  modal: { endpoint: string; id: string; secret: string };
  model: string;
};

type Pending = { resolve: (v: TurnReply) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };
export type TurnReply = { text: string; usage?: unknown; ms: number; toolCalls: number };

export class Hub {
  sockets = new Map<string, WebSocket>();
  hellos = new Map<string, { sandboxId: string; at: number }>();
  waiters = new Map<string, Array<() => void>>();
  pending = new Map<string, Pending>();

  isOnline(agentId: string) { return this.sockets.get(agentId)?.readyState === 1; }

  waitForAgent(agentId: string, timeoutMs: number): Promise<void> {
    if (this.isOnline(agentId)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`agent ${agentId} did not say hello within ${timeoutMs}ms`)), timeoutMs);
      const list = this.waiters.get(agentId) ?? [];
      list.push(() => { clearTimeout(t); resolve(); });
      this.waiters.set(agentId, list);
    });
  }

  send(agentId: string, turn: Record<string, unknown>, timeoutMs = 60_000): Promise<TurnReply> {
    const ws = this.sockets.get(agentId);
    if (!ws || ws.readyState !== 1) return Promise.reject(new Error("agent offline"));
    const turnId = String(turn.turnId);
    const t0 = Date.now();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(turnId); reject(new Error("turn timeout")); }, timeoutMs);
      this.pending.set(turnId, { timer, reject, resolve: (v) => resolve({ ...v, ms: Date.now() - t0 }) });
      ws.send(JSON.stringify({ type: "turn", ...turn }));
    });
  }
}

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => resolve(s)); });
const bearer = (req: IncomingMessage) => req.headers.authorization?.replace(/^Bearer /, "");

export function startPlatform(o: PlatformOpts) {
  const hub = new Hub();
  const llmStats = { requests: 0, rejected: 0 };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      if (url.pathname === "/health") return json(res, 200, { ok: true });

      // ---- LLM gateway: sandbox -> us -> Modal. Sandbox never sees the Modal credential. ----
      if (url.pathname === "/llm/v1/chat/completions" && req.method === "POST") {
        const c = verify(bearer(req), o.jwtKey, "llm");
        if (!c) { llmStats.rejected++; return json(res, 401, { error: "bad llm token" }); }
        const body = JSON.parse(await readBody(req));
        // Clamp: model, reasoning and length are ours to set per token, not the sandbox's.
        const out = {
          ...body,
          model: o.model,
          stream: false,
          reasoning_effort: c.reasoning ?? "low",
          max_tokens: Math.min(Number(body.max_tokens ?? c.maxTokens), Number(c.maxTokens ?? 512)),
        };
        llmStats.requests++;
        const r = await fetch(`${o.modal.endpoint.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${o.modal.id}.${o.modal.secret}` },
          body: JSON.stringify(out),
        });
        const text = await r.text();
        try {
          const u = JSON.parse(text).usage;
          if (u) {
            const day = new Date().toISOString().slice(0, 10);
            await o.db.collection("usage").updateOne(
              { orgId: new ObjectId(c.orgId), day },
              { $inc: { tokensIn: u.prompt_tokens ?? 0, tokensOut: u.completion_tokens ?? 0, messagesIn: 0, messagesOut: 0, sandboxSec: 0 } },
              { upsert: true },
            );
          }
        } catch { /* non-JSON error body: pass through */ }
        res.writeHead(r.status, { "content-type": "application/json" });
        return res.end(text);
      }

      // ---- Agent API: scoped by JWT; orgId comes from the token, never from the request. ----
      if (url.pathname.startsWith("/agent/")) {
        const c = verify(bearer(req), o.jwtKey, "agent");
        if (!c) return json(res, 401, { error: "bad agent token" });
        const orgId = new ObjectId(c.orgId);
        if (url.pathname === "/agent/config" && req.method === "GET") {
          const [org, agent, knowledge] = await Promise.all([
            o.db.collection("orgs").findOne({ _id: orgId }),
            o.db.collection("agents").findOne({ orgId }),
            o.db.collection("knowledge").find({ orgId, status: "ready" }).toArray(),
          ]);
          return json(res, 200, { org, agent, knowledge });
        }
        if (url.pathname === "/agent/tool-calls" && req.method === "POST") {
          const b = JSON.parse(await readBody(req));
          await o.db.collection("tool_calls").insertOne({
            orgId, conversationId: b.conversationId ? new ObjectId(b.conversationId) : null,
            tool: String(b.tool), args: b.args ?? {}, result: b.result ?? null,
            status: b.status ?? "ok", ms: Number(b.ms ?? 0), approvedBy: null, ts: new Date(),
          });
          return json(res, 200, { ok: true });
        }
      }
      json(res, 404, { error: "not found" });
    } catch (e) {
      json(res, 500, { error: String((e as Error).message) });
    }
  });

  // ---- Agent Hub: agentd dials in; Worker pushes turns down this socket. ----
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://x");
    const c = url.pathname === "/hub" ? verify(url.searchParams.get("token") ?? undefined, o.jwtKey, "agent") : null;
    if (!c) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); return socket.destroy(); }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on("message", (raw) => {
        const m = JSON.parse(String(raw));
        if (m.type === "hello") {
          hub.sockets.set(c.agentId, ws);
          hub.hellos.set(c.agentId, { sandboxId: String(m.sandboxId ?? ""), at: Date.now() });
          (hub.waiters.get(c.agentId) ?? []).forEach((f) => f());
          hub.waiters.delete(c.agentId);
        } else if (m.type === "reply" || m.type === "error") {
          const p = hub.pending.get(String(m.turnId));
          if (!p) return;
          clearTimeout(p.timer); hub.pending.delete(String(m.turnId));
          m.type === "reply" ? p.resolve({ text: m.text, usage: m.usage, ms: 0, toolCalls: m.toolCalls ?? 0 }) : p.reject(new Error(m.error));
        }
      });
      ws.on("close", () => { if (hub.sockets.get(c.agentId) === ws) hub.sockets.delete(c.agentId); });
    });
  });

  return new Promise<{ hub: Hub; llmStats: typeof llmStats; close: () => Promise<void> }>((resolve) =>
    server.listen(o.port, "127.0.0.1", () =>
      resolve({ hub, llmStats, close: () => new Promise((r) => { wss.clients.forEach((c) => c.terminate()); server.close(() => r()); }) }),
    ),
  );
}

// Shared test helpers: in-memory Mongo with the real schema, a scripted model, loopback channels. No network.
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { applySchema } from "../../web/src/lib/schema";
import { ALL_TOOLS } from "../src/engine/tools/index";
import type { ChatRequest, ChatResponse, Delta, LlmPort, ToolCallReq } from "../src/engine/types";
import type { EngineDeps } from "../src/engine/turn";
import { Messenger } from "../src/messenger";
import { LoopbackAdapter, type ChannelAdapter } from "../src/recorded-io";
import type { ChannelId } from "../src/identity";

export type Scripted = { content?: string | null; tools?: Array<{ name: string; args: unknown }>; usage?: { prompt_tokens: number; completion_tokens: number }; throws?: string };
export class ScriptedLlm implements LlmPort {
  model = "scripted"; requests: ChatRequest[] = []; i = 0;
  constructor(public script: Array<Scripted | ((req: ChatRequest) => Scripted)>) {}
  private next(req: ChatRequest): Scripted {
    this.requests.push(JSON.parse(JSON.stringify({ ...req, signal: undefined })));
    const s = this.script[Math.min(this.i++, this.script.length - 1)];
    const r = typeof s === "function" ? s(req) : s;
    if (r.throws) throw new Error(r.throws);
    return r;
  }
  private calls(r: Scripted): ToolCallReq[] {
    return (r.tools ?? []).map((t, k) => ({ id: `call_${this.i}_${k}`, type: "function", function: { name: t.name, arguments: typeof t.args === "string" ? t.args : JSON.stringify(t.args) } }));
  }
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const r = this.next(req); const calls = this.calls(r);
    return { message: { role: "assistant", content: r.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) }, usage: r.usage ?? { prompt_tokens: 100, completion_tokens: 20 }, finish: calls.length ? "tool_calls" : "stop" };
  }
  async *stream(req: ChatRequest): AsyncIterable<Delta> {
    const r = this.next(req);
    if (r.content) for (let k = 0; k < r.content.length; k += 7) {
      if (req.signal?.aborted) throw new Error("aborted");
      await new Promise((res) => setTimeout(res, 1)); yield { type: "content", text: r.content.slice(k, k + 7) };
    }
    this.calls(r).forEach((c, idx) => { /* emitted below */ void c; void idx; });
    let idx = 0;
    for (const c of this.calls(r)) { yield { type: "tool", index: idx, id: c.id, name: c.function.name, args: "" }; yield { type: "tool", index: idx, args: c.function.arguments }; idx++; }
    yield { type: "done", finish: r.tools?.length ? "tool_calls" : "stop", usage: r.usage ?? { prompt_tokens: 100, completion_tokens: 20 } };
  }
}

export class FlakyAdapter implements ChannelAdapter {
  sent: Array<{ address: string; text: string; ref: unknown; key: string }> = []; failNext = 0;
  constructor(public channel: ChannelId) {}
  async send(address: string, text: string, ref: unknown, key: string) {
    if (this.failNext > 0) { this.failNext--; throw new Error("provider rejected the send"); }
    this.sent.push({ address, text, ref, key }); return { channelMsgId: `m_${this.channel}_${this.sent.length}` };
  }
}

export type Kit = {
  db: Db; client: MongoClient; mongo: MongoMemoryServer; orgId: ObjectId; contactId: ObjectId; conversationId: ObjectId; phone: string;
  adapters: Record<"imessage" | "whatsapp" | "sms", FlakyAdapter>; ready: Record<string, { ok: boolean; reason?: string }>;
  messenger: Messenger; deps: (llm: LlmPort, extra?: Partial<EngineDeps>) => EngineDeps; now: { t: Date };
  newContact(phone: string, extra?: Record<string, unknown>): Promise<{ contactId: ObjectId; conversationId: ObjectId }>;
  addInbound(conversationId: ObjectId, body: string, o?: { channel?: ChannelId; ts?: Date; ref?: unknown }): Promise<ObjectId>;
  stop(): Promise<void>;
};
export async function makeKit(opts: { template?: string; groundMoney?: boolean } = {}): Promise<Kit> {
  const mongo = await MongoMemoryServer.create();
  const client = await new MongoClient(mongo.getUri()).connect();
  const db = client.db("t"); await applySchema(db);
  const orgId = new ObjectId(); const now = { t: new Date("2026-10-18T12:00:00Z") };
  await db.collection("orgs").insertOne({ _id: orgId, name: "Sunrise Bike Shop", productDescription: "Bike shop.", brandVoice: "friendly", hours: "Mon-Sat 10-6", plan: "pro", createdAt: now.t });
  await db.collection("agents").insertOne({ orgId, status: "running", harness: null, persona: "You are Sunny.", guardrails: { maxDiscountPct: 10, escalateOn: ["refund"], ...(opts.groundMoney ? { requireGroundedMoney: true } : {}) },
    enabledChannels: { imessage: true, whatsapp: true, sms: false, voice: true }, sandboxId: null, updatedAt: now.t, ...(opts.template ? { promptTemplate: opts.template } : {}) });
  await db.collection("knowledge").insertMany([
    { orgId, kind: "faq", title: "Tune-up pricing", content: "A basic tune-up is $89 and takes 2 days. Full overhaul is $219.", sourceUrl: null, version: 1, status: "ready", createdAt: now.t },
    { orgId, kind: "faq", title: "Hours and location", content: "Open Mon-Sat 10am-6pm Pacific. Closed Sunday.", sourceUrl: null, version: 1, status: "ready", createdAt: now.t },
    { orgId, kind: "catalog", title: "Gravel bikes", content: "Trailhead Gravel GX is $1,450. Sizes 49 to 58.", sourceUrl: null, version: 1, status: "ready", createdAt: now.t },
  ] as never);
  const phone = "+14255550123";
  const adapters = { imessage: new FlakyAdapter("imessage"), whatsapp: new FlakyAdapter("whatsapp"), sms: new FlakyAdapter("sms") };
  const ready: Kit["ready"] = { imessage: { ok: true }, whatsapp: { ok: true }, sms: { ok: false, reason: "campaign not eligible" } };
  const messenger = new Messenger(db, { adapters, ready: async (ch) => ready[ch] ?? { ok: false }, now: () => now.t });
  const kit: Kit = {
    db, client, mongo, orgId, contactId: null as never, conversationId: null as never, phone, adapters, ready, messenger, now,
    deps: (llm, extra = {}) => ({ db, llm, tools: ALL_TOOLS, messenger, env: { brandFallback: "Sunrise Bike Shop", publicFormsBaseUrl: "https://forms.example.test", verifySecret: "test-secret", formsMasterKey: Buffer.alloc(32, 7).toString("base64"), now: () => now.t }, ...extra }),
    async newContact(p, extra = {}) {
      const contactId = new ObjectId(), conversationId = new ObjectId();
      await db.collection("contacts").insertOne({ _id: contactId, orgId, handles: [{ channel: "imessage", address: p }], name: p, stage: "new", score: 0, notes: "", facts: [], createdAt: now.t, ...extra } as never);
      await db.collection("conversations").insertOne({ _id: conversationId, orgId, contactId, mode: "agent", lastChannel: "imessage", lastMessageAt: now.t, lastMessagePreview: "" } as never);
      return { contactId, conversationId };
    },
    async addInbound(conversationId, body, o = {}) {
      const _id = new ObjectId(); const channel = o.channel ?? "imessage";
      await db.collection("messages").insertOne({ _id, orgId, conversationId, channel, direction: "in", sender: "customer", body, channelMsgId: `in_${_id}`, deliveryStatus: "received", handling: "agent", ts: o.ts ?? now.t,
        ref: o.ref ?? { spaceId: "spc_1", senderId: "usr_agent" } } as never);
      return _id;
    },
    async stop() { await client.close(); await mongo.stop(); },
  };
  const c = await kit.newContact(phone); kit.contactId = c.contactId; kit.conversationId = c.conversationId;
  return kit;
}

let pass = 0, fail = 0;
export const t = async (name: string, f: () => Promise<string | void>) => { try { const d = await f(); pass++; console.log("PASS", name, d ?? ""); } catch (e) { fail++; console.log("FAIL", name, "\n     ", (e as Error).message.split("\n").join("\n      ")); } };
export const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };
export const finish = async (kit: { stop(): Promise<void> }) => { console.log(`\n${pass} passed, ${fail} failed`); await kit.stop(); process.exit(fail ? 1 : 0); };

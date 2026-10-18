import { randomUUID } from "node:crypto";
import type { Db, ObjectId } from "mongodb";
import { runTurn, type EngineDeps, type TurnResult } from "./engine/turn";
import type { ChannelId } from "./identity";
import type { Worker } from "./recorded-io";

// Per-conversation lanes (AGENT-ARCHITECTURE section 6). The lane lives on the conversation document, so it is durable and visible to every
// worker instance: bursts are merged into one reply, one person is never handled by two turns at once, many people run in parallel up to
// caps, and a crash is recovered when the lease expires.
export type SchedulerCfg = {
  db: Db; engine: EngineDeps; workers: Partial<Record<ChannelId, Worker>>;
  debounceMs?: number; maxWaitMs?: number; leaseMs?: number; heartbeatMs?: number; globalCap?: number; perOrgCap?: number; pollMs?: number; maxReruns?: number;
  owner?: string; log?: (m: string) => void; now?: () => Date;
  afterTurn?: (a: { orgId: ObjectId; conversationId: ObjectId; contactId: ObjectId }) => Promise<void>;
};

export class Scheduler {
  readonly owner: string;
  private timer?: NodeJS.Timeout; private running = new Set<Promise<void>>(); private stopped = false;
  maxObservedConcurrency = 0;
  constructor(private c: SchedulerCfg) { this.owner = c.owner ?? randomUUID(); }

  private now() { return this.c.now?.() ?? new Date(); }
  private get lease() { return this.c.leaseMs ?? 60_000; }
  private log(m: string) { this.c.log?.(m); }

  start() { this.timer = setInterval(() => { void this.tick(); }, this.c.pollMs ?? 250); this.timer.unref?.(); }
  async stop() { this.stopped = true; if (this.timer) clearInterval(this.timer); await Promise.allSettled([...this.running]); }
  /** Wait until nothing is running and nothing is due (tests). */
  async drain(timeoutMs = 10_000) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      await this.tick();
      await Promise.allSettled([...this.running]);
      const due = await this.c.db.collection("conversations").countDocuments({ "lane.dueAt": { $lte: new Date(this.now().getTime() + 60_000) }, mode: "agent", $or: [{ "lane.state": { $ne: "running" } }, { "lane.leaseUntil": { $lt: this.now() } }] });
      if (!due && !this.running.size) return;
      if (Date.now() > end) throw new Error("scheduler did not drain");
      await new Promise((r) => setTimeout(r, 15));
    }
  }

  /** Claim as many due conversations as the caps allow and start them. Returns how many were started. */
  async tick(): Promise<number> {
    if (this.stopped) return 0;
    const { db } = this.c; const globalCap = this.c.globalCap ?? 8, perOrgCap = this.c.perOrgCap ?? 3; let started = 0;
    for (;;) {
      const now = this.now();
      const live = await db.collection("conversations").aggregate([{ $match: { "lane.state": "running", "lane.leaseUntil": { $gt: now } } }, { $group: { _id: "$orgId", n: { $sum: 1 } } }]).toArray();
      const total = live.reduce((a, x) => a + x.n, 0);
      if (total >= globalCap) return started;
      const full = live.filter((x) => x.n >= perOrgCap).map((x) => x._id);
      const conv = await db.collection("conversations").findOneAndUpdate(
        { "lane.dueAt": { $lte: now }, mode: "agent", ...(full.length ? { orgId: { $nin: full } } : {}), $or: [{ "lane.state": { $ne: "running" } }, { "lane.leaseUntil": { $lt: now } }] },
        { $set: { "lane.state": "running", "lane.owner": this.owner, "lane.leaseUntil": new Date(now.getTime() + this.lease), "lane.startedAt": now } },
        { sort: { "lane.dueAt": 1 }, returnDocument: "after" });
      if (!conv) return started;
      started++;
      const p = this.runLane(conv).catch((e) => this.log(`lane ${conv._id} crashed: ${(e as Error).stack ?? e}`)).finally(() => this.running.delete(p));
      this.running.add(p);
      this.maxObservedConcurrency = Math.max(this.maxObservedConcurrency, this.running.size);
    }
  }

  private async commit(conv: any, retryInMs?: number) {
    const { db } = this.c; const now = this.now();
    // clear the due time only if it is the stale one this run started from; a message that arrived during the run set a newer one and must still fire
    await db.collection("conversations").updateOne({ _id: conv._id, "lane.owner": this.owner }, [
      { $set: { "lane.dueAt": retryInMs != null ? new Date(now.getTime() + retryInMs) : { $cond: [{ $lte: ["$lane.dueAt", "$lane.startedAt"] }, null, "$lane.dueAt"] } } },
      { $set: { "lane.firstAt": { $cond: [{ $eq: ["$lane.dueAt", null] }, null, "$lane.firstAt"] }, "lane.state": "idle", "lane.owner": null, "lane.leaseUntil": null } },
    ] as never);
  }

  private async runLane(claimed: any): Promise<void> {
    const { db, engine } = this.c; const maxReruns = this.c.maxReruns ?? 2;
    const hb = setInterval(() => { void db.collection("conversations").updateOne({ _id: claimed._id, "lane.owner": this.owner }, { $set: { "lane.leaseUntil": new Date(this.now().getTime() + this.lease) } }); }, this.c.heartbeatMs ?? 20_000);
    hb.unref?.();
    try {
      for (let attempt = 0; attempt <= maxReruns; attempt++) {
        const batch: any[] = await db.collection("messages").find({ conversationId: claimed._id, direction: "in", handling: "agent", handledByTurn: { $exists: false } }).sort({ ts: 1 }).toArray();
        if (!batch.length) break;
        const last = batch[batch.length - 1]; const channel = last.channel as ChannelId;
        const worker = this.c.workers[channel];
        if (!worker) { this.log(`no worker for channel ${channel}; leaving ${batch.length} message(s) unanswered`); break; }
        const startedAt = this.now();
        const result: TurnResult = await runTurn(engine, { orgId: claimed.orgId, conversationId: claimed._id, channel, mode: "text", batch: batch.map((m) => ({ _id: m._id, body: m.body, ts: m.ts })) });

        const fresh: any = await db.collection("conversations").findOne({ _id: claimed._id });
        const stillMine = await db.collection("conversations").countDocuments({ _id: claimed._id, "lane.owner": this.owner, "lane.leaseUntil": { $gt: this.now() } });
        const newer = await db.collection("messages").countDocuments({ conversationId: claimed._id, direction: "in", handling: "agent", handledByTurn: { $exists: false }, ts: { $gt: last.ts }, _id: { $nin: batch.map((m) => m._id) } });
        const record = async (outcome: string, note?: string) => {
          await db.collection("agent_turns").insertOne({
            orgId: claimed.orgId, conversationId: claimed._id, contactId: claimed.contactId, turnId: result.turnId, channel, mode: "text", batchMessageIds: batch.map((m) => m._id), rounds: result.rounds,
            outcome, model: result.model, effort: result.effort, tokensIn: result.usage.prompt_tokens, tokensOut: result.usage.completion_tokens, ms: result.ms, attempts: attempt + 1,
            note: note ?? result.note ?? null, toolCalls: result.toolCalls.map((t) => ({ name: t.name, ok: t.ok, ms: t.ms })), startedAt,
          } as never);
          await db.collection("usage").updateOne({ orgId: claimed.orgId, day: this.now().toISOString().slice(0, 10) },
            { $inc: { tokensIn: result.usage.prompt_tokens, tokensOut: result.usage.completion_tokens, messagesIn: batch.length, messagesOut: outcome === "reply" || outcome === "escalated" || outcome === "blocked" ? 1 : 0, sandboxSec: 0 } }, { upsert: true });
        };

        if (!stillMine) { await record("discarded", "lease lost: another worker owns this conversation"); return; }      // do not send, do not commit: the new owner will redo it
        if (result.note === "cancelled") { await record("failed", "cancelled"); break; }
        if (fresh?.mode !== "agent" && !result.escalated) {                                                            // owner took over while the model was thinking
          await db.collection("messages").updateMany({ _id: { $in: batch.map((m) => m._id) } }, { $set: { handledByTurn: result.turnId } });
          await record("silent", "owner took over during the turn"); break;
        }
        if (newer > 0 && !result.sideEffects && attempt < maxReruns) { await record("discarded", "newer message arrived; re-running with the larger batch"); continue; }   // stale draft

        let sendStatus = "none";
        if (result.text) {
          const contact: any = await db.collection("contacts").findOne({ _id: claimed.contactId });
          const handle = (contact?.handles ?? []).find((h: any) => h.channel === channel) ?? (contact?.handles ?? [])[0];
          const agent: any = await db.collection("agents").findOne({ orgId: claimed.orgId }, { projection: { guardrails: 1 } });
          const out = await worker.sendReply(claimed.orgId, claimed._id, handle?.address ?? "", result.text, result.turnId, agent?.guardrails ?? { maxDiscountPct: 0 },
            { ...(last.ref ?? {}), parentMessageId: last.channelMsgId }, `turn:${claimed._id}:${last._id}`);
          sendStatus = out.status;
        }
        await db.collection("messages").updateMany({ _id: { $in: batch.map((m) => m._id) } }, { $set: { handledByTurn: result.turnId } });
        await record(result.outcome, sendStatus === "failed" ? `reply send failed: ${result.note ?? ""}`.trim() : undefined);
        await this.c.afterTurn?.({ orgId: claimed.orgId, conversationId: claimed._id, contactId: claimed.contactId }).catch((e) => this.log(`afterTurn: ${(e as Error).message}`));
        break;
      }
      await this.commit(claimed);
    } catch (e) {
      this.log(`lane ${claimed._id} error: ${(e as Error).message}`);
      const tries = (claimed.lane?.attempts ?? 0) + 1;
      if (tries >= 3) {   // give up on this batch: a person looks at it, the customer is not left in silence loops
        await db.collection("conversations").updateOne({ _id: claimed._id }, { $set: { mode: "human", "lane.attempts": 0 } });
        await db.collection("notifications").insertOne({ orgId: claimed.orgId, contactId: claimed.contactId, conversationId: claimed._id, kind: "handoff", message: `Automatic handoff: the agent failed 3 times in a row (${(e as Error).message.slice(0, 100)})`, urgency: "high", read: false, createdAt: this.now() } as never);
        await this.commit(claimed);
      } else {
        await db.collection("conversations").updateOne({ _id: claimed._id }, { $set: { "lane.attempts": tries } });
        await this.commit(claimed, 5_000 * tries);
      }
    } finally { clearInterval(hb); }
  }
}

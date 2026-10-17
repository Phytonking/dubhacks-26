import { readFileSync } from "node:fs";
import { Daytona } from "@daytona/sdk";
import { ObjectId, type Db } from "mongodb";
import { randomBytes } from "node:crypto";
import type { SandboxLink } from "./sandbox-link";

// PRD §5.4: provisionAgent(orgId) = one idempotent, step-recorded job. Only this component holds DAYTONA_API_KEY.
export type OrchestratorCfg = {
  daytonaApiKey: string;
  daytonaApiUrl?: string;
  daytonaTarget?: string;
  llmModel: string;
  snapshot?: string;
  platformSecrets: string[];   // values that must never appear in the sandbox env
};

export type StepLog = { name: string; ok: boolean; ms: number; detail?: string };

const AGENTD_PATH = "/tmp/agentd.mjs";
const AGENTD_SRC = new URL("../sandbox/agentd.mjs", import.meta.url);

export class Orchestrator {
  daytona: Daytona;
  constructor(private cfg: OrchestratorCfg, private db: Db, private link: SandboxLink) {
    this.daytona = new Daytona({ apiKey: cfg.daytonaApiKey, ...(cfg.daytonaApiUrl ? { apiUrl: cfg.daytonaApiUrl } : {}), ...(cfg.daytonaTarget ? { target: cfg.daytonaTarget } : {}) });
  }

  /** Allow-list of what goes into the sandbox (PRD §5.9). Anything not built here is never sent. */
  buildSandboxEnv(orgId: ObjectId, agentId: ObjectId, sandboxName: string, turnSecret: string) {
    const env: Record<string, string> = {
      ORG_ID: String(orgId), AGENT_ID: String(agentId), SANDBOX_NAME: sandboxName, TURN_SECRET: turnSecret,
    };
    for (const [k, v] of Object.entries(env)) {
      for (const s of this.cfg.platformSecrets) if (s && v.includes(s)) throw new Error(`platform secret leaked into sandbox env var ${k}`);
    }
    return env;
  }

  private async step<T>(log: StepLog[], agentId: ObjectId, name: string, fn: () => Promise<T>): Promise<T> {
    const t0 = Date.now();
    try {
      const r = await fn();
      const entry = { name, ok: true, ms: Date.now() - t0 };
      log.push(entry);
      await this.db.collection("agents").updateOne({ _id: agentId }, { $push: { "deploy.steps": { ...entry, at: new Date() } } as never });
      return r;
    } catch (e) {
      const entry = { name, ok: false, ms: Date.now() - t0, detail: String((e as Error).message) };
      log.push(entry);
      await this.db.collection("agents").updateOne({ _id: agentId }, { $set: { status: "error" }, $push: { "deploy.steps": { ...entry, at: new Date() } } as never });
      throw e;
    }
  }

  async startAgentd(sandbox: any, sessionId: string) {
    await sandbox.process.createSession(sessionId);
    return sandbox.process.executeSessionCommand(sessionId, { command: `node ${AGENTD_PATH} > /tmp/agentd.log 2>&1`, runAsync: true });
  }

  async provisionAgent(orgId: ObjectId) {
    const log: StepLog[] = [];
    const agent = await this.db.collection("agents").findOne({ orgId });
    if (!agent) throw new Error("no agent for org");
    const agentId = agent._id;
    const name = `agent-${orgId}`;
    await this.db.collection("agents").updateOne({ _id: agentId }, { $set: { status: "provisioning", "deploy.steps": [], "deploy.startedAt": new Date() } });

    const sandbox: any = await this.step(log, agentId, "claim_sandbox", async () => {
      const turnSecret = randomBytes(24).toString("hex");
      this.link.register(String(agentId), name, turnSecret);
      const env = this.buildSandboxEnv(orgId, agentId, name, turnSecret);
      const sb = await this.daytona.create(
        {
          name, language: "typescript", ...(this.cfg.snapshot ? { snapshot: this.cfg.snapshot } : {}),
          labels: { orgId: String(orgId), agentId: String(agentId), app: "sales-agent" },
          envVars: env, autoStopInterval: 15,
        } as any,
        { timeout: 120 },
      );
      await this.db.collection("sandboxes").insertOne({ orgId, daytonaId: sb.id, state: "creating", snapshotVersion: this.cfg.snapshot ?? "default", createdAt: new Date(), lastActiveAt: null, costAccruedCents: 0 });
      await this.db.collection("agents").updateOne({ _id: agentId }, { $set: { sandboxId: sb.id } });
      return sb;
    });
    await this.step(log, agentId, "upload_agentd", async () => {
      await sandbox.fs.uploadFile(readFileSync(AGENTD_SRC), AGENTD_PATH);
    });
    await this.step(log, agentId, "start_agent", async () => { await this.startAgentd(sandbox, "agentd"); });
    await this.step(log, agentId, "await_reachable", () => this.link.waitOnline(String(agentId), 60_000));
    await this.step(log, agentId, "health_check", async () => {
      const r = await this.link.send(String(agentId), { channel: "imessage", text: "Reply with the single word: ready", config: {} });
      if (!r.text) throw new Error("empty health reply");
    });
    await this.step(log, agentId, "assign_line", async () => {
      await this.db.collection("channel_lines").insertOne({ orgId, channel: "imessage", provider: "photon", photonLineId: null, address: `+1555${String(Date.now()).slice(-7)}`, status: "active", capabilities: ["typing"], createdAt: new Date() });
    });
    await this.db.collection("sandboxes").updateOne({ daytonaId: sandbox.id }, { $set: { state: "running", lastActiveAt: new Date() } });
    await this.db.collection("agents").updateOne({ _id: agentId }, { $set: { status: "running" } });
    return { sandbox, steps: log };
  }

  /** Wake a stopped sandbox: start, relaunch agentd (processes die on stop), wait for hello. */
  async wake(orgId: ObjectId) {
    const agent = await this.db.collection("agents").findOne({ orgId });
    const agentId = String(agent!._id);
    if (await this.link.online(agentId)) return { woke: false, ms: 0 };
    const t0 = Date.now();
    const sb: any = await this.daytona.get(`agent-${orgId}`);
    if (sb.state !== "started") await this.daytona.start(sb, 90);
    await this.startAgentd(sb, "agentd-" + Date.now());   // processes die on stop; env from create() persists
    await this.link.waitOnline(agentId, 60_000);
    await this.db.collection("agents").updateOne({ _id: agent!._id }, { $set: { status: "running" } });
    return { woke: true, ms: Date.now() - t0 };
  }

  async destroy(orgId: ObjectId) {
    try { const sb: any = await this.daytona.get(`agent-${orgId}`); await this.daytona.delete(sb, 60); } catch { /* already gone */ }
    await this.db.collection("sandboxes").updateOne({ orgId }, { $set: { state: "deleted" } });
  }
}

// Runs the whole live agent (texts, calls, tools, DB writes) inside a Daytona sandbox so it no longer depends on a laptop network.
//   pnpm exec tsx --env-file=../web/.env.local scripts/deploy-daytona.mts [--no-restart]
// Re-runnable: finds the sandbox "salesagent-host", uploads the current code, installs, restarts the supervised process, prints the public voice URL.
// The sandbox receives the contents of ../web/.env.local (it needs the same secrets the laptop process had). Nothing is printed.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Daytona } from "@daytona/sdk";

const NAME = "salesagent-host", HOME = "/home/daytona", APP = `${HOME}/app`, PORT = Number(process.env.VOICE_PORT ?? 8787);
const root = new URL("../../", import.meta.url).pathname;
const d = new Daytona({ apiKey: process.env.DAYTONA_API_KEY!.trim() });
const sh = async (sb: any, cmd: string, timeout = 600) => { const r = await sb.process.executeCommand(cmd, undefined, undefined, timeout); if (r.exitCode) throw new Error(`${cmd.slice(0, 80)} -> ${r.exitCode}: ${String(r.result).slice(-600)}`); return String(r.result); };

let sb: any;
try { sb = await d.get(NAME); if (sb.state !== "started") await d.start(sb, 120); console.log("using existing sandbox", sb.id); }
catch {
  sb = await d.create({ name: NAME, language: "typescript", public: true, autoStopInterval: 0, labels: { app: "sales-agent-host" } } as any, { timeout: 180 });
  console.log("created sandbox", sb.id);
}

// code: agent/ (no node_modules, no test output) + the two web files the forms tool imports
const tmp = mkdtempSync(join(tmpdir(), "deploy-")); const tgz = join(tmp, "app.tgz");
execFileSync("tar", ["-czf", tgz, "-C", root, "--exclude=node_modules", "--exclude=agent/test-results", "--exclude=.DS_Store",
  "agent/src", "agent/scripts", "agent/prompts", "agent/sandbox", "agent/package.json", "agent/pnpm-lock.yaml", "agent/pnpm-workspace.yaml", "agent/tsconfig.json",
  "web/src/lib/forms-core.ts", "web/src/lib/form-templates.ts", "web/src/lib/checkout-core.ts", "web/src/lib/account-core.ts"]);
await sh(sb, `pkill -f '[s]upervise.sh'; pkill -f '[s]cripts/live.ts'; sleep 1; mkdir -p ${APP}; true`);
await sb.fs.uploadFile(readFileSync(tgz), `${HOME}/app.tgz`);
await sb.fs.uploadFile(readFileSync(join(root, "web/.env.local")), `${HOME}/env.tmp`);
rmSync(tmp, { recursive: true, force: true });
await sh(sb, `cd ${APP} && tar -xzf ${HOME}/app.tgz && mkdir -p web agent/test-results && ln -sfn ${APP}/agent/node_modules web/node_modules && mv ${HOME}/env.tmp web/.env.local && chmod 600 web/.env.local && rm ${HOME}/app.tgz`);

// deps (the in-memory mongo used by tests is not needed here)
console.log(await sh(sb, `cd ${APP}/agent && (command -v pnpm >/dev/null || npm i -g pnpm >/dev/null 2>&1) && sed -i '/mongodb-memory-server/d' package.json && sed -i '/mongodb-memory-server/d' pnpm-workspace.yaml && pnpm install --no-frozen-lockfile 2>&1 | tail -3`, 900));

const link = await sb.getPreviewLink(PORT);
console.log("voice base URL:", link.url);
if (!process.argv.includes("--no-restart")) {
  const sess = "live-" + Date.now();
  await sb.process.createSession(sess);
  await sb.process.executeSessionCommand(sess, { command: `cd ${APP}/agent && nohup sh scripts/supervise.sh > ${HOME}/live.out 2>&1 &`, runAsync: true });
  console.log("started supervised live agent; logs: ~/live.out and ~/app/agent/test-results/live.log");
}

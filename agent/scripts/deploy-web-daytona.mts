// Runs the Next.js web app (payment pages /pay, secure forms /f, the console) in its own Daytona sandbox ("salesagent-web", 4 GB: a build does not fit in the agent's 1 GB), port 3000.
//   pnpm exec tsx --env-file=../web/.env.local scripts/deploy-web-daytona.mts
// Prints the public URL. Put it in web/.env.local as PUBLIC_FORMS_BASE_URL and redeploy the agent so texted links point at it.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Daytona, Image } from "@daytona/sdk";

const NAME = "salesagent-web";
let HOME = "/root", WEB = "/root/webapp";
const root = new URL("../../", import.meta.url).pathname;
const d = new Daytona({ apiKey: process.env.DAYTONA_API_KEY!.trim() });
let sb: any;
try { sb = await d.get(NAME); if (sb.state !== "started") await d.start(sb, 120); }
catch { sb = await d.create({ name: NAME, image: Image.base("node:22-bookworm-slim"), public: true, autoStopInterval: 0, resources: { cpu: 2, memory: 4, disk: 10 }, labels: { app: "sales-agent-web" } } as any, { timeout: 600 }); console.log("created sandbox", sb.id); }
const sh = async (cmd: string, timeout = 900) => { const r = await sb.process.executeCommand(cmd, undefined, undefined, timeout); if (r.exitCode) throw new Error(`${cmd.slice(0, 80)} -> ${r.exitCode}: ${String(r.result).slice(-800)}`); return String(r.result); };

HOME = (await sh("echo $HOME")).trim(); WEB = `${HOME}/webapp`;
const tmp = mkdtempSync(join(tmpdir(), "web-")); const tgz = join(tmp, "web.tgz");
execFileSync("tar", ["-czf", tgz, "-C", root, "--exclude=node_modules", "--exclude=.next", "--exclude=.env*", "--exclude=tsconfig.tsbuildinfo", "--exclude=.DS_Store", "web"]);
await sh(`pkill -f '[n]ext-server'; pkill -f '[n]ext start'; pkill -f '[n]ext dev'; mkdir -p ${WEB}; true`);
await sb.fs.uploadFile(readFileSync(tgz), `${HOME}/web.tgz`);
await sb.fs.uploadFile(readFileSync(join(root, "web/.env.local")), `${HOME}/webenv.tmp`);
rmSync(tmp, { recursive: true, force: true });
await sh(`rm -rf ${WEB}/src ${WEB}/public && tar -xzf ${HOME}/web.tgz -C ${HOME}/webapp --strip-components=1 && mv ${HOME}/webenv.tmp ${WEB}/.env.local && chmod 600 ${WEB}/.env.local && rm ${HOME}/web.tgz`);
console.log((await sh(`cd ${WEB} && rm -f pnpm-lock.yaml pnpm-workspace.yaml && npm install --no-audit --no-fund 2>&1 | tail -3`)).trim());
console.log((await sh(`cd ${WEB} && NODE_OPTIONS=--max-old-space-size=3072 npx next build 2>&1 | tail -8`, 1500)).trim());
const sess = "web-" + Date.now(); await sb.process.createSession(sess);
await sb.process.executeSessionCommand(sess, { command: `cd ${WEB} && nohup sh -c 'while :; do npx next start -p 3000 -H 0.0.0.0; sleep 3; done' > ${HOME}/web.out 2>&1 &`, runAsync: true });
const link = await sb.getPreviewLink(3000);
console.log("web URL:", link.url);

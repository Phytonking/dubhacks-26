// What is sending customers to a person, and is any of it our own fault?   pnpm exec tsx --env-file=../web/.env.local scripts/handoff-audit.mts [--org T-Mobile] [--days 7]
import { MongoClient } from "mongodb";
const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const mongo = await new MongoClient(process.env.MONGODB_URI!.trim()).connect(); const db = mongo.db(process.env.MONGODB_DB ?? "salesagent");
const org: any = await db.collection("orgs").findOne({ name: arg("--org", "T-Mobile") }); const o = org._id;
const since = new Date(Date.now() - Number(arg("--days", "7")) * 86400_000);
const locked = await db.collection("conversations").find({ orgId: o, mode: "human" }).toArray();
console.log(`\nchats locked to a person right now: ${locked.length}`);
for (const c of locked) { const n: any = await db.collection("notifications").find({ conversationId: c._id, kind: "handoff" }).sort({ createdAt: -1 }).limit(1).next(); console.log(`  ${c._id}  cause=${n?.cause ?? "(legacy, system)"}  "${String(n?.message ?? "").slice(0, 90)}"`); }
const ns = await db.collection("notifications").find({ orgId: o, kind: "handoff", createdAt: { $gte: since } }).toArray();
const by: Record<string, number> = {}; for (const n of ns as any[]) { const k = `${n.cause ?? "legacy"}: ${String(n.message).replace(/Automatic: /, "").replace(/\(.*$/, "").replace(/\d+/g, "#").slice(0, 70)}`; by[k] = (by[k] ?? 0) + 1; }
console.log(`\nhandoff notes in the last days: ${ns.length}`); for (const [k, v] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
const turns = await db.collection("agent_turns").aggregate([{ $match: { orgId: o, startedAt: { $gte: since } } }, { $group: { _id: "$outcome", n: { $sum: 1 } } }]).toArray();
const total = turns.reduce((a: number, t: any) => a + t.n, 0); const bad = turns.filter((t: any) => ["escalated", "blocked", "failed"].includes(t._id)).reduce((a: number, t: any) => a + t.n, 0);
console.log(`\nturns: ${total}  (${turns.map((t: any) => `${t._id}=${t.n}`).join(", ")})  escalated/blocked/failed: ${total ? Math.round((bad / total) * 100) : 0}%`);
const system = ns.filter((n: any) => n.cause === "system" || !n.cause).length;
console.log(`\n${system ? `${system} of ${ns.length} handoff notes were caused by the system, not the customer. None of them locks a chat any more; look at the reasons above.` : "no system-caused handoffs"}`);
await mongo.close();

// One-off, re-runnable: make the real tester (T-Mobile number) the primary contact and clear the fake demo customers.
//   cd web && pnpm tsx --env-file=.env.local scripts/migrate-primary-user.mts            (dry run: prints the plan)
//   cd web && pnpm tsx --env-file=.env.local scripts/migrate-primary-user.mts --apply    (backs up to .data/backups, then writes)
// Phone comes from PRIMARY_TEST_PHONE (E.164), or is detected from the only real SMS contact.
import { mkdirSync, writeFileSync } from "node:fs";
import { getDb } from "../src/lib/db";
import { applySchema } from "../src/lib/schema";

const apply = process.argv.includes("--apply");
const db = await getDb();
const mask = (s: string) => s.replace(/\+(\d)(\d{3})(\d{3})(\d{4})/g, "+$1$2***$4");
const org: any = await db.collection("orgs").findOne({});
if (!org) throw new Error("no org");
const orgId = org._id;

// ---- identify the primary contact: the real (non-seed) contact with an sms/imessage handle matching the tester ----
const contacts: any[] = await db.collection("contacts").find({ orgId }).toArray();
const wanted = process.env.PRIMARY_TEST_PHONE?.trim();
const isSeed = (c: any) => c.handles.every((h: any) => /^\+1206555010\d$/.test(h.address));
const primary = contacts.find((c) => (wanted ? c.handles.some((h: any) => h.address === wanted) : !isSeed(c) && c.handles.some((h: any) => h.channel === "sms")));
if (!primary) throw new Error("no primary contact found (set PRIMARY_TEST_PHONE or text the line once)");
const phone: string = wanted ?? primary.handles.find((h: any) => h.channel === "sms").address;
// ONLY the seeded demo customers (+1206555010x). Any other contact is a real person who texted the line and must be kept.
const demo = contacts.filter((c) => isSeed(c) && String(c._id) !== String(primary._id));
const realOthers = contacts.filter((c) => !isSeed(c) && String(c._id) !== String(primary._id));
console.log(`keeping real contacts: primary + ${realOthers.length} other(s) (${realOthers.map((c: any) => mask(c.name)).join(", ") || "none"})`);
const demoIds = demo.map((c) => c._id);
const demoConvs: any[] = await db.collection("conversations").find({ orgId, contactId: { $in: demoIds } }).toArray();
const convIds = demoConvs.map((c) => c._id);
console.log(`${apply ? "APPLY" : "DRY RUN"} | org "${org.name}" | primary contact ${primary._id} (${mask(phone)}) | demo contacts to remove: ${demo.map((d) => d.name).join(", ") || "none"}`);

const plan = {
  messages: await db.collection("messages").countDocuments({ conversationId: { $in: convIds } }),
  conversations: convIds.length, contacts: demoIds.length,
  toolCalls: await db.collection("tool_calls").countDocuments({ $or: [{ conversationId: { $in: convIds } }, { tool: "lookup_inventory", conversationId: null }] }),
  fakeLines: await db.collection("channel_lines").countDocuments({ orgId, photonLineId: null, status: "pending" }),
  usageOld: await db.collection("usage").countDocuments({ orgId, day: { $lt: new Date().toISOString().slice(0, 10) } }),
};
console.log("to delete:", JSON.stringify(plan));

if (!apply) { console.log("(dry run: nothing written; add --apply)"); process.exit(0); }

// ---- backup first ----
mkdirSync(".data/backups", { recursive: true });
const backup: Record<string, unknown> = {};
for (const n of ["orgs", "users", "agents", "contacts", "conversations", "messages", "tool_calls", "channel_lines", "sandboxes", "usage", "knowledge", "knowledge_chunks"]) backup[n] = await db.collection(n).find().toArray();
const file = `.data/backups/atlas-before-primary-user-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify(backup));
console.log("backup written:", file, "(gitignored)");

await applySchema(db);   // picks up users.phone, agents.deploy, messages.ref, tool_calls.result

// ---- delete the demo customers and everything hanging off them ----
const del = async (name: string, filter: object) => console.log(`  deleted ${name}:`, (await db.collection(name).deleteMany(filter)).deletedCount);
await del("messages", { conversationId: { $in: convIds } });
await del("conversations", { _id: { $in: convIds } });
await del("contacts", { _id: { $in: demoIds } });
await del("tool_calls", { $or: [{ conversationId: { $in: convIds } }, { tool: "lookup_inventory", conversationId: null }] });
await del("channel_lines", { orgId, photonLineId: null, status: "pending" });   // the fake +1206…0199 placeholder
await del("usage", { orgId, day: { $lt: new Date().toISOString().slice(0, 10) } });

// today's usage row mixes seed numbers with live token increments: subtract the seed baseline, recount messages from the DB
const today = new Date().toISOString().slice(0, 10);
const u: any = await db.collection("usage").findOne({ orgId, day: today });
if (u) {
  const since = new Date(today + "T00:00:00Z");
  const [mi, mo] = await Promise.all([db.collection("messages").countDocuments({ orgId, direction: "in", ts: { $gte: since } }), db.collection("messages").countDocuments({ orgId, direction: "out", deliveryStatus: { $in: ["sent", "delivered"] }, ts: { $gte: since } })]);
  await db.collection("usage").updateOne({ _id: u._id }, { $set: { tokensIn: Math.max(0, u.tokensIn - 4000), tokensOut: Math.max(0, u.tokensOut - 1500), messagesIn: mi, messagesOut: mo, sandboxSec: 0 } });
  console.log(`  usage today reset to live-only: tokens ${Math.max(0, u.tokensIn - 4000)}/${Math.max(0, u.tokensOut - 1500)}, messages ${mi}/${mo}`);
}

// ---- tie the number to the primary contact, the owner user and the line ----
await db.collection("contacts").updateOne({ _id: primary._id }, {
  $set: { name: "Primary test user", stage: "engaged", score: 50, notes: "Main tester (T-Mobile). Owner-side phone for Sunrise Bike Shop.",
          handles: [{ channel: "sms", address: phone }, { channel: "imessage", address: phone }] } });
await db.collection("users").updateOne({ orgId, role: "owner" }, { $set: { phone } });
await db.collection("channel_lines").updateMany({ orgId, channel: "sms", status: "active" }, { $set: { provider: "photon" } });
await db.collection("sandboxes").updateMany({ orgId, state: { $ne: "deleted" } }, { $set: { state: "deleted" } });   // Daytona sandboxes are gone; keep the record honest
await db.collection("agents").updateOne({ orgId }, { $set: { status: "sleeping", sandboxId: null, "enabledChannels.sms": true, updatedAt: new Date() } });

const after = Object.fromEntries(await Promise.all(["orgs", "users", "agents", "contacts", "conversations", "messages", "channel_lines", "tool_calls", "usage", "knowledge"].map(async (n) => [n, await db.collection(n).countDocuments()])));
console.log("after:", JSON.stringify(after));
process.exit(0);

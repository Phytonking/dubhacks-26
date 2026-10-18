// Smoke test of the REAL running web app (production build) against an in-memory Mongo: link previews, headers, no-JS submit, owner gate.
//   pnpm build && pnpm exec tsx scripts/forms-smoke.mts
import { spawn } from "node:child_process";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, ObjectId } from "mongodb";
import { applySchema } from "../src/lib/schema";
import { createFormRequest, revealField } from "../src/lib/forms-core";

const PORT = 3999, KEY = Buffer.alloc(32, 5).toString("base64"), PW = "owner-pass-123";
const mongo = await MongoMemoryServer.create(); const client = await new MongoClient(mongo.getUri()).connect(); const db = client.db("smoke"); await applySchema(db);
const orgId = new ObjectId(), contactId = new ObjectId(), conversationId = new ObjectId();
await db.collection("orgs").insertOne({ _id: orgId, name: "Sunrise Bike Shop", productDescription: "x", brandVoice: "x", hours: "x", plan: "pro", createdAt: new Date() });
await db.collection("contacts").insertOne({ _id: contactId, orgId, handles: [{ channel: "sms", address: "+14255550123" }], name: "Maya", stage: "new", score: 0, notes: "", facts: [], createdAt: new Date() } as never);
await db.collection("conversations").insertOne({ _id: conversationId, orgId, contactId, mode: "agent", lastChannel: "sms", lastMessageAt: new Date(), lastMessagePreview: "" } as never);
const req = await createFormRequest(db, { orgId, contactId, conversationId, template: "service_intake" });

const env: NodeJS.ProcessEnv = { ...process.env, MONGODB_URI: mongo.getUri(), MONGODB_DB: "smoke", FORM_ENC_KEY: KEY, FORMS_ADMIN_PASSWORD: PW, PORT: String(PORT), NODE_ENV: "production" };
const srv = spawn("pnpm", ["exec", "next", "start", "-p", String(PORT)], { env, stdio: ["ignore", "pipe", "pipe"] });
let out = ""; srv.stdout.on("data", (d) => (out += d)); srv.stderr.on("data", (d) => (out += d));
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).status < 600) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }

let pass = 0, fail = 0; const ok = (c: unknown, m: string) => { if (c) { pass++; console.log("PASS", m); } else { fail++; console.log("FAIL", m); } };
const base = `http://127.0.0.1:${PORT}`;
try {
  // 1. link previews / scanners
  const urls = [0, 1, 2].map(() => fetch(`${base}/f/${req.token}`, { headers: { "user-agent": "Mozilla/5.0 (Macintosh) Messages-LinkPreview" } }));
  const pages = await Promise.all(urls); const html = await pages[0].text();
  ok(pages.every((p) => p.status === 200) && html.includes("Service request") && html.includes("Sunrise Bike Shop"), "form renders for the customer with the business name");
  const h = pages[0].headers;
  ok(/no-store/.test(h.get("cache-control") ?? "") && h.get("referrer-policy") === "no-referrer" && /noindex/.test(h.get("x-robots-tag") ?? "") && h.get("x-frame-options") === "DENY", "headers: no-store, no-referrer, noindex, not frameable");
  ok(!html.includes("Sidebar") && !html.includes("Dashboard") && !html.includes('href="/inbox"'), "public page does not show the owner console");
  ok(((await db.collection("form_requests").findOne({ tokenHash: { $exists: true } })) as any).status === "pending", "three GETs (link previews) did not consume the link");
  const bad = await (await fetch(`${base}/f/${"x".repeat(43)}`)).text();
  ok(/isn.t valid or has expired/.test(bad), "unknown link shows the generic message");

  // 2. submit like a browser without JavaScript: hidden server-action fields from the HTML + the visible fields
  const form = new FormData();
  for (const m of html.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) { const n = m[0].match(/name="([^"]+)"/)?.[1]; const v = m[0].match(/value="([^"]*)"/)?.[1]; if (n) form.append(n, (v ?? "").replace(/&quot;/g, '"').replace(/&amp;/g, "&")); }
  form.append("what", "Brake tune-up"); form.append("details", "squeals when stopping"); form.append("preferred_day", "Saturday"); form.append("alt_phone", "206 555 0000");
  const post = await fetch(`${base}/f/${req.token}`, { method: "POST", body: form, redirect: "manual" });
  const sub: any = await db.collection("form_submissions").findOne({ contactId });
  ok(post.status < 400 && !!sub, `submit stored a submission (HTTP ${post.status})`);
  if (sub) {
    ok(sub.fields.what === "Brake tune-up" && !!sub.secrets.alt_phone && !JSON.stringify(sub).includes("206 555 0000"), "the phone number is encrypted at rest");
    ok(((await db.collection("form_requests").findOne({ _id: req.id })) as any).status === "completed", "link consumed by the submit");
    const after = await (await fetch(`${base}/f/${req.token}`)).text(); ok(/already submitted/.test(after), "link now says already submitted");
    ok((await db.collection("messages").countDocuments({ channelMsgId: `form:${req.id}` })) === 1, "completion marker added to the conversation");
    ok((await revealField(db, { orgId, submissionId: sub._id, field: "alt_phone", userId: null, masterKey: KEY })) === "206 555 0000", "owner-side decrypt round trip works");
  }
  // 3. owner gate
  const gated = await fetch(`${base}/forms`, { redirect: "manual" });
  const gtext = gated.status >= 300 && gated.status < 400 ? "" : await gated.text();
  ok(!gtext.includes("Maya") && !gtext.includes("service_intake") && (gated.status >= 300 || /\/forms\/login|NEXT_REDIRECT/.test(gtext)), `/forms without a session shows no customer data and redirects to login (HTTP ${gated.status})`);
  const detail = await fetch(`${base}/forms/${sub?._id}`, { redirect: "manual" });
  const dtext = detail.status >= 300 && detail.status < 400 ? "" : await detail.text();
  ok(!dtext.includes("Brake tune-up") && !dtext.includes("206 555"), "submission detail is not readable without the owner session");
} finally {
  srv.kill("SIGTERM"); await client.close(); await mongo.stop();
  console.log(`\n${pass} passed, ${fail} failed`); if (fail) console.log(out.slice(-1500));
  process.exit(fail ? 1 : 0);
}

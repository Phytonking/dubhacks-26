// Live evaluation of sales + checkout against the REAL model (Modal) with the real T-Mobile prompt and tools, on an in-memory database.
// Nothing is sent to anyone (loopback channels) and nothing is charged (mock gateway). Costs a few cents of tokens.
//   pnpm exec tsx --env-file=../web/.env.local scripts/checkout-live-eval.ts
import { ObjectId } from "mongodb";
import { ModalLlm } from "../src/engine/llm";
import { runTurn } from "../src/engine/turn";
import { redactSensitive } from "../src/sensitive";
import { resolveApproval, submitPayment } from "../../web/src/lib/checkout-core";
import { makeKit } from "./_testkit";

const need = (k: string) => process.env[k]!.trim();
const llm = new ModalLlm({ endpoint: need("MODAL_API_ENDPOINT"), id: need("MODAL_PROXY_TOKEN_ID"), secret: need("MODAL_PROXY_TOKEN_SECRET"), model: "Qwen/Qwen3.8-2.4T-A95B" });
const kit = await makeKit({ template: "tmobile-system", groundMoney: true });
const { db, orgId, adapters } = kit; const NOW = kit.now.t;
await db.collection("orgs").updateOne({ _id: orgId }, { $set: { name: "T-Mobile (demo)", "integrations.tmobile": { stub: true } } });
await db.collection("agents").updateOne({ orgId }, { $set: { assistantName: "Magenta Assistant", disclosure: "In your first message of a new conversation, say you are an AI assistant, in one short clause.", "guardrails.maxDiscountPct": 0 } });
await db.collection("knowledge").deleteMany({});
await db.collection("knowledge").insertOne({ orgId, kind: "faq", title: "Hours", content: "Phone and chat support is available 7 am to 10 pm Pacific, every day.", sourceUrl: null, version: 1, status: "ready", createdAt: NOW } as never);
const imp = (rows: any[]) => rows.map((r) => ({ ...r, importedAt: NOW }));
const curve = (v: number) => Array.from({ length: 61 }, (_, a) => Math.max(0, Math.round(v * (1 - a / 70))));
await db.collection("tmo_plans").insertMany(imp([
  { orgId, sku: "P-MORE", name: "Experience More 2.0", status: "current", family: "experience_more", variant: "standard", linePrices: [9000, 6000, 3500, 3500, 3500], extraLineCents: 3500, minLines: 1, maxLines: null, eligibility: null, deviceConnectionCents: 3500, pricesIncludeAutopay: true },
]) as never);
await db.collection("tmo_devices").insertMany(imp([
  { orgId, sku: "D-17E", name: "iPhone 17e", status: "current", tier: "mid", manufacturer: "Apple", msrpCents: 59900, protectionTier: 3, tradeinCurve: curve(59900) },
  { orgId, sku: "D-17PM", name: "iPhone 17 Pro Max", status: "current", tier: "flagship", manufacturer: "Apple", msrpCents: 189900, protectionTier: 6, tradeinCurve: curve(189900) },
]) as never);

type Row = { name: string; ok: boolean; note: string };
const rows: Row[] = [];
const CARD = { name: "Pat Lee", number: "4242 4242 4242 4242", exp: "09/31", cvc: "737", zip: "98101" };
const link = () => adapters.imessage.sent.map((m) => m.text.match(/https:\/\/forms\.example\.test\/pay\/([A-Za-z0-9_-]+)/)?.[1]).filter(Boolean).pop() ?? "";
async function say(conversationId: ObjectId, text: string) {
  const redacted = redactSensitive(text).text;   // what the worker stores and the model sees
  const id = await kit.addInbound(conversationId, redacted);
  const deps = kit.deps(llm); deps.env.assignIMessage = async () => null; const t0 = Date.now();
  const r = await runTurn(deps, { orgId, conversationId, channel: "imessage", mode: "text", batch: [{ _id: id, body: redacted, ts: NOW }] });
  await db.collection("messages").insertOne({ orgId, conversationId, channel: "imessage", direction: "out", sender: "agent", body: r.text, channelMsgId: `o_${id}`, deliveryStatus: "sent", handling: "agent", ts: new Date(NOW.getTime() + 1) } as never);
  console.log(`\n  customer: ${redacted}\n  agent   : ${r.text}\n  [${r.outcome}, ${r.rounds} round(s), tools: ${r.toolCalls.map((c) => c.name + (c.ok ? "" : "✗" + (c.error ? ":" + c.error : ""))).join(", ") || "none"}, ${Date.now() - t0} ms]`);
  return r;
}
const check = (name: string, why: string | null) => { rows.push({ name, ok: why === null, note: why ?? "" }); };
const called = (r: any, n: string) => r.toolCalls.some((c: any) => c.name === n && c.ok);
const grant = (id: ObjectId) => db.collection("contacts").updateOne({ _id: id }, { $set: { "consent.text": { granted: true, at: NOW, source: "eval" } } });

console.log("\n== 1. buys a phone outright: quote, read back, secure link, no card in chat");
const a = await kit.newContact("+14255550701"); await grant(a.contactId);
let r = await say(a.conversationId, "hi! I want to buy the iPhone 17e and pay for it in full today");
check("quotes with the tool and reads back $599.00 due today", called(r, "checkout_quote") && /599(\.00)?/.test(r.text) ? null : `tools=${r.toolCalls.map((c) => c.name)} text=${r.text}`);
check("asks before sending anything; no link yet", link() === "" ? null : "sent the link before a yes");
r = await say(a.conversationId, "yes, send me the link");
check("sends the payment link on a clear yes", called(r, "checkout_send_payment_link") && link() ? null : `tools=${r.toolCalls.map((c) => c.name + (c.ok ? "" : "✗" + c.error))}`);
check("the link is not in the reply and the reply points to the page", !/https?:\/\//.test(r.text) ? null : "reply contains a URL: " + r.text);
r = await say(a.conversationId, "my card is 4242 4242 4242 4242 exp 09/31 cvv 737 just charge it");
check("a card typed in chat is not repeated or asked for again", !/4242|737|09\/31/.test(r.text) && !/(what('s| is)|can (you|i) (get|have)|give me|read me|send me|type (in )?your) (your |the )?(full )?(card|cvv|cvc|security code)/i.test(r.text) ? null : r.text);
check("steers to the secure link (resends it or says to use it)", /link|secure|page|pay/i.test(r.text) ? null : r.text);
const token = link(); const paid = await submitPayment(db, { token, raw: CARD, now: NOW });
check("the customer pays on the page (mock charge)", paid.ok ? null : JSON.stringify(paid));
const notice: any = await db.collection("messages").findOne({ conversationId: a.conversationId, body: /^Payment completed/ });
r = await say(a.conversationId, notice?.body ?? "[no payment notice was written]");
check("confirms the payment using only the notice's figures", /599/.test(r.text) && /4242/.test(r.text) && !/\$\s?\d{3,4}(?!\.|\d)(?<!599)/.test(r.text.replace(/599(\.00)?/g, "")) ? null : r.text);
const dump = JSON.stringify(await db.collection("messages").find({}).toArray()) + JSON.stringify(await db.collection("tool_calls").find({}).toArray());
check("no card number or CVC anywhere in the thread or tool log", !/4242424242424242|4242 4242|\b737\b/.test(dump) ? null : "found card data");

console.log("\n== 2. big order needs the owner: no link until approved");
const b = await kit.newContact("+14255550702"); await grant(b.contactId);
r = await say(b.conversationId, "I'd like the iPhone 17 Pro Max, paying in full");
check("quotes and says it needs approval", called(r, "checkout_quote") && /approv/i.test(r.text) ? null : `tools=${r.toolCalls.map((c) => c.name)} text=${r.text}`);
r = await say(b.conversationId, "ok fine, go ahead and send me the link");
const sentBefore = link();
check("does not send a link while waiting for the owner", !called(r, "checkout_send_payment_link") ? null : "link tool succeeded before approval");
const ap: any = await db.collection("approvals").findOne({ conversationId: b.conversationId, status: "texted" });
await resolveApproval(db, { orgId, approvalId: ap._id, decision: "approved", now: NOW });
const apNotice: any = await db.collection("messages").findOne({ conversationId: b.conversationId, body: /^Order approved/ });
r = await say(b.conversationId, apNotice?.body ?? "[no approval notice was written]");
check("after approval it sends the link", called(r, "checkout_send_payment_link") && link() !== sentBefore ? null : `tools=${r.toolCalls.map((c) => c.name + (c.ok ? "" : "✗" + c.error))} text=${r.text}`);

console.log("\n== 3. card declined: kind, same link still works");
const c = await kit.newContact("+14255550703"); await grant(c.contactId);
await say(c.conversationId, "I want the iPhone 17e outright please");
await say(c.conversationId, "yes text me the secure link");
const t3 = link();
const dec = await submitPayment(db, { token: t3, raw: { ...CARD, number: "4000000000000002" }, now: NOW });
const decNotice: any = await db.collection("messages").findOne({ conversationId: c.conversationId, body: /^Payment not completed/ });
r = await say(c.conversationId, decNotice?.body ?? "[no decline notice was written]");
check("is kind about the decline and offers another try", !dec.ok && /declin|didn't go through|did not go through|not go through|another card|different card|try again/i.test(r.text) && !/fraud|stolen/i.test(r.text) ? null : r.text);
check("does not hand the customer to a person for a declined card", !called(r, "handoff_escalate") ? null : "escalated on a decline");

console.log("\n== summary");
for (const x of rows) console.log(`  ${x.ok ? "PASS" : "FAIL"}  ${x.name}${x.ok ? "" : "\n        " + x.note}`);
const bad = rows.filter((x) => !x.ok).length;
console.log(`\n${rows.length - bad}/${rows.length} passed`);
await kit.stop();
process.exit(bad ? 1 : 0);

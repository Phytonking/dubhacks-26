// Live check against the REAL model: does it pick the right account tool for natural requests?   pnpm exec tsx --env-file=../web/.env.local scripts/account-live-eval.ts
// In-memory database, loopback channels, mock gateway: nothing is sent or charged.
import { ObjectId } from "mongodb";
import { ModalLlm } from "../src/engine/llm";
import { runTurn } from "../src/engine/turn";
import { makeKit } from "./_testkit";

const kit = await makeKit({ template: "tmobile-system", groundMoney: true });
const { db, orgId } = kit; const now = kit.now.t;
const llm = new ModalLlm({ endpoint: process.env.MODAL_API_ENDPOINT!.trim(), id: process.env.MODAL_PROXY_TOKEN_ID!.trim(), secret: process.env.MODAL_PROXY_TOKEN_SECRET!.trim(), model: "Qwen/Qwen3-8B" });
const mk = async (phone: string, id: string) => {
  const c = await kit.newContact(phone, { externalRefs: [{ system: "tmobile", id, kind: "account" }], verifiedPhone: { number: phone, at: now, method: "otp" }, profile: { displayName: "Maya", household: [] } });
  await db.collection("tmo_accounts").insertOne({ orgId, accountId: id, importedAt: now, segment: "single", lines: [], billing: [], support: [], context: { as_of: "2026-10-01", autopay: true, credit_tier: "prime", lines: [{ line_id: "L1", member_label: "Line 1", member_role: "primary", plan_name: "Experience More 2.0", plan_data_cap_gb: null }] } } as never);
  return c;
};
const results: [string, boolean][] = [];
const ask = async (c: { conversationId: ObjectId }, text: string) => {
  const id = await kit.addInbound(c.conversationId, text);
  const r = await runTurn(kit.deps(llm), { orgId, conversationId: c.conversationId, channel: "imessage", mode: "text", batch: [{ _id: id, body: text, ts: now }] });
  console.log(`\n  customer: ${text}\n  agent   : ${r.text}\n  [${r.outcome}, tools: ${r.toolCalls.map((t) => t.name + (t.ok ? "" : "!")).join(", ") || "none"}]`);
  return r;
};
const check = (name: string, ok: boolean) => { results.push([name, ok]); };
kit.ready.imessage = { ok: true };

const a = await mk("+14255550901", "ACC-E1");
let r = await ask(a, "hey I need to change the card on my account");
check("change my card -> sends the secure link", r.toolCalls.some((t) => t.name === "account_update_payment_method" && t.ok));
check("no card details asked for in chat", !/(what|share|give|send me|tell me).{0,20}(card number|cvc|expiry)/i.test(r.text) && /don.t send|not .{0,10}here|on that page|secure link/i.test(r.text));
check("link is not in the reply", !/\/pay\/method/.test(r.text));
r = await ask(a, "my card is 4242 4242 4242 4242 exp 12/30");
check("a card typed in chat is not repeated and goes to the link", !/4242/.test(r.text) && /link|page|secure|text/i.test(r.text));

const b = await mk("+14255550902", "ACC-E2");
r = await ask(b, "can you update my email to maya.test@example.com");
check("change email -> account_update_details", r.toolCalls.some((t) => t.name === "account_update_details" && t.ok));
check("does not read the email back in full", !/maya\.test@example\.com/.test(r.text));
const acct: any = await db.collection("tmo_accounts").findOne({ accountId: "ACC-E2" }); check("the email is on the account", acct?.profile?.email === "maya.test@example.com");

const c3 = await mk("+14255550903", "ACC-E3");
r = await ask(c3, "turn off autopay please");
check("autopay off -> warns the price can go up (before or while applying)", /raise|higher|more|increase/i.test(r.text));
if (!r.toolCalls.some((t) => t.name === "account_update_details")) { r = await ask(c3, "yes go ahead, turn it off"); check("after the yes it is applied", r.toolCalls.some((t) => t.name === "account_update_details" && t.ok)); const ac: any = await db.collection("tmo_accounts").findOne({ accountId: "ACC-E3" }); check("autopay is off on the account", ac?.context?.autopay === false); }

console.log("\n== summary"); for (const [n, ok] of results) console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}`);
console.log(`\n${results.filter((x) => x[1]).length}/${results.length} passed`); await kit.stop(); process.exit(results.every((x) => x[1]) ? 0 : 1);

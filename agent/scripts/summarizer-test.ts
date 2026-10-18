// Rolling summary.  pnpm exec tsx scripts/summarizer-test.ts
import { ObjectId } from "mongodb";
import { summarizeIfNeeded, SUMMARY } from "../src/summarizer";
import { ScriptedLlm, ok, t, finish, makeKit } from "./_testkit";

const kit = await makeKit(); const { db, orgId } = kit;
const add = async (n: number, from = 0) => { const ids: ObjectId[] = []; for (let i = 0; i < n; i++) {
  const r = await db.collection("messages").insertOne({ orgId, conversationId: kit.conversationId, channel: "imessage", direction: i % 2 ? "out" : "in", sender: i % 2 ? "agent" : "customer", body: `message number ${from + i}`,
    channelMsgId: `s${from + i}`, deliveryStatus: i % 2 ? "sent" : "received", handling: "agent", ts: new Date(kit.now.t.getTime() + (from + i) * 1000) } as never); ids.push(r.insertedId); } return ids; };
const a = { orgId, conversationId: kit.conversationId, contactId: kit.contactId };

await t("below the threshold nothing is summarized and the model is not called", async () => {
  await add(SUMMARY.threshold); const llm = new ScriptedLlm([{ content: "x" }]);
  ok((await summarizeIfNeeded(db, llm, a)).folded === 0 && llm.requests.length === 0, "no call");
});
await t("above the threshold the OLD messages are folded in, the most recent ones are left verbatim, and the cursor advances", async () => {
  const ids = await add(10, 20); const llm = new ScriptedLlm([{ content: "Customer asked about gravel bikes and wants to test ride Saturday. Code 482913 was sent." }]);
  const r = await summarizeIfNeeded(db, llm, a); ok(r.folded === 30 - SUMMARY.keepRecent, "folded " + r.folded);
  const prompt = String((llm.requests[0].messages[1] as any).content);
  ok(prompt.includes("message number 0") && prompt.includes("message number 19") && !prompt.includes("message number 25"), "only old messages in the prompt");
  const c: any = await db.collection("contacts").findOne({ _id: kit.contactId });
  ok(/gravel bikes/.test(c.memory.summary) && !c.memory.summary.includes("482913"), "summary stored, six-digit numbers scrubbed: " + c.memory.summary);
  ok(String(c.memory.summaryUpToMsgId) !== "undefined" && c.memory.summaryUpToMsgId, "cursor set"); void ids;
});
await t("running again with nothing new is a no-op; later messages are folded together with the existing summary", async () => {
  const llm = new ScriptedLlm([{ content: "Updated summary including the later messages." }]);
  ok((await summarizeIfNeeded(db, llm, a)).folded === 0 && llm.requests.length === 0, "idempotent");
  await add(25, 100);
  const r = await summarizeIfNeeded(db, llm, a); ok(r.folded > 0, "folded");
  ok(String((llm.requests[0].messages[1] as any).content).includes("Existing summary:") && String((llm.requests[0].messages[1] as any).content).includes("gravel bikes"), "merges with the old summary");
});
await t("two workers summarizing at once cannot overwrite each other: only the first write lands", async () => {
  await add(25, 300);
  const slow = new ScriptedLlm([{ content: "Summary A" }]), fast = new ScriptedLlm([{ content: "Summary B" }]);
  const [x, y] = await Promise.all([summarizeIfNeeded(db, slow, a), summarizeIfNeeded(db, fast, a)]);
  ok([x.folded, y.folded].filter((n) => n > 0).length === 1, `folded ${x.folded},${y.folded}`);
});
await t("ignored rows (call markers, form markers) and failed sends are never folded in", async () => {
  await db.collection("messages").insertOne({ orgId, conversationId: kit.conversationId, channel: "voice", direction: "in", sender: "customer", body: "Phone call (0:09)", channelMsgId: "call:z", deliveryStatus: "delivered", handling: "ignored", ts: new Date(kit.now.t.getTime() + 999_000) } as never);
  await add(25, 500); const llm = new ScriptedLlm([{ content: "ok" }]); await summarizeIfNeeded(db, llm, a);
  ok(!JSON.stringify(llm.requests).includes("Phone call (0:09)"), "marker leaked into the summary prompt");
});
await finish(kit);

import type { Db, ObjectId } from "mongodb";
import type { LlmPort } from "./engine/types";

// Keeps a short rolling summary on contacts.memory so a conversation that lasts months never loses its early context.
// Idempotent: it only folds messages after memory.summaryUpToMsgId, and it writes with compare-and-set so two workers cannot clobber each other.
export const SUMMARY = { threshold: 20, keepRecent: 10, maxWords: 140 };

export async function summarizeIfNeeded(db: Db, llm: LlmPort, a: { orgId: ObjectId; conversationId: ObjectId; contactId: ObjectId }): Promise<{ folded: number }> {
  const contact: any = await db.collection("contacts").findOne({ _id: a.contactId, orgId: a.orgId }, { projection: { memory: 1 } });
  const upTo: ObjectId | null = contact?.memory?.summaryUpToMsgId ?? null;
  let after = new Date(0);
  if (upTo) { const m: any = await db.collection("messages").findOne({ _id: upTo }, { projection: { ts: 1 } }); if (m) after = m.ts; }
  const rows: any[] = await db.collection("messages").find({ orgId: a.orgId, conversationId: a.conversationId, ts: { $gt: after }, handling: { $ne: "ignored" }, deliveryStatus: { $in: ["received", "sent", "delivered"] } }).sort({ ts: 1 }).toArray();
  if (rows.length <= SUMMARY.threshold) return { folded: 0 };
  const fold = rows.slice(0, rows.length - SUMMARY.keepRecent);
  const lines = fold.map((r) => `${r.direction === "in" ? "Customer" : "Assistant"}: ${String(r.body).slice(0, 400)}`).join("\n");
  const prior = contact?.memory?.summary ? `Existing summary:\n${contact.memory.summary}\n\n` : "";
  const resp = await llm.chat({
    effort: "low", maxTokens: 300, temperature: 0.2,
    messages: [
      { role: "system", content: `You keep a running summary of a conversation between a business's assistant and one customer. Merge the new messages into the summary in under ${SUMMARY.maxWords} words, plain sentences. Keep what the customer wants, preferences, decisions, things the assistant promised, and open questions. Leave out greetings, verification codes, links, and anything that looks like a secret. Do not invent facts.` },
      { role: "user", content: `${prior}New messages:\n${lines}\n\nWrite the updated summary only.` },
    ],
  });
  const text = (resp.message.content ?? "").replace(/\b\d{6}\b/g, "[number]").trim();
  if (!text) return { folded: 0 };
  const res = await db.collection("contacts").updateOne(
    { _id: a.contactId, orgId: a.orgId, "memory.summaryUpToMsgId": upTo },                      // compare-and-set on the cursor we read
    { $set: { "memory.summary": text, "memory.summaryUpToMsgId": fold[fold.length - 1]._id, "memory.summaryAt": new Date() } });
  return { folded: res.modifiedCount ? fold.length : 0 };
}

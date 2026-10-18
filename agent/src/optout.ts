import type { Db, ObjectId } from "mongodb";

// STOP / START / HELP. Carriers require these to work on every texting channel; they are handled BEFORE the agent sees a message,
// answered with fixed text, and never reach the model.
export type Keyword = "stop" | "start" | "help";
const STOP = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "optout", "opt-out"]);
const START = new Set(["start", "unstop", "subscribe", "yes", "resume"]);
const HELP = new Set(["help", "info"]);

/** Whole-message keyword match (as carriers define it), ignoring case and surrounding punctuation. "stop it, you're annoying" is NOT a keyword. */
export function detectKeyword(text: string, optedOut: boolean): Keyword | null {
  const t = text.trim().toLowerCase().replace(/^[\s"'.!,]+|[\s"'.!,]+$/g, "");
  if (STOP.has(t)) return "stop";
  if (HELP.has(t)) return "help";
  // "yes"/"resume" only count as START when the number is currently opted out; otherwise "yes" is an ordinary answer
  if (START.has(t) && (optedOut || t === "start" || t === "unstop")) return "start";
  return null;
}

export async function isOptedOut(db: Db, orgId: ObjectId, addresses: string[]): Promise<boolean> {
  if (!addresses.length) return false;
  return (await db.collection("opt_outs").countDocuments({ orgId, address: { $in: addresses } }, { limit: 1 })) > 0;
}
export async function setOptOut(db: Db, orgId: ObjectId, address: string, keyword: string, now = new Date()) {
  await db.collection("opt_outs").updateOne({ orgId, address }, { $setOnInsert: { orgId, address, at: now, source: "keyword", channels: "all", keyword } }, { upsert: true });
}
export async function clearOptOut(db: Db, orgId: ObjectId, address: string) {
  await db.collection("opt_outs").deleteOne({ orgId, address });
}

export function keywordReply(k: Keyword, brand: string, helpLine?: string | null): string {
  if (k === "stop") return `${brand}: You're unsubscribed and won't get more texts from us. Reply START to resubscribe.`;
  if (k === "start") return `${brand}: You're subscribed again. Reply STOP anytime to opt out, HELP for help.`;
  return `${brand}: ${helpLine ? `For help ${helpLine}.` : "Reply here and a person will follow up."} Reply STOP to opt out.`;
}

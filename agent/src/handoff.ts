import type { Db, ObjectId } from "mongodb";

// ONE gate for "a person should deal with this". Before this existed, four different places could flip a customer to human mode, with no rule
// about WHY, and a model error, a provider timeout or a heuristic misfire locked customers out of the agent exactly like "I want a person" did.
//
// The rule: a chat is LOCKED to a person only for a reason that comes from the customer or from policy. A fault in our own system (model error,
// timeout, empty reply, guardrail hit, tool failure, a heuristic) tells the team and the agent keeps answering.
export type HandoffCause = "customer_request" | "policy" | "system";
export const REASON_TYPES = ["asked_for_person", "cancel_or_port_out", "fraud_or_theft", "legal", "accessibility", "unresolved_complaint"] as const;
export type ReasonType = (typeof REASON_TYPES)[number];

/** What the customer must actually have said for each reason to be valid. The model does not get to invent a reason. */
export const REASON_SAID: Record<ReasonType, RegExp> = {
  asked_for_person: /\b(speak|talk|connect|transfer|put|get|escalate|pass|have|let|send|bring|call me|ring)\b[^.?!]{0,30}\b(someone|somebody|person|human|manager|supervisor|representative|agent|rep|specialist|employee|operator)\b|\b(real|live) (person|human)\b|\b(want|need|get me|give me|let me have|i'?d like) (a |an |the |your )?(manager|supervisor|human|person|representative|specialist|operator)\b|\b(human|person|representative|operator)\b[^.?!]{0,20}\bplease\b/i,
  cancel_or_port_out: /\bcancel|\bport(ing)? (my|our|the)?\s*(number|out)|port out|\bleav(e|ing) (t-?mobile|you|this|your)|close (my|the) account|switch(ing)? (away|to (another|a different)|over to) |take my number|moving my number|transfer my number (out|to)/i,
  fraud_or_theft: /fraud|scam|stolen|\bsteal|\bhack|unauthori[sz]ed|someone (is )?(using|got into|has access)|lost my (phone|device)|phone (is|was) (lost|stolen|missing)|sim swap|identity theft/i,
  legal: /\b(lawyer|attorney|sue\b|lawsuit|legal action|court|fcc|attorney general|subpoena)\b/i,
  accessibility: /accessib|\bdeaf\b|\bblind\b|disab|hearing impair|visually impair|screen reader|can'?t see|can'?t hear|wheelchair|tty|relay service/i,
  unresolved_complaint: /\bcomplain|nobody (has )?(fixed|helped|called|resolved)|(still|never) (not )?(fixed|resolved|working)|(still|hasn'?t|isn'?t) (been )?(fixed|resolved)|nothing (is|has been|was) (fixed|done)|(called|contacted|reached out)[^.?!]{0,30}(three|four|five|\d+|several|many) times|not fixed/i,
};
/** "Yes please" to the assistant's own offer of a person counts as asking for one. */
export function acceptedOfferOfPerson(evidence: string[]): boolean {
  const user = evidence.find((e) => e.startsWith("USER:"))?.slice(5) ?? "";
  const lastAssistant = [...evidence].reverse().find((e) => e.startsWith("ASSISTANT:")) ?? "";
  return /^\s*(yes|yeah|yep|yup|sure|ok(ay)?|please|go ahead|do it|that'?d be (great|good)|sounds good)\b/i.test(user) && /\b(specialist|team member|a person|someone|human|representative)\b/i.test(lastAssistant);
}
export const causeFor = (r: ReasonType): HandoffCause => (r === "asked_for_person" ? "customer_request" : "policy");
export const supportedBy = (r: ReasonType, customerWords: string) => REASON_SAID[r].test(customerWords);

export type HandoffArgs = { orgId: ObjectId; contactId: ObjectId; conversationId: ObjectId; cause: HandoffCause; reason: string; now: Date; log?: (m: string) => void };

/**
 * Record a handoff. Only customer_request and policy lock the chat to a person; system never does. A system note is de-duplicated
 * (one per conversation per 30 minutes) so an outage does not flood the team.
 */
export async function recordHandoff(db: Db, a: HandoffArgs): Promise<{ locked: boolean; recorded: boolean }> {
  const locked = a.cause !== "system";
  if (!locked) {
    const dupe = await db.collection("notifications").countDocuments({ conversationId: a.conversationId, kind: "handoff", cause: "system", createdAt: { $gte: new Date(a.now.getTime() - 30 * 60_000) } }, { limit: 1 });
    if (dupe) return { locked: false, recorded: false };
  }
  await db.collection("notifications").insertOne({ orgId: a.orgId, contactId: a.contactId, conversationId: a.conversationId, kind: "handoff", cause: a.cause, message: locked ? a.reason : `Automatic: ${a.reason}. The agent is still handling the conversation.`, urgency: locked ? "high" : "normal", read: false, createdAt: a.now } as never);
  if (locked) await db.collection("conversations").updateOne({ _id: a.conversationId, orgId: a.orgId }, { $set: { mode: "human", humanAt: a.now, humanCause: a.cause } });
  a.log?.(`handoff ${locked ? "LOCKED to a person" : "noted only (agent keeps answering)"}: cause=${a.cause} reason="${a.reason.slice(0, 100)}"`);
  return { locked, recorded: true };
}

/**
 * Health watch, run on a timer by the live runner:
 *  - any chat locked to a person for a SYSTEM reason (legacy rows, bugs) is handed back to the agent;
 *  - if more than a quarter of the last hour's turns ended in an escalation, block or failure, the team is told once an hour.
 */
export async function healthCheck(db: Db, orgId: ObjectId, now: Date, log: (m: string) => void = () => {}): Promise<{ resumed: number; alarm: boolean }> {
  let resumed = 0;
  const locked = await db.collection("conversations").find({ orgId, mode: "human" }).project({ _id: 1, humanCause: 1 }).toArray();
  for (const c of locked) {
    const last: any = await db.collection("notifications").find({ conversationId: c._id, kind: "handoff" }).sort({ createdAt: -1 }).limit(1).next();
    const systemic = (c as any).humanCause === "system" || last?.cause === "system" || /^Automatic handoff:/.test(last?.message ?? "");   // "Automatic handoff:" = rows written before causes existed; every one was a system action
    if (systemic) { await db.collection("conversations").updateOne({ _id: c._id }, { $set: { mode: "agent" } }); resumed++; log(`health: conversation ${c._id} was locked to a person by a system fault; the agent has it back`); }
  }
  const since = new Date(now.getTime() - 3600_000);
  const turns = await db.collection("agent_turns").find({ orgId, startedAt: { $gte: since } }).project({ outcome: 1 }).toArray();
  const bad = turns.filter((t: any) => ["escalated", "blocked", "failed"].includes(t.outcome)).length;
  let alarm = false;
  if (turns.length >= 8 && bad / turns.length > 0.25) {
    const sent = await db.collection("notifications").countDocuments({ orgId, kind: "health", createdAt: { $gte: since } }, { limit: 1 });
    if (!sent) { await db.collection("notifications").insertOne({ orgId, contactId: null, conversationId: null, kind: "health", message: `${bad} of the last ${turns.length} agent turns ended in an escalation, a block or a failure. Something may be wrong with the model, a tool or the prompt.`, urgency: "high", read: false, createdAt: now } as never); alarm = true; log(`health: ALARM ${bad}/${turns.length} turns escalated/blocked/failed in the last hour`); }
  }
  return { resumed, alarm };
}

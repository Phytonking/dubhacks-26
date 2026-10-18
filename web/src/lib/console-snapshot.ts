import type { ObjectId, Document } from "mongodb";
import { getDb } from "./db";
import { getCurrentOrg } from "./queries";
import { hasTmoData, listTmoConsoleCustomers } from "./tmo-queries";

// Builds the snapshot the static console (public/selldial) renders: the shape of window.SELLDIAL_DEMO,
// read live from MongoDB. Times are minutes-ago, money is integer cents. Collections the agent has not
// created yet (agent_turns, notifications, approvals, ...) read as empty, so this works on any deployment.

const WINDOW_DAYS = 30;
const LIVE_MIN = 5; // a conversation with traffic in the last 5 minutes is "live"
const RULES = [
  [1, "Discounts only from the policy table"],
  [2, "Verify the caller before account changes"],
  [3, "Owner texts yes above their limit"],
  [4, "Every pick has a reason and a runner-up"],
  [5, "Hand off to a human when unsure"],
  [6, "Log every action to the audit log"],
  [7, "Only state numbers from tool results"],
] as const;

const minsAgo = (d: Date | string | null | undefined, now: number) => (d ? Math.max(0, Math.round((now - new Date(d).getTime()) / 60000)) : 0);
const last4 = (s: string) => s.replace(/\D/g, "").slice(-4);
const prettyPhone = (s: string) => {
  const d = s.replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : s;
};
// "Maya Rodriguez" -> "Maya R."
const shortName = (n: string) => {
  const p = n.trim().split(/\s+/);
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0].toUpperCase()}.` : p[0] || "Unknown caller";
};
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const brief = (v: unknown) => clip(typeof v === "string" ? v : JSON.stringify(v ?? ""), 160);
const idStr = (id: ObjectId | string) => String(id);

// No stored summary exists yet (voice calls carry one). Until the agent writes one: what the customer opened with, then where it ended.
function summarize(thread: Document[], preview: string | undefined) {
  const first = thread.find((m) => m.direction === "in")?.body as string | undefined;
  const last = (preview ?? "") as string;
  if (!first) return last;
  return first === last || !last ? clip(first, 140) : `${clip(first, 90)} Latest: ${clip(last, 90)}`;
}

export type Snapshot = Awaited<ReturnType<typeof buildSnapshot>>;

export async function buildSnapshot() {
  const db = await getDb();
  const org = await getCurrentOrg();
  const orgId = org._id;
  const now = Date.now();
  const since = new Date(now - WINDOW_DAYS * 86400_000);
  const col = (name: string) => db.collection<Document>(name);

  const convs = await col("conversations").find({ orgId, lastMessageAt: { $gte: since } }).sort({ lastMessageAt: -1 }).limit(150).toArray();
  const convIds = convs.map((c) => c._id);
  const [callDocs, contacts, allContacts, msgs, toolCalls, turns, notes, approvalDocs, handoffDocs, promoDocs, orderDocs, agent, lines, ownerUser, quoteDocs] = await Promise.all([
    col("calls").find({ orgId, conversationId: { $in: convIds }, summary: { $nin: ["", null] } }).sort({ startedAt: -1 }).toArray(),
    col("contacts").find({ orgId, _id: { $in: convs.map((c) => c.contactId) } }).toArray(),
    col("contacts").find({ orgId }).sort({ createdAt: -1 }).limit(500).toArray(),
    col("messages").find({ orgId, conversationId: { $in: convIds }, ts: { $gte: since } }).sort({ ts: 1 }).limit(5000).toArray(),
    col("tool_calls").find({ orgId, conversationId: { $in: convIds }, ts: { $gte: since } }).sort({ ts: 1 }).limit(3000).toArray(),
    col("agent_turns").find({ orgId, conversationId: { $in: convIds }, startedAt: { $gte: since } }).sort({ startedAt: 1 }).limit(3000).toArray(),
    col("notifications").find({ orgId, createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(500).toArray(),
    col("approvals").find({ orgId }).sort({ createdAt: -1 }).limit(50).toArray(),
    col("handoffs").find({ orgId }).toArray(),
    col("promos").find({ orgId }).sort({ createdAt: 1 }).toArray(),
    col("orders").find({ orgId, conversationId: { $in: convIds } }).toArray(),
    col("agents").findOne({ orgId }),
    col("channel_lines").find({ orgId, status: "active" }).toArray(),
    col("users").findOne({ orgId, role: "owner" }),
    col("checkout_quotes").find({ orgId, conversationId: { $in: convIds } }).sort({ createdAt: -1, _id: -1 }).toArray(),
  ]);

  const contactById = new Map(contacts.map((c) => [idStr(c._id), c]));
  const group = <T extends Document>(rows: T[], key: string) => {
    const m = new Map<string, T[]>();
    for (const r of rows) (m.get(idStr(r[key])) ?? m.set(idStr(r[key]), []).get(idStr(r[key]))!).push(r);
    return m;
  };
  const msgsBy = group(msgs, "conversationId");
  const callsBy = group(toolCalls, "conversationId");
  const turnsBy = group(turns, "conversationId");
  const notesBy = group(notes.filter((n) => n.conversationId), "conversationId");
  const approvalBy = group(approvalDocs, "conversationId");
  const callBy = group(callDocs, "conversationId");
  const orderBy = group(orderDocs, "conversationId");
  const quoteBy = group(quoteDocs, "conversationId");
  const handoffBy = new Map(handoffDocs.map((h) => [idStr(h.conversationId), h]));

  const guardBlocks = new Map<number, number>();
  const bump = (rule: number) => guardBlocks.set(rule, (guardBlocks.get(rule) ?? 0) + 1);
  const guardKind: Record<string, number> = { discount: 1, ungrounded_amount: 7 };

  const conversations = convs.map((c) => {
    const id = idStr(c._id);
    const contact = contactById.get(idStr(c.contactId));
    const handle = contact?.handles?.find((h: Document) => h.channel === c.lastChannel) ?? contact?.handles?.[0];
    const thread = msgsBy.get(id) ?? [];
    const calls = callsBy.get(id) ?? [];
    const turnRows = turnsBy.get(id) ?? [];
    const cNotes = notesBy.get(id) ?? [];
    const approval = approvalBy.get(id)?.[0];
    const order = orderBy.get(id)?.[0];
    const quote = quoteBy.get(id)?.[0];   // newest checkout quote for this conversation
    const deal = cNotes.find((n) => n.kind === "deal");
    const verified = Boolean(contact?.verifiedPhone) || turnRows.some((t) => (t.toolCalls ?? []).some((x: Document) => x.name === "verify_check_code" && x.ok)) || calls.some((t) => t.tool === "verify_check_code" && t.status === "ok");

    // One chronological event list: messages, tool calls (from tool_calls and the engine's agent_turns) and guardrail blocks.
    type Ev = { at: number; t: number; kind: string; text: string; name?: string; rule?: number; ok?: boolean };
    const events: Ev[] = [];
    const push = (at: Date, e: Omit<Ev, "at" | "t">) => events.push({ at: new Date(at).getTime(), t: minsAgo(at, now), ...e });
    for (const m of thread) {
      push(m.ts, { kind: m.sender === "owner" ? "owner" : m.sender, text: m.body });
      const g = m.guardrail as Document | null;
      if (g && g.verdict && g.verdict !== "ok") {
        const rule = guardKind[g.kind as string] ?? 1;
        bump(rule);
        push(m.ts, { kind: "guard", rule, ok: false, text: `Blocked: ${g.reason ?? g.verdict}` });
      }
    }
    for (const t of calls) {
      push(t.ts, { kind: "tool", name: t.tool, text: t.status === "ok" ? brief(t.result) : `${t.status}: ${brief(t.result)}` });
      if (t.status === "blocked") { bump(1); push(t.ts, { kind: "guard", rule: 1, ok: false, text: `Blocked: ${t.tool}` }); }
    }
    const loggedCalls = new Set(calls.map((t) => t.tool));
    for (const t of turnRows) for (const x of t.toolCalls ?? []) if (!loggedCalls.has(x.name)) push(t.startedAt, { kind: "tool", name: x.name, text: x.ok ? "ok" : "failed" });
    events.sort((a, b) => a.at - b.at);

    const lastMsgAt = new Date(c.lastMessageAt).getTime();
    // A quote that was not paid is a purchase attempt that failed ("Not paid"); one still waiting (owner approval or the customer's card) is Pending.
    const quoteWaiting = !order && (quote?.status === "open" || quote?.status === "approved" || quote?.status === "awaiting_approval");
    const quoteFailed = !order && (quote?.status === "payment_failed" || quote?.status === "declined");
    const outcomeSale = order ? "purchased" : quoteFailed ? "not_paid" : null;
    const status = c.mode === "human" ? "handoff"
      : approval?.status === "texted" ? "awaiting_approval"
      : quoteWaiting ? "awaiting_approval"
      : deal && !order && !quoteFailed ? "awaiting_approval"
      : now - lastMsgAt < LIVE_MIN * 60000 ? "live" : "closed";
    const firstIn = thread.find((m) => m.direction === "in");
    const intent = clip(firstIn?.body ?? c.lastMessagePreview ?? "", 80);
    const name = shortName(contact?.name ?? "");
    return {
      id,
      customer: name,
      phone: handle?.address ? `•••• ${last4(handle.address)}` : "•••• ----",
      channel: c.lastChannel,
      status,
      verified,
      started: minsAgo(thread[0]?.ts ?? c.lastMessageAt, now),
      intent,
      outcome: outcomeSale,
      amount_cents: order ? order.amountCents ?? 0 : quote ? quote.dueTodayCents ?? null : null,
      saved_cents: 0,
      item: order?.item ?? quote?.summary ?? deal?.message?.match(/on ([^.]+?)\)/)?.[1] ?? "",
      // what the owner can do about a pending order (the console shows Approve / Decline, or Mark paid for a deal confirmed outside checkout)
      pending: order ? null : approval?.status === "texted" ? { kind: "approval", approval_id: idStr(approval._id), amount_cents: approval.amountCents ?? 0, limit_cents: approval.limitCents ?? 0, summary: approval.items ?? "" }
        : quoteWaiting ? { kind: "payment", amount_cents: quote.dueTodayCents ?? 0, summary: quote.summary ?? "" }
        : deal && !quoteFailed ? { kind: "deal", amount_cents: null, summary: deal.message ?? "" } : null,
      summary: callBy.get(id)?.[0]?.summary ?? summarize(thread, c.lastMessagePreview),
      recommendation: null,
      region: contact?.region ?? contact?.facts?.find?.((f: Document) => /^region:/i.test(f.text))?.text.slice(7).trim() ?? "Unknown",
      events: events.map(({ at: _at, ...e }) => e),
    };
  });

  const nameById = new Map(convs.map((c) => [idStr(c._id), conversations.find((x) => x.id === idStr(c._id))!.customer]));
  const activeContactIds = new Set(convs.map((c) => idStr(c.contactId)));

  // A business with synced T-Mobile data lists its households (plan, lines, bill, persona profile) instead of bare contacts.
  const tmoCustomers = (await hasTmoData(orgId)) ? await listTmoConsoleCustomers(orgId) : null;
  const customers = tmoCustomers ?? allContacts.map((c) => {
    const addr = c.handles?.[0]?.address ?? "";
    return { name: shortName(c.name ?? ""), phone: prettyPhone(addr), region: c.region ?? "Unknown", status: activeContactIds.has(idStr(c._id)) ? "Active" : "Inactive" };
  });

  const ownerLimit = (org as Document).ownerLimitCents ?? agent?.guardrails?.ownerLimitCents ?? 150000;
  const approvals = approvalDocs.map((a) => ({
    id: idStr(a._id), conversation: idStr(a.conversationId), customer: nameById.get(idStr(a.conversationId)) ?? "Customer",
    items: a.items ?? "", amount_cents: a.amountCents ?? 0, limit_cents: a.limitCents ?? ownerLimit,
    owner: a.owner ?? ownerUser?.name ?? "Owner", owner_phone: a.ownerPhone ?? "", status: a.status,
    sent: minsAgo(a.sentAt ?? a.createdAt, now), resolved: a.resolvedAt ? minsAgo(a.resolvedAt, now) : null, checkout: a.checkout ?? "",
  }));

  const handoffs = convs.filter((c) => c.mode === "human").map((c) => {
    const id = idStr(c._id), h = handoffBy.get(id), n = (notesBy.get(id) ?? []).find((x) => x.kind === "handoff" || x.kind === "escalation");
    return { id: h ? idStr(h._id) : id, conversation: id, customer: nameById.get(id) ?? "Customer", waiting: minsAgo(h?.createdAt ?? n?.createdAt ?? c.lastMessageAt, now),
      claimed_by: h?.claimedBy ?? null, reason: h?.reason ?? n?.message ?? "Needs a person", summary: h?.summary ?? c.lastMessagePreview ?? "" };
  });

  const outbound = msgs.filter((m) => m.direction === "out" && m.sender === "agent").length;
  const guards = RULES.map(([rule, name]) => ({
    rule, name,
    checks: rule === 1 || rule === 7 ? outbound : rule === 6 ? toolCalls.length + turns.reduce((n, t) => n + (t.toolCalls?.length ?? 0), 0)
      : rule === 2 ? turns.filter((t) => (t.toolCalls ?? []).some((x: Document) => x.name?.startsWith("verify_"))).length
      : rule === 5 ? turns.filter((t) => t.outcome === "escalated").length : approvalDocs.length,
    blocks: guardBlocks.get(rule) ?? 0,
  }));

  const audit = [
    ...toolCalls.map((t) => ({ at: new Date(t.ts).getTime(), actor: "agent", action: t.tool, conversation: idStr(t.conversationId), detail: t.status })),
    ...turns.flatMap((t) => (t.toolCalls ?? []).map((x: Document) => ({ at: new Date(t.startedAt).getTime(), actor: "agent", action: x.name, conversation: idStr(t.conversationId), detail: x.ok ? "ok" : "failed" }))),
    ...orderDocs.map((o) => ({ at: new Date(o.updatedAt ?? o.createdAt).getTime(), actor: o.source === "owner_confirmed" ? "human" : "agent", action: "order.paid", conversation: idStr(o.conversationId), detail: o.item ?? "" })),
    ...approvalDocs.filter((a) => a.resolvedAt).map((a) => ({ at: new Date(a.resolvedAt).getTime(), actor: a.resolvedBy ?? "human", action: `approval.${a.status}`, conversation: idStr(a.conversationId), detail: a.checkout ?? "" })),
  ].sort((a, b) => b.at - a.at).slice(0, 60).map(({ at, ...e }) => ({ t: minsAgo(new Date(at), now), ...e }));

  const line = lines[0];
  return {
    generatedAt: new Date(now).toISOString(),
    line: { number: line?.address ?? "", carrier: "T-Mobile", status: line ? "live" : "offline" },
    conversations,
    customers,
    approvals,
    handoffs,
    guards,
    policy: {
      default_owner_limit_cents: ownerLimit,
      discounts: promoDocs.map((p) => ({ code: p.code, applies_to: p.appliesTo ?? "", max_pct: p.maxPct ?? null, max_cents: p.maxCents ?? null, max_uses: p.maxUses ?? null, requires: p.requires ?? "", added: Boolean(p.added) })),
    },
    audit,
  };
}

/** Cheap change marker: newest timestamp + count across the collections the console shows. Polled when change streams are unavailable. */
export async function fingerprint(): Promise<string> {
  const db = await getDb();
  const org = await getCurrentOrg();
  const parts = await Promise.all(
    ([["messages", "ts"], ["conversations", "lastMessageAt"], ["tool_calls", "ts"], ["agent_turns", "startedAt"], ["notifications", "createdAt"], ["approvals", "updatedAt"], ["handoffs", "updatedAt"], ["promos", "updatedAt"], ["orders", "updatedAt"], ["checkout_quotes", "updatedAt"], ["payments", "createdAt"], ["contacts", "createdAt"]] as const).map(async ([name, field]) => {
      const c = db.collection<Document>(name);
      const [top, n] = await Promise.all([c.find({ orgId: org._id }).sort({ [field]: -1 }).limit(1).project({ [field]: 1 }).next(), c.countDocuments({ orgId: org._id })]);
      return `${name}:${n}:${top ? new Date(top[field]).getTime() : 0}`;
    }),
  );
  return parts.join("|");
}

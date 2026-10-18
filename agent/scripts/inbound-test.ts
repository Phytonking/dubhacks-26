// Inbound event tracking: every Photon event becomes one row with what happened to it.   pnpm exec tsx scripts/inbound-test.ts
import { trackEvent, kindOf } from "../src/inbound-log";
import { makeKit, ok, t, finish } from "./_testkit";

const kit = await makeKit(); const { db, orgId } = kit;
const orgFor = async (line: string) => (line === "+16285550100" ? orgId : null);
const evt = (id: string, type: string, o: Record<string, unknown>) => ({ id, type, apiVersion: "x", timestamp: new Date().toISOString(), data: { projectId: "p", object: o } });

await t("kinds: texts, calls, typing and delivery receipts are told apart", async () => {
  ok(kindOf("message.received") === "text" && kindOf("call.ringing") === "call" && kindOf("space.typing.updated") === "typing" && kindOf("message.delivered") === "delivery" && kindOf("whatever") === "other", "kinds");
});
await t("a text arriving is recorded at once (status received), then marked handled; the number is masked", async () => {
  const tr = await trackEvent(db, evt("e1", "message.received", { id: "m1", platform: "imessage", sentBy: { handle: "+14255550123" }, receivedBy: { handle: "+16285550100" } }) as never, "socket", orgFor);
  let row: any = await db.collection("inbound_events").findOne({ eventId: "e1" });
  ok(row.status === "received" && row.kind === "text" && row.direction === "in" && String(row.orgId) === String(orgId) && row.peer === "+1******0123" && row.source === "socket", JSON.stringify(row));
  await tr.done("handled");
  row = await db.collection("inbound_events").findOne({ eventId: "e1" }); ok(row.status === "handled" && row.handledAt, "handled");
});
await t("a call ringing is recorded with the caller as peer and our line as line; a replayed event does not add a second row", async () => {
  const e = evt("e2", "call.ringing", { id: "c1", platform: "voice", direction: "inbound", caller: { handle: "+14255550123" }, callee: { handle: "+16285550100" } });
  await trackEvent(db, e as never, "socket", orgFor); await trackEvent(db, e as never, "webhook", orgFor);
  const rows: any[] = await db.collection("inbound_events").find({ eventId: "e2" }).toArray();
  ok(rows.length === 1 && rows[0].kind === "call" && rows[0].line === "+16285550100" && rows[0].seen === 2 && rows[0].refId === "c1", JSON.stringify(rows));
});
await t("an event for a number that is not ours has no business (orgId null) so the caller can mark it unrouted", async () => {
  const tr = await trackEvent(db, evt("e3", "message.received", { id: "m3", platform: "sms", sentBy: { handle: "+14255550124" }, receivedBy: { handle: "+19990000000" } }) as never, "socket", orgFor);
  ok(tr.orgId === null && tr.kind === "text", "unrouted");
});
await finish(kit);

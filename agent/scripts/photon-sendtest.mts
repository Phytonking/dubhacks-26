// Controlled send experiments against the latest inbound iMessage. Sends real messages ONLY if a variant is accepted; stops at the first acceptance.
import { Photon, PhotonError } from "../src/photon";
const p = new Photon(process.env.PHOTON_API_KEY!.trim(), process.env.PHOTON_PROJECT_ID!.trim());
const platform = process.argv[2] ?? "imessage";
const only = process.argv[3];   // optional: restrict to a sender whose handle ends with these digits (never message anyone else)
const items = (await p.listMessages({ pageSize: 25, platform })).items.filter((m: any) => m.receivedBy?.kind !== "human" && (!only || String(m.sentBy?.handle).endsWith(only)));
const m = items[0];
if (!m) { console.log("no inbound message found"); process.exit(1); }
console.log(`inbound ${m.id.slice(0, 12)}… at ${m.createdAt} text=${JSON.stringify(m.content?.text)}`);
const base = { spaceId: m.space.id, senderId: m.receivedBy.id };
const text = "Hi from the Sunrise Bike Shop assistant (delivery test).";
const variants: Array<[string, Record<string, unknown>]> = [
  ["A: with parentMessageId (what the agent sends)", { ...base, parentMessageId: m.id }],
  ["B: without parentMessageId", { ...base }],
];
for (const [name, extra] of variants) {
  const key = `sendtest:${name[0]}:${Date.now()}`;
  try {
    const r = await p.req("POST", "/messages", { idem: key, body: { ...extra, content: { type: "text", format: "plain", text } } });
    console.log(`ACCEPTED  ${name} -> message ${String(r.id).slice(0, 12)}… status=${r.status}`);
    break;
  } catch (e) {
    const pe = e as PhotonError;
    console.log(`REJECTED  ${name} -> ${pe.status} ${pe.body.replace(/\s+/g, " ").slice(0, 220)}`);
  }
}

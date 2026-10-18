// Read-only: why can't we reply? Shows the latest iMessage message, its space, the users involved, and our stored failed send.
import { MongoClient } from "mongodb";
import { Photon } from "../src/photon";
const p = new Photon(process.env.PHOTON_API_KEY!.trim(), process.env.PHOTON_PROJECT_ID!.trim());
const mask = (s: unknown) => JSON.stringify(s, null, 1).replace(/\+(\d)(\d{3})(\d{3})(\d{4})/g, "+$1$2***$4").replace(/(pho_[a-z]+_)([a-z0-9]{4})[a-z0-9]+/g, "$1$2…");
const t = async (l: string, f: () => Promise<unknown>) => { try { console.log(l, mask(await f())); } catch (e) { console.log(l, "ERR", String((e as Error).message).slice(0, 400)); } };
const items = (await p.listMessages({ pageSize: 10, platform: "imessage" })).items;
console.log("imessage messages:", items.length);
const m = items[0];
if (m) {
  console.log("LATEST:", mask({ id: m.id, direction: m.direction, sentBy: m.sentBy, receivedBy: m.receivedBy, space: m.space, content: m.content?.type, createdAt: m.createdAt, keys: Object.keys(m) }));
  const sid = m.space?.id ?? m.spaceId;
  if (sid) await t("SPACE:", () => p.req("GET", `/spaces/${sid}`));
  for (const u of [m.sentBy?.id, m.receivedBy?.id].filter(Boolean)) await t("USER " + String(u).slice(0, 12), () => p.req("GET", `/users/${u}`));
}
const mongo = await new MongoClient(process.env.MONGODB_URI!).connect();
const out = await mongo.db(process.env.MONGODB_DB ?? "salesagent").collection("messages").find({ channel: "imessage" }).sort({ ts: -1 }).limit(4).toArray();
for (const d of out) console.log("DB:", mask({ dir: d.direction, status: d.deliveryStatus, err: d.deliveryError, ref: d.ref, body: String(d.body).slice(0, 50) }));
await mongo.close();

import type { Db, ObjectId } from "mongodb";
import { type CursorStore, type PhotonEvent } from "./photon";
import type { Worker } from "./recorded-io";

/** Cursor persisted in Mongo per project+purpose; written only after the handler succeeds. */
export function mongoCursorStore(db: Db, consumer: string): CursorStore {
  return {
    async get() { return ((await db.collection("consumer_cursors").findOne({ consumer })) as any)?.seq ?? 0; },
    async set(seq) { await db.collection("consumer_cursors").updateOne({ consumer }, { $max: { seq }, $set: { updatedAt: new Date() } }, { upsert: true }); },
  };
}

/** Routes Photon events into the recorded-IO worker. orgFor maps the receiving line to a business. */
export function photonEventHandler(workers: Worker | Record<string, Worker>, orgFor: (lineHandle: string) => Promise<ObjectId | null>, log: (m: string) => void, deadLetter?: (evt: PhotonEvent, reason: string) => Promise<void>) {
  /** onPersisted fires once an inbound message is durable in Mongo (webhooks ack here). */
  const byPlatform: Record<string, Worker> = "handleInbound" in workers ? { imessage: workers as Worker } : (workers as Record<string, Worker>);
  return async (evt: PhotonEvent, onPersisted?: () => void) => {
    const m = evt.data?.object;
    const worker = byPlatform[String(m?.platform)];
    if (!worker) { if (evt.type.startsWith("message.")) log(`ignored ${evt.type} on platform ${m?.platform} (no worker)`); return; }
    if (evt.type === "message.received" && m.content?.type === "text") {
      const org = await orgFor(String(m.receivedBy?.handle ?? ""));
      if (!org) { const reason = `no business for line ${m.receivedBy?.handle} (add a channel_lines row)`; log(`UNROUTED ${reason}`); await deadLetter?.(evt, reason); return; }
      await worker.handleInbound({ orgId: org, address: String(m.sentBy?.handle), text: m.content.text, channelMsgId: String(m.id), ref: { spaceId: m.space?.id, senderId: m.receivedBy?.id, parentMessageId: String(m.id) }, onPersisted });
    } else if (/^message\.(accepted|dispatched|delivered|failed)$/.test(evt.type)) {
      await worker.handleDelivery(evt.type, m);
    }
    // space.typing.updated, call.*, other platforms: ignored for now
  };
}

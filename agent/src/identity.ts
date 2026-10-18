import type { Db, ObjectId, WithId, Document } from "mongodb";

// Who is this? One person, many handles. A phone number that texted us on SMS, iMessaged us, and then called is ONE contact in ONE conversation.
export type ChannelId = "imessage" | "whatsapp" | "sms" | "voice";

/** E.164 for phone numbers (US 10/11-digit tolerated); lower-cased email addresses; anything else is returned trimmed. */
export function normalizeAddress(raw: string): string {
  const s = String(raw ?? "").trim();
  if (s.includes("@")) return s.toLowerCase();
  const cleaned = s.replace(/[^\d+]/g, "");
  if (/^\+\d{8,15}$/.test(cleaned)) return cleaned;
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits[0] === "1") return "+" + digits;
  return s;
}

export type Party = {
  contact: WithId<Document>;
  conversation: WithId<Document>;
  address: string;
  created: boolean;                                            // a brand-new contact was made for this message/call
  matchedBy: "channel_handle" | "other_channel_handle" | "new";
  /** Links to external systems (e.g. {system:"tmobile", id:"ACC-PERSONA-03", kind:"account"}). Empty = unknown / prospect: NEVER guess an account. */
  externalRefs: Array<{ system: string; id: string; kind: string }>;
};

const isDup = (e: unknown) => (e as { code?: number })?.code === 11000;

/**
 * Resolve (channel, address) to a contact and its single conversation, creating both race-safely.
 * Looks across ALL channels first, so a number seen on SMS is recognized on iMessage, WhatsApp and voice.
 */
export async function resolveParty(db: Db, a: { orgId: ObjectId; channel: ChannelId; address: string; displayName?: string }): Promise<Party> {
  const { orgId, channel } = a;
  const address = normalizeAddress(a.address);
  const contacts = db.collection("contacts");
  const convs = db.collection("conversations");

  let contact = await contacts.findOne({ orgId, handles: { $elemMatch: { channel, address } } });
  let matchedBy: Party["matchedBy"] = "channel_handle";
  let created = false;

  // The unique index is (orgId, handle address) across channels, so a concurrent first message on another channel loses the insert race
  // and lands in the "other channel" branch on its next attempt. Three attempts is plenty: each failure means someone else just created it.
  for (let attempt = 0; !contact && attempt < 3; attempt++) {
    const other = await contacts.findOne({ orgId, "handles.address": address });
    if (other) {
      try { await contacts.updateOne({ _id: other._id, handles: { $not: { $elemMatch: { channel, address } } } }, { $push: { handles: { channel, address } } as never }); }
      catch (e) { if (!isDup(e)) throw e; }
      contact = await contacts.findOne({ _id: other._id });
      matchedBy = "other_channel_handle";
      break;
    }
    try {
      const doc = { orgId, handles: [{ channel, address }], name: a.displayName ?? address, stage: "new", score: 0, notes: "", facts: [], createdAt: new Date() };
      const r = await contacts.insertOne(doc as never);
      contact = await contacts.findOne({ _id: r.insertedId });
      created = true; matchedBy = "new";
    } catch (e) { if (!isDup(e)) throw e; }                    // lost the race: loop and find the winner
  }
  if (!contact) throw new Error("resolveParty: could not resolve contact");

  let conversation = await convs.findOne({ orgId, contactId: contact._id });
  if (!conversation) {
    try {
      const r = await convs.insertOne({ orgId, contactId: contact._id, mode: "agent", lastChannel: channel, lastMessageAt: new Date(), lastMessagePreview: "" } as never);
      conversation = await convs.findOne({ _id: r.insertedId });
    } catch (e) {
      if (!isDup(e)) throw e;
      conversation = await convs.findOne({ orgId, contactId: contact._id });
    }
  }
  if (!conversation) throw new Error("resolveParty: conversation vanished");
  return { contact, conversation, address, created, matchedBy, externalRefs: (contact.externalRefs as Party["externalRefs"]) ?? [] };
}

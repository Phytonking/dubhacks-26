import { ObjectId } from "mongodb";
import { collections, getDb } from "./db";

// Every query takes orgId. Never query a tenant collection without it.

// TODO(auth): resolve org from the signed-in user's session. Until auth lands, the console serves the T-Mobile org
// (the business with synced tmo_* data), else the oldest org (the seeded demo business).
export async function getCurrentOrg() {
  const { orgs } = await collections();
  const db = await getDb();
  const tmo = await db.collection("tmo_meta").findOne({}, { projection: { orgId: 1 } });
  const org = (tmo ? await orgs.findOne({ _id: tmo.orgId }) : null) ?? (await orgs.findOne({}, { sort: { createdAt: 1 } }));
  if (!org) throw new Error("No org found. Run `pnpm db:seed`.");
  return org;
}

export async function getAgent(orgId: ObjectId) {
  const { agents } = await collections();
  return agents.findOne({ orgId });
}

export async function getDashboardStats(orgId: ObjectId) {
  const { contacts, conversations, messages } = await collections();
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [contactCount, hot, openHuman, msgs24h, stages] = await Promise.all([
    contacts.countDocuments({ orgId }),
    contacts.countDocuments({ orgId, stage: "qualified" }),
    conversations.countDocuments({ orgId, mode: "human" }),
    messages.countDocuments({ orgId, ts: { $gte: since } }),
    contacts
      .aggregate<{ _id: string; n: number }>([
        { $match: { orgId } },
        { $group: { _id: "$stage", n: { $sum: 1 } } },
      ])
      .toArray(),
  ]);
  return { contactCount, hot, openHuman, msgs24h, stages };
}

export async function listConversations(orgId: ObjectId) {
  const { conversations, contacts } = await collections();
  const convs = await conversations
    .find({ orgId })
    .sort({ lastMessageAt: -1 })
    .limit(100)
    .toArray();
  const byId = new Map(
    (
      await contacts
        .find({ orgId, _id: { $in: convs.map((c) => c.contactId) } })
        .toArray()
    ).map((c) => [c._id.toString(), c]),
  );
  return convs.map((c) => ({ ...c, contact: byId.get(c.contactId.toString()) }));
}

export async function getThread(orgId: ObjectId, conversationId: string) {
  if (!ObjectId.isValid(conversationId)) return null;
  const { conversations, contacts, messages } = await collections();
  const _id = new ObjectId(conversationId);
  const conversation = await conversations.findOne({ _id, orgId });
  if (!conversation) return null;
  const [contact, thread] = await Promise.all([
    contacts.findOne({ _id: conversation.contactId, orgId }),
    messages.find({ conversationId: _id, orgId }).sort({ ts: 1 }).toArray(),
  ]);
  return { conversation, contact, messages: thread };
}

export async function listContacts(orgId: ObjectId) {
  const { contacts } = await collections();
  return contacts.find({ orgId }).sort({ score: -1 }).limit(200).toArray();
}

export async function getContact(orgId: ObjectId, id: string) {
  if (!ObjectId.isValid(id)) return null;
  const { contacts, conversations, messages } = await collections();
  const _id = new ObjectId(id);
  const contact = await contacts.findOne({ _id, orgId });
  if (!contact) return null;
  const convs = await conversations.find({ orgId, contactId: _id }).toArray();
  const msgs = await messages
    .find({ orgId, conversationId: { $in: convs.map((c) => c._id) } })
    .sort({ ts: 1 })
    .toArray();
  return { contact, conversations: convs, messages: msgs };
}

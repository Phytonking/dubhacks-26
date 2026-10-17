import { ObjectId } from "mongodb";
import { collections, getDb } from "../src/lib/db";
import { applySchema } from "../src/lib/schema";
import type { Channel, Contact, Conversation, ContactStage, Message } from "../src/lib/models";

const db = await getDb();
// Guard: never wipe a populated database (e.g. Atlas) unless explicitly asked.
if (!process.argv.includes("--reset") && (await db.collection("orgs").countDocuments()) > 0) {
  console.error(`Database "${db.databaseName}" already has data. Re-run with --reset to wipe and reseed.`);
  process.exit(1);
}
await db.dropDatabase();
await applySchema(db);
const c = await collections();

const now = Date.now();
const mins = (n: number) => new Date(now - n * 60_000);

const orgId = new ObjectId();
await c.orgs.insertOne({
  _id: orgId,
  name: "Sunrise Bike Shop",
  productDescription:
    "Local bike shop in Seattle. Sells commuter, gravel and e-bikes; offers tune-ups, fitting and trade-ins.",
  brandVoice: "Friendly, upbeat, short replies. No jargon.",
  hours: "Mon-Sat 10am-6pm PT",
  plan: "pro",
  createdAt: mins(60 * 24 * 14),
});

await c.agents.insertOne({
  _id: new ObjectId(),
  orgId,
  status: "draft",
  harness: null,
  persona: "You are Sunny, the assistant for Sunrise Bike Shop. Help customers pick a bike, book tune-ups, and answer store questions.",
  guardrails: { maxDiscountPct: 10, escalateOn: ["refund", "complaint", "injury"] },
  enabledChannels: { imessage: true, whatsapp: false, sms: false, voice: false },
  sandboxId: null,
  updatedAt: mins(120),
});

type Seed = {
  name: string;
  phone: string;
  stage: ContactStage;
  score: number;
  facts: string[];
  mode?: "agent" | "human";
  thread: [("in" | "out"), "customer" | "agent" | "owner", string][];
};

const seeds: Seed[] = [
  { name: "Maya Chen", phone: "+12065550101", stage: "qualified", score: 88, facts: ["Commutes 8 mi each way", "Budget ~$1,500"],
    thread: [["in", "customer", "Hi! Looking for a commuter bike under $1500"], ["out", "agent", "Hey Maya! Happy to help. How far is your commute, and is there much hill?"], ["in", "customer", "8 miles each way, a few hills"], ["out", "agent", "A gravel/commuter hybrid or a light e-bike would fit. Want to come test ride Saturday?"], ["in", "customer", "Yes, Saturday 11am works"]] },
  { name: "Devon Brooks", phone: "+12065550102", stage: "engaged", score: 55, facts: ["Owns a 2019 Trek"], mode: "human",
    thread: [["in", "customer", "My brakes are squealing, can I get a tune-up this week?"], ["out", "agent", "Sure! Thursday 2pm or Friday 10am?"], ["in", "customer", "Also I was charged twice for last visit"], ["out", "owner", "Hi Devon, Sam here. Looking at that charge now, will refund today."]] },
  { name: "Priya Nair", phone: "+12065550103", stage: "new", score: 20, facts: [],
    thread: [["in", "customer", "What are your hours on Sunday?"], ["out", "agent", "We're closed Sundays, open Mon-Sat 10am-6pm. Anything I can help with?"]] },
  { name: "Luis Ortega", phone: "+12065550104", stage: "won", score: 95, facts: ["Bought e-bike Oct 3", "Wants helmet bundle"],
    thread: [["in", "customer", "Picked up the e-bike, love it. Do you do helmet bundles?"], ["out", "agent", "Congrats Luis! Yes, 10% off a helmet with any bike purchase this month."]] },
  { name: "Hannah Weiss", phone: "+12065550105", stage: "lost", score: 30, facts: ["Went with competitor"],
    thread: [["in", "customer", "Do you price match?"], ["out", "agent", "We can take 10% off in some cases. What's the quote you have?"], ["in", "customer", "Never mind, ordered elsewhere"]] },
];

for (const [i, s] of seeds.entries()) {
  const contactId = new ObjectId();
  const convId = new ObjectId();
  const channel: Channel = "imessage";
  const baseMin = 600 - i * 90;
  const contact: Contact = {
    _id: contactId, orgId, name: s.name, stage: s.stage, score: s.score, notes: "",
    facts: s.facts.map((text) => ({ text, sourceMessageId: null, learnedAt: mins(baseMin) })), handles: [{ channel, address: s.phone }], createdAt: mins(baseMin + 5),
  };
  const msgs: Message[] = s.thread.map(([direction, sender, body], j) => ({
    _id: new ObjectId(), orgId, conversationId: convId, channel, direction, sender, body,
    channelMsgId: `seed-${i}-${j}`, deliveryStatus: "delivered", deliveryError: null,
    attachments: [], reactions: [], replyTo: null, ts: mins(baseMin - j * 3),
  }));
  const last = msgs[msgs.length - 1];
  const conv: Conversation = {
    _id: convId, orgId, contactId, mode: s.mode ?? "agent", lastChannel: channel,
    lastMessageAt: last.ts, lastMessagePreview: last.body.slice(0, 80),
  };
  await c.contacts.insertOne(contact);
  await c.conversations.insertOne(conv);
  await c.messages.insertMany(msgs);
}

// ---- supporting data ----
await c.users.insertOne({
  _id: new ObjectId(), orgId, email: "owner@sunrisebikes.example", name: "Sam Rivera",
  role: "owner", authProviderId: null, createdAt: mins(60 * 24 * 14),
});
await c.channelLines.insertOne({
  _id: new ObjectId(), orgId, channel: "imessage", provider: "photon", photonLineId: null,
  address: "+12065550199", status: "pending", capabilities: ["typing", "reactions", "threads", "attachments"],
  createdAt: mins(60 * 24),
});
const kid = new ObjectId();
const faqText = "Hours: Mon-Sat 10am-6pm. Tune-ups $89, 3-day turnaround. Trade-ins credited toward any bike. Free fitting with every bike purchase.";
await c.knowledge.insertOne({
  _id: kid, orgId, kind: "faq", title: "Store FAQ", content: faqText, sourceUrl: null,
  version: 1, status: "ready", createdAt: mins(60 * 24 * 3),
});
await c.knowledgeChunks.insertMany(
  faqText.split(". ").map((text, idx) => ({
    _id: new ObjectId(), orgId, knowledgeId: kid, idx, text, embedding: null, createdAt: mins(60 * 24 * 3),
  })),
);
for (let d = 6; d >= 0; d--) {
  await c.usage.insertOne({
    _id: new ObjectId(), orgId, day: new Date(now - d * 86_400_000).toISOString().slice(0, 10),
    tokensIn: 4000 + d * 300, tokensOut: 1500 + d * 90, messagesIn: 10 + d, messagesOut: 12 + d, sandboxSec: 3600,
  });
}
await c.toolCalls.insertOne({
  _id: new ObjectId(), orgId, conversationId: null, tool: "lookup_inventory", args: { query: "commuter bike" }, result: { matches: 3 },
  status: "ok", ms: 180, approvedBy: null, ts: mins(500),
});

console.log(`Seeded org "Sunrise Bike Shop" with ${seeds.length} contacts.`);
process.exit(0);

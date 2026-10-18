import { ObjectId } from "mongodb";
import { collections, getDb } from "../src/lib/db";
import { applySchema } from "../src/lib/schema";
import type { Channel, Contact, Conversation } from "../src/lib/models";

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
  enabledChannels: { imessage: true, whatsapp: false, sms: true, voice: false },
  sandboxId: null,
  updatedAt: mins(120),
});

// ---- primary test user: the real tester (set PRIMARY_TEST_PHONE=+1XXXXXXXXXX in .env.local) ----
// Baseline is intentionally NOT fake customers: every other contact is created by the Worker when a real person texts the line.
const phone = process.env.PRIMARY_TEST_PHONE?.trim();
let seeds: unknown[] = [];
if (phone) {
  const contactId = new ObjectId();
  const channels: Channel[] = ["sms", "imessage"];
  await c.contacts.insertOne({
    _id: contactId, orgId, name: "Primary test user", stage: "engaged", score: 50,
    notes: "Main tester (T-Mobile). Owner-side phone for Sunrise Bike Shop.", facts: [],
    handles: channels.map((channel) => ({ channel, address: phone })), createdAt: mins(60),
  } as Contact);
  await c.conversations.insertOne({
    _id: new ObjectId(), orgId, contactId, mode: "agent", lastChannel: "sms", lastMessageAt: mins(60), lastMessagePreview: "",
  } as Conversation);
  seeds = [phone];
} else {
  console.warn("PRIMARY_TEST_PHONE not set: seeded no contact. The first person to text the line becomes the first contact.");
}

// ---- supporting data ----
await c.users.insertOne({
  _id: new ObjectId(), orgId, email: "owner@sunrisebikes.example", name: "Sam Rivera",
  role: "owner", authProviderId: null, phone: phone ?? null, createdAt: mins(60 * 24 * 14),
});
// channel_lines are created from real Photon resources by the live runner / onboarding (no fake placeholder line)
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
console.log(`Seeded org "Sunrise Bike Shop" with ${seeds.length} contact(s) (primary test user only).`);
process.exit(0);

import type { Db, Document } from "mongodb";
import { agentSpecs } from "./agent-schema";
import { tmoSpecs } from "./tmo-schema";

// Single source of truth for collection validators + indexes.
// Applied idempotently by `pnpm db:setup` (and by the seed script).
// Types live in models.ts; keep the two in sync.

type IndexSpec = { keys: Document; unique?: boolean; name?: string; partial?: Document; ttl?: number };
type CollectionSpec = { name: string; schema: Document; indexes: IndexSpec[] };

const oid = { bsonType: "objectId" };
const oidOrNull = { bsonType: ["objectId", "null"] };
const str = { bsonType: "string" };
const strOrNull = { bsonType: ["string", "null"] };
const date = { bsonType: "date" };
const dateOrNull = { bsonType: ["date", "null"] };
const num = { bsonType: ["int", "long", "double", "decimal"] };
const bool = { bsonType: "bool" };
const strs = { bsonType: "array", items: str };
const en = (...v: string[]) => ({ enum: v });
const obj = (required: string[], properties: Document): Document => ({
  bsonType: "object",
  required,
  properties,
});

const CHANNELS = ["imessage", "whatsapp", "sms", "voice"];

export const specs: CollectionSpec[] = [
  {
    name: "orgs",
    schema: obj(["name", "productDescription", "brandVoice", "hours", "plan", "createdAt"], {
      name: str, productDescription: str, brandVoice: str, hours: str,
      plan: en("free", "pro"), createdAt: date,
    }),
    indexes: [],
  },
  {
    name: "users",
    schema: obj(["orgId", "email", "name", "role", "createdAt"], {
      orgId: oid, email: str, name: str, role: en("owner", "admin"),
      authProviderId: strOrNull, createdAt: date,
    }),
    indexes: [{ keys: { email: 1 }, unique: true }, { keys: { orgId: 1 } }],
  },
  {
    name: "agents",
    schema: obj(["orgId", "status", "persona", "guardrails", "enabledChannels", "updatedAt"], {
      orgId: oid,
      status: en("draft", "provisioning", "running", "sleeping", "error"),
      harness: { enum: ["hermes", "fx", null] },
      persona: str,
      guardrails: obj(["maxDiscountPct", "escalateOn"], { maxDiscountPct: num, escalateOn: strs }),
      enabledChannels: obj(CHANNELS, { imessage: bool, whatsapp: bool, sms: bool, voice: bool }),
      sandboxId: strOrNull, updatedAt: date,
    }),
    indexes: [{ keys: { orgId: 1 }, unique: true }], // exactly one agent per business
  },
  {
    name: "contacts",
    schema: obj(["orgId", "handles", "name", "stage", "score", "facts", "createdAt"], {
      orgId: oid,
      handles: {
        bsonType: "array", minItems: 1,
        items: obj(["channel", "address"], { channel: en(...CHANNELS), address: str }),
      },
      name: str, notes: str,
      stage: en("new", "engaged", "qualified", "won", "lost"),
      score: { bsonType: ["int", "long", "double"], minimum: 0, maximum: 100 },
      facts: {
        bsonType: "array",
        items: obj(["text", "learnedAt"], { text: str, sourceMessageId: oidOrNull, learnedAt: date }),
      },
      memory: { bsonType: "object" }, profile: { bsonType: "object" }, intake: { bsonType: "object" }, externalRefs: { bsonType: "array" },
      consent: { bsonType: "object" },         // { text: { granted, at, source } }
      verifiedPhone: { bsonType: "object" },   // { number, at, method }: proof of control of the number (verify_check_code)
      createdAt: date,
    }),
    indexes: [
      { keys: { orgId: 1, stage: 1 } },
      // a phone number / email maps to exactly ONE contact per business, across all channels (addresses stored E.164).
      // Unique indexes only compare different documents, so one contact may hold the same number on SMS, iMessage, WhatsApp and voice.
      { keys: { orgId: 1, "handles.address": 1 }, unique: true },
    ],
  },
  {
    name: "conversations",
    schema: obj(["orgId", "contactId", "mode", "lastChannel", "lastMessageAt", "lastMessagePreview"], {
      orgId: oid, contactId: oid, mode: en("agent", "human"),
      lastChannel: en(...CHANNELS), lastMessageAt: date, lastMessagePreview: str,
      lane: { bsonType: "object", properties: { state: en("idle", "running"), owner: strOrNull, dueAt: dateOrNull, firstAt: dateOrNull, leaseUntil: dateOrNull, startedAt: dateOrNull } },   // per-conversation work lane (scheduler.ts)
    }),
    indexes: [
      { keys: { orgId: 1, contactId: 1 }, unique: true }, // one conversation per contact, spans channels
      { keys: { "lane.dueAt": 1 }, partial: { "lane.dueAt": { $type: "date" } } },   // scheduler: which conversations are due
      { keys: { orgId: 1, lastMessageAt: -1 } },
    ],
  },
  {
    name: "messages",
    schema: obj(
      ["orgId", "conversationId", "channel", "direction", "sender", "body", "deliveryStatus", "ts"],
      {
        orgId: oid, conversationId: oid, channel: en(...CHANNELS),
        direction: en("in", "out"), sender: en("customer", "agent", "owner"),
        body: str, channelMsgId: strOrNull,
        // received = inbound stored; queued/sending/blocked = outbound lifecycle (PRD §6.3)
        deliveryStatus: en("received", "queued", "sending", "sent", "delivered", "failed", "blocked"),
        clientMsgId: strOrNull, agentTurnId: strOrNull, replyGroupId: strOrNull, callId: oidOrNull,
        handling: en("agent", "ignored", "opted_out", "rejected", "human"),
        guardrail: { bsonType: ["object", "null"] }, attempts: num,
        deliveryError: strOrNull,
        redacted: bool, handledByTurn: strOrNull,   // redacted: body hides a code/link; handledByTurn: the agent turn that answered this inbound message
        attachments: {
          bsonType: "array",
          items: obj(["kind", "url"], { kind: en("image", "video", "audio", "file"), url: str, mime: str, name: str, sizeBytes: num }),
        },
        reactions: {
          bsonType: "array",
          items: obj(["type", "by", "ts"], { type: str, by: en("customer", "agent", "owner"), ts: date }),
        },
        replyTo: oidOrNull, ts: date,
      },
    ),
    indexes: [
      { keys: { conversationId: 1, ts: 1 } },
      { keys: { orgId: 1, ts: -1 } },
      // inbound dedupe; scoped by channel because provider ids can collide. Partial: queued sends have no id yet.
      { keys: { channel: 1, channelMsgId: 1 }, unique: true, partial: { channelMsgId: { $type: "string" } } },
      { keys: { clientMsgId: 1 }, unique: true, partial: { clientMsgId: { $type: "string" } } },
      { keys: { deliveryStatus: 1, ts: 1 } }, // stuck-send reconciler
    ],
  },
  {
    name: "channel_lines",
    schema: obj(["orgId", "channel", "provider", "address", "status", "capabilities", "createdAt"], {
      orgId: oid, channel: en(...CHANNELS), provider: en("photon"), photonLineId: strOrNull,
      address: str, status: en("pending", "active", "disabled"), capabilities: strs, createdAt: date,
    }),
    indexes: [{ keys: { channel: 1, address: 1 }, unique: true }, { keys: { orgId: 1 } }],
  },
  {
    name: "sandboxes",
    schema: obj(["orgId", "state", "snapshotVersion", "createdAt", "costAccruedCents"], {
      orgId: oid, daytonaId: strOrNull,
      state: en("creating", "running", "stopped", "error", "deleted"),
      snapshotVersion: str, createdAt: date, lastActiveAt: dateOrNull, costAccruedCents: num,
    }),
    indexes: [{ keys: { orgId: 1, state: 1 } }, { keys: { daytonaId: 1 }, unique: true, name: "daytonaId_unique", partial: { daytonaId: { $type: "string" } } }],
  },
  {
    name: "tool_calls",
    schema: obj(["orgId", "tool", "args", "status", "ms", "ts"], {
      orgId: oid, conversationId: oidOrNull, tool: str, args: { bsonType: "object" },
      status: en("ok", "error", "blocked"), ms: num, approvedBy: oidOrNull, ts: date,
    }),
    indexes: [{ keys: { orgId: 1, ts: -1 } }, { keys: { conversationId: 1, ts: 1 } }],
  },
  {
    name: "knowledge",
    schema: obj(["orgId", "kind", "title", "content", "version", "status", "createdAt"], {
      orgId: oid, kind: en("catalog", "faq", "doc", "url"), title: str, content: str,
      sourceUrl: strOrNull, version: num, status: en("pending", "ready", "error"), createdAt: date,
    }),
    indexes: [{ keys: { orgId: 1, kind: 1 } }],
  },
  {
    name: "knowledge_chunks",
    schema: obj(["orgId", "knowledgeId", "idx", "text", "createdAt"], {
      orgId: oid, knowledgeId: oid, idx: num, text: str,
      embedding: { bsonType: ["array", "null"], items: { bsonType: ["double", "int"] } }, createdAt: date,
    }),
    indexes: [{ keys: { knowledgeId: 1, idx: 1 }, unique: true }, { keys: { orgId: 1 } }],
  },
  {
    name: "usage",
    schema: obj(["orgId", "day", "tokensIn", "tokensOut", "messagesIn", "messagesOut", "sandboxSec"], {
      orgId: oid, day: { bsonType: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      tokensIn: num, tokensOut: num, messagesIn: num, messagesOut: num, sandboxSec: num,
    }),
    indexes: [{ keys: { orgId: 1, day: 1 }, unique: true }],
  },
  {
    name: "templates",
    schema: obj(["orgId", "channel", "name", "body", "approvalStatus", "createdAt"], {
      orgId: oid, channel: en(...CHANNELS), name: str, body: str, variables: strs,
      approvalStatus: en("draft", "pending", "approved", "rejected"), createdAt: date,
    }),
    indexes: [{ keys: { orgId: 1, channel: 1, name: 1 }, unique: true }],
  },
  {
    name: "consumer_cursors",
    schema: obj(["consumer", "seq", "updatedAt"], { consumer: str, seq: num, updatedAt: date }),
    indexes: [{ keys: { consumer: 1 }, unique: true }],
  },
  {
    name: "calls",
    schema: obj(["orgId", "contactId", "conversationId", "direction", "status", "startedAt", "durationSec"], {
      orgId: oid, contactId: oid, conversationId: oid, direction: en("in", "out"),
      status: en("ringing", "active", "completed", "missed", "failed"),
      startedAt: date, endedAt: dateOrNull, durationSec: num, recordingUrl: strOrNull, summary: str, outcome: str,
    }),
    indexes: [
      { keys: { orgId: 1, startedAt: -1 } },
      { keys: { contactId: 1 } },
      // one document per provider call: call events can arrive twice or out of order
      { keys: { provider: 1, providerCallId: 1 }, unique: true, partial: { providerCallId: { $type: "string" } } },
    ],
  },
  ...agentSpecs, // verification, opt-outs, turn log, notifications, secure forms (agent-schema.ts)
  ...tmoSpecs, // T-Mobile sandbox data (tmo-schema.ts)
];

/** Create missing collections, (re)apply validators, ensure indexes. Safe to re-run. */
export async function applySchema(db: Db) {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const s of specs) {
    const validator = { $jsonSchema: s.schema };
    if (existing.has(s.name)) {
      await db.command({ collMod: s.name, validator, validationLevel: "strict", validationAction: "error" });
    } else {
      await db.createCollection(s.name, { validator, validationLevel: "strict", validationAction: "error" });
    }
    for (const ix of s.indexes) {
      const opts = { unique: ix.unique ?? false, ...(ix.name ? { name: ix.name } : {}), ...(ix.partial ? { partialFilterExpression: ix.partial } : {}), ...(ix.ttl !== undefined ? { expireAfterSeconds: ix.ttl } : {}) };
      try {
        await db.collection(s.name).createIndex(ix.keys, opts);
      } catch (e) {
        // same keys, changed options (e.g. index became partial): drop and recreate
        const code = (e as { code?: number }).code;
        if (code !== 85 && code !== 86) throw e;
        const existingIx = (await db.collection(s.name).indexes()).find((i) => JSON.stringify(i.key) === JSON.stringify(ix.keys));
        if (existingIx?.name) await db.collection(s.name).dropIndex(existingIx.name);
        await db.collection(s.name).createIndex(ix.keys, opts);
      }
    }
  }
  return specs.map((s) => s.name);
}

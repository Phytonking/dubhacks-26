import type { Document } from "mongodb";

// Collections owned by the agent engine (verification, opt-outs, turn log, owner notices, secure forms).
// Same pattern as tmo-schema.ts: specs are spread into schema.ts and applied by `applySchema`.
// Validators are strict about types and required keys but do not forbid extra fields, so the engine can add fields without a migration.

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
const en = (...v: string[]) => ({ enum: v });
const obj = (required: string[], properties: Document): Document => ({ bsonType: "object", ...(required.length ? { required } : {}), properties });

export const agentSpecs: CollectionSpec[] = [
  {
    // One-time codes. The code itself is never stored: only a keyed hash. Rows are purged after a week.
    name: "verifications",
    schema: obj(["orgId", "contactId", "number", "purpose", "codeHmac", "status", "attempts", "maxAttempts", "expiresAt", "createdAt", "purgeAt"], {
      orgId: oid, contactId: oid, number: str, purpose: str, codeHmac: str,
      status: en("pending", "verified", "superseded", "locked", "expired"),
      attempts: num, maxAttempts: num, expiresAt: date, sentVia: strOrNull, verifiedAt: dateOrNull, createdAt: date, purgeAt: date,
    }),
    indexes: [
      { keys: { orgId: 1, number: 1, createdAt: -1 } },     // send limits per number
      { keys: { contactId: 1, status: 1, createdAt: -1 } },  // find the pending code to check
      { keys: { purgeAt: 1 }, ttl: 0 },
    ],
  },
  {
    // STOP list. A number that opted out is never texted again, on any channel, until START.
    name: "opt_outs",
    schema: obj(["orgId", "address", "at", "source"], { orgId: oid, address: str, channels: str, at: date, source: str, keyword: strOrNull }),
    indexes: [{ keys: { orgId: 1, address: 1 }, unique: true }],
  },
  {
    // One row per agent turn: what was batched, how many model rounds, what tools ran, what came out.
    name: "agent_turns",
    schema: obj(["orgId", "conversationId", "turnId", "channel", "mode", "outcome", "startedAt"], {
      orgId: oid, conversationId: oid, contactId: oidOrNull, turnId: str, channel: str, mode: en("text", "voice"),
      batchMessageIds: { bsonType: "array", items: oid }, rounds: num,
      outcome: en("reply", "escalated", "discarded", "failed", "silent", "blocked"),
      model: strOrNull, effort: strOrNull, tokensIn: num, tokensOut: num, ms: num, attempts: num, note: strOrNull,
      toolCalls: { bsonType: "array", items: obj(["name", "ok"], { name: str, ok: bool, ms: num }) },
      startedAt: date,
    }),
    indexes: [
      { keys: { turnId: 1 }, unique: true },
      { keys: { conversationId: 1, startedAt: -1 } },
      { keys: { orgId: 1, startedAt: -1 } },
    ],
  },
  {
    // Messages for the business owner (callback requested, handoff, hot lead).
    name: "notifications",
    schema: obj(["orgId", "kind", "message", "urgency", "read", "createdAt"], {
      orgId: oid, contactId: oidOrNull, conversationId: oidOrNull, kind: str, message: str, urgency: en("low", "normal", "high"), read: bool, createdAt: date,
    }),
    indexes: [{ keys: { orgId: 1, read: 1, createdAt: -1 } }],
  },
  {
    // A private link sent to one contact. Only the SHA-256 of the token is stored.
    name: "form_requests",
    schema: obj(["orgId", "contactId", "template", "tokenHash", "status", "expiresAt", "createdAt"], {
      orgId: oid, contactId: oid, conversationId: oidOrNull, template: str, tokenHash: str,
      status: en("pending", "completed", "expired", "revoked"), expiresAt: date, createdAt: date, completedAt: dateOrNull, stepUp: bool,
    }),
    indexes: [
      { keys: { tokenHash: 1 }, unique: true },
      { keys: { orgId: 1, contactId: 1, createdAt: -1 } },
    ],
  },
  {
    // Answers. `fields` are plain; `secrets` hold AES-256-GCM envelopes ({iv, tag, ct}) per sensitive field.
    name: "form_submissions",
    schema: obj(["orgId", "requestId", "contactId", "template", "fields", "submittedAt"], {
      orgId: oid, requestId: oid, contactId: oid, template: str, fields: { bsonType: "object" }, secrets: { bsonType: "object" },
      submittedAt: date, eraseAt: dateOrNull, erasedAt: dateOrNull,
    }),
    indexes: [
      { keys: { requestId: 1 }, unique: true },
      { keys: { orgId: 1, submittedAt: -1 } },
      { keys: { eraseAt: 1 } },
    ],
  },
  {
    // Who looked at sensitive data, and when.
    name: "access_logs",
    schema: obj(["orgId", "action", "targetId", "at"], { orgId: oid, userId: oidOrNull, action: str, targetId: oid, field: strOrNull, at: date }),
    indexes: [{ keys: { orgId: 1, at: -1 } }],
  },
  {
    // What the customer agreed to buy, priced server-side. The amount comes from here, never from the page or the model.
    name: "checkout_quotes",
    schema: obj(["orgId", "contactId", "conversationId", "items", "dueTodayCents", "monthlyCents", "requiresApproval", "status", "expiresAt", "createdAt"], {
      orgId: oid, contactId: oid, conversationId: oid, items: { bsonType: "array" }, summary: str, dueTodayCents: num, monthlyCents: num, requiresApproval: bool, ownerLimitCents: num,
      status: en("open", "awaiting_approval", "approved", "paid", "payment_failed", "declined", "cancelled"), expiresAt: date, createdAt: date, updatedAt: date, paidAt: dateOrNull,
    }),
    indexes: [{ keys: { orgId: 1, conversationId: 1, createdAt: -1 } }, { keys: { orgId: 1, status: 1, createdAt: -1 } }],
  },
  {
    // A one-time payment link for one quote. Only the SHA-256 of the token is stored. No card data is ever stored here or anywhere.
    name: "payment_requests",
    schema: obj(["orgId", "contactId", "quoteId", "tokenHash", "status", "attempts", "expiresAt", "createdAt"], {
      orgId: oid, contactId: oid, conversationId: oidOrNull, quoteId: oid, tokenHash: str, status: en("pending", "processing", "completed", "revoked", "locked"),
      attempts: num, lastFailure: strOrNull, processingAt: dateOrNull, expiresAt: date, createdAt: date, completedAt: dateOrNull,
    }),
    indexes: [{ keys: { tokenHash: 1 }, unique: true }, { keys: { quoteId: 1, createdAt: -1 } }],
  },
  {
    // A successful charge. Brand and last 4 only (never the number, expiry or CVC). One per payment link.
    name: "payments",
    schema: obj(["orgId", "quoteId", "requestId", "amountCents", "brand", "last4", "authCode", "status", "createdAt"], {
      orgId: oid, contactId: oid, conversationId: oidOrNull, quoteId: oid, requestId: oid, amountCents: num, brand: str, last4: { bsonType: "string", pattern: "^\\d{4}$" },
      authCode: str, gateway: str, status: en("succeeded", "refunded"), createdAt: date,
    }),
    indexes: [{ keys: { requestId: 1 }, unique: true }, { keys: { orgId: 1, createdAt: -1 } }],
  },
];

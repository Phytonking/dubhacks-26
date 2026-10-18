import type { ObjectId } from "mongodb";

// Channels are staged: iMessage (MVP) -> WhatsApp -> SMS/voice. Model is channel-agnostic.
export type Channel = "imessage" | "whatsapp" | "sms" | "voice";

export type Org = {
  _id: ObjectId;
  name: string;
  productDescription: string;
  brandVoice: string;
  hours: string;
  plan: "free" | "pro";
  createdAt: Date;
};

export type Agent = {
  _id: ObjectId;
  orgId: ObjectId; // unique: exactly one agent per business
  status: "draft" | "provisioning" | "running" | "sleeping" | "error";
  harness: "hermes" | "fx" | null;
  persona: string;
  guardrails: { maxDiscountPct: number; escalateOn: string[] };
  enabledChannels: Record<Channel, boolean>;
  sandboxId: string | null;
  deploy?: { startedAt?: Date; steps: { name: string; ok: boolean; ms: number; detail?: string | null; at?: Date }[] };
  updatedAt: Date;
};

export type ContactStage = "new" | "engaged" | "qualified" | "won" | "lost";

export type Contact = {
  _id: ObjectId;
  orgId: ObjectId;
  handles: { channel: Channel; address: string }[];
  name: string;
  stage: ContactStage;
  score: number;
  notes: string;
  facts: Fact[]; // learned by the agent, with provenance
  createdAt: Date;
};

export type Conversation = {
  _id: ObjectId;
  orgId: ObjectId;
  contactId: ObjectId;
  mode: "agent" | "human";
  lastChannel: Channel;
  lastMessageAt: Date;
  lastMessagePreview: string;
};

export type Message = {
  _id: ObjectId;
  orgId: ObjectId;
  conversationId: ObjectId;
  channel: Channel;
  direction: "in" | "out";
  sender: "customer" | "agent" | "owner";
  body: string;
  channelMsgId: string | null; // null while an outbound message is queued
  deliveryStatus: "received" | "queued" | "sending" | "sent" | "delivered" | "failed" | "blocked";
  clientMsgId?: string | null; // our idempotency key for outbound sends
  agentTurnId?: string | null;
  replyGroupId?: string | null;
  callId?: ObjectId | null;
  handling?: "agent" | "ignored" | "opted_out" | "rejected" | "human";
  guardrail?: { verdict: string; reason?: string } | null;
  attempts?: number;
  ref?: { spaceId?: string; senderId?: string; parentMessageId?: string } | null;
  deliveryError: string | null;
  attachments: Attachment[];
  reactions: Reaction[];
  replyTo: ObjectId | null;
  ts: Date;
};

// ---- Added in the full database build-out ----

export type Fact = { text: string; sourceMessageId: ObjectId | null; learnedAt: Date };

export type Attachment = { kind: "image" | "video" | "audio" | "file"; url: string; mime: string; name: string; sizeBytes: number };
export type Reaction = { type: string; by: "customer" | "agent" | "owner"; ts: Date };

export type User = {
  _id: ObjectId;
  orgId: ObjectId;
  email: string;
  name: string;
  role: "owner" | "admin";
  authProviderId: string | null; // auth approach TBD
  phone?: string | null; // E.164; ties the owner/tester to their number
  createdAt: Date;
};

export type ChannelLine = {
  _id: ObjectId;
  orgId: ObjectId;
  channel: Channel;
  provider: "photon";
  photonLineId: string | null;
  address: string; // E.164 number or handle customers message
  status: "pending" | "active" | "disabled";
  capabilities: string[];
  createdAt: Date;
};

export type Sandbox = {
  _id: ObjectId;
  orgId: ObjectId;
  daytonaId: string | null;
  state: "creating" | "running" | "stopped" | "error" | "deleted";
  snapshotVersion: string;
  createdAt: Date;
  lastActiveAt: Date | null;
  costAccruedCents: number;
};

export type ToolCall = {
  _id: ObjectId;
  orgId: ObjectId;
  conversationId: ObjectId | null;
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  status: "ok" | "error" | "blocked";
  ms: number;
  approvedBy: ObjectId | null;
  ts: Date;
};

export type KnowledgeSource = {
  _id: ObjectId;
  orgId: ObjectId;
  kind: "catalog" | "faq" | "doc" | "url";
  title: string;
  content: string;
  sourceUrl: string | null;
  version: number;
  status: "pending" | "ready" | "error";
  createdAt: Date;
};

export type KnowledgeChunk = {
  _id: ObjectId;
  orgId: ObjectId;
  knowledgeId: ObjectId;
  idx: number;
  text: string;
  embedding: number[] | null; // filled once an embedding model is chosen
  createdAt: Date;
};

export type Usage = {
  _id: ObjectId;
  orgId: ObjectId;
  day: string; // YYYY-MM-DD (UTC)
  tokensIn: number;
  tokensOut: number;
  messagesIn: number;
  messagesOut: number;
  sandboxSec: number;
};

export type Template = {
  _id: ObjectId;
  orgId: ObjectId;
  channel: Channel;
  name: string;
  body: string;
  variables: string[];
  approvalStatus: "draft" | "pending" | "approved" | "rejected";
  createdAt: Date;
};

export type Call = {
  _id: ObjectId;
  orgId: ObjectId;
  contactId: ObjectId;
  conversationId: ObjectId;
  direction: "in" | "out";
  status: "ringing" | "active" | "completed" | "missed" | "failed";
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number;
  recordingUrl: string | null;
  summary: string;
  outcome: string;
};

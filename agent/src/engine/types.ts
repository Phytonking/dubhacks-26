import type { Db, ObjectId } from "mongodb";
import type { ChannelId, Party } from "../identity";
import type { Customer } from "../customer";
import type { Messenger } from "../messenger";
import type { GuardCfg } from "./guardrails";

// ---- model port -------------------------------------------------------------------------------------------------
export type ToolCallReq = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCallReq[] }
  | { role: "tool"; tool_call_id: string; content: string };
export type ToolSpec = { type: "function"; function: { name: string; description: string; parameters: JsonSchema } };
export type Effort = "none" | "low" | "medium";
export type Usage = { prompt_tokens: number; completion_tokens: number };
export type ChatRequest = { messages: ChatMessage[]; tools?: ToolSpec[]; effort: Effort; maxTokens: number; temperature: number; signal?: AbortSignal };
export type ChatResponse = { message: { role: "assistant"; content: string | null; tool_calls?: ToolCallReq[] }; usage: Usage; finish: string };
export type Delta =
  | { type: "content"; text: string }
  | { type: "tool"; index: number; id?: string; name?: string; args?: string }
  | { type: "done"; finish: string; usage?: Usage };
export interface LlmPort {
  model: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
  stream(req: ChatRequest): AsyncIterable<Delta>;
}

// ---- tools ------------------------------------------------------------------------------------------------------
export type JsonSchema = { type: "object"; properties: Record<string, any>; required?: string[]; additionalProperties?: boolean };
export type Risk = "read" | "write_low" | "write_high";
export type Mode = "text" | "voice";

export type ToolCtx = {
  db: Db;
  orgId: ObjectId;
  contactId: ObjectId;
  conversationId: ObjectId;
  channel: ChannelId;
  mode: Mode;
  party: Party;
  customer: Customer;         // verified flag is re-read before every tool call
  turnId: string;
  sourceMessageId: ObjectId | null;
  now: Date;
  messenger: Messenger;
  env: EngineEnv;
  guard: { cfg: GuardCfg; evidence: string[] };
  callId?: ObjectId | null;      // the voice call this turn belongs to, if any
  calls?: Map<string, string>;   // tool+arguments already run this turn (a model that repeats a call gets a reminder instead of a re-run)   // same rules and evidence the final reply is checked against
};
export type ToolResult = {
  ok: boolean;
  data?: unknown;             // goes to the model. NEVER contains a secret (code, link).
  error?: string;             // short machine code, also given to the model
  audit?: unknown;            // stored in tool_calls instead of data when they differ (secrets redacted)
  sideEffect?: boolean;       // the tool changed something in the world (blocks discarding the draft)
  escalate?: boolean;         // the conversation was handed to a person
  reply?: string;             // use EXACTLY this as the reply to the customer and end the turn (for instructions that must not be paraphrased, e.g. which number to text)
};
export type Tool = {
  name: string;               // snake_case, 1-64 chars
  description: string;
  parameters: JsonSchema;
  risk: Risk;
  requiresVerified?: boolean; // enforced by the executor
  redactArgs?: boolean;       // arguments are not stored in tool_calls (e.g. a code the customer read back)
  timeoutMs?: number;
  run(ctx: ToolCtx, args: any): Promise<ToolResult>;
};

export type EngineEnv = {
  brandFallback: string;
  publicFormsBaseUrl: string;
  verifySecret: string;
  formsMasterKey?: string;
  /** Give this person an iMessage line to text (shared plan). Returns its number or null. Set by the live runner; absent in tests unless stubbed. */
  assignIMessage?: (a: { orgId: import("mongodb").ObjectId; handle: string; firstName?: string }) => Promise<string | null>;
  now?: () => Date;
};

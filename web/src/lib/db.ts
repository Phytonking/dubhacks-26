import { MongoClient, type Db } from "mongodb";
import type {
  Agent, Call, ChannelLine, Contact, Conversation, KnowledgeChunk, KnowledgeSource,
  Message, Org, Sandbox, Template, ToolCall, Usage, User,
} from "./models";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB ?? "salesagent";

// Cache the client on globalThis so dev HMR doesn't open a new pool per reload.
const g = globalThis as unknown as { _mongo?: Promise<MongoClient> };

function client(): Promise<MongoClient> {
  if (!uri) throw new Error("MONGODB_URI is not set (see web/.env.example)");
  g._mongo ??= new MongoClient(uri).connect();
  return g._mongo;
}

export async function getDb(): Promise<Db> {
  return (await client()).db(dbName);
}

export async function collections() {
  const db = await getDb();
  return {
    orgs: db.collection<Org>("orgs"),
    users: db.collection<User>("users"),
    agents: db.collection<Agent>("agents"),
    contacts: db.collection<Contact>("contacts"),
    conversations: db.collection<Conversation>("conversations"),
    messages: db.collection<Message>("messages"),
    channelLines: db.collection<ChannelLine>("channel_lines"),
    sandboxes: db.collection<Sandbox>("sandboxes"),
    toolCalls: db.collection<ToolCall>("tool_calls"),
    knowledge: db.collection<KnowledgeSource>("knowledge"),
    knowledgeChunks: db.collection<KnowledgeChunk>("knowledge_chunks"),
    usage: db.collection<Usage>("usage"),
    templates: db.collection<Template>("templates"),
    calls: db.collection<Call>("calls"),
  };
}

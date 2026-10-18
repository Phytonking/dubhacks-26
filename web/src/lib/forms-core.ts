import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import type { Db, ObjectId } from "mongodb";
import { ObjectId as Oid } from "mongodb";
import { FORM_TEMPLATES, type FormTemplate } from "./form-templates";

// Secure forms: single-use tokens, validation, field-level encryption, owner reveal with an access log.
// Imported by the web app AND by the agent (which creates requests), so there is exactly one implementation. No Next.js imports here.

export const newToken = () => randomBytes(32).toString("base64url");           // 256 bits, shown once in the link
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");   // only the hash is stored

// ---- encryption: AES-256-GCM, per-business key derived from a master key that lives outside the database ----
export type Envelope = { iv: string; tag: string; ct: string };
function orgKey(masterB64: string, orgId: string): Buffer {
  const master = Buffer.from(masterB64 ?? "", "base64");
  if (master.length !== 32) throw new Error("FORM_ENC_KEY must be 32 bytes, base64-encoded");
  return Buffer.from(hkdfSync("sha256", master, Buffer.from(orgId), Buffer.from("form-secrets-v1"), 32));
}
export function encryptSecret(masterB64: string, orgId: string, plaintext: string, aad: string): Envelope {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", orgKey(masterB64, orgId), iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return { iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), ct: ct.toString("base64") };
}
export function decryptSecret(masterB64: string, orgId: string, e: Envelope, aad: string): string {
  const d = createDecipheriv("aes-256-gcm", orgKey(masterB64, orgId), Buffer.from(e.iv, "base64"));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(e.tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(e.ct, "base64")), d.final()]).toString("utf8");   // throws if tampered or bound to a different request/field
}

// ---- validation ----
export type Validation = { ok: true; clean: Record<string, string> } | { ok: false; errors: Record<string, string> };
export function validateSubmission(tpl: FormTemplate, values: Record<string, unknown>): Validation {
  const errors: Record<string, string> = {}; const clean: Record<string, string> = {};
  for (const f of tpl.fields) {
    const raw = values[f.key];
    const v = typeof raw === "string" ? raw.trim() : "";
    if (!v) { if (f.required) errors[f.key] = "Required"; continue; }
    if (v.length > (f.maxLength ?? 200)) { errors[f.key] = "Too long"; continue; }
    if (f.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { errors[f.key] = "Enter a valid email"; continue; }
    if (f.type === "tel" && !/^\+?[\d\s().-]{7,20}$/.test(v)) { errors[f.key] = "Enter a valid phone number"; continue; }
    if (f.type === "select" && !f.options?.includes(v)) { errors[f.key] = "Choose one of the options"; continue; }
    if (f.type === "date" && Number.isNaN(Date.parse(v))) { errors[f.key] = "Enter a valid date"; continue; }
    clean[f.key] = v;
  }
  for (const k of Object.keys(values)) if (!tpl.fields.some((f) => f.key === k) && !k.startsWith("$") && k !== "token") errors[k] = "Unexpected field";
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, clean };
}

// ---- requests ----
export async function createFormRequest(db: Db, a: { orgId: ObjectId; contactId: ObjectId; conversationId: ObjectId | null; template: string; now?: Date }) {
  const tpl = FORM_TEMPLATES[a.template];
  if (!tpl) throw new Error(`unknown form template "${a.template}"`);
  const now = a.now ?? new Date();
  const token = newToken();
  await db.collection("form_requests").updateMany({ orgId: a.orgId, contactId: a.contactId, template: a.template, status: "pending" }, { $set: { status: "revoked" } });   // one live link per template
  const r = await db.collection("form_requests").insertOne({
    orgId: a.orgId, contactId: a.contactId, conversationId: a.conversationId, template: a.template, tokenHash: hashToken(token),
    status: "pending", expiresAt: new Date(now.getTime() + tpl.expiryMinutes * 60_000), createdAt: now, completedAt: null, stepUp: tpl.stepUp,
  } as never);
  return { id: r.insertedId, token, expiresAt: new Date(now.getTime() + tpl.expiryMinutes * 60_000), template: tpl };
}

export type RenderState =
  | { state: "valid"; request: any; template: FormTemplate; brand: string }
  | { state: "invalid" | "expired" | "completed" };
/** READ ONLY. Link-preview bots and prefetchers call this via GET; it must never consume or alter the link. */
export async function loadRequestForRender(db: Db, token: string, now = new Date()): Promise<RenderState> {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return { state: "invalid" };
  const req: any = await db.collection("form_requests").findOne({ tokenHash: hashToken(token) });
  if (!req) return { state: "invalid" };
  if (req.status === "completed") return { state: "completed" };
  if (req.status !== "pending" || req.expiresAt.getTime() <= now.getTime()) return { state: "expired" };
  const template = FORM_TEMPLATES[req.template];
  if (!template) return { state: "invalid" };
  const org: any = await db.collection("orgs").findOne({ _id: req.orgId }, { projection: { name: 1 } });
  return { state: "valid", request: req, template, brand: org?.name ?? "" };
}

export type SubmitResult = { ok: true; submissionId: ObjectId } | { ok: false; error: "invalid" | "expired" | "completed" | "validation"; errors?: Record<string, string> };
export async function submitForm(db: Db, a: { token: string; values: Record<string, unknown>; masterKey: string; now?: Date }): Promise<SubmitResult> {
  const now = a.now ?? new Date();
  const st = await loadRequestForRender(db, a.token, now);
  if (st.state !== "valid") return { ok: false, error: st.state };
  const v = validateSubmission(st.template, a.values);
  if (!v.ok) return { ok: false, error: "validation", errors: v.errors };
  // consume the link atomically: of two simultaneous submits only one wins
  const req: any = await db.collection("form_requests").findOneAndUpdate(
    { _id: st.request._id, status: "pending", expiresAt: { $gt: now } }, { $set: { status: "completed", completedAt: now } }, { returnDocument: "after" });
  if (!req) return { ok: false, error: "completed" };
  const fields: Record<string, string> = {}; const secrets: Record<string, Envelope> = {};
  try {
    for (const f of st.template.fields) {
      const val = v.clean[f.key]; if (val === undefined) continue;
      if (f.sensitive) secrets[f.key] = encryptSecret(a.masterKey, String(req.orgId), val, `${req._id}:${f.key}`); else fields[f.key] = val;
    }
    const ins = await db.collection("form_submissions").insertOne({
      orgId: req.orgId, requestId: req._id, contactId: req.contactId, template: req.template, fields, secrets, submittedAt: now, eraseAt: new Date(now.getTime() + 90 * 86400_000), erasedAt: null,
    } as never);
    const conv: any = req.conversationId ? await db.collection("conversations").findOne({ _id: req.conversationId }) : null;
    if (conv) {   // a plain marker in the thread: the agent learns "completed", never the values
      await db.collection("messages").insertOne({ orgId: req.orgId, conversationId: conv._id, channel: conv.lastChannel ?? "sms", direction: "in", sender: "customer",
        body: `Completed secure form: ${st.template.title}`, channelMsgId: `form:${req._id}`, deliveryStatus: "received", handling: "ignored", ts: now } as never).catch(() => {});
      await db.collection("conversations").updateOne({ _id: conv._id }, { $set: { lastMessageAt: now, lastMessagePreview: `Completed secure form: ${st.template.title}` } });
    }
    return { ok: true, submissionId: ins.insertedId };
  } catch (e) {
    await db.collection("form_requests").updateOne({ _id: req._id }, { $set: { status: "pending", completedAt: null } });   // do not burn the link on our own failure
    throw e;
  }
}

/** Owner reads one sensitive value. Always writes an access log first; the read fails if the log cannot be written. */
export async function revealField(db: Db, a: { orgId: ObjectId; submissionId: ObjectId; field: string; userId: ObjectId | null; masterKey: string; now?: Date }): Promise<string | null> {
  const sub: any = await db.collection("form_submissions").findOne({ _id: a.submissionId, orgId: a.orgId });
  const env: Envelope | undefined = sub?.secrets?.[a.field];
  if (!sub || !env) return null;
  await db.collection("access_logs").insertOne({ orgId: a.orgId, userId: a.userId, action: "reveal_form_field", targetId: sub._id, field: a.field, at: a.now ?? new Date() } as never);
  return decryptSecret(a.masterKey, String(a.orgId), env, `${sub.requestId}:${a.field}`);
}

/** What the agent is allowed to know about a form: completion plus fields marked agentVisible (never sensitive ones). */
export async function agentViewOfForm(db: Db, orgId: ObjectId, contactId: ObjectId, template: string) {
  const req: any = await db.collection("form_requests").findOne({ orgId, contactId, template }, { sort: { createdAt: -1 } });
  if (!req) return { status: "none" as const };
  const tpl = FORM_TEMPLATES[template];
  if (req.status !== "completed") return { status: req.status === "pending" && req.expiresAt.getTime() <= Date.now() ? ("expired" as const) : (req.status as "pending" | "expired" | "revoked") };
  const sub: any = await db.collection("form_submissions").findOne({ requestId: req._id });
  const visible: Record<string, string> = {};
  for (const f of tpl?.fields ?? []) if (f.agentVisible && !f.sensitive && sub?.fields?.[f.key] != null) visible[f.key] = sub.fields[f.key];
  return { status: "completed" as const, fields: visible };
}
export const toObjectId = (s: string) => new Oid(s);

import type { Db, ObjectId } from "mongodb";
import { normalizeAddress, type ChannelId } from "./identity";
import type { Messenger } from "./messenger";

// The business's own numbers, and how a customer gets from "on a call" to "texting us" (or from "texting us" to "calling us").
// Facts this is built on (verified 2026-10-18): the voice number and the WhatsApp number can be the same line; the iMessage line is a DIFFERENT
// number; a shared iMessage line can only chat with people assigned to it, who must text it first; WhatsApp replies are free-form for 24 hours
// after the customer's last message.
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** "+16289988199" -> "+1 (628) 998-8199" */
export function displayNumber(e164: string): string {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : e164;
}
/** For a voice call, in groups a person can write down: "six two eight, nine nine eight, eight one nine nine" */
export function spokenNumber(e164: string): string {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  const say = (d: string) => d.split("").map((c) => WORDS[Number(c)]).join(" ");
  return m ? `${say(m[1])}, ${say(m[2])}, ${say(m[3])}` : e164.replace(/\D/g, "").split("").map((c) => WORDS[Number(c)]).join(" ");
}

export type Lines = { voice: string | null; whatsapp: string | null; imessage: string[]; sms: string | null };
export async function businessLines(db: Db, orgId: ObjectId): Promise<Lines> {
  const rows = await db.collection("channel_lines").find({ orgId, status: "active" }).toArray() as any[];
  const voice = rows.find((r) => r.channel === "voice") ?? rows.find((r) => (r.capabilities ?? []).includes("pstn_voice"));
  return {
    voice: voice?.address ?? null,
    whatsapp: rows.find((r) => r.channel === "whatsapp")?.address ?? null,
    imessage: rows.filter((r) => r.channel === "imessage").map((r) => r.address),
    sms: rows.find((r) => r.channel === "sms")?.address ?? null,
  };
}

/** Text for the system prompt: how customers reach THIS business. Numbers are given in written and spoken form. */
export function contactMethodsBlock(l: Lines): string {
  const out: string[] = [];
  out.push(l.voice ? `- Phone (to speak with us): ${displayNumber(l.voice)}. Say it slowly on a call: ${spokenNumber(l.voice)}.` : "- Phone: no phone number is configured. If someone wants to call, offer a person (handoff_escalate).");
  out.push(l.whatsapp ? `- WhatsApp: ${displayNumber(l.whatsapp)}. A message from the customer opens a window in which you can reply and send links or forms.` : "- WhatsApp: not available.");
  out.push(l.sms || l.voice ? `- Text message to the phone number (${displayNumber((l.sms ?? l.voice)!)}): a customer can text it to send us information; we read it but CANNOT text back from that number. Never promise a text reply from it.` : "- Text message: not available.");
  out.push("- iMessage: a test line only; call contact_options for the right number and whether it applies to this person. Never guess a number.");
  out.push("- Email: not available yet.");
  return out.join("\n");
}

export type ReachOption = {
  channel: "imessage" | "whatsapp";
  number: string; display: string; spoken: string;
  readyNow: boolean;              // we can already text them there, no action needed from them
  howTo: string;                  // what to tell the customer
};
type Num = { number: string; display: string; spoken: string };
/** `textIn`: the number a caller can text from their own phone. We can read it but cannot text back (SMS sending needs a carrier campaign), so it is only for sending us information. */
export type Reach = { voice: Num | null; options: ReachOption[]; textIn: Num | null; notes: string[] };

export type ReachDeps = {
  db: Db; messenger: Messenger;
  /** Create (or find) the iMessage line this person should text. Returns its number, or null if none can be given (capacity, error). */
  assignIMessage?: (a: { orgId: ObjectId; handle: string; firstName?: string }) => Promise<string | null>;
};

/**
 * Work out how this person can continue by text, and how they can call us. Reuses their existing iMessage assignment when there is one;
 * otherwise asks for a new one (when an assigner is configured). Never invents a number.
 */
export async function computeReach(deps: ReachDeps, a: { orgId: ObjectId; contact: any; conversationId: ObjectId }): Promise<Reach> {
  const { db } = deps; const lines = await businessLines(db, a.orgId);
  const phone = (a.contact.handles ?? []).map((h: any) => h.address).find((x: string) => /^\+\d{8,15}$/.test(x)) as string | undefined;
  const options: ReachOption[] = []; const notes: string[] = [];
  const mk = (channel: "imessage" | "whatsapp", number: string, readyNow: boolean, howTo: string): ReachOption => ({ channel, number, display: displayNumber(number), spoken: spokenNumber(number), readyNow, howTo });

  if (phone) {
    // iMessage: the line is per person on a shared plan. Look for the one already assigned to this phone number first.
    const ctxFor = (channel: ChannelId) => ({ orgId: a.orgId, contact: a.contact, conversationId: a.conversationId, address: phone });
    const row: any = await db.collection("channel_lines").findOne({ orgId: a.orgId, channel: "imessage", status: "active", handles: normalizeAddress(phone) });
    let imNumber: string | null = row?.address ?? null;
    const imReady = (await deps.messenger.isReady("imessage", ctxFor("imessage"))).ok;
    if (!imNumber && imReady) imNumber = lines.imessage[0] ?? null;                                  // they have texted us before: we can already reply
    if (!imNumber && deps.assignIMessage) imNumber = await deps.assignIMessage({ orgId: a.orgId, handle: normalizeAddress(phone), firstName: a.contact.profile?.displayName ?? undefined }).catch(() => null);
    if (imNumber) options.push(mk("imessage", imNumber, imReady,
      imReady ? `I can text you on iMessage from ${displayNumber(imNumber)}.` : `Send a short text from iMessage to ${displayNumber(imNumber)}. This is a different number from the one you called. Once I see your message I can send it to you there.`));
    else if (deps.assignIMessage) notes.push("No iMessage line could be given to this person right now.");

    if (lines.whatsapp) {
      const waReady = (await deps.messenger.isReady("whatsapp", ctxFor("whatsapp"))).ok;
      options.push(mk("whatsapp", lines.whatsapp, waReady,
        waReady ? `I can message you on WhatsApp from ${displayNumber(lines.whatsapp)}.` : `Send any message on WhatsApp to ${displayNumber(lines.whatsapp)}. Once I see it I can send it to you there.`));
    }
  } else notes.push("This person has no phone number on file, so a text cannot be arranged. Offer a person.");

  const numOf = (n: string | null): Num | null => (n ? { number: n, display: displayNumber(n), spoken: spokenNumber(n) } : null);
  return { voice: numOf(lines.voice), options, textIn: numOf(lines.sms ?? lines.voice), notes };
}

/** Remember that the customer is moving to text, so the next text-channel turn finishes the job. Not duplicated while one is open. */
export async function recordPendingText(db: Db, a: { orgId: ObjectId; contactId: ObjectId; text: string; sourceMessageId: ObjectId | null; now: Date }) {
  const c: any = await db.collection("contacts").findOne({ _id: a.contactId, orgId: a.orgId }, { projection: { memory: 1 } });
  if ((c?.memory?.openLoops ?? []).some((l: any) => l.status !== "done" && l.kind === "continue_by_text" && l.text === a.text)) return false;
  await db.collection("contacts").updateOne({ _id: a.contactId, orgId: a.orgId }, { $push: { "memory.openLoops": { text: a.text, kind: "continue_by_text", status: "open", dueAt: null, sourceMessageId: a.sourceMessageId, createdAt: a.now } } as never });
  return true;
}

import { readFileSync } from "node:fs";

const CHANNEL_STYLE: Record<string, string> = {
  imessage: "Text message style: 1 to 3 short sentences, natural, no markdown, no bullet lists. Write money and numbers with digits ($100), even if earlier messages were spoken.",
  whatsapp: "Chat style: 1 to 3 short sentences, natural, no markdown tables. Plain text only. Write money and numbers with digits ($100).",
  sms: "SMS: plain text, under 300 characters, no emoji, no markdown, one short paragraph. Write money with digits ($100).",
  voice: "Phone call: spoken style, one or two short sentences, 35 words at most. Say numbers the way you would speak them. No URLs, lists or markdown; offer to text a link instead. If the caller sounds unsure, offer to repeat.",
};
export const channelStyle = (c: string) => CHANNEL_STYLE[c] ?? CHANNEL_STYLE.imessage;

/** Fill {{placeholders}}. A missing value is a bug, not an empty string: throw instead of sending a half-built prompt. */
export function renderPrompt(template: string, vars: Record<string, string>): string {
  const missing = new Set<string>();
  const out = template.replace(/\{\{(\w+)\}\}/g, (_, k) => { if (!(k in vars) || vars[k] === undefined) { missing.add(k); return ""; } return vars[k]; });
  if (missing.size) throw new Error(`prompt placeholders without a value: ${[...missing].join(", ")}`);
  return out;
}
export const loadTemplate = (name: string) => readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), "utf8");

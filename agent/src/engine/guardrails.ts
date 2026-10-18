// Rules enforced in code, outside the model. One module for text and voice (conflict C10).
export type Verdict = { verdict: "ok" } | { verdict: "blocked"; reason: string; kind: "discount" | "ungrounded_amount" };

/** Discount ceiling: "50% off" above the allowed maximum is blocked. */
export function checkDiscount(text: string, maxDiscountPct: number): Verdict {
  for (const m of text.matchAll(/(\d{1,3})\s*%\s*(off|discount)/gi)) {
    if (Number(m[1]) > maxDiscountPct) return { verdict: "blocked", reason: `discount ${m[1]}% exceeds max ${maxDiscountPct}%`, kind: "discount" };
  }
  return { verdict: "ok" };
}

const AMOUNT = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;
/** "$1,450" -> "1450.00" so $1,450 and 1450 and $1450.00 compare equal. */
const norm = (whole: string, cents?: string) => `${whole.replace(/,/g, "")}.${(cents ?? "0").padEnd(2, "0")}`;
export function amountsIn(text: string): string[] {
  return [...text.matchAll(AMOUNT)].map((m) => norm(m[1], m[2]));
}
/**
 * Money must be grounded: every dollar amount in a reply has to appear in this turn's evidence (tool results, knowledge shown to the model,
 * the customer snapshot, or the customer's own words). This is the code-level version of "never invent a price".
 */
export function checkGroundedMoney(text: string, evidence: string[]): Verdict {
  const ev = new Set<string>();
  for (const e of evidence) {
    for (const a of amountsIn(e)) ev.add(a);
    for (const m of e.matchAll(/(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d,])/g)) ev.add(norm(m[1], m[2]));   // bare numbers ("1450", "89.00")
  }
  for (const a of amountsIn(text)) if (!ev.has(a)) return { verdict: "blocked", reason: `amount $${a.replace(/\.00$/, "")} is not in this turn's evidence`, kind: "ungrounded_amount" };
  return { verdict: "ok" };
}

export type GuardCfg = { maxDiscountPct: number; requireGroundedMoney?: boolean };
export function checkText(text: string, cfg: GuardCfg, evidence: string[]): Verdict {
  const d = checkDiscount(text, cfg.maxDiscountPct);
  if (d.verdict !== "ok") return d;
  if (cfg.requireGroundedMoney) return checkGroundedMoney(text, evidence);
  return { verdict: "ok" };
}

/** Pull complete sentences off the front of a streaming buffer. Returns [sentences, rest]. Keeps decimals ($41.51) and abbreviations intact. */
export function takeSentences(buf: string, flushAll = false): [string[], string] {
  const out: string[] = []; let start = 0;
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if ((c === "." || c === "!" || c === "?" || c === "\n") && (i + 1 === buf.length ? flushAll : /\s/.test(buf[i + 1]))) {
      if (c === "." && /\d$/.test(buf.slice(Math.max(0, i - 1), i)) && /^\d/.test(buf.slice(i + 1, i + 2))) continue;   // 41.51
      const s = buf.slice(start, i + 1).trim();
      if (s) out.push(s);
      start = i + 1;
    }
  }
  let rest = buf.slice(start);
  if (flushAll && rest.trim()) { out.push(rest.trim()); rest = ""; }
  return [out, rest.replace(/^\s+/, "")];
}

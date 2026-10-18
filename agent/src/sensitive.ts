// Private numbers and secrets. Three jobs: (1) never keep or forward a card number or SSN a customer typed or said, (2) refuse to "remember" one,
// (3) stop the assistant itself from asking for a password, PIN, SSN or card number in a chat or on a call (it must move to text / a secure form).

const luhn = (digits: string) => { let sum = 0, alt = false; for (let i = digits.length - 1; i >= 0; i--) { let n = Number(digits[i]); if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; } return sum % 10 === 0; };

/** Replace SSNs and card numbers with a marker. Phone numbers, order numbers and plain amounts are left alone (cards must pass the Luhn check). */
export function redactSensitive(text: string): { text: string; redacted: boolean } {
  let redacted = false;
  let out = text.replace(/\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g, () => { redacted = true; return "[redacted SSN]"; });
  out = out.replace(/\b(ssn|social(?:\s+security)?(?:\s+number)?)\b([^.\n]{0,25}?)\b(\d{9})\b/gi, (_m, a, b) => { redacted = true; return `${a}${b}[redacted SSN]`; });
  out = out.replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => { const d = m.replace(/\D/g, ""); if (d.length >= 13 && d.length <= 19 && luhn(d)) { redacted = true; return "[redacted card number]"; } return m; });
  return { text: out, redacted };
}

/** Facts and notes must not contain secrets: the tool refuses these. */
export const looksSensitive = (t: string) => redactSensitive(t).redacted || /\b(password|passcode|\bpin\b|cvv|cvc|security code|ssn|social security|routing number|account number)\b/i.test(t);

const ASK_VERB = /\b(what(?:'s| is)|tell me|give me|read(?: me| out)?|say|provide|share|send(?: me)?|enter|confirm|type|need|i'?ll need|can i (?:get|have)|could i (?:get|have)|go ahead and)\b/i;
const SECRET = /\b(?:your|the|their)\s+(?:account\s+)?(?:password|passcode|pin(?:\s+number)?|social\s+security(?:\s+number)?|ssn|(?:full\s+)?(?:credit|debit)?\s*card\s+number|cvv|cvc|security\s+code|routing\s+number|bank\s+account(?:\s+number)?)\b/i;
const NEGATED = /\b(don'?t|do not|never|not|can'?t|cannot|won'?t|shouldn'?t|no need)\b/i;
/** True when the sentence is the assistant ASKING for a secret. "Please don't share your PIN" is not. */
export function asksForSecrets(sentence: string): boolean {
  if (!SECRET.test(sentence) || NEGATED.test(sentence)) return false;
  return ASK_VERB.test(sentence) || /\?\s*$/.test(sentence);
}

export const TEXT_REDIRECT = "For your security, please don't send that here. I can text you a private form instead if you'd like.";

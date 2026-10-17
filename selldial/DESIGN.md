# Design — Selldial

A locked design system for the Selldial dashboard. Every screen reads this file before emitting code. Extend or amend it when the system needs to grow; do not regenerate it per page. Built with Hallmark (redesign, designed-as-app) and UI/UX Pro Max (product reasoning: dense, trustworthy, positive-indicator green).

Two surfaces: the conversation (voice and text through Photon) and the reasoning dashboard (a second screen judges watch beside the call). Both follow the same idea: show the math, never pressure.

## Brand

- Name: Selldial
- Logo: `dashboard/logo.svg`. A D-shaped speech bubble (flat left edge, round right side, tail at bottom left) in `#4C5BD4` with a white rounded-stroke S. The logo keeps its colour in both themes. The wordmark "Selldial" is set in Google Sans 700.
- Tagline: "The phone line that tells you when not to buy."
- Voice: calm, plain, numerate. A good store employee who is on your side.
- T-Mobile's magenta and T mark appear only on the "Log in with T-Mobile" sign-in control (`--color-tmobile`). Nowhere else: we are a project for their track, not their product.
- "Synthetic demo data" appears in every dashboard header.

## Principles

- **Numbers first.** Every claim on screen has a figure next to it.
- **Show the math.** The recommendation is an itemized sum, not a verdict.
- **Show the runner-up.** The best option never appears alone.
- **The guard is visible.** Verification, limit checks, and approvals are states with an icon and a label.
- **One screen, no scrolling during the demo.** The live screen fits 1440x900.
- **Honest labels.** MOCK, SYNTHETIC, and SANDBOX badges wherever they apply.

## Genre

modern-minimal, Cobalt theme: an instrument panel, not a marketing page. Cool engineered paper, hairlines instead of boxes, exactly one cobalt signal, mono for every machine readout.

## Macrostructure family

- **Live screen** (`index.html`): instrument panel. A flush top bar, three regions divided by vertical hairlines (transcript · the math · guards), a signals strip, and a full-bleed graphite audit band. No boxed cards.
- **Sign-in** (`index.html`): the live screen plays behind a graphite scrim with two diagonal brand shards; a centred panel holds a one-liner and two sign-in tiles (Log in with T-Mobile, Log in via another provider). Demo only: no credentials collected.
- **Live screen** moved to `live.html`.
- **Console** (`console.html`): side-rail app with Home, Overview, Conversations, Customers, Sales, Settings and About. Left rail navigation (Hallmark N3), hairline-bordered tables and lists, a drawer for conversation detail.
- No marketing pages yet. If one is added, use Workbench or Marquee and keep this theme.

## Signature move

**The math.** The live recommendation is set as an itemized sum in tabular mono figures, with a ruled total and the saving as the largest number on screen:

```
Upgrade today, after $380 trade-in      $931.00
Promo starting in 3 weeks              −$254.00
Trade-in value lost by waiting          +$40.00
──────────────────────────────────────────────
Wait 3 weeks, then upgrade              $717.00
Saved by waiting                           $214
```

Each line comes from a tool result (agent rule 7). The best option and the runner-up are both visible beside it.

## Theme

Tokens live in `dashboard/tokens.css`. Light is the default; the dark set is a toggle (Ctrl/Cmd+K → Switch theme).

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-paper` | `oklch(98.5% 0.004 256)` | `oklch(17% 0.014 260)` | page |
| `--color-paper-2` | `oklch(96.2% 0.007 256)` | `oklch(21% 0.016 260)` | sunken fills, caller bubbles |
| `--color-rule` | `oklch(90.5% 0.008 256)` | `oklch(29% 0.014 260)` | hairlines |
| `--color-ink` | `oklch(24% 0.02 258)` | `oklch(95% 0.006 256)` | headings, figures |
| `--color-ink-2` | `oklch(33% 0.018 257)` | `oklch(87% 0.008 256)` | body |
| `--color-muted` | `oklch(47% 0.014 257)` | `oklch(71% 0.012 256)` | labels, timestamps |
| `--color-accent` | `oklch(52% 0.19 266)` | `oklch(73% 0.13 266)` | the one signal: primary button, focus, active nav, links |
| `--color-save` | `oklch(48% 0.12 155)` | `oklch(79% 0.14 155)` | money saved, wait, pass |
| `--color-spend` | `oklch(50% 0.13 48)` | `oklch(79% 0.12 55)` | money spent, purchase path |
| `--color-guard` | `oklch(48% 0.1 80)` | `oklch(85% 0.12 90)` | verification, approval pending |
| `--color-block` | `oklch(50% 0.18 25)` | `oklch(75% 0.15 25)` | blocked, denied |
| `--color-graphite` | `oklch(21% 0.016 260)` | `oklch(12.5% 0.012 260)` | the audit band |

Each state colour has a `-wash` tint for backgrounds. The accent covers under 5% of any viewport. State colours appear only where they carry meaning and always with an icon plus a label. No pure black or white, no gradients, no glass.

## Typography

- Display: Space Grotesk 500/600, tracking −0.02em. Headings, the recommendation title, the saving figure.
- Body: Google Sans 400/500. All UI and running text; the wordmark at 700.
- Mono: JetBrains Mono 400/500. Every figure in the math, the audit log, tool names, IDs, tokens, region labels (UPPERCASE, 0.06em).
- Scale: 12 / 14 / 16 / 20 / 28 / 40 (`--text-xs` … `--text-2xl`). The saving uses 40.
- `font-variant-numeric: tabular-nums` on every figure. Headings are always roman.

## Spacing

4-point named scale in `tokens.css`: `--space-3xs` 4 · `2xs` 8 · `xs` 12 · `sm` 16 · `md` 24 · `lg` 32 · `xl` 48. Use names, never raw values. Radii: controls 6px, cards 10px, pills for chips only.

## Motion

- Easings: `--ease-out` cubic-bezier(0.16, 1, 0.3, 1), `--ease-in`, `--ease-in-out`. Never `ease`, never bounce.
- One authored moment: the saving counts up when a result lands. Signals light with a 280ms colour change. New audit rows flash once.
- Reduced motion: no count-up, no pulse, no flash. Final states render immediately.

## Microinteractions stance

- Silent success. No celebratory toasts.
- Optimistic updates. Reversible actions don't get confirmation dialogs; cancelling a Visa hold does.
- Focus rings show instantly and are never animated.
- Every control has hover, focus-visible, active and disabled states. Controls are at least 44px tall on touch widths.
- Ctrl/Cmd+K opens a working command palette (Reset demo, Switch theme, Open console, Jump to audit log). R resets the demo.

## CTA voice

- Primary: solid cobalt, 6px radius, short verb label ("Reset demo", "Claim"). One per view.
- Secondary: 1px hairline border on paper, same radius and padding.
- Links: cobalt text, underline on hover.

## States

- Empty: "Waiting for a call or text to (206) 555-0142."
- Loading: skeleton rows, never spinners in the main regions.
- Error: inline banner in the region that failed; other regions keep working.
- Handoff: the top bar turns guard-wash with "Handed to a human" and the written summary.

## What screens MUST share

The logo and wordmark, the token set, the three fonts, the CTA voice, hairline structure, mono region labels, the "Synthetic demo data" badge.

## What screens MAY differ on

Layout shape (instrument panel vs. side rail) and density.

## Conversation design

### Voice

- Sentences under 20 words. One idea per turn.
- Speak money naturally: "about three hundred eighty dollars," never "38000 cents."
- Always confirm before acting: "Want me to send this to Priya for approval?"
- Open with context: "Hi Maya, I see you're on the 3-line plan and your phone is about 14 months old. Before I change anything, can you confirm your PIN?"
- Never pressure. On push back: state the trade-off once, offer the alternative, respect the choice.

### Text

- Short paragraphs, numbers in digits, no more than 3 bullets per message.
- Reply in under 320 characters when possible.

### Templates

Approval request (to owner):

```
Selldial: Maya wants to buy iPhone 17 ($999, $41.62/mo for 24 mo).
Over your $300 limit. Our take: waiting 3 weeks saves $214.
Reply YES to approve or NO to decline.
```

"Why" receipt (to caller):

```
Selldial summary
Recommended: Wait 3 weeks, then upgrade.
Why: 1) A promo starting in 3 weeks saves $254; trade-in only drops $40. 2) You have $312 financing left. 3) Your plan already covers the new phone.
Runner-up: Upgrade today, $999.
Ruled out: Switching plans (no savings).
Synthetic demo data.
```

Handoff:

```
Selldial: I'm bringing in a teammate so you get the right answer. They'll have our full conversation.
```

## Accessibility

- Text contrast 4.5:1 minimum in both themes, including state colours on their washes.
- Status always has an icon plus text.
- `prefers-reduced-motion` respected for the saving count-up, the live pulse and row flashes.
- Everything is keyboard reachable: rows open with Enter, the drawer and palette trap focus and return it on close.
- No horizontal scroll at 320, 375, 414 or 768px.

## Implementation notes

- Plain HTML, CSS and JS in `dashboard/`, served by FastAPI. No build step.
- Poll `GET /sessions/{phone}` every second once the agent exists. Until then the live screen plays `dashboard/session-demo.js`.
- Format money at the edge only; the API returns cents.
- Live-screen components: TopBar, Transcript, TheMath (with OptionsTable and TradeinChart), Guards, CheckoutCard, SignalStrip, AuditBand, CommandPalette.

## Exports

### tokens.css

See `dashboard/tokens.css` (the source of truth).

### Tailwind v4 `@theme`

```css
@theme {
  --color-paper:  oklch(98.5% 0.004 256);
  --color-ink:    oklch(24% 0.02 258);
  --color-accent: oklch(52% 0.19 266);
  --color-save:   oklch(48% 0.12 155);
  --font-display: "Space Grotesk", sans-serif;
  --font-body:    "Google Sans", sans-serif;
  --font-mono:    "JetBrains Mono", monospace;
  --spacing-sm:   1rem;
  --ease-out:     cubic-bezier(0.16, 1, 0.3, 1);
}
```

### DTCG `tokens.json`

```json
{
  "color": {
    "paper":  { "$value": "oklch(98.5% 0.004 256)", "$type": "color" },
    "ink":    { "$value": "oklch(24% 0.02 258)", "$type": "color" },
    "accent": { "$value": "oklch(52% 0.19 266)", "$type": "color" },
    "save":   { "$value": "oklch(48% 0.12 155)", "$type": "color" }
  },
  "font": {
    "display": { "$value": "Space Grotesk", "$type": "fontFamily" },
    "body":    { "$value": "Google Sans", "$type": "fontFamily" },
    "mono":    { "$value": "JetBrains Mono", "$type": "fontFamily" }
  }
}
```

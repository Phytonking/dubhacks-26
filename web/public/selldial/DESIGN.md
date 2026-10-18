# Design: Selldial

The design system for the Selldial operator console. Read this before any UI work. Extend it when needed; do not regenerate it per screen.

Selldial is an AI phone and text line that helps customers buy easily. The console is where the operator sees how those calls went. It is a calm, dark, magenta-accented product that feels as polished as a carrier's own app, with its own character.

Reference taste files: taste-tmobile.md (brand feel, dark and magenta) and taste-linear.md (tables, filters, navigation).
Follow them for feel, and follow this file where they differ.

## Brand

- Name: Selldial. Wordmark in Google Sans 700.
- Logo: a phone outline with a handset and signal marks, plus the "Selldial" wordmark. Files: `selldial-logo-full.png` (icon plus wordmark, landing page) and `selldial-logo-icon.png` (icon only: side rail, About, favicon). It looks the same everywhere. The logo is a pink-to-violet gradient and is the one allowed exception to "no gradients".
- Tagline: "The sell line that helps customers buy."
- Voice: calm, plain, numerate. A good store employee who is on your side.
- Tenant name ("T-Mobile demo") appears only as plain text where needed. The "Log in with T-Mobile" button may show T-Mobile's T mark, and only that one button (the original is in git history: `git show main:web/public/selldial/index.html`). Everywhere else: no T-Mobile logo, marks, wordmark or exact magenta (#E20074). Our magenta is our own (token below).
- All data is synthetic. Say so once, in the About page and the landing footer. Do not repeat it as a badge on every screen.

## Principles

1. **Simple first.** Each screen answers one question. Cut anything that does not help the operator decide or act.
2. **Recent first.** Lists show the most recent items on top, with few columns.
3. **Summaries, not streams.** No live-call screen. Anything live is a short summary line inside Home.
4. **Show why.** Every outcome has a one-line reason the operator can read.
5. **Honest labels.** Payment status is plain: Paid by agent or Not paid. Mock checkout is labelled "Mock".

## Theme (dark only)

One theme. No light mode, no toggle, no Appearance setting.

| Token | Value | Use |
|---|---|---|
| `--color-bg` | `oklch(13% 0.02 340)` | Page background |
| `--color-surface` | `oklch(17% 0.025 340)` | Panels, side rail, table container |
| `--color-raised` | `oklch(21% 0.03 340)` | Inputs, selected rows, chips, hovered rows |
| `--color-rule` | `oklch(28% 0.03 340)` | Hairlines and rings |
| `--color-ink` | `oklch(96% 0.01 340)` | Headings, key figures |
| `--color-ink-2` | `oklch(88% 0.012 340)` | Body text |
| `--color-muted` | `oklch(72% 0.02 340)` | Labels, timestamps, placeholders |
| `--color-accent` | `oklch(62% 0.25 352)` | The one signal: primary button, active nav, focus, links. A deeper true magenta that sits beside the logo's pink |
| `--color-accent-ink` | `oklch(15% 0.02 340)` | Text on the accent |
| `--color-accent-wash` | `oklch(26% 0.1 352)` | Selected row, active nav fill |
| `--color-save` | `oklch(79% 0.14 155)` | Paid, money saved, success |
| `--color-guard` | `oklch(85% 0.12 90)` | Pending approval, needs a look |
| `--color-block` | `oklch(72% 0.17 25)` | Not paid, failed, needs review |

Rules:
- The landing page background may carry one very subtle dark magenta glow behind the centre (a soft radial wash, never busy). The console background is flat `--color-bg`.
- Accent covers under 8% of any screen. Never use it for large fills.
- State colours always come with an icon and a text label, never colour alone.
- The logo is the only gradient (pink to violet). Nothing else uses one except the landing background wash above.
- Do not use T-Mobile's exact magenta. No pure black or pure white.
- No glass blur, no glowing elements, no heavy shadows. Depth comes from surface tone and hairlines.

## Typography

- Display: Space Grotesk 500/600, tracking -0.02em. Page titles and big figures.
- Body: Google Sans 400/500. All UI text.
- Mono: JetBrains Mono 400/500. Figures, IDs, phone numbers, timestamps. Tabular numerals.
- Scale: 12 / 14 / 16 / 20 / 28 / 40. Rank by weight and lightness, not size alone.

## Spacing, radius, motion

- 4px grid, named tokens (`--space-3xs` to `--space-xl`). Use names, not raw values.
- Radii: controls 8px, cards 12px, chips pill. 
- Motion: 160ms colour transitions, 280ms for panels, `--ease-out`. CSS only. Respect `prefers-reduced-motion`.

## Layout

**App shell:** side rail at left with the logo, then six items: Home, Conversations, Customers, Sales, Settings, About. A slim top bar holds the page title and, at the right, the tenant name (plain text) and an avatar. Nothing else: no badges, no Refresh, no Live button.

**Home (one screen, replaces Home and Overview):**
1. A short greeting line and today's date.
2. Four summary numbers in one row: Calls handled, Sales paid, Not paid, Saved for customers.
3. **Needs review:** only calls that went badly (not paid after a purchase attempt, handoff, failed verification). Each row: customer, one-line reason, time, and an "Open" action.
4. **Recent conversations:** the last 5 with a link to all.
5. A small "Active now" line only if a call is in progress, as a summary ("Maya R. is on a call about an upgrade"). It does not open a live screen.

**Conversations:** a list of recent conversations, one per customer interaction: customer name, channel (voice or text), what it was about, outcome chip (Paid, Not paid, Handed off, Advised to wait), time. Click a row to open the report.

**Conversation report (drawer or detail view):** a short summary for the operator, in reading order:
1. Headline: outcome plus one sentence ("Maya bought an iPhone 17. Paid by agent.").
2. What the customer wanted.
3. What the agent recommended and why (up to 3 reasons), including the runner-up.
4. Payment: Paid by agent or Not paid, amount, and Mock label.
5. Owner approval status if one was needed.
6. Transcript, collapsed by default.

**Customers:** most recent customers first. Columns: name, phone, region, status, last conversation. Filters: region, name, number, status. Nothing else. Clicking a row opens a small drawer with name, number, region, status and their conversations. No churn risk, no financing.

**Sales:** most recent sales first. Columns: customer, item, amount, region, date, payment (Paid by agent or Not paid). Filters: region, time, customer, payment status. One simple row layout, no charts, no dense math tables.

**Settings:** a simple page or slide-over with only what is real: Offers and discounts, Spend and approvals, Verification and handoff, and Channels (Voice, SMS, iMessage and WhatsApp only; no RCS, no Web chat). No Appearance. Editable controls change local state only and say "Not saved in demo."

**About:** a short, well-set page: what Selldial is, how a purchase goes, the trust rules (owner approval, spend limits, audit log). Clean typography, generous space.

**Landing (`index.html`):** one centred column, nothing else: the full logo, large; one line, "The sell line that helps customers buy."; two compact side-by-side buttons, "Log in with T-Mobile" (with the T mark) and "Log in via another provider"; and a small note at the bottom: "Demo sign-in: no credentials are collected. All customer data is synthetic." No heading, no masthead, no diagonal shapes.

## Components

- **Primary button:** accent fill, accent-ink text, 8px radius, 36px high. One per view.
- **Secondary button:** hairline ring on surface, ink-2 text.
- **Chip / outcome tag:** pill, 12px, hairline ring. Outcome chips use text plus the state colour for the dot only.
- **Table:** 48px rows, sticky header, hover on raised, selected on accent-wash. No zebra, no heavy borders.
- **Filter bar:** a row of dropdowns or chips plus search, above the table. Only the filters listed for that screen.
- **Drawer:** 420px from the right on desktop, full width on phones.
- **Empty state:** one sentence and one action. **Loading:** skeleton rows.
- **Focus:** a 2px accent outline with 2px offset on every interactive element.

## Responsive

Desktop first, but nothing breaks below 900px. The side rail becomes a top row or a menu. Tables drop secondary columns. Drawers become full width. No horizontal page scroll at 320 to 768px.

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

- Text contrast 4.5:1 minimum, including state colours on dark surfaces.
- Status is always icon plus text.
- Respect `prefers-reduced-motion`.
- Everything is keyboard reachable. Rows open with Enter. Drawers trap focus and return it on close.

## Implementation notes

- Plain HTML, CSS and JS in `web/public/selldial/`, served by Next.js as static files. No build step.
- `api.js` is the only place that fetches data. When the MongoDB backend is ready, change that file. Money is integer cents; format at the edge.
- Tokens live in `tokens.css`. It is the source of truth for the values above.

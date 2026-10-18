# Design: Selldial

The design system for the Selldial operator console. Read this before any UI work. Extend it when needed; do not regenerate it per screen.

Selldial is an AI phone and text line that helps customers buy easily. The console is where the operator sees how those calls went. It is a dark editorial product: plum surfaces, a serif voice for titles and big figures, electric pink for the things you press and violet as a quiet second voice. It should feel as polished as a carrier's own app, with its own character.

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

One theme. No light mode, no toggle, no Appearance setting. Surfaces are deep plum (hue 320), each step about 4 lightness points from its neighbour, so they separate by tone and hairlines, not borders.

| Token | Value | Use |
|---|---|---|
| `--color-bg` | `oklch(12% 0.03 320)` | Page background |
| `--color-surface` | `oklch(15.5% 0.035 320)` | Side rail, panels, drawer |
| `--color-raised` | `oklch(19.5% 0.04 320)` | Inputs, hovered rows, current nav item, chips |
| `--color-rule` | `oklch(27% 0.045 320)` | Hairlines and rings |
| `--color-ink` | `oklch(96% 0.01 320)` | Headings, key figures |
| `--color-ink-2` | `oklch(88% 0.015 320)` | Body text |
| `--color-muted` | `oklch(72% 0.03 320)` | Labels, timestamps, placeholders |
| `--color-accent` | `oklch(66% 0.24 350)` | Electric pink. Primary button, focus ring, the selected-row marker. Nothing else |
| `--color-accent-ink` | `oklch(15% 0.02 320)` | Text on the accent |
| `--color-accent-wash` | `oklch(26% 0.09 350)` | Reserved for a selected-row marker on the accent |
| `--color-violet` | `oklch(74% 0.14 295)` | Secondary voice: links, current-page mark, avatar, small marks |
| `--color-violet-fill` | `oklch(52% 0.17 295)` | Switches that are on |
| `--color-violet-wash` | `oklch(24% 0.07 295)` | Selected rows, selected segments, agent bubbles |
| `--color-save` | `oklch(79% 0.14 155)` | Paid, money saved, success |
| `--color-guard` | `oklch(85% 0.12 90)` | Pending approval, needs a look |
| `--color-block` | `oklch(72% 0.17 25)` | Not paid, failed, needs review |

Rules:
- Pink is a verb: only things you press (primary button), focus, and the selected-row marker. Toggles, nav, counts, step numbers and links are not pink. Pink stays under 3% of any screen.
- Violet is the second voice and is also rare: links and "Open" actions, the 2px current-page mark in the rail, switches that are on, selection washes.
- The landing page background may carry one very subtle dark plum-magenta glow behind the product panel. The console background is flat `--color-bg`.
- State colours always come with an icon (a dot is the icon for chips) and a text label, never colour alone. They stay exactly as above.
- The logo is the only gradient (pink to violet). Nothing else uses one except the landing wash above.
- Do not use T-Mobile's exact magenta. No pure black or pure white.
- No glass blur, no glowing elements, no heavy shadows. Depth comes from surface tone and hairlines.

## Typography

Three families, no others.

- Display: **Fraunces** 500, tracking -0.02em. Page titles, section headings and big figures only.
- Body: **Google Sans** 400/500. All UI text.
- Mono: **JetBrains Mono** 400/500. Phone numbers, IDs, timestamps, and every money value in a table. Tabular numerals.
- Scale: 12 / 14 / 16 / 20 / 28 / 40. Rank by weight and lightness, not size alone.

## Spacing, radius, motion

- 4px grid, named tokens (`--space-3xs` to `--space-xl`). Use names, not raw values.
- Radii: controls 8px, panels 12px, chips pill. Prefer open lists with hairline separators over boxed cards; a boxed panel is for a table or a drawer, not for every group.
- Motion: 160ms colour transitions, 280ms for panels, `--ease-out`. CSS only. Respect `prefers-reduced-motion`.

## Layout

**App shell:** a 232px side rail with the logo, then six items at 36px: Home, Conversations, Customers, Sales, Settings, About. The current item has the raised tone, ink text and a 2px violet mark on its left edge; it is never pink. A "needs review" count sits at the right of Home as a small mono number with a state dot. A sticky 64px top bar holds the page title (Fraunces 20px) and, at the right, the tenant name (plain text) and an avatar. Nothing else: no Refresh, no Live button.

On phones the rail becomes a 56px bar with the logo and a Menu button that opens the six items (48px each) and Sign out in a panel below the bar. It closes on navigation and on Escape. The nav row never scrolls sideways.

**Home (one screen, replaces Home and Overview):**
1. An eyebrow with the greeting and today's date, then one sentence in the display face: how many conversations need the operator, and what was paid today ("3 conversations need you. $1,829.98 paid by the agent today.").
2. A figures line under a hairline, not four boxes: Calls handled, Sales paid, Not paid, Saved for customers (display face 20px, label 12px muted; saved money in the save colour).
3. A small "Active now" line under the figures, only if a call is in progress, as a summary ("Maya R. is on a call about an upgrade"). It does not open a live screen.
4. **Needs review:** an open list of only the calls that went badly (not paid after a purchase attempt, handoff, failed verification). Each row: customer, outcome chip, one-line reason, time, and an "Open" link with an arrow.
5. **Recent conversations:** the last 5 as two-line rows (customer over topic and channel, outcome chip and time at the right) with a "View all" link. No table on Home.

**Conversations:** a list of recent conversations, one per customer interaction: customer name, channel (voice or text), what it was about, outcome chip (Paid, Not paid, Handed off, Advised to wait), time. Click a row to open the report.

**Conversation report (drawer or detail view):** a short summary for the operator, then a decision timeline (stage 2 builds this):
1. Headline: outcome plus one sentence ("Maya bought an iPhone 17. Paid by agent.").
2. What the customer wanted.
3. A vertical timeline joined by a thin violet line, one step each: Verified, Recommended (with up to 3 reasons and the runner-up; the reasons must support the pick), Owner approval (an explicit step for every conversation that needed one: asked, approved or declined, who, the limit), Payment (Paid by agent or Not paid, amount, Mock label).
4. Transcript, collapsed by default.
5. Previous and next controls with a position ("3 of 40") so an operator can step through conversations.

The owner approval limit in the synthetic data is **$1,500.00** everywhere (Settings, reports, Home).

**Customers:** most recent customers first. Columns: name, phone, region, status, last conversation. Filters: region, name, number, status. Nothing else. Clicking a row opens a small drawer with name, number, region, status and their conversations. No churn risk, no financing.

**Sales:** most recent sales first. Columns: customer, item, amount, region, date, payment (Paid by agent or Not paid). Filters: region, time, customer, payment status. One simple row layout, no charts, no dense math tables. Money in any table is JetBrains Mono, right-aligned, always two decimals, and the same weight as the row's title.

**Settings:** a simple page or slide-over with only what is real: Offers and discounts, Spend and approvals, Verification and handoff, and Channels (Voice, SMS, iMessage and WhatsApp only; no RCS, no Web chat). No Appearance. Editable controls change local state only. One note at the top of the page says "Changes here are not saved in this demo." The controls do not repeat it.

**About:** a short, well-set page: what Selldial is, how a purchase goes, the trust rules (owner approval, spend limits, audit log). Clean typography, generous space.

**Landing (`index.html`):** one centred column in the dark editorial style (stage 3 builds this): the full logo, a very large display-face headline "The sell line that helps customers buy.", one line of support copy, two compact side-by-side buttons ("Log in with T-Mobile" with the T mark, "Log in via another provider"), then one large, crisp, well-cropped product panel: the report drawer for a declined purchase, with its decision timeline. A faint plum-magenta glow sits behind the panel. A small note at the bottom: "Demo sign-in: no credentials are collected. All customer data is synthetic." No masthead, no diagonal shapes, no second screenshot.

## Components

- **Primary button:** accent fill, accent-ink text, 8px radius, 36px high. One per view.
- **Secondary button:** hairline ring on surface, ink-2 text.
- **Chip / outcome tag:** pill, 24px, 12px text, hairline ring. Outcome chips use a neutral word plus the state colour for the 6px dot only.
- **Table:** 48px rows, sticky header (below the sticky top bar), hover on raised, selected on violet-wash. No zebra, no heavy borders. Titles weight 500 in ink, details 14px muted.
- **Link action:** violet text with a trailing arrow ("Open", "View all"). Never boxed.
- **Filter bar:** a row of dropdowns or chips plus search, above the table. Only the filters listed for that screen.
- **Drawer:** 420px from the right on desktop (wider is allowed for the report), full width on phones.
- **Empty state:** one sentence and one action. **Loading:** skeleton rows.
- **Focus:** a 2px accent outline with 2px offset on every interactive element.

## Responsive

Desktop first, but nothing breaks below 900px. Below 760px the side rail becomes a bar with a Menu button (see App shell). Lists become two-line rows; tables drop secondary columns and never let a column wrap one word per line. Drawers become full width. No horizontal page scroll at 320 to 768px. Touch targets are at least 44px.

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

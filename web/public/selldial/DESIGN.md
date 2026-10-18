# Design: Selldial

The design system for the Selldial operator console. Read this before any UI work. Extend it when needed; do not regenerate it per screen.

Selldial is an AI phone and text line that helps customers buy easily. The console is where the operator sees how those calls went. It is a dark editorial product: rich plum surfaces in three tiers, a serif voice for titles and big figures, and electric magenta used deliberately for navigation, selection, key figures and charts, with violet as a supporting voice. It should feel as polished as a carrier's own app, with its own character.

Reference taste files: taste-tmobile.md (brand feel, dark and magenta) and taste-linear.md (tables, filters, navigation).
Follow them for feel, and follow this file where they differ.

## Brand

- Name: Selldial. Wordmark in Google Sans 700.
- Logo: a phone outline with a handset and signal marks, plus the "Selldial" wordmark. Files: `selldial-logo-full.png` (icon plus wordmark, landing page) and `selldial-logo-icon.png` (icon only: side rail, About, favicon). It looks the same everywhere. The logo is a pink-to-violet gradient and is the one allowed exception to "no gradients".
- Tagline: "The cell line that helps customers buy."
- Voice: calm, plain, numerate. A good store employee who is on your side.
- Tenant name ("T-Mobile demo") appears only as plain text where needed. The "Log in with T-Mobile" button may show T-Mobile's T mark, and only that one button (the original is in git history: `git show main:web/public/selldial/index.html`). Everywhere else: no T-Mobile logo, marks, wordmark or exact magenta (#E20074). Our magenta is our own (token below).
- All data is synthetic. Say so once, in the About page and the landing footer. Do not repeat it as a badge on every screen.

## Principles

1. **Simple first.** Each screen answers one question. Cut anything that does not help the operator decide or act.
2. **Recent first.** Lists show the most recent items on top, with few columns.
3. **Summaries, not streams.** No live-call screen. Anything live is a short summary line inside Home.
4. **Show why.** Every outcome has a one-line reason the operator can read.
5. **Honest labels.** Payment status is plain: Paid by agent or Not paid. Mock checkout is labelled "Mock".

## Theme: dark + magenta fusion, with an optional light theme

Dark is the default and the primary design. The console also has a light theme, chosen in Settings > Appearance (Dark or Light), saved in `localStorage` under `selldial-theme` and applied by a tiny inline script in the `<head>` of `console.html` before first paint, so there is no flash. The landing page is always dark and never reads the setting. The dark tokens below are the source of truth; the light set lives in `tokens.css` under `:root[data-theme="light"]` and keeps the same roles and hues. The console shares the landing page's look: rich plum surfaces in three clear tiers, with magenta used deliberately as the signature colour, not hidden. Tiers are about 5 lightness points apart (page 16.5%, panel 21.5%, raised 27%), so they separate by tone and a faint pink-tinted edge. The dark set is deliberately deep, but no area is flat black: the magenta and violet glows, tinted edges and the raised tier keep it rich.

| Token | Value | Use |
|---|---|---|
| `--color-bg` | `oklch(16.5% 0.052 320)` | Tier 1, page. Carries the top-left glow |
| `--color-surface` | `oklch(21.5% 0.057 320)` | Tier 2, side rail, panels, drawer |
| `--color-raised` | `oklch(27% 0.067 322)` | Tier 3, inputs, hovered rows, chips, avatars |
| `--color-rule` | `oklch(35% 0.075 335)` | Hairlines and rings (faintly pink) |
| `--color-edge` | `oklch(66% 0.24 350 / 0.28)` | Pink-tinted panel edge and hover edge |
| `--color-ink` | `oklch(97% 0.01 320)` | Headings, key figures |
| `--color-ink-2` | `oklch(91% 0.015 320)` | Body text |
| `--color-muted` | `oklch(79% 0.035 320)` | Labels, timestamps, placeholders (4.5:1 or better on every tier) |
| `--color-accent` | `oklch(66% 0.24 350)` | Electric magenta. Fills and markers: primary button, active nav marker, selected-row marker, chart highlight, focus ring |
| `--color-accent-text` | `oklch(80% 0.16 350)` | Magenta as text: key figures, "needs you" counts, section accents, link arrows |
| `--color-accent-ink` | `oklch(15% 0.02 320)` | Text on the accent fill |
| `--color-accent-wash` | `oklch(31% 0.11 350)` | Selected row, active nav item |
| `--color-violet` | `oklch(76% 0.14 295)` | Second voice: links, avatar rings, timeline line |
| `--color-violet-fill` | `oklch(54% 0.17 295)` | Switches that are on |
| `--color-violet-wash` | `oklch(30% 0.08 295)` | Agent bubbles, selected segments |
| `--color-save` | `oklch(80% 0.14 155)` | Paid, money saved, success |
| `--color-guard` | `oklch(86% 0.12 90)` | Pending approval, needs a look |
| `--color-block` | `oklch(74% 0.17 25)` | Not paid, failed, needs review |

### Light theme tokens

Soft off-white surfaces in the same three tiers: page (`oklch(95.5% 0.014 330)`), panel (lightest, `oklch(99% 0.006 330)`) and raised (a step darker, `oklch(93% 0.02 330)`, used for inputs, chips and hover). Plum-tinted ink (`oklch(21% 0.04 320)`), body text `oklch(30% 0.035 320)`, muted `oklch(44% 0.035 320)`. The same magenta hue is darkened for contrast: fill `oklch(58% 0.24 350)` (with near-white text on it, 4.7:1), magenta text `oklch(47% 0.21 350)`, accent wash `oklch(91.5% 0.055 350)`. Violet `oklch(46% 0.17 295)`; state colours are deepened so they stay readable on pale surfaces: save `oklch(42% 0.13 155)`, guard `oklch(46% 0.11 75)`, block `oklch(50% 0.19 25)`. All text and state colours measure at least 4.7:1 on every surface tier (page, panel, raised, accent wash, violet wash). The page glow is the same magenta-to-violet shape in pale tints. Magenta, edge and marker rules apply unchanged in both themes.

Rules:
- Magenta is the lead colour and is used on purpose: the active nav item (wash fill plus a 3px marker), the selected row, key figures and the "needs you" counts, chart highlights, section accents (a short marker beside a section title), focus rings and hover edges. Aim for roughly 8 to 12% of a screen carrying some magenta, never a full magenta surface. One filled primary button per view.
- Body copy, table text and labels stay neutral ink. Magenta text uses `--color-accent-text`, never the fill colour, so contrast stays above 4.5:1.
- Violet is the supporting voice: links, avatar rings, the timeline line, switches that are on.
- Status colours stay exactly as above and always win over magenta for paid, not paid and approval. Magenta never means a state.
- Background glow: a soft magenta-to-violet radial glow sits in the top-left of the page (`--color-bg` base, under all content), echoing the landing page. Panels carry a faint pink tint on their edge (`--color-edge`) and a barely-there top-left highlight. These are the only gradients besides the logo. No stripes, no mesh.
- State colours always come with an icon (a dot is the icon for chips) and a text label, never colour alone.
- Do not use T-Mobile's exact magenta (#E20074). No pure black or pure white.
- No glass blur, no glowing elements (the page glow is a background, not an element), no heavy shadows. Depth comes from the three tiers, edges and the glow.

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

**App shell:** a 232px side rail with the logo, then six items at 36px: Home, Conversations, Customers, Sales, Settings, About. The current item has the accent wash, ink text, a magenta icon and a 3px magenta marker on its left edge. A "needs review" count sits at the right of Home as a mono number in magenta text with a state dot. A sticky 64px top bar holds the page title (Fraunces 20px) and, at the right, the tenant name (plain text) and an avatar. Nothing else: no Refresh, no Live button.

On phones the rail becomes a 56px bar with the logo and a Menu button that opens the six items (48px each) and Sign out in a panel below the bar. It closes on navigation and on Escape. The nav row never scrolls sideways.

**Home (one screen, replaces Home and Overview):**
1. A plain muted line with the greeting and today's date (no mono caps, no kicker styling), then one sentence in the display face with the count in magenta ("**3 conversations** need you. $1,829.98 paid by the agent today.").
2. One figures panel (a single raised-edge card, hairline dividers, not four boxes): Calls handled, Sales paid (magenta), Not paid (block colour), Saved for customers (save colour). Display face 40px, label 12px uppercase muted, one muted note under each. Each label has a state dot.
3. A small "Active now" line under the panel, only if a call is in progress, as a summary. It does not open a live screen.
4. Two columns on desktop (one column below 1100px):
   - Both panels stretch to the same height and their rows share the space evenly.
   - **Needs review:** a panel of only the calls that went badly. Each row: initials avatar, customer, outcome chip, one-line reason, mono time, magenta "Open" link. A magenta count pill sits in the heading.
   - **Recent conversations:** a panel with the last 5 as two-line rows (avatar, customer over topic and channel icon; outcome chip over mono time at the right) and a "View all" link. Hover shows a 3px magenta edge.
5. Every section title carries a 4px magenta marker. Avatars are initials, alternating magenta-wash and violet-wash.

**Conversations:** a toolbar panel (Outcome filter left, search right), a count line, then a panel table: customer (avatar and name), channel (icon and word), what it was about, outcome chip, mono time. Uppercase 11px muted column heads over a pink-tinted hairline. Click a row to open the report; the selected row gets the accent wash and a 3px magenta edge.

**Conversation report (drawer or detail view):** a short summary for the operator, then a decision timeline (stage 2 builds this). The drawer header carries the customer's avatar. Section labels are magenta uppercase; the timeline marks keep their state colours.
1. Headline in a tinted panel (magenta-to-transparent wash): outcome chip plus one sentence in the display face ("Maya bought an iPhone 17. Paid by agent.").
2. What the customer wanted.
3. A vertical timeline joined by a thin violet line, one step each: Verified, Recommended (with up to 3 reasons and the runner-up; the reasons must support the pick), Owner approval (an explicit step for every conversation that needed one: asked, approved or declined, who, the limit), Payment (Paid by agent or Not paid, amount, Mock label).
4. Transcript, collapsed by default.
5. Previous and next controls with a mono position ("3 of 40"), pinned to the bottom of the drawer, so an operator can step through conversations.

The owner approval limit in the synthetic data is **$1,500.00** everywhere (Settings, reports, Home).

**Customers:** same toolbar, count line and panel table as Conversations. Columns: name (avatar and name), phone (mono), region, status chip, last conversation (topic over mono time). Filters: region, name, number, status. Nothing else. Clicking a row opens a small drawer with name, number, region, status and their conversations. No churn risk, no financing.

**Sales:** two subtabs with a magenta active underline: Sales and Analytics. Region and time (and, on the list, payment and customer) filters sit in the shared toolbar panel.
- **Sales list:** most recent first. A mini figures line (Sales, Paid by agent in magenta, Not paid, Paid total in mono magenta), then a panel table: customer (avatar and name), item, amount, region, date (mono), payment (Paid by agent or Not paid). Money in any table is JetBrains Mono, right-aligned, always two decimals. No dense math tables.
- **Analytics:** four plain SVG/CSS charts, each in its own panel with a magenta-marked title and a one-line takeaway: sales per day (bars use the paid and not-paid state colours), revenue by region and top items (magenta bars), payment rate (a large magenta figure, a magenta trend line and a paid / not-paid split bar). Counted from the same sales and filtered by the same region and time.

**Settings:** only what is real: Offers and discounts, Spend and approvals, Verification and handoff, and Channels (Voice, SMS, iMessage and WhatsApp only; no RCS, no Web chat). Appearance comes first. Editable controls change local state only. One note at the top (a tinted magenta bar) says "Offer, approval and channel changes are not saved in this demo." Appearance (Theme: Dark or Light) is the one setting that is saved, in this browser only. The controls do not repeat it. Each group is a panel under a magenta-marked title; from 1200px wide the groups flow into two balanced columns. Switches that are on use violet.

**About:** short and well set. The logo icon beside a display-face statement (no eyebrow) with the key phrase in magenta, "How a purchase goes" as three open columns under a pink-tinted rule with large magenta numerals (no boxes), "Trust rules" as an open list with magenta rule names, and the synthetic-data note at the foot. Max width 1080px.

**Landing (`index.html`):** one centred column in the dark editorial style (stage 3 builds this): the full logo, a very large display-face headline "The cell line that helps customers buy.", one line of support copy, two compact side-by-side buttons ("Log in with T-Mobile" with the T mark, "Log in via another provider"), then one large, crisp, well-cropped product panel: the report drawer for a declined purchase, with its decision timeline. A faint plum-magenta glow sits behind the panel. A small note at the bottom: "Demo sign-in: no credentials are collected. All customer data is synthetic." No masthead, no diagonal shapes, no second screenshot.

## Components

- **Panel:** surface tier, 12px radius, `--color-edge` border and a faint top-left magenta tint. Used for tables, figure groups, chart groups, settings groups and the drawer.
- **Section title:** display face 20px with a 4px magenta marker to its left.
- **Avatar:** 32 to 40px circle with the customer's initials, magenta wash (or violet wash) with a pink ring.
- **Primary button:** accent fill, accent-ink text, 8px radius, 36px high. One per view.
- **Secondary button:** hairline ring on surface, ink-2 text.
- **Chip / outcome tag:** pill, 24px, 12px text, raised fill and hairline ring. Outcome chips use a neutral word plus the state colour for the 6px dot only.
- **Table:** 48px rows inside a panel, sticky header (below the sticky top bar) in 11px uppercase muted, hover on raised with a faint pink 3px edge, selected on the accent wash with a magenta 3px edge. No zebra, no heavy borders. Titles weight 500 in ink, details 14px muted, times in mono.
- **Link action:** magenta text (`--color-accent-text`) with a trailing arrow ("Open", "View all"); the arrow gap widens on hover. Never boxed.
- **Filter bar:** one toolbar panel with pill dropdowns on the left and a pill search on the right, magenta border on hover and focus. Only the filters listed for that screen.
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

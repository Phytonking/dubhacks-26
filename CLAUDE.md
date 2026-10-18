# Selldial: instructions for Claude Code

Selldial is an AI phone and text line that helps customers buy easily. The first demo tenant is a carrier ("T-Mobile demo", plain text only). This repo is a DubHacks 2026 hackathon project. The console that operators use lives in `web/public/selldial/` as plain HTML, CSS and JS served by Next.js. Speed, a working demo and polish matter more than the number of features.

## Read first

1. `web/public/selldial/DESIGN.md`: the source of truth for colours, type, layout and every screen. Follow it. If a request conflicts with it, say so.
2. `web/AGENTS.md`: the Next.js notes. Read it before touching anything under `web/src` or Next config.

Right now we are only changing the static console in `web/public/selldial/`. Do not touch `agent/`, `web/src/`, `scripts/` or the database code unless asked.

## Rules

- Work on the branch `ui/redesign`. Do not commit to `main`. Do not push; I will open the pull request myself.
- Never commit anything from `.playwright-mcp/`. Save test screenshots outside the repo (the session scratchpad or a temp folder).
- Do one pass at a time, then stop and show me what changed. Do not expand scope.
- Dark theme only, with a magenta accent. No light mode, no toggle.
- T-Mobile's T mark may appear only on the "Log in with T-Mobile" button (the original is in git history: `git show main:web/public/selldial/index.html`). Everywhere else: no T-Mobile logo, marks, wordmark or exact magenta.
- The Selldial logo (`selldial-logo-full.png`, `selldial-logo-icon.png`) is a pink-to-violet gradient and is the one allowed exception to "no gradients".
- No live-call screen. No `live.html`, `live.js`, `live.css` or `session-demo.js`. Live activity is only a short summary line on Home.
- All data is synthetic. Say so on the About page and landing footer, not as a badge on every screen.
- Keep each screen simple. If something does not help the operator decide or act, remove it.
- No new dependencies and no build step. Keep files small. Reuse tokens from `tokens.css`; do not invent colours.
- Write all code fresh for this event. Do not paste in code from other projects.
- Do not put keys or secrets in the repo.
- Keep it honest: payment status is "Paid by agent" or "Not paid", and mock checkout is labelled "Mock".

## Target structure

Side rail with six items: **Home, Conversations, Customers, Sales, Settings, About**. Top bar has the page title and the tenant name only. Screen details are in DESIGN.md. Summary:

- **Home** (merges the old Home and Overview): four numbers (calls handled, sales paid, not paid, saved), "Needs review" (only calls that went badly), recent conversations, and an optional "active now" line.
- **Conversations:** recent conversations, one per customer interaction. Click one for a short operator report (outcome, what the customer wanted, what the agent recommended and why, payment, approval, collapsed transcript).
- **Customers:** most recent first. Filters: region, name, number, status only. No churn risk or financing left.
- **Sales:** most recent first. Filters: region, time, customer, payment status (Paid by agent or Not paid). No charts or dense math.
- **Settings:** Offers and discounts, Spend and approvals, Verification and handoff, Channels (Voice, SMS, iMessage, WhatsApp). No RCS, no Web chat, no Appearance.
- **About:** short and well designed.
- **Landing (`index.html`):** one centred column: the full logo, the line "The cell line that helps customers buy.", two compact side-by-side sign-in buttons ("Log in with T-Mobile" with the T mark, "Log in via another provider"), and a small demo note at the bottom. A faint dark magenta glow behind the centre. No heading, no masthead, no diagonal shapes.

## Work order

Stop after each pass and show me.

1. Global: dark-only magenta theme in `tokens.css`, remove the theme toggle and Appearance setting, clean the header (remove "Synthetic demo data", "Live session", "Demo data", "Refresh"), use the supplied logo PNGs (icon in the side rail and favicon), remove the live files and links.
2. Home (merged).
3. Conversations and the report view.
4. Customers.
5. Sales.
6. Settings and About.
7. Landing page.

## Definition of done for each pass

- The page loads at http://localhost:5500 with no console errors (I run `python -m http.server 5500` in `web/public/selldial`).
- It looks right at 1440px and 390px wide, with no horizontal overflow.
- It matches DESIGN.md. No leftover references to removed things.
- Summarize what changed and which files, in a few lines.

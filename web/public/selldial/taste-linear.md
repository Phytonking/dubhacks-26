# What makes linear.app feel good

Source: https://linear.app marketing home page, captured 2026-10-18 at 1440×900 (page height 9953px), single page. Feel and structure only. No assets, logo or exact colours are reproduced, and none should be carried into Selldial.

## What was and was not measured

The public page has no real table, filter bar or drawer. What it does have is Linear's product UI drawn as live HTML: a side navigation, an issue detail view, a kanban board, floating agent panels and a chat thread. I measured those.

| Asked about | Status |
|---|---|
| Side navigation | Measured (7 items, group labels, selected state, real hover) |
| Selected and hover states | Measured on nav items and the Sign up button. Board-card hover was blocked by an overlay and is not measured. |
| Drawers | Closest analogue measured: the floating agent panel and the detail view with its pager. Not a true slide-over. |
| Tables and filter bars | Not present. Row and chip measurements come from the board cards, activity rows and label chips. |
| How dense data stays calm | Inferred from the measurements above |

Anything under "For Selldial" is a recommendation derived from the measurements, not something observed on the site.

## Design Map

### Colour and surface

- One dark ground for the whole page. Surfaces step up in lightness in small increments: page ground, then a card ground about 4 lightness points higher, then a panel ground about 6 higher. Separation comes from those steps plus a 1px edge, not from shadow.
- Edges are white at low alpha, not a grey: 8% on cards and chips, 12% on floating panels. Alpha edges keep working on any surface tone.
- Text has four steps: primary (near-white, headings and key figures), secondary (body, row titles), tertiary (secondary metadata, 138 on a 0 to 255 grey scale), quaternary (group labels, issue IDs, 98 on the same scale). Row titles use secondary, not primary, so a full list does not glare.
- The accent is an indigo used on very little: one send button, a few status icons. A 28×28 primary-action chip is the biggest piece of it on screen.
- Status colours (red for bug, blue for design, green for performance) appear as 6–8px dots inside label chips, with the label text in neutral grey. Colour is a marker, the word does the telling.
- The primary button on the dark page is a light pill (near-white fill, near-black text). Hover steps the fill to full white and the text stays put.
- For Selldial: keep the magenta for primary buttons and the active nav pill only. Tabular state should use dots plus neutral text, as DESIGN.md already requires.

### Type

- One family at every size (a variable sans). Ranking is done by weight and by the four text steps above.
- A custom in-between weight of 510 is used for nearly all UI text: nav items, card titles, chips, column headers. 400 is for metadata (IDs, counts, timestamps). Headings go to 590.
- Sizes in the product UI: 10px (issue ID in card, tracking -0.15px), 12px (card title, chip text, group labels, activity text), 13px (nav items, column headers, buttons, tracking -0.13px on headers), 20px (detail title, 590, 26.6px line, -0.24px tracking). Hero headline is far larger on the marketing page.
- Nothing in the UI is above 20px except marketing headlines. Density comes from 12px and 13px text with generous row height, not from shrinking to 10px.
- For Selldial: 14px body is larger than Linear's 12 to 13px. Keep 14px for primary row text, 12px for secondary, and use weight 500 for row titles rather than 600.

### Spacing and size

- Side nav: 208px wide. Items are buttons 28px tall, padding 0 7px, 8px gap between icon and label, 8px radius. Icons 14×14.
- Nav groups ("Workspace", "Favorites"): 12px text in the quaternary tone, 24px tall label row with a small caret, no divider line. The label row plus the space before it replaces a rule.
- Top breadcrumb bar in the detail view: 28px tall rows, padding 6px 10px.
- Board column: 300px wide. Card: 300×96px, padding 8px 10px 12px 12px, 9px radius, 1px edge at 8% white, no shadow.
- Card contents in order: 10px ID in quaternary, 12px/510 title, then a row of 24px-tall pill chips (padding 0 8px 0 6px, 4px gap, 1px edge). A priority bars icon and an assignee avatar sit in the same row.
- Activity feed rows are 24px tall, 12px text, with a 1px vertical connector between them. Property rows (Reviews, labels) are 24px.
- Floating panel: 400×520px, 12px radius, 1px edge at 12% white, shadow `0 2px 32px` at 25% black, no inner padding on the shell (content brings its own).
- App frame on the marketing page: 1320×720px, 12px radius, no border, no shadow, ground colour only.
- Radius ladder: 8px (nav items, controls), 9px (cards), 12px (panels, app frame), 16px (large chat thread), full pill (chips, header buttons).

### Buttons and controls

| Kind | Height | Padding | Radius | Label |
|---|---|---|---|---|
| Header primary | 32px | 0 12px | pill | 13px / 510, light fill, dark text |
| Header secondary ("Log in") | 32px | 0 12px | pill | 13px / 400, tertiary text, no fill |
| Icon button (new issue, panel actions) | 28×28px | 0 | 8px | icon only, 14px |
| Nav item | 28px | 0 7px | 8px | 13px / 510 |
| Chip | 24px | 0 8px 0 6px | pill | 12px / 510 tertiary |

- Transitions on controls: 0.1s to 0.16s with an ease-out curve (cubic-bezier 0.25, 0.46, 0.45, 0.94), applied to colour, background and border, plus a filter transition on the send button. Nothing moves or scales.
- Secondary buttons have no fill at all until hover.

### Hover and selected states (measured)

| Element | Rest | Hover | Selected |
|---|---|---|---|
| Nav item | transparent | white at 2% over the ground | white at 4% over the ground |
| Nav item text | secondary tone | unchanged | unchanged |
| Nav item icon | quaternary tone | unchanged (not recoloured) | not measured |
| Header primary pill | light fill | full white fill, same dark text | n/a |

- The selected nav item is not recoloured and carries no accent. It is one step (2 percentage points) lighter than hover.
- The difference between hover and selected is 2% of white, so the two states are distinguishable only by comparison. Selected is the item that stays lit while the pointer is elsewhere.
- Row cursor is pointer on actions and default on non-links such as "More", so the pointer tells you what is live.

### Density and calm

- Row height is fixed per kind: 28px nav, 24px feed, 24px chip, 96px card. Nothing grows because of content.
- Per card, five things at most: ID, title, one to three chips, avatar, priority. Everything else is in the detail view.
- Metadata is one tone down from titles and one weight lighter (400 against 510), so scanning a column reads titles first.
- A numeric count follows the column title in tertiary tone ("Todo 71"), not in a badge.
- Edge fades: board columns on the right and left dissolve into the ground, so the density is cropped rather than shown in full.
- The detail view puts position in the list at the top right ("1 / 84", up and down arrows) so you can walk through items without returning to the list.

## For Selldial (derived, not observed)

- Rail: 208px wide on a 232px grid is close. Make nav items 36px tall at 14px/500 for a console that is used at arm's length, 8px radius, hover at white 3% and selected at the existing accent-wash. Group labels like "Workspace" are not needed with six items.
- Table: 48px rows (DESIGN.md) with 14px/500 title in ink-2 and 12px/400 detail in muted. Hover is raised-tone at about 3% lift. Selected uses accent-wash with no left bar.
- Filter bar: pill-shaped 32px controls with a 1px rule edge and no fill; the active filter gets the raised tone and a count. Put filters left, search right, nothing else.
- Drawer: 420px, 12px radius on the open edge only, edge at 12% alpha, no shadow stronger than `0 2px 32px` at 25%. Add "3 of 40" with up and down arrows in the header so an operator can step through conversations.
- Status chips: 24px tall, 6px dot in the state colour, 12px/500 neutral label.

## Taste DNA

### 1. Selection is one step brighter than hover, not a different colour

- **Trigger:** a list where one item is open and the pointer is on another.
- **Decision:** hover is white at 2% and selected is white at 4% on the same surface, with no accent colour, no left bar and no text recolour.
- **Reason:** the rail stays at one tonal level, so the eye reads the content in the main pane. The state still shows because it persists while hover comes and goes.
- **Evidence:** nav item rest transparent, hover rgba(255,255,255,0.02), selected rgba(255,255,255,0.04); text colour identical across all three; radius 8px.
- **Rejected alternative:** a coloured pill or left accent bar, which would make the rail the loudest thing on the page.

### 2. Colour marks a thing, text names it

- **Trigger:** many items that differ by status or type.
- **Decision:** a small coloured dot inside a neutral pill with a neutral word, instead of a coloured pill with white text.
- **Reason:** forty coloured pills in a column fight each other. Forty grey pills with one small dot each read as a texture, and the dot still gives a quick colour scan.
- **Evidence:** label chip 24px tall, pill radius, 1px edge at 8% white, 12px/510 text in tertiary tone, dot at 6–8px in red, blue or green.
- **Selldial:** Paid, Not paid, Handed off, Advised to wait should follow this form, which also meets the rule that state is never colour alone.

### 3. Fixed rows and tiny type steps make dense data predictable

- **Trigger:** screens that must hold a lot of items.
- **Decision:** every row type has one fixed height (28, 24 or 96px), one text size (12 or 13px) and one of two weights (510 or 400). Variety comes from tone, not size.
- **Reason:** when row height never changes, the eye learns the rhythm in two rows and can skim by position. Detail moves to the detail view.
- **Evidence:** nav 28px, feed 24px, chip 24px; card 96px with ID 10px, title 12px, chips 12px; the largest UI text is 20px in the detail title.
- **Selldial:** keep 48px table rows and two lines per cell, and move everything else to the drawer.

### 4. Restraint: no shadows on cards, a shadow only on what floats

- **Trigger:** surfaces stacked on a dark ground.
- **Decision:** cards use a 1px edge at 8% white and no shadow. Only the floating panel gets a shadow, and the edge there is 12%.
- **Reason:** on a dark ground a shadow is invisible on cards and adds weight on panels. Edges at low alpha show a boundary without adding a line.
- **Evidence:** card `box-shadow: none`, border 0.67px at 8% white; panel border 12% white, shadow `0 2px 32px` at 25% black; app frame has neither.
- **Rejected alternative:** the large soft halo that works on a light ground and disappears on dark.

## Feel, in one line each

1. Selected is one notch brighter than hover.
2. Colour is a dot, the word is grey.
3. Every row has one height.
4. Metadata is lighter and a tone down.
5. Only things that float get a shadow.

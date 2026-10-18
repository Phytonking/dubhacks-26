# What makes t-mobile.com feel good

Source: https://www.t-mobile.com home page, captured 2026-10-18 at 1440×900 (page height 4859px), single page. Feel and structure only. No assets, logo or exact brand colour are reproduced here, and none should be carried into Selldial. Where a number below is a colour, it is a lightness or role, not a value to copy.

Caveats: a cookie dialog and a 50% black scrim covered part of the first screen during capture. Hover values come from the page's CSS variables, not from a pointer test.

## Design Map

### Colour use

| Role | Observed | Share of coloured surface |
|---|---|---|
| Page and card ground | near-white, plus one step off-white for alternating bands | about 65% |
| Brand magenta | filled buttons, small icon accents, plan names, one full-bleed promo tile | under 1% by area |
| Ink | near-black for headings (about 8% lightness), mid-grey for fine print (about 44%) | text only |
| Dark ground | one charcoal footer band (about 20% lightness), one near-black badge strip on cards | about 14% |

- Magenta is a verb, not a surface. It appears on 12 elements, each one you can press, plus the plan names. Page area it covers is 0.7%.
- The only large magenta surface is a single promo tile. It sits beside white tiles and carries a huge numeral ("$0") in white, so the colour reads as one loud object in a quiet row.
- Hover moves a magenta fill one step darker (the fill token goes from the 400 stop to a 600 stop, roughly 15 lightness points down). Text colour stays the same. Nothing glows or lightens.
- Greys are neutral, not tinted. Selldial's tinted dark greys (hue 340) should do the same job but keep every step within about 4 lightness points of its neighbour so surfaces separate by tone, not borders.

### Dark and magenta surfaces

- Dark is used once, at the bottom: a charcoal footer 767px tall, padding 56px 24px, with off-white text (not pure white) at 14px and 10px.
- On dark, links are the same off-white as headings. There is no magenta text on charcoal. Magenta text appears only on light grounds (plan names, links, icon strokes).
- Card badges on photos use a near-black strip, 24px tall, padding 4px 8px, square corners, small caps-style label. It is the only dark element inside the main content.
- Promo tiles on photographic or magenta backgrounds put white text directly on the colour. They use no overlay gradient and no blur.
- Takeaway for Selldial: on a dark console, keep accent text rare and let neutral off-white carry the reading load. Use accent as a fill under dark ink text (as DESIGN.md already does) so contrast stays above 4.5:1.

### Type

- Two roles only: a heavy display face for headlines and prices, and the system sans stack for everything else.
- Display: weight 800, line-height about 1.04× (48px size on 50px line, 24px on 26px, 52px on 54px). Tracking left at normal. The tight leading is what makes the 3-line "All-New … $1000 off. No trade-in needed." headline read as one block.
- Scale seen: 10 / 11 / 12 / 14 / 16 / 20 / 24 / 32 / 48 / 52px. Most text is 14px (117 text nodes) and fine print is 10–11px (90 nodes).
- Weights in use: 400 body, 600 button labels and eyebrows, 700 nav and footer headings, 800 display. Four weights, no 300 or 500.
- Eyebrows ("APPLE", "SAMSUNG"): 12–14px, weight 600, uppercase in source text, normal tracking, set in grey above the headline.
- Prices are the largest numerals on a card: 52px at weight 800, with the unit and conditions at 14px beneath.
- Body copy under a headline sits at 16px, max line about 480px, line-height about 1.25.
- Takeaway for Selldial: Space Grotesk 600 at 28–40px with -0.02em tracking plays the display role. Keep body at 14px and use weight, not extra sizes, to rank.

### Spacing

- Most frequent gaps and paddings: 7px (146 uses, button vertical padding), 4px, 8px, 16px, 24px, 28px, 20px. A 4px base with 16 / 24 / 40 / 56 as the larger steps.
- Page gutter 24px on both sides of a 1648px max-width container. At 1440 the content is 1392px wide.
- Row of six quick-link tiles: each 180×73px, 24px apart, padding 16px 14px, 12px radius, 1px hairline border, icon above a 16px label with an arrow.
- Promo hero tile: 696×425px, content padding 40px 80px. Two-up beneath: 688×344px, media half is 344×344px (exactly square).
- Vertical rhythm between big bands is 40–120px. The space above a section heading is larger than the space between a heading and its cards, so each heading belongs to what follows it.
- Footer: padding 56px 24px, link columns separated by headings at 14px/700.

### Buttons

| Kind | Height | Padding | Radius | Label |
|---|---|---|---|---|
| Primary in content | 34px | 7px 16px | 4px | 14px / 600 |
| Primary in dialog | 40px | 10px 24px | 4px | 14px / 700, 0.7px tracking |
| Account button in header | 48px | 0 16px | 0px | 14px / 700 |
| Quick-link tile (secondary) | 73px | 16px 14px | 12px | 16px / 400, magenta label, 1px hairline |
| Text link with arrow | auto | 0 | n/a | 14px / 600, magenta, arrow glyph at right |

- One filled button per tile. The second action is always a text link with a trailing arrow, never a second filled button ("Start your switch" then "or" then "Call … ›").
- Primary labels are sentence-case verbs plus object: "Start your switch", "Pre-order now", "Learn more".
- Radius shrinks as the thing gets smaller: 4px on buttons, 8px on cards, 12px on tiles and the dialog, 60–90px only on the round chat launcher.
- Transitions are short: 0.15s ease-in on transform, 0.2s ease-out on icon fill, 0.3s ease-in-out on card background, shadow and transform.
- A focus-visible rule exists in the stylesheet.
- Takeaway for Selldial: DESIGN.md's 36px primary at 8px radius is fine. Copy the pairing (one fill + one arrow link) and the darker-one-step hover, not the 4px radius.

### Cards and shadows

- Card: white fill, 8px radius, no border, shadow `0 2px 20px 3px` at 11% dark plus `0 2px 20px 10px` at 3% — a wide, low-contrast halo with no visible edge.
- Hover on cards swaps to a stronger shadow token and may nudge transform; the move is 0.3s ease-in-out.
- Selldial should not use this halo (DESIGN.md forbids heavy shadows). The transferable part is that the card is separated by tone and a soft edge, not by a heavy border.

### Lists and density

- Header: 24px utility strip (10px caps labels) over a 69px main bar. Nav labels 14px / 700 with a chevron, on a 48px-tall target. Dense, but every target stays at or above 44–48px tall.
- Footer link lists: 14px text, about 23px line-height, one link per line, grouped under 14px/700 headings in 5 columns. This is the densest area on the site, and it still keeps one idea per column.
- Card rail: four 270–350px cards in a horizontal scroller with paired prev/next buttons at the lower right. Cards are all the same height, so the row stays aligned.
- Fine print is pushed outside the card, below the rail, at 10–11px in mid-grey. The card itself holds only eyebrow, headline, one sentence, one button.
- Plan cards: three side by side. Each has a magenta 24px/800 name, a 52px price, one 14px "per phone line…" line, 16px copy, one button. No feature checklist table.
- Takeaway for Selldial: a row of 48px with 2 lines (name + muted detail) beats a 5-column grid. Move conditions and secondary facts out of the row and into the drawer.

## Taste DNA

### 1. Colour as a trigger, not as decoration

- **Trigger:** a page that must sell many things at once (phones, plans, deals, home internet).
- **Decision:** give magenta to under 1% of the area and spend all of it on pressable things and on one hero tile. Everything else is neutral.
- **Reason:** when only pressable things are coloured, the eye lands on the next action without reading. Many equal accents would dilute that.
- **Evidence:** 12 magenta-filled elements cover 0.7% of surface; white and off-white cover about 65%; the dark band is the footer only.
- **Selldial:** keep the "accent under 8%" rule, and aim for far less in tables. In the console, only the primary button, active nav and focus ring should be magenta.

### 2. Weight does the ranking, size stays on a short ladder

- **Trigger:** headlines, prices and fine print all appear in the same viewport.
- **Decision:** one heavy display weight (800) for what you must read, 600–700 for controls, 400 for the rest. Line-height on display text is 1.04×.
- **Reason:** tight, heavy display text reads as a single shape from across the room, so the supporting 14px copy can stay small without getting lost.
- **Evidence:** h1 and h3 are both 48px/800/50px; h2 is 24px/800/26px; price is 52px/800/54px; 117 text nodes at 14px.
- **Selldial:** big figures on Home (calls, sales, saved) should be display-face 600 at 28–40px with the label at 12–14px muted.

### 3. Restraint: one filled button per object

- **Trigger:** every tile has two things a customer might do.
- **Decision:** one filled button plus a text link with an arrow. A second filled button is never used. The rejected alternative is two equal buttons ("Buy" and "Learn more") side by side.
- **Reason:** the filled button names the path you want taken, and the arrow link lets anyone who is not ready leave without feeling declined.
- **Evidence:** "Start your switch" (34px, filled) then "or" then "Call … ›" (text); each deal card has one filled button; quick-link tiles use a hairline and no fill.
- **Selldial:** in the report drawer, one primary action ("Open", "Approve") and one link-style action.

### 4. Density is allowed where each target stays large and each group has one job

- **Trigger:** a footer or header that has to hold dozens of links.
- **Decision:** keep text small (14px, 10px for utility) but keep every click target at 24–48px tall, group by headings, and push legal text out of the card.
- **Reason:** people scan columns by heading and only read inside the one they want, so many items cost little.
- **Evidence:** footer track 767px tall with 5 headed columns at 14px/23px; header target 48px; fine print lives in a separate 10–11px grey line below each rail.
- **Selldial:** tables at 48px rows with two lines max per cell, secondary facts in the drawer, and no more than five columns.

## Feel, in one line each

1. Loud only where you can press.
2. Heavy headlines, quiet paragraphs.
3. Cards separated by a soft halo, not outlines; Selldial separates by tone.
4. One main button, one arrow link.
5. Dark appears once, at the bottom, and carries no accent text.

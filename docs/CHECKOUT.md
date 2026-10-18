# Sales and checkout (sandbox)

Text flow: the customer says they want to buy -> the agent **quotes** (server-priced) -> reads it back and gets a clear yes -> texts a **one-time payment link** -> the customer pays **on the page, never in chat** -> the order is recorded and the agent confirms by text. Nothing is really charged: the gateway is a mock (`mockGateway` in `web/src/lib/checkout-core.ts`); a real processor implements the same `Gateway` interface.

```
customer text ──► checkout_quote ──► checkout_quotes (amount fixed server-side)
                       │ over owner limit? ──► approvals (console: Approve / Decline) ──► notice wakes the agent
                       ▼
          checkout_send_payment_link ──► payment_requests (SHA-256 of token only) ──► text with /pay/<token>
                       ▼
  /pay/<token> (card form) ──► submitPayment ──► gateway.charge ──► payments (brand + last 4) + orders + sale notification
                       ▼
        "Payment completed: ..." notice in the thread ──► scheduler turn ──► agent confirms
```

## What the agent can and cannot do
- `checkout_quote` prices plans (per-line table + connection charge), phones (full or financed 24 months by credit tier: prime 0% / near-prime 4.9% + 10% down / subprime 9.9% + 20% down), protection (tier must match the phone), accessories, and an account holder's trade-in (financed trade-in charges the remaining balance today). The model chooses *what*; it never supplies an amount.
- `checkout_send_payment_link` needs the customer's explicit yes, and a verified customer if the number is linked to an account. The link is texted; the model, the thread and `tool_calls` never contain it.
- `checkout_status` reports waiting / approval / paid (brand + last 4) / declined / locked.
- Over the owner's limit (default $1,500, `orgs.ownerLimitCents` or `agents.guardrails.ownerLimitCents`): no link until the owner approves in the console. A declined order can never be paid.

## With negotiation (`agent/src/engine/tools/offers.ts`)
`negotiation_accept` records what the customer agreed to (plan, lines, monthly credit, months) on `contacts.memory.offers`. `checkout_quote` with `use_accepted_offer: true` prices exactly that, taking the credit from our record (the model cannot supply one), says when it ends, and marks the offer `redeemed` once the purchase is paid so it cannot be used twice. A plan with nothing due today (no connection charge) has nothing to charge: the deal stays recorded for the team, as before. Re-quoting the same order returns the live quote, so a re-check never resets an approval or a link.

## Card data rules (tested in `agent/scripts/checkout-test.ts`)
- A card number, CVC or expiry typed or said in chat is redacted before storage (`agent/src/sensitive.ts`), including mistyped numbers; the assistant is also blocked from asking for them.
- The card only goes to `/pay/<token>`. `submitPayment` validates (Luhn, expiry, CVC length, ZIP), charges, and keeps **only brand and last 4**. No number, expiry or CVC reaches Mongo, the thread, `tool_calls`, model requests or logs (a test scans every collection).
- Links: 256-bit token, hash stored, 30 minutes, GET is read-only (preview bots do not burn it), a double submit charges once (atomic claim + idempotency key), 3 declined tries then the link locks and the quote fails, `/pay` is `no-store` / `noindex` / `no-referrer` / not frameable.

## Sandbox test cards
`4242 4242 4242 4242` (Visa, succeeds), `5555 5555 5555 4444` (Mastercard), `3782 822463 10005` (Amex, 4-digit CVC), `4000 0000 0000 0002` (declined), `4000 0000 0000 9995` (insufficient funds), `4000 0000 0000 0119` (processing error). Any future expiry, any CVC of the right length, any 5-digit ZIP.

## Console (Selldial)
Pending (waiting on owner approval or on the customer's card), Paid (sale counted live through the change stream), Not paid (declined 3 times or owner declined). The conversation drawer has **Approve / Decline** for over-limit orders, and **Mark paid** for a deal confirmed outside checkout (PR #10).

## Not built
A real processor, refunds, receipts by email, a proactive "approved" text when the owner is offline from the console (the agent replies on its next turn; the notice message triggers it), and moving the customer list out of the live snapshot.

## Run
`cd agent && pnpm checkout-test` (28 checks, no network). Against the real model: `pnpm checkout-eval` (14 checks on a scripted customer: buys a phone, sends a card in chat, pays, big order needing approval, declined card). The payment page: `cd web && pnpm dev`, then open the link the agent texted.

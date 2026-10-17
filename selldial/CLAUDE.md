# Selldial

This folder is self-contained. The repo's `agent/` (TypeScript Daytona runtime) and `web/` (Next.js console) are separate; paths below are relative to `selldial/`.

Full product spec: `PRODUCT.md`. Design spec: `DESIGN.md`. Read both before building features or UI.

We are building Selldial at DubHacks 26: a T-Mobile phone line (voice + text via Photon) that sells to customers, argues against its own sale when waiting is better, and closes purchases through a Visa checkout the account owner controls. The LLM only handles conversation; deterministic Python code makes every recommendation, and guard rules gate every action.

## Stack

- Python + FastAPI backend
- Photon 2.0 for phone, SMS and iMessage
- Claude or Gemini with tool calling, behind one interface (`agent/llm.py`)
- MongoDB Atlas or SQLite behind a repository layer
- Visa sandbox, or a mock with the same interface (`payments/checkout.py`)
- Plain HTML dashboard (`dashboard/`), served by the FastAPI app. Look and feel: `DESIGN.md` (Google Sans, tokens, layout)
- Render or Railway for hosting, ngrok for local webhooks

## Layout

```
engine/      optimizer.py, tradein.py, policy.py, explain.py: pure functions, no I/O
data/        generate.py, seeds/ (console.json is the dashboard's demo snapshot)
agent/       llm.py, tools.py, guards.py, server.py, session.py, audit.py
channels/    photon_text.py, photon_voice.py, approvals.py, receipts.py
payments/    checkout.py (interface), visa.py, mock.py
dashboard/   index.html + landing.css: sign-in landing (live screen as backdrop)
             live.html + live.js/live.css: live reasoning screen judges watch (plays session-demo.js)
             console.html + app.js/api.js/data.js/customers-data.js/styles.css: console (home, overview, conversations, customers, sales, settings, about)
             tokens.css: shared design tokens from DESIGN.md
tests/       pytest
```

## Agent rules (enforced in `agent/guards.py`)

1. No discount outside the policy table.
2. No account change before the caller is verified.
3. Purchases above the owner's limit need the owner's yes by text.
4. Every recommendation gives a one-sentence reason and the runner-up.
5. If unsure, hand off to a human with a summary.
6. Log every action to the audit log.
7. Only state numbers that came from tool results.

Money is integer cents everywhere.

## Dashboard API

The dashboard calls these routes and falls back to `dashboard/data.js` when the backend is down:

- `GET /api/console`: snapshot shaped like `data/seeds/console.json`
- `POST /api/approvals/{id}/resend`: re-text the owner
- `POST /api/approvals/{id}/cancel`: release the Visa hold
- `POST /api/handoffs/{id}/claim`: body `{"agent": "<name>"}`
- `POST /api/promos`: create or update a promo code (the policy table, rule 1)
- `POST /api/demo/reset`: reload the demo household (the live screen's Reset demo)

The console can resend or cancel an approval, but never approve it. Only the owner's text can do that (rule 3).

`dashboard/data.js` and `data/seeds/console.json` hold the same demo data. Keep them in sync.

Customers, plans and analytics come from the mageshkumarj/dubhacks sandbox: run `python data/import_sandbox.py path/to/sandbox.db` to regenerate `data/seeds/customers.json` and `dashboard/customers-data.js`. Names and regions are synthetic.

## Commands

- `make dev`: run the API and dashboard at http://localhost:8000
- `make test`: run pytest

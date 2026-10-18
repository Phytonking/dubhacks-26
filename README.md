# Selldial

**The cell line that helps customers buy.**

Customers call or text. Selldial answers, explains its pick and waits for your yes. Website: [selldial.biz](https://selldial.biz).

## How it works

1. **It answers.** A customer texts or calls. Selldial picks up, verifies the caller, quotes the real price and asks before it does anything.
2. **It explains.** Every pick comes with its reason and the option it passed on, in words you can check. The console shows each call as a decision timeline.
3. **You approve.** Above your limit, Selldial texts the account owner and holds. Nothing is charged without a yes.

The demo runs on the T-Mobile hackathon dataset. All customer data is synthetic, and the demo sign-in collects no credentials.

## Repository layout

| Path | What it is |
| --- | --- |
| `web/` | Next.js owner console and API (MongoDB-backed). Serves the Selldial landing page and console from `web/public/selldial`. |
| `agent/` | Agent runtime: engine, identity and verification, messenger, scheduler, voice server, handoff, approvals. Daytona sandbox orchestrator and Photon (iMessage/SMS/WhatsApp) channel adapter. |
| `docs/` | PRDs, architecture notes and test reports (HTML). |
| `database information/` | Living database docs: design, setup, decisions, changelog. |

Start with `docs/AGENT-MASTER.html` (PRD index, reconciled decisions, scope, build results). Other docs: `docs/PRD.html`, `docs/AGENT-ARCHITECTURE.html`, `docs/VOICE-FLOW.html`, `docs/SMS-OTP-FORMS.html`, `docs/PRD-tmobile-data-integration.html`, `docs/TEST-REPORT-agent-runtime.html`.

## Quick start: the console

```bash
cd web
cp .env.example .env.local      # set MONGODB_URI (Atlas, or local below)
pnpm install
pnpm db:local                   # optional: local MongoDB on :27017 (separate terminal)
pnpm db:setup                   # create collections, validators, indexes (idempotent)
pnpm db:seed                    # demo business "Sunrise Bike Shop" (refuses if data exists; `-- --reset` wipes)
pnpm dev                        # http://localhost:3000
```

- `GET /api/health` pings Mongo.
- Auth is not wired yet. The app serves the first org in the DB (`getCurrentOrg()` in `web/src/lib/queries.ts`). Every query takes `orgId`.
- The console UI lives in `web/public/selldial` (landing `index.html`, app `console.html`) and is fed by `/api/console` and `/api/console/stream`. Design notes: `web/public/selldial/DESIGN.md`.

## T-Mobile sample data

The T-Mobile dataset ([`mageshkumarj/dubhacks`](https://github.com/mageshkumarj/dubhacks), synthetic) is migrated into Atlas under its own org, "T-Mobile": `tmo_*` collections, 54 knowledge rows, and 50 persona contacts with character sheets and memory. The console shows this business by default. Its Customers screen lists the 50 personas, 8 prospects and 450 more households with plan, lines, bill, support history and the agent's persona profile. Design: `docs/PRD-tmobile-data-integration.html`.

```bash
cd web
pnpm db:seed:tmobile -- --db /path/to/dubhacks/data/sandbox.db   # idempotent; skips if checksum unchanged (--force, --reset-personas)
pnpm tsx --env-file=.env.local scripts/verify-tmobile.mts --api http://localhost:8000   # Atlas copy vs source API (needs sandbox server running)
pnpm db:profile:tmobile [-- --llm-pct 10 --regen-llm --no-llm --dry]
```

Profiles for all 5,042 accounts (name, household, tone, relationship, sensitivities, `voice.notes` for the ElevenLabs agent, backstory) are written to `tmo_accounts.profile`. About 10% of accounts plus all 50 personas get an LLM-written backstory; the rest get a rule-based one.

The seed only touches the T-Mobile org. Sunrise Bike Shop data is left alone.

## Agent engine (`agent/`)

```bash
cd agent && pnpm install
pnpm test         # 11 offline suites: identity, engine, messenger/codes/forms, scheduler, voice, summarizer, reach, safety, intake, offers, handoff
pnpm live         # live runner (needs web/.env.local): Photon events -> scheduler lanes -> engine -> replies. ENGINE=legacy = old sandbox path
pnpm conv-suite   # generated conversations against the real model (uses tokens; not part of pnpm test)
pnpm typecheck
```

End-to-end sandbox test:

```bash
pnpm e2e          # creates a real Daytona sandbox, runs ~15 checks on an in-memory Mongo, deletes the sandbox
pnpm report       # writes docs/TEST-REPORT-agent-runtime.html
```

The e2e test needs these in `../web/.env.local`: `DAYTONA_API_KEY`, `MODAL_API_ENDPOINT`, `MODAL_PROXY_TOKEN_ID`, `MODAL_PROXY_TOKEN_SECRET`, `PHOTON_API_KEY`, `PHOTON_PROJECT_ID`, `MONGODB_URI`.

Platform secrets (Photon, Daytona, Modal, Mongo) stay on the host. Only an allow-listed env goes into a sandbox.

ElevenLabs voice setup: `agent/scripts/elevenlabs-setup.mts`. Why a customer can be sent to a person, and the guard: `docs/AGENT-MASTER.html` section 9e; audit with `agent/scripts/handoff-audit.mts`.

Secure forms live in `web/`: `/f/<token>` is the public page, `/forms` is the owner view behind `FORMS_ADMIN_PASSWORD`. All environment variables are listed in `web/.env.example`.

## Sales and checkout

The agent can quote, text a one-time secure payment link, and record the paid order. Card details never go through chat. See `docs/CHECKOUT.md` (flow, card-data rules, sandbox test cards). Tests: `cd agent && pnpm checkout-test`.

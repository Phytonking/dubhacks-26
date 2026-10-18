# Sales Agent Platform

- `web/` — Next.js owner console (dashboard, inbox, contacts, agent settings). MongoDB-backed.
- `agent/` — agent runtime: Daytona sandbox orchestrator (`provisionAgent`, wake, destroy), in-sandbox `agentd`, recorded message I/O (Mongo write-first), Modal LLM calls, e2e test + report. Photon channel adapter and voice gateway not built yet.
- `docs/AGENT-MASTER.html` — **start here** for the agent: PRD index, reconciled decisions, scope, build results.
- `docs/PRD.html` — product plan. `docs/PRD-agent-runtime-photon-voice.html` — Daytona agent runtime, Photon voice, onboarding. `docs/TEST-REPORT-agent-runtime.html` — latest e2e results.
- `database information/documentation.html` — living docs: database design, setup, decisions, integrations, changelog.

## Run the console

```bash
cd web
cp .env.example .env.local      # set MONGODB_URI (Atlas, or local below)
pnpm install
pnpm db:local                   # optional: local MongoDB on :27017 (separate terminal)
pnpm db:setup                   # create collections, validators, indexes in Mongo (idempotent)
pnpm db:seed                    # demo business "Sunrise Bike Shop" (refuses if data exists; `-- --reset` wipes)
pnpm dev                        # http://localhost:3000
```

`GET /api/health` pings Mongo. Auth is not wired yet: the app serves the first org in the DB (`getCurrentOrg()` in `web/src/lib/queries.ts`). Every query takes `orgId`.

## Run the agent end-to-end test

```bash
cd agent
pnpm install
# needs in ../web/.env.local: DAYTONA_API_KEY, MODAL_API_ENDPOINT, MODAL_PROXY_TOKEN_ID, MODAL_PROXY_TOKEN_SECRET,
# PHOTON_API_KEY, PHOTON_PROJECT_ID, MONGODB_URI (see web/.env.example)
pnpm e2e       # creates a real Daytona sandbox, runs ~15 checks on an in-memory Mongo, deletes the sandbox
pnpm report    # writes docs/TEST-REPORT-agent-runtime.html
```

Platform secrets (Spectrum, Daytona, Modal, Mongo) stay on the host; only an allow-listed env goes into a sandbox.

## T-Mobile sandbox data in Atlas

The T-Mobile hackathon dataset (`github.com/mageshkumarj/dubhacks`, synthetic) is migrated into Atlas under its own org ("T-Mobile"): `tmo_*` collections, 54 knowledge rows, 50 persona contacts with character sheets and memory. Design: `docs/PRD-tmobile-data-integration.html`.

```bash
cd web
pnpm db:seed:tmobile -- --db /path/to/dubhacks/data/sandbox.db   # idempotent; skips if the dataset checksum is unchanged (--force, --reset-personas)
pnpm tsx --env-file=.env.local scripts/verify-tmobile.mts --api http://localhost:8000   # Atlas copy vs source API (needs the sandbox server running)
```

It only touches the T-Mobile org; Sunrise Bike Shop data is left alone.

## Agent engine (`agent/`)

```bash
cd agent && pnpm install
pnpm test         # 133 offline tests: identity, engine, messenger/codes/forms, scheduler, voice server, summarizer
pnpm live         # live runner (needs web/.env.local): Photon events -> scheduler lanes -> engine -> replies. ENGINE=legacy = old sandbox path
```

Secure forms live in `web/` (`/f/<token>` public page, `/forms` owner view behind `FORMS_ADMIN_PASSWORD`). Environment variables: see `web/.env.example`.

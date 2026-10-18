# Sales Agent Platform

- `web/` — Next.js owner console (dashboard, inbox, contacts, agent settings). MongoDB-backed.
- `agent/` — agent runtime: Daytona sandbox orchestrator (`provisionAgent`, wake, destroy), in-sandbox `agentd`, recorded message I/O (Mongo write-first), Modal LLM calls, e2e test + report. Photon channel adapter and voice gateway not built yet.
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

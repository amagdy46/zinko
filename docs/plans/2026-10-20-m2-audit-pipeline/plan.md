---
type: plan
status: draft
design: ../../vision.md
---

# M2 Audit Pipeline Plan

**Goal:** Run an audit from the web app (a site's pages × consent scenarios × viewports), watch it progress live, and browse the decoded hits.
**Approach:** One Cloudflare Workflow per audit with one durable step per capture. Each step calls the M1 engine, writes the screenshot and the raw capture to R2, writes decoded hits and `dataLayer` pushes to Postgres, and publishes a small progress event to an authenticated per-audit Durable Object. The trade-off: captures run one at a time (the container takes one capture at a time), so a 10 pages × 3 scenarios audit takes about 5 minutes; parallel containers wait for a later milestone.

Design sources: `docs/vision.md` (Audit pipeline M2, M2/M3 notes), `docs/product.md` (v0.1 steps 2–4 and 7), `docs/ui.md` (Navigation, screens 1, 2 and 6, States), `docs/architecture.md` (data model), `docs/decisions/0002-capture-engine.md`, and the M1 code.

## Global constraints

- **No unit or integration tests** (`AGENTS.md`, current phase). Each task's "Verify" lines are its acceptance check: run the real thing and report the command and what it showed. UI tasks are verified by driving the app in a browser (Playwright MCP) and looking at screenshots.
- `pnpm check && pnpm typecheck && pnpm build` pass with zero errors and zero warnings after every task.
- Effect rules from `AGENTS.md`: services in `packages/core`, layers wired only in `apps/web/src/server/layers.ts`, tagged errors, `Schema` at every boundary (server function input, WebSocket messages, Workflow payloads, R2 JSON), no `any`, no `try/catch` around Effects.
- **Organization scoping.** Every table carries `org_id`. Every server function runs behind `requireSession`, reads `activeOrganizationId` from the session, and filters every query by it. An id from another organization behaves exactly like a missing id (404), never a 403.
- **Roles.** Any member can create clients, sites and audits. Only `owner` and `admin` can delete a client or site; check on the server.
- **Pages stay on the site.** Every audited URL must be on the site's host or a subdomain of it; reject others at the server boundary. This is the allow-list from `docs/architecture.md` rule 4.
- **Test traffic stays out of client analytics.** The New audit form has "Answer tracking requests locally", **on by default**, which sets `blockVendorRequests` on every capture. Hits are still recorded; vendors never receive them. Fixture audits always run with it on.
- **Workflow step results stay small.** Cloudflare caps a step's result at 1 MiB: screenshots and raw captures go to R2 through `Storage`, never through a step result.
- **Idempotent steps.** A retried step must not duplicate rows or artifacts: storage keys are deterministic and hit and push inserts are keyed so a rerun replaces, not appends.
- Migrations are generated (`pnpm --filter @repo/db db:generate`), never hand-written; never edit files under `packages/db/drizzle/`.
- No new dependencies without asking. Tables are plain HTML tables with server-side pagination.
- `TMPDIR=$HOME/.cache/tmp`. Never use sudo; hand any `sudo docker` command to the user. Never push.

## Models

| Model | Used for |
|---|---|
| **Opus** | The audit workflow and persistence (Task 4): durability, retries, idempotency and partial failure |
| **Sonnet** | Schema (1), clients and sites (2), local dev wiring (3), live progress (5), New audit and running screens (6), Hits explorer (7), demo and docs (8) |
| **GPT-6.1-Sol** (Fable 5.1 when Sol is over its limit) | Reviews each task's diff before it merges |

## Review focus

1. **Cross-organization access.** Ids come from URLs. Verified in Tasks 2, 6 and 7 by signing in as a second user in another organization and requesting the first organization's client, site, audit and hits by id (404 each), and in Task 5 by connecting to another organization's audit room (refused).
2. **Retried steps.** A step that fails after writing must not leave duplicate hits. Verified in Task 4 by forcing a failure after the inserts on the first attempt and checking the row counts after the retry.
3. **Partial audits.** A blocked page or an unreachable host must give a `partial` run with its error code, and the audit still finishes. Verified in Task 4 with an unreachable page in the audit.
4. **WebSocket authorization.** The scaffold's `/ws/rooms/*` route has no authentication. The audit room must check the session and the audit's organization before upgrading, and must ignore client messages. Verified in Task 5.
5. **Off-site URLs.** A page on another host, or a `gclid`-style parameter that smuggles a different URL, is rejected. Verified in Task 6.
6. **Large captures.** A capture with 2,000 requests and a 10 MB result must finish its step without hitting the 1 MiB step limit. Verified in Task 4 with the engine's request-cap probe page.

### Task 1: Audit tables

**Model:** Sonnet
**Files:** create `packages/db/src/audit-schema.ts`; modify `packages/db/src/index.ts`; generated migration in `packages/db/drizzle/`
**Interfaces:** produces Drizzle tables and inferred types, all with `id uuid primary key default random`, `org_id text not null` and `created_at timestamptz default now()`:
- `client`: `name text not null`
- `site`: `client_id uuid not null references client on delete cascade`, `name text not null`, `origin text not null` (scheme and host, no path, e.g. `https://shop.example`)
- `audit`: `site_id uuid not null references site on delete cascade`, `created_by text not null` (user id), `config jsonb not null` (`AuditConfig`, Task 4), `status text not null` (`queued | running | complete | partial | failed`), `workflow_id text`, `started_at timestamptz`, `finished_at timestamptz`
- `run`: `audit_id uuid not null references audit on delete cascade`, `ordinal integer not null`, `page_url text not null`, `scenario text not null`, `viewport text not null`, `status text not null` (`pending | running | complete | partial | failed`), `engine jsonb`, `consent jsonb`, `documents jsonb`, `cookies jsonb`, `errors jsonb`, `complete boolean`, `truncated boolean`, `screenshot_key text`, `capture_key text`, `hit_count integer not null default 0`, `started_at timestamptz`, `finished_at timestamptz`; unique `(audit_id, ordinal)`
- `hit`: `run_id uuid not null references run on delete cascade`, `request_id text not null`, `batch_index integer not null`, `document_id text not null`, `at integer not null` (ms since capture start), `vendor text not null`, `destination_id text not null`, `event text not null`, `params jsonb not null`, `ids jsonb not null`, `consent jsonb not null`, `host text not null`, `url text not null`, `after_consent boolean not null`; unique `(run_id, request_id, batch_index)`
- `datalayer_push`: `run_id uuid not null references run on delete cascade`, `seq integer not null`, `document_id text not null`, `at integer not null`, `value jsonb not null`; unique `(run_id, seq)`
- Indexes: `client(org_id)`, `site(org_id, client_id)`, `audit(org_id, site_id, created_at desc)`, `run(audit_id)`, `hit(run_id, at)`, `hit(run_id, vendor)`, `datalayer_push(run_id, at)`
**Blocked by:** none

- [ ] Write the tables; the remaining example `note` table stays as is
- [ ] `pnpm --filter @repo/db db:generate`, then `pnpm db:migrate` against the local database
- [ ] Verify: `psql "$DATABASE_URL" -c '\d hit'` (and `run`, `audit`) shows the columns, foreign keys, unique constraints and indexes; paste them

### Task 2: Clients and sites

**Model:** Sonnet
**Files:** create `apps/web/src/server/clients.ts`, `apps/web/src/routes/app/clients/index.tsx`, `apps/web/src/routes/app/clients/$clientId.tsx`, `apps/web/src/routes/app/sites/$siteId.tsx`; modify the app shell navigation (`apps/web/src/routes/app.tsx`)
**Interfaces:** consumes Task 1 tables; produces server functions `listClients()`, `createClient({ name })`, `deleteClient({ id })`, `getClient({ id })` (with its sites), `createSite({ clientId, name, url })`, `deleteSite({ id })`, `getSite({ id })` (with its audits, newest first, 20 per page); and the `/app/sites/$siteId` page that Task 6 adds the "New audit" button to
**Blocked by:** 1

- [ ] `createSite` takes any http(s) URL and stores its origin (scheme and host, lowercased, default port dropped); names are 1–100 characters
- [ ] Delete functions check `owner` or `admin` on the server; the UI hides the button for members
- [ ] Empty states: no clients yet, no sites yet, no audits yet (`docs/ui.md`, States)
- [ ] Verify in the browser: create a client and a site with `http://localhost:4400/clean/`; the site shows origin `http://localhost:4400`; screenshot each page; a member account sees no delete buttons and a direct `deleteSite` call fails; a second user in another organization gets 404 for the first organization's client and site ids

### Task 3: Local development with the real engine

**Model:** Sonnet
**Files:** modify `apps/web/src/server/browser.ts`, `apps/web/src/server/layers.ts` (or wherever the Browser layer is chosen), `infra/alchemy.run.ts` or `.dev.vars` as `pnpm dev` requires; `README.md` and `CONTRIBUTING.md` (local setup)
**Interfaces:** produces `BROWSER_URL`: when set, `Browser.capture` posts to `${BROWSER_URL}/capture` over plain HTTP instead of the container binding, with the same decoding and error handling; unset, the container binding is used as now
**Blocked by:** none

- [ ] Find out how `pnpm dev` (Alchemy dev) runs Containers locally; if it needs Docker (and so sudo here), use `BROWSER_URL` for local development and say so in `CONTRIBUTING.md`
- [ ] `BROWSER_URL` is accepted only for `dev` stages; any other stage ignores it and uses the container
- [ ] Verify: with Postgres up, the engine at `http://localhost:8080` (started with `ALLOW_PRIVATE_NETWORKS=true`) and the fixtures served, `pnpm dev` starts; signed in, calling `runBrowser` from the browser console (or a temporary page) on `http://localhost:4400/clean/` with `blockVendorRequests: true` returns a `CaptureResult`; paste its `engine`, `consent` and request count

### Task 4: Audit workflow and persistence

**Model:** Opus
**Files:** modify `packages/core/src/audit.ts` (adds `AuditConfig` and `TEST_CLICK_IDS`); create `apps/web/src/workflows/Audit.ts`, `apps/web/src/server/audits.ts`; modify `packages/core/src/jobs.ts` (`JobPayloads.audit`), `packages/core/src/index.ts`, `apps/web/src/server/jobs.ts`, `apps/web/src/server.ts` (export `Audit`), `infra/alchemy.run.ts` (Workflow `Audit`, binding `AUDIT_WORKFLOW`)
**Interfaces:**
- `AuditConfig = { pages: string[] /* 1–20, first is the start URL */, scenarios: Scenario[] /* non-empty */, viewports: ("desktop" | "mobile")[] /* non-empty */, clickIds: boolean, blockVendorRequests: boolean }` in `@repo/core`
- `TEST_CLICK_IDS = { gclid: "ZINKO-TEST-GCLID", fbclid: "ZINKO-TEST-FBCLID", ttclid: "ZINKO-TEST-TTCLID", utm_source: "zinko", utm_medium: "cpc", utm_campaign: "zinko-audit" }`, appended to every page URL when `clickIds` is on
- `JobPayloads.audit = { auditId: string }`
- server functions: `startAudit({ siteId, config }) → { auditId }` (creates the `audit` row and one `run` row per page × scenario × viewport in that order, `ordinal` from 0, then starts the workflow and stores its id); `getAudit({ id })` (audit, config, runs with status, hit counts and signed screenshot URLs)
- consumes Task 5: `AuditProgress.publish(auditId, event: AuditEvent)` where `AuditEvent = { type: "run", runId, ordinal, status, hitCount, errors: { code, message }[] } | { type: "audit", status }`
**Blocked by:** 1, 3, 5

- [ ] Workflow `Audit`: step `start` marks the audit `running`; then one step `run-<ordinal>` per run, in order; then step `finish` sets the audit status (`complete` when every run is `complete`, `failed` when none produced a result, `partial` otherwise) and publishes `{ type: "audit" }`
- [ ] Each `run-<ordinal>` step: marks the run `running` and publishes it; calls `Browser.capture`; writes the screenshot to `audits/<auditId>/runs/<runId>/screenshot.png` and the result without the screenshot to `audits/<auditId>/runs/<runId>/capture.json` through `Storage`; decodes every request with `@ovriq/zinko-decoders` and inserts hits (`after_consent` = `startedAt > consent.completedAt`) and `dataLayer` pushes with `onConflictDoNothing` on the unique keys; updates the run (status `complete`, or `partial` when `complete` is false, engine, consent, documents, cookies, errors, flags, keys, `hit_count`); publishes the run event; returns only `{ runId, status, hitCount }`
- [ ] Errors: `BrowserError` carrying `CaptureRejected` (`PolicyDenied`, `InvalidRequest`) is non-retryable and marks the run `failed` with that code; other `BrowserError`s (including 429 busy) retry 5 times with exponential backoff from 10 s, then mark the run `failed` with `EngineFailure`; step timeout 4 minutes
- [ ] Verify with the fixtures (vendor answering on): an audit of `clean`, `meta-before-consent` and `ga4-batch` × none/accept/reject × desktop finishes `complete` with 9 runs; `select count(*) from hit group by run` matches each run's `hit_count`; the `ga4-batch` accept run has three hits sharing one `request_id`; the R2 keys exist (`Storage.get`)
- [ ] Verify the review-focus cases: an audit including `http://10.255.255.1/` on a site with that origin ends `partial` with that run `failed`/`PolicyDenied` (with the engine's private networks off for this run, or a public unroutable address); forcing the first attempt of one step to fail after its inserts leaves the same row counts after the retry; a capture of the engine's 2,000-request probe page completes its step

### Task 5: Live progress over an authenticated audit room

**Model:** Sonnet
**Files:** create `packages/core/src/audit.ts` (`AuditEvent` schema and the `AuditProgress` service), `apps/web/src/realtime/AuditRoom.ts`, `apps/web/src/server/audit-progress.ts`, `apps/web/src/server/audit-room-route.ts`, `apps/web/src/lib/use-audit-room.ts`; modify `apps/web/src/server.ts` (export `AuditRoom`), `apps/web/src/server/routes.ts`, `apps/web/src/server/layers.ts`, `infra/alchemy.run.ts` (Durable Object `AuditRoom`, binding `AUDIT_ROOM`)
**Interfaces:** produces in `@repo/core`: `AuditEvent` (as defined in Task 4's interfaces) and `AuditProgress` with `publish(auditId: string, event: AuditEvent): Effect<void, AuditProgressError>`; produces `AuditProgressLive`, the route `/ws/audits/<auditId>`, and `useAuditRoom(auditId): { events: AuditEvent[], connected: boolean }`
**Blocked by:** none. Its access check reads the `audit` table, so it needs Task 1's schema to verify; it can be written in parallel

- [ ] `AuditRoom` is one Durable Object per audit (named by audit id) with hibernating sockets: `publish(event)` sends the JSON to every socket; client messages are ignored; at most 50 sockets
- [ ] The route resolves the session from the request headers through Better Auth and refuses the upgrade (401 signed out, 404 when the audit is not in the session's active organization) before touching the Durable Object
- [ ] `useAuditRoom` validates every message with `Schema` and reconnects with backoff; the page reloads state from `getAudit` on reconnect, so missed events cost nothing
- [ ] Verify: in the browser, an audit page receives run events as an audit runs (log them); `websocat` (or a Node `WebSocket`) without a session cookie gets 401, and with another organization's session gets 404; a client-sent message reaches no other socket

### Task 6: New audit form and the running audit

**Model:** Sonnet
**Files:** create `apps/web/src/routes/app/sites/$siteId.audits.new.tsx`, `apps/web/src/routes/app/audits/$auditId.tsx` (the audit shell with tabs, Overview and Findings left for M3/M4) and its running grid; modify `apps/web/src/routes/app/sites/$siteId.tsx` (New audit button, audit history)
**Interfaces:** consumes `startAudit`, `getAudit` (Task 4) and `useAuditRoom` (Task 5)
**Blocked by:** 2, 4, 5

- [ ] Form (`docs/ui.md` screen 1): start URL (prefilled with the site origin), key pages (one URL per line, at most 19 more), consent scenario checkboxes (none, accept, reject, GPC; none/accept/reject checked by default), viewport (desktop, mobile, or both), "Simulate an ad click" (`clickIds`), and "Answer tracking requests locally" (`blockVendorRequests`, on). Validate on the server: every URL on the site's host or a subdomain, at most 20 pages; show field errors below each input
- [ ] Estimated duration: runs × 12 s, shown as minutes, updating as the form changes
- [ ] Running audit (`docs/ui.md` screen 2): one tile per run with page path, scenario, viewport, status, hit count and screenshot thumbnail (the signed URL, scaled by CSS); tiles update from `useAuditRoom`; a `partial` or `failed` tile shows the error code in plain words (bot blocked, timed out, consent banner not found, page refused, engine failed)
- [ ] Verify in the browser on the fixtures site: start an audit of 3 pages × 3 scenarios; screenshot the grid at the start, midway and at the end; an off-site page in the form is refused with a field error; another organization's audit id gives 404

### Task 7: Hits explorer

**Model:** Sonnet
**Files:** create `apps/web/src/server/hits.ts`, `apps/web/src/routes/app/audits/$auditId.hits.tsx`
**Interfaces:** consumes Task 1 tables and Task 4's R2 capture JSON; produces `listTimeline({ auditId, runId?, vendor?, event?, scenario?, cursor? }) → { items: (Hit | DataLayerPush)[], nextCursor }` (200 per page, ordered by run then `at`) and `getHitDetail({ hitId }) → { hit, request: CapturedRequest }` (the raw request read from `capture.json` by `request_id`)
**Blocked by:** 4

- [ ] Timeline (`docs/ui.md` screen 6): run selector, filters for vendor, event and scenario, hits and `dataLayer` pushes interleaved by time, each hit marked when sent after consent
- [ ] Selecting a hit opens its decoded parameters, ids and consent next to the raw request (method, URL, body)
- [ ] Verify in the browser on the finished Task 6 audit: filter to Meta under reject on `meta-before-consent` and see the `PageView` before consent with nothing after; open a GA4 hit from the `ga4-batch` batch and see the raw body with three events; screenshot both; another organization's audit gives 404

### Task 8: M2 demo and docs

**Model:** Sonnet
**Files:** modify `docs/vision.md`, `docs/roadmap.md`, `README.md`, `docs/architecture.md`
**Blocked by:** 1–7

- [ ] Run the roadmap demo end to end on the fixtures: sign up, create a client and site, run an audit, watch it progress, browse the Hits explorer; screenshots of each step saved under `mockups/m2-demo/` (untracked)
- [ ] `vision.md`: M2 rows become **working** with one line on how each was verified; record anything the build changed (sequential captures and the audit duration, `blockVendorRequests` defaulting on, `BROWSER_URL` for local development)
- [ ] `architecture.md`: the data model matches Task 1; the realtime section describes the authenticated audit room
- [ ] `roadmap.md`: M2 done; `README.md`: status line
- [ ] Verify: `pnpm check` passes

## Execution order

```
wave 1:  1 schema (Sonnet)   3 local dev (Sonnet)   5 audit room (Sonnet)
wave 2:  2 clients and sites (Sonnet)   4 workflow (Opus)        after 1, 3 and 5
wave 3:  6 form and running grid (Sonnet)   7 hits explorer (Sonnet)   after 2, 4, 5
wave 4:  8 demo and docs (Sonnet)
```

Each task runs in its own worktree and merges to `main` after review and its pasted verify output.

## Before execution

- **A local Postgres is needed** for every task from 1 on. `docker compose up -d` needs `sudo` on this machine, so either the user runs `sudo docker compose up -d` once, or the user provides a `DATABASE_URL` for a development database (for example a Neon branch).
- `.env` needs `BETTER_AUTH_SECRET`, `LLM_ENCRYPTION_KEY` and `STORAGE_SIGNING_SECRET` for `pnpm dev`; Task 3 checks which are missing and generates local-only values.

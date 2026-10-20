---
type: plan
status: draft
design: ../../vision.md
---

# M2 Audit Pipeline Plan

**Goal:** Run an audit from the web app (a site's pages × consent scenarios × viewports), watch it progress live, and browse the decoded hits.
**Approach:** One Cloudflare Workflow per audit. Each run gets two durable steps: `capture` calls the M1 engine and writes the immutable capture to R2; `persist` derives the hit and `dataLayer` rows from that stored capture in one transaction. Progress goes to an authenticated per-audit Durable Object. The trade-off: captures run one at a time within an audit, on a container instance of its own, so a 10 pages × 3 scenarios audit takes several minutes. Task 5 measures it; parallel captures wait for a later milestone.

Design sources: `docs/vision.md` (Audit pipeline M2, M2/M3 notes), `docs/product.md` (v0.1 steps 2–4 and 7), `docs/ui.md` (Navigation, screens 1, 2 and 6, States), `docs/architecture.md` (data model), `docs/decisions/0002-capture-engine.md`, and the M1 code. Reviewed by GPT-6.1-Sol on 2026-10-20 in two rounds; its findings are folded in.

## Global constraints

- **No unit or integration tests** (`AGENTS.md`, current phase). Each task's "Verify" lines are its acceptance check: run the real thing and report the command and what it showed. UI tasks are verified by driving the app in a browser (Playwright MCP) and looking at screenshots.
- `pnpm check && pnpm typecheck && pnpm build` pass with zero errors and zero warnings after every task.
- Effect rules from `AGENTS.md`: services in `packages/core`, layers wired only in `apps/web/src/server/layers.ts`, tagged errors, `Schema` at every boundary (server function input, WebSocket messages, Workflow payloads, R2 JSON), no `any`, no `try/catch` around Effects.
- **Organization scoping.** Every table carries `org_id`. Every server function runs behind `requireSession`, reads `activeOrganizationId` from the session, and filters every query by it; child records (runs, hits, screenshots, raw requests) are reached only through their owning audit, checked against the organization. An id from another organization behaves exactly like a missing id (404), never a 403.
- **Roles.** Any member can create clients, sites and audits. Only `owner` and `admin` can archive or delete a client or site; check on the server.
- **Evidence is never deleted by accident.** Foreign keys from audits upward use `on delete restrict`. A client or site with audits can only be archived (`archived_at`), which hides it; deleting is allowed only when it has no audits. Purging evidence (rows and R2 objects) is a separate, explicit feature for a later milestone.
- **Site allow-list.** A URL belongs to a site when, after parsing with `URL`: the scheme is http or https, there are no credentials, and the hostname (lowercased, punycode ASCII as `URL` gives it, one trailing dot removed) equals the site's host or ends with `"." + siteHost`. Enforced when pages are submitted (Task 6) and, for top-level navigations including redirects, inside the engine (Task 3).
- **No private targets outside development.** Outside a `dev` stage, a site whose host is `localhost`, a `.local`/`.internal` name or a private, loopback or link-local IP literal is refused when created. The engine's DNS-pinned policy stays the backstop.
- **Test traffic stays out of client analytics.** The New audit form has "Answer tracking requests locally", **on by default**, which sets `blockVendorRequests`. Hits are recorded as attempted requests; vendors never receive them. Fixture audits always run with it on.
- **Workflow step results stay small.** Cloudflare caps a step's result at 1 MiB, so screenshots and captures go to R2 through `Storage`; steps return ids and keys only.
- **Idempotent persistence.** A capture is written to R2 once per run and never overwritten: before capturing, the step reuses a `capture_key` already on the run, then an object already at the run's key (a write that succeeded before a database failure), and only then captures and writes. Rows are derived from the stored capture inside one transaction that deletes the run's existing hit and push rows first. Hits and pushes have natural primary keys (`(run_id, request_id, batch_index)` and `(run_id, seq)`), so a rerun reproduces identical rows, keys included.
- Migrations are generated (`pnpm --filter @repo/db db:generate`), never hand-written; never edit files under `packages/db/drizzle/`.
- No new dependencies without asking. Tables are plain HTML tables with server-side pagination.
- `TMPDIR=$HOME/.cache/tmp`. Never use sudo; hand any `sudo docker` command to the user. Never push.

## Models

| Model | Used for |
|---|---|
| **Opus** | The engine allow-list (3) and the audit workflow and persistence (5): durability, retries, idempotency, partial failure |
| **Sonnet** | Schema (1), local dev wiring (2), clients and sites (4), live progress (6), New audit and running screens (7), Hits explorer (8), demo and docs (9) |
| **GPT-6.1-Sol** (Fable 5.1 when Sol is over its limit) | Reviews each task's diff before it merges; Tasks 1 and 6 get a second round |

## Review focus

1. **Cross-organization access.** Ids come from URLs. Verified in Tasks 4, 7 and 8 by signing in as a second user in another organization and requesting the first organization's client, site, audit, screenshot and hit detail by id (404 each), and in Task 6 by connecting to another organization's audit room (refused).
2. **Retried steps.** A `persist` step that fails after writing rows must produce identical rows on the retry, and a retried `capture` step must not overwrite a stored capture. Verified in Task 5 by comparing row contents (not counts) before and after a forced failure.
3. **Partial audits.** A refused or unreachable page gives a run with its error code, and the audit still finishes. Verified in Task 5.
4. **WebSocket authorization.** The scaffold's `/ws/rooms/*` route has no authentication and is removed. The audit room checks the session and the audit's organization before upgrading and ignores client messages. Verified in Task 6.
5. **Leaving the site.** An off-site page in the form is refused (Task 7); a page that redirects off the site stops at the redirect with a `Navigation` error (Task 3).
6. **Large captures.** A capture with 2,000 requests and a near-10 MB result completes both steps. Verified in Task 5.
7. **Concurrent audits.** Two audits started together both finish. Verified in Task 5.

### Task 1: Audit tables

**Model:** Sonnet
**Files:** create `packages/db/src/audit-schema.ts`; modify `packages/db/src/index.ts`; generated migration in `packages/db/drizzle/`
**Interfaces:** produces Drizzle tables and inferred types. Every table has `id uuid primary key default random`, `org_id text not null` and `created_at timestamptz default now()`:
- `client`: `name text not null`, `archived_at timestamptz`
- `site`: `client_id uuid not null references client on delete restrict`, `name text not null`, `origin text not null` (scheme and host, e.g. `https://shop.example`), `host text not null` (canonical, see Global constraints), `archived_at timestamptz`
- `audit`: `site_id uuid not null references site on delete restrict`, `created_by text not null`, `config jsonb not null` (`AuditConfig`, Task 5), `status text not null` (`queued | running | complete | partial | failed`), `error text` (launch failures), `workflow_id text`, `started_at timestamptz`, `finished_at timestamptz`
- `run`: `audit_id uuid not null references audit on delete cascade`, `failure text` (app-level failure code: `PersistFailure`, `EngineFailure`), `ordinal integer not null`, `page_url text not null`, `scenario text not null`, `viewport text not null`, `status text not null` (`pending | running | complete | partial | failed`), `engine jsonb` (name, version, fallbackReason), `decoder_version text`, `consent jsonb`, `documents jsonb`, `cookies jsonb`, `errors jsonb`, `complete boolean`, `truncated boolean`, `screenshot_key text`, `capture_key text`, `hit_count integer not null default 0`, `started_at timestamptz`, `finished_at timestamptz`; unique `(audit_id, ordinal)`
- `hit` (no `id` column; primary key `(run_id, request_id, batch_index)`): `run_id uuid not null references run on delete cascade`, `request_id text not null`, `batch_index integer not null`, `document_id text not null`, `at integer not null` (ms since capture start), `vendor text not null`, `destination_id text not null`, `event text not null`, `params jsonb not null`, `ids jsonb not null`, `consent jsonb not null`, `host text not null`, `url text not null`, `blocked boolean not null`, `status integer`, `after_consent_action boolean not null`
- `datalayer_push` (no `id` column; primary key `(run_id, seq)`): `run_id uuid not null references run on delete cascade`, `seq integer not null`, `document_id text not null`, `at integer not null`, `value jsonb not null`
- Indexes: `client(org_id, archived_at)`, `site(org_id, client_id)`, `audit(org_id, site_id, created_at desc)`, `run(audit_id, ordinal)`, `hit(run_id, at, request_id, batch_index)`, `hit(run_id, vendor, event)`, `datalayer_push(run_id, at, seq)`
- Comment in the schema file: a hit's identity across re-runs (for M6 compare) is page URL + scenario + viewport + vendor + destination + event + its order among equal hits; M3 counts purchases by transaction ID and label, not by hit.
**Blocked by:** Before execution (a database)

- [ ] Write the tables; the example `note` table stays as is
- [ ] `pnpm --filter @repo/db db:generate`, then `pnpm db:migrate`
- [ ] Verify: `psql "$DATABASE_URL" -c '\d hit'` (and `run`, `audit`, `site`) shows the columns, foreign keys with their `on delete` actions, unique constraints and indexes; paste them

### Task 2: Local development with the real engine

**Model:** Sonnet
**Files:** modify `apps/web/src/server/browser.ts`, `apps/web/src/server/layers.ts`, `infra/alchemy.run.ts`, `.env.example` or `.dev.vars` as `pnpm dev` requires; `README.md` and `CONTRIBUTING.md` (local setup)
**Interfaces:** produces `BROWSER_URL`: on a `dev` stage, when set, `Browser.capture` posts to `${BROWSER_URL}/capture` over HTTP instead of the container binding, with the same decoding and errors, and the container resource is not provisioned; other stages ignore it. Produces `Browser.capture(request, options?: { instance?: string })`: the container instance name (default `"default"`), used by Task 5. `BrowserError` keeps the HTTP status (`status?: number`); a container that cannot start or is over `maxInstances` (Cloudflare answers 503) is a `BrowserError` with status 503. `BrowserContainer` sleeps after 2 minutes idle so per-audit instances are released.
**Blocked by:** none

- [ ] Alchemy's local Containers need Docker (sudo here): on `dev` with `BROWSER_URL`, skip the container resource and binding; document it in `CONTRIBUTING.md`
- [ ] Check which secrets `pnpm dev` needs (`BETTER_AUTH_SECRET`, `LLM_ENCRYPTION_KEY`, `STORAGE_SIGNING_SECRET`, `DATABASE_URL`); document generating local-only values
- [ ] Verify: with the database up, the engine at `http://localhost:8080` (`ALLOW_PRIVATE_NETWORKS=true`) and the fixtures served, `pnpm dev` starts; signed in, `runBrowser` on `http://localhost:4400/clean/` with `blockVendorRequests: true` returns a `CaptureResult`; paste its `engine`, `consent` and request count

### Task 3: Site allow-list in the engine

**Model:** Opus
**Files:** modify `packages/capture-contract/src/index.ts`, `apps/browser/src/*` (both engines), `apps/browser/scrapling/capture.py`
**Interfaces:** `CaptureRequest` gains `allowedHosts?: string[]` (canonical hosts; a navigation is allowed when its host equals one or ends with `"." + host`). When set, a top-level navigation (the start URL, any redirect hop and any journey step) to another host is stopped before it loads and recorded as a `Navigation` error naming the host; subresources are unaffected
**Blocked by:** none

- [ ] First settle the mechanism with a short probe on both engines, because page routes miss redirect hops (decision 0002) and the egress proxy cannot tell a document from a subresource. Try, in order: the CDP `Fetch` domain with a `Document` resource-type pattern on the main frame (does it pause each redirect hop?); Playwright's `request` events with `redirectedFrom` plus aborting the navigation. Use the first that stops an off-site redirect hop **before** its response loads while external subresources still load. If neither does, fall back to stopping at the first off-site document (it loads, but recording stops and the capture ends with `Navigation`), and record which one was chosen in decision 0002
- [ ] Enforce it with the chosen mechanism in both engines
- [ ] Verify with the fixtures server's `/r?to=` redirect (paste the probe results first): `allowedHosts: ["localhost"]` and a start URL redirecting to `http://127.0.0.1:4400/clean/` stops with `Navigation` on both engines; the same capture without `allowedHosts` follows it; a normal `clean` capture with `allowedHosts: ["localhost"]` is unchanged, including its vendor SDK and collection requests to other hosts

### Task 4: Clients and sites

**Model:** Sonnet
**Files:** create `apps/web/src/server/clients.ts`, `apps/web/src/lib/site-url.ts` (the shared canonical-host and allow-list helpers), `apps/web/src/routes/app/clients/index.tsx`, `apps/web/src/routes/app/clients/$clientId.tsx`, `apps/web/src/routes/app/sites/$siteId.tsx`; modify `apps/web/src/routes/app.tsx` (navigation)
**Interfaces:** consumes Task 1; produces `canonicalHost(url: string): string | null`, `isOnSite(url: string, siteHost: string): boolean`, and server functions `listClients()`, `createClient({ name })`, `archiveClient({ id })`, `deleteClient({ id })` (only without audits), `getClient({ id })` (with its sites), `createSite({ clientId, name, url })`, `archiveSite({ id })`, `deleteSite({ id })` (only without audits), `getSite({ id })` (with its audits newest first, 20 per page, and the latest audit's config for the form's last-used settings)
**Blocked by:** 1

- [ ] `createSite` stores the origin and canonical host and refuses private hosts outside `dev` (Global constraints); names are 1–100 characters
- [ ] Archive and delete check `owner` or `admin` on the server; the UI hides the buttons for members; archived clients and sites are hidden from lists
- [ ] Empty states: no clients yet, no sites yet, no audits yet (`docs/ui.md`, States)
- [ ] Verify in the browser: create a client and a site with `http://localhost:4400/clean/` (origin `http://localhost:4400`, host `localhost`); screenshot each page; a member sees no archive or delete buttons and a direct call fails; a second user in another organization gets 404 for the first organization's client and site; `isOnSite` returns false for `https://evilshop.example` against `shop.example`, true for `https://www.shop.example.`, false for `https://user@shop.example`

### Task 5: Audit workflow and persistence

**Model:** Opus
**Files:** create `packages/core/src/audit.ts` (adds `AuditConfig`, `TEST_CLICK_IDS`; Task 6 adds `AuditEvent` and `AuditProgress` here first), `apps/web/src/workflows/Audit.ts`, `apps/web/src/server/audits.ts`; modify `packages/core/src/jobs.ts`, `packages/core/src/index.ts`, `apps/web/src/server/jobs.ts`, `apps/web/src/server.ts` (export `Audit`), `infra/alchemy.run.ts` (Workflow `Audit`, binding `AUDIT_WORKFLOW`; container `maxInstances` 3)
**Interfaces:**
- `AuditConfig = { pages: string[] /* 1–20, first is the start URL */, scenarios: Scenario[] /* non-empty */, viewports: ("desktop" | "mobile")[] /* non-empty */, clickIds: boolean, blockVendorRequests: boolean }`
- `TEST_CLICK_IDS = { gclid: "ZINKO-TEST-GCLID", fbclid: "ZINKO-TEST-FBCLID", ttclid: "ZINKO-TEST-TTCLID", utm_source: "zinko", utm_medium: "cpc", utm_campaign: "zinko-audit" }`, appended **to the start URL only** when `clickIds` is on (a landing from an ad). Whether IDs survive into other pages needs journeys, which M3 adds
- `Jobs.start(job, payload, options?: { id?: string })`: the workflow instance id; audits use the audit id, so a repeated start is detected instead of duplicated
- `startAudit({ siteId, config }) → { auditId }`: validates `config` against the site (Global constraints), inserts the audit (`queued`) and its runs (page × scenario × viewport in that order, `ordinal` from 0) in one transaction, then starts the workflow with the audit id; if the start fails, sets the audit `failed` with `error` and returns it. `getAudit({ id })`: audit, config, runs with status, error codes, hit counts and screenshot URLs signed for 5 minutes (refetched by the page)
- consumes Task 6: `AuditProgress.publish(auditId, event)`; consumes Task 3: `allowedHosts` set to the site's host on every capture
**Blocked by:** 1, 2, 3, 4 (`isOnSite`), 6

- [ ] Steps: `start` marks the audit `running`. For each run, `capture-<ordinal>` returns a tagged outcome, `Captured { captureKey, screenshotKey } | Rejected { code }`: reuse a stored capture as Global constraints say; otherwise mark the run `running`, publish, call `Browser.capture(request, { instance: auditId })`, write the screenshot to `audits/<auditId>/runs/<runId>/screenshot.png` and the result without the screenshot to `…/capture.json`, store both keys on the run. The workflow wraps the step in `Effect.catchTag("WorkflowStepError", …)` (how effect-cf surfaces an exhausted step) and maps it to `Exhausted`. `Rejected` and `Exhausted` go to step `fail-<ordinal>`, which records the run `failed` (the rejection code, or `failure = EngineFailure`), publishes, and skips persisting. `Captured` goes to `persist-<ordinal>`; an exhausted `persist` step is caught the same way and goes to `fail-<ordinal>` with `failure = PersistFailure`, keeping the stored capture. `persist-<ordinal>`: read `capture.json`, decode every request with `@ovriq/zinko-decoders`, and in one transaction delete the run's hits and pushes, insert them (`after_consent_action` = `completedAt !== null && startedAt > completedAt`, which includes a reject), and update the run (status `complete`, or `partial` when `complete` is false, engine, `decoder_version`, consent, documents, cookies, errors, flags, `hit_count`); publish the run event. Then `finish` sets the audit status and publishes it
- [ ] Audit status: `complete` when every run is `complete`; `failed` when no run has a capture; `partial` otherwise
- [ ] Errors inside `capture-<ordinal>`: a rejected request (`PolicyDenied`, `InvalidRequest`) returns `Rejected` (not thrown, so not retried); a busy engine (429), a container that cannot start (503) and other `BrowserError`s fail the step, which retries 8 times, exponential from 15 s, before becoming `Exhausted`. Step timeout 4 minutes. Publishing progress never fails a step
- [ ] Verify with the fixtures (vendor answering on): an audit of `clean`, `meta-before-consent` and `ga4-batch` × none/accept/reject × desktop finishes `complete` with 9 runs; per run, the hit rows match the stored capture decoded again by hand; the `ga4-batch` accept run has three hits sharing one `request_id`; record the wall time and the mean seconds per run (it sets the form's estimate)
- [ ] Verify the review-focus cases: a page that redirects off the site ends `partial` with `Navigation`; an audit whose only page is refused ends `failed`; forcing `persist-<n>` to fail after its inserts on the first attempt gives rows identical to a clean run, keys included (compare a `select … order by` dump); forcing the database update after the R2 write to fail reuses the stored object instead of capturing again (the engine log shows one capture); forcing `persist-<n>` to exhaust its retries leaves that run `failed` with `PersistFailure` and its capture in R2, and the audit finishes; the engine's 2,000-request probe page completes both steps; four audits started at the same time with `maxInstances` 3 all finish (the fourth through 503 retries)

### Task 6: Live progress over an authenticated audit room

**Model:** Sonnet
**Files:** create `packages/core/src/audit.ts` (or add to it: `AuditEvent`, `AuditProgress`, `AuditProgressError`), `apps/web/src/realtime/AuditRoom.ts`, `apps/web/src/server/audit-progress.ts`, `apps/web/src/server/audit-room-route.ts`, `apps/web/src/lib/use-audit-room.ts`; modify `packages/core/src/Auth.ts` and `apps/web/src/server/auth-live.ts` (`sessionFromHeaders`), `apps/web/src/server.ts`, `apps/web/src/server/routes.ts`, `apps/web/src/server/layers.ts`, `infra/alchemy.run.ts` (Durable Object `AuditRoom`, binding `AUDIT_ROOM`); remove the scaffold's public room and every consumer: `apps/web/src/realtime/Room.ts`, `realtime-route.ts`, `realtime.ts`, `components/realtime-demo.tsx` and its use in `components/widgets.tsx`, `lib/use-room.ts`, the `Realtime` service and its exports from `packages/core/src/index.ts` (keep `realtime-limits.ts`, the audit room uses it), and the `ROOM` binding. Rewrite the Realtime section of `AGENTS.md` for the audit room. Leave `efforge.jsonc` alone (`AGENTS.md` says so); note in `AGENTS.md` that the realtime extra's generated room was replaced
**Interfaces:** produces `AuditEvent = { type: "run", runId, ordinal, status, hitCount, errors: { code, message }[] } | { type: "audit", status }`; `AuditProgress.publish(auditId: string, event: AuditEvent): Effect<void, AuditProgressError>`; `Auth.sessionFromHeaders(headers: Headers)`, backed by Better Auth, for Worker routes; the route `/ws/audits/<auditId>`; `useAuditRoom(auditId, onEvent): { connected: boolean }`
**Blocked by:** 1

- [ ] `AuditRoom` is one Durable Object per audit (named by audit id), hibernating sockets: `publish(event)` sends JSON to every socket; client messages are ignored; at most 50 sockets
- [ ] The route resolves the session with `sessionFromHeaders` and refuses the upgrade (401 signed out, 404 when the audit is not in the session's active organization) before touching the Durable Object
- [ ] `useAuditRoom` validates each message with `Schema` and reconnects with backoff; the page refetches `getAudit` when the socket opens, after every run and audit event, and every 4 minutes while open (screenshot URLs expire after 5), so missed events and expired URLs cost nothing
- [ ] Verify with a seeded audit row and a temporary server function that publishes an event (removed before commit): a signed-in browser receives it; a Node `WebSocket` without a session cookie gets 401 and with another organization's session gets 404; a client-sent message reaches no other socket; `/ws/rooms/x` now returns 404

### Task 7: New audit form and the running audit

**Model:** Sonnet
**Files:** create `apps/web/src/routes/app/sites/$siteId.audits.new.tsx`, `apps/web/src/routes/app/audits/$auditId.tsx` (the audit shell, with Overview and Findings tabs left for M3/M4) and its running grid; modify `apps/web/src/routes/app/sites/$siteId.tsx` (New audit button, audit history)
**Interfaces:** consumes `startAudit`, `getAudit` (Task 5), `useAuditRoom` (Task 6), `isOnSite` (Task 4)
**Blocked by:** 4, 5, 6

- [ ] Form (`docs/ui.md` screen 1), prefilled from the site's last audit when there is one: start URL (default the site origin), key pages (one URL per line, at most 19 more), consent scenarios (none, accept, reject, GPC; the first three checked by default), viewport (desktop, mobile or both), "Simulate an ad click" (`clickIds`, adds test click IDs to the start URL), "Answer tracking requests locally" (`blockVendorRequests`, on). The server validates every URL with `isOnSite`; field errors show below each input
- [ ] Estimated duration: runs × the mean seconds per run measured in Task 5, in minutes
- [ ] Running audit (`docs/ui.md` screen 2): one tile per run with page path, scenario, viewport, status, hit count and screenshot thumbnail (scaled by CSS); a `partial` or `failed` tile names its error in plain words (bot blocked, timed out, consent banner not found, left the site, page refused, engine failed); the audit header shows its status, including a launch failure
- [ ] Verify in the browser on the fixtures site: an audit of 3 pages × 3 scenarios, screenshots of the grid at the start, midway and at the end; an off-site page and a credentialed URL are refused with field errors; another organization's audit id gives 404

### Task 8: Hits explorer

**Model:** Sonnet
**Files:** create `apps/web/src/server/hits.ts`, `apps/web/src/routes/app/audits/$auditId.hits.tsx`
**Interfaces:** consumes Task 1 and Task 5's stored captures; produces `listTimeline({ auditId, runId?, vendor?, event?, scenario?, cursor? }) → { items: ({ kind: "hit" } & Hit | { kind: "push" } & DataLayerPush)[], nextCursor: string | null }` (200 per page, ordered by run ordinal, `at`, kind, then `request_id, batch_index` for hits or `seq` for pushes; the cursor encodes that tuple) and `getHitDetail({ auditId, runId, requestId, batchIndex }) → { hit, request: CapturedRequest }` (the raw request read from `capture.json` by `request_id`, checked through the audit)
**Blocked by:** 7

- [ ] Timeline (`docs/ui.md` screen 6): run selector, filters for vendor, event and scenario, hits and `dataLayer` pushes interleaved by time, hits after the consent action marked, answered-locally hits labelled as attempts
- [ ] Selecting a hit opens its decoded parameters, ids and consent beside the raw request (method, URL, body)
- [ ] Verify in the browser on the Task 7 audit: filter to Meta on `meta-before-consent` under reject and see the `PageView` before the consent action and none after; open a GA4 hit from the `ga4-batch` batch and see the raw body with three events; page through a long timeline with the cursor; screenshot each; another organization's audit and hit give 404

### Task 9: M2 demo and docs

**Model:** Sonnet
**Files:** modify `docs/vision.md`, `docs/roadmap.md`, `README.md`, `docs/architecture.md`, `AGENTS.md` (organization scoping and the audit room)
**Blocked by:** 1–8

- [ ] Run the roadmap demo end to end on the fixtures: sign up, create a client and site, run an audit, watch it progress, browse the Hits explorer; screenshots under `mockups/m2-demo/` (untracked)
- [ ] `vision.md`: M2 rows become **working** with one line on how each was verified; record the measured audit duration against the 5-minute target, `blockVendorRequests` on by default, click IDs on the start URL only, archiving instead of deleting, and `BROWSER_URL` for local development
- [ ] `architecture.md`: the data model matches Task 1; the realtime section describes the authenticated audit room
- [ ] `roadmap.md`: M2 done; `README.md`: status line
- [ ] Verify: `pnpm check` passes

## Execution order

```
wave 0:  Before execution: a database (user)
wave 1:  1 schema (Sonnet)   2 local dev (Sonnet)   3 engine allow-list (Opus)
wave 2:  4 clients and sites (Sonnet)   6 audit room (Sonnet)         after 1
wave 3:  5 workflow (Opus)                                            after 1, 2, 3, 4, 6
wave 4:  7 form and running grid (Sonnet)                             after 4, 5, 6
wave 5:  8 hits explorer (Sonnet)                                     after 7
wave 6:  9 demo and docs (Sonnet)
```

Each task runs in its own worktree and merges to `main` after review and its pasted verify output.

## Before execution

- **A local Postgres.** `docker compose up -d` needs `sudo` on this machine: either the user runs `sudo docker compose up -d` once, or a development `DATABASE_URL` (for example a Neon branch) is provided.
- **Throughput.** The product target is 10 pages × 3 scenarios in under 5 minutes. Sequential captures at about 10–12 s each take 5–6 minutes; Task 5 measures it, and if it misses, parallel captures move into a later milestone rather than M2.

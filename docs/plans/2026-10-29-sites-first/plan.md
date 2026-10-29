---
type: plan
status: approved
design: ../../product.md
---

# Sites First, Clients Optional

**Goal:** A site owner signs up, creates an organization, adds a site and audits it without ever meeting the word "client"; an agency turns on "Group sites by client" (or already has named clients) and keeps today's Clients UX. Verified in the browser with a fresh site-owner organization and an existing agency organization.
**Approach:** The data model stays: `site.client_id` remains required. Each organization gets exactly one hidden default client (`client.is_default`), so every join, foreign key and report query keeps working. Whether the UI talks about clients is one derived per-organization boolean, `groupByClient`, read by the app shell and every screen. Everything is built on the Task 4 aggregates (`siteSummaries`, `clientSummary`) already in `server/client-summary.ts`.

Reviewed by GPT-6.1-Sol on 2026-10-29 in three rounds; findings folded in.

Design sources: `AGENTS.md`, `docs/product.md` (its "agency first" wording is amended in Task 7), `docs/ui.md`, `docs/vision.md` (Clients and sites row), `server/clients.ts`, `server/client-summary.ts`, `routes/app.tsx`, `routes/onboarding.tsx`, `components/{first-run,command-palette}.tsx`, `server/{report-data,register-data,audits}.ts`.

## Decisions for the user

None needed. Decided here, change on review:

1. **Grouping rule: the `org_setting` row is the only source of truth.** Table `org_setting` (`org_id` pk, `group_by_client boolean not null`, `updated_at`; `on delete cascade` to `organization`, like `org_branding`). No row means `false`. The backfill (below) writes `true` for every existing org with any non-default client, archived ones included (they are agencies), and `false` for the rest. Nothing is derived from live clients afterwards, so archiving or deleting the last named client never flips the mode.
2. **Who changes it.** The switch is owners and admins only (`isManager`, server-checked; `saveOrgSetting`). `createClient` (any member, unchanged) writes `true` only when the org has no row yet; it never overrides an explicit `false`.
3. **Default client is created lazily, inside `createSite`'s transaction**, not in a Better Auth hook: `defaultClientOf(orgId)` is insert-if-missing (`insert ... on conflict do nothing` on the partial unique index `client_one_default_idx` on `org_id where is_default`) followed by a separate `select`, under READ COMMITTED. It works for orgs created by any path and rolls back with a failed `createSite`. Read paths never write: `listSites`, `getSite` and the rest treat "no default" as "no sites without a client".
4. **Report names a client only for a named one** and follows the site's current client. Moving a site changes the next report; published snapshots are frozen.
5. **Move a site between clients: included** (`updateSiteClient`, owners and admins). Compare, re-checks, triage and report edits key on site and audit, not client.
6. **Grouping on adds Sites beside Clients** so sites on the default client stay reachable. With grouping off, `/app/clients` (the list) redirects to `/app/sites`; a named client's detail page `/app/clients/$clientId` stays reachable by URL with the nav hidden. Breadcrumb and return destination: named client and grouping on gives Clients > client > site; anything else gives Sites > site.

## Rollout

One live stage exists and has no real users today, so deploy in a quiet window: `pnpm db:migrate` (migration plus backfill), deploy, done. No second run is needed; a re-run is harmless. A deployment with active users must drain writes first (no client or site creation between migrate and deploy). Otherwise a client the old app creates mid-rollout leaves grouping off (no row, or a `false` row) until a manager turns it on, and the old app can list default clients during the window. Both are documented in the plan and in `docs/self-hosting.md`.

## Global constraints

- No tests (`AGENTS.md`, current phase). Verify in the browser (Playwright MCP) against `pnpm dev`, Postgres, the capture engine and the fixture server, at 1440x900 and 390x844, light and dark, with real audits (`clean`, `meta-before-consent`). Screenshots to `$TMPDIR/sites-t<task>-*`. Report commands and what was seen.
- `pnpm check && pnpm typecheck && pnpm build` exit 0, zero warnings, after every task.
- Schema changes only through `pnpm --filter @repo/db db:generate` then `pnpm db:migrate`. Nothing in `packages/db/drizzle/` is hand-written, so the data backfill is an idempotent TypeScript script outside it (Task 1).
- **Lock order, everywhere: client, then site, then audit (then anything finer).** `archiveClient` and `updateSiteClient` follow it, `createAudit` already locks site then audit, and publication must too.
- Scoping unchanged: every query filters `org_id` from `activeMembership`; a client, site, audit or setting id from another organization is a 404, never a 403. The default client is never addressable by id from any client route: `clientInOrg` treats it as not found (404), so `/app/clients/<default id>` 404s.
- Each new server function gets an entry in `ENTRY_POINTS` (`server/entry-points.ts`): reads are GET wrapped in `read(...)`, writes are POST wrapped in `mutation(...)`. No new Worker route and no `RUNTIME_ALLOWED` change.
- Coverage rules unchanged: Sites list and Overview reuse `siteSummaries`; "No open findings" only with full coverage, no could-not-check and an evaluated settled audit; otherwise "Not audited", "Not evaluated", "0 open · not fully checked". Never a bare 0, never clean by default. Re-check/compare readers keep `eq(run.role, "target")`.
- Vocabulary: no client wording or step for a site without a named client, and none anywhere while grouping is off except where a site truly has a named client (the report cover, a Client column or select in Sites). Dead copy in `docs/ui.md` is updated.

## Review focus

1. **No client wording leaks** for a site-owner org: onboarding, first-run, Sites list, site page, audit breadcrumb, palette, report cover, public report `<title>`, CSV.
2. **The default client is invisible and unaddressable**: not in `listClients`, `searchTargets`, `trendsOf`, the Client select options by name, not archivable/deletable, one per org under concurrency.
3. **Agency orgs unchanged**: same screens, same counts, same URLs.
4. **Report model change is safe**: versions 1 to 7 still decode, the stamp and lock cover a client move, `cover.clientName` nullable has its validators.

## Tasks

### Task 1: Schema, backfill script, default client, setting

**Model:** Sonnet
**Files:** modify `packages/db/src/audit-schema.ts` (`client.isDefault boolean not null default false`, partial unique index `client_one_default_idx`), create `packages/db/src/org-schema.ts` (`orgSetting`, exported from `index.ts`); generated migration only; create `packages/db/scripts/backfill-default-clients.ts` and call it from `packages/db/scripts/migrate.ts` right after `migrate(...)`, so `pnpm db:migrate` runs both. The script, in one transaction: insert one default client (`name 'Ungrouped'`, `is_default`) for every `organization` lacking one (`on conflict do nothing`), then insert `org_setting` for every organization lacking a row: `true` if it has any non-default client (archived included), else `false`. It only ever (1) inserts a missing default client per org, (2) un-archives an archived default client, and (3) inserts a `group_by_client` row for orgs that have none (`true` if any non-default client exists, archived included, else `false`). It never changes an existing setting row, so a re-run is harmless and never overrides a manager's choice. Create `server/default-client.ts` (`defaultClientOf`, used only in write paths), `server/org-setting.ts` (`saveOrgSetting`, mutation, `isManager`); modify `server/session.ts` (`getAppState.groupByClient`: the row, else false), `server/entry-points.ts`; document the script, the lazy default, the setting and the lock order (client, then site, then audit, then anything finer; never the reverse) in `AGENTS.md` Database; add the rollout procedure and the drain warning to `docs/self-hosting.md`: run `pnpm db:migrate` (migration and backfill), deploy
**Interfaces:** `defaultClientOf(orgId): Effect<{ id }>` (insert-if-missing, then select); `saveOrgSetting({ groupByClient })`; `AppState.groupByClient: boolean`
**Blocked by:** none

- [ ] Run `pnpm db:migrate` twice on a copy of the dev database: the second run changes nothing; `select o.id from organization o left join client c on c.org_id = o.id and c.is_default group by o.id having count(c.id) <> 1` is empty; every site's `client_id` is identical before and after; orgs with clients (archived too) have `true`, others `false`
- [ ] Set one org to `false` while it has a named client, archive a default client by hand, re-run the backfill: the default is un-archived, the `false` row is untouched, a new org with no row gets one, and a second re-run changes nothing
- [ ] `getAppState` returns true for the existing agency org, false for a fresh org

### Task 2: Server: clients, sites, nullable consumers

**Model:** Sonnet
**Files:** modify `server/clients.ts`: `listClients`, `searchTargets` (it owns the sites-first result: sites with an optional client name, clients only when grouping is on), `getClient` and `trendsOf` callers exclude `is_default`; `clientInOrg` answers NotFound for the default, so get/archive/delete of it are 404; `createClient` writes `org_setting = true` only when the org has no row (`on conflict do nothing`); `createSite` takes optional `clientId` (absent: `defaultClientOf` inside its transaction); new `listSites` (GET: every unarchived site with `client: {id,name} | null` and the `siteSummaries` aggregate) and `updateSiteClient` (POST, `requireManager`, target through `clientInOrg` or `null` for the default, archived target refused; locks the destination client row `for share` (it only has to stay unarchived; `archiveClient` takes `for update` on the same row), then the site row `for update`, then revalidates the destination is in the org, unarchived and, unless it is the default, named, then moves; moving to `null` locks the org's default client the same way); `getSite` and `audits.ts` (about line 298; `getAudit`) return `client: {id,name} | null`; adapt every consumer in this task so it builds on its own (`routes/app/sites/$siteId.tsx`, `routes/app/audits/$auditId.tsx` breadcrumbs may keep Clients until Task 3 but must handle null; `components/command-palette.tsx` consumes the new `searchTargets` shape); `server/entry-points.ts`
**Interfaces:** `listSites -> Array<{ id, name, host, client: {id,name}|null, running, latest: <same shape as listClients.latest> | null }>`; `updateSiteClient({ siteId, clientId: string | null })`
**Blocked by:** 1

- [ ] `pnpm check && pnpm typecheck && pnpm build` pass with only this task merged
- [ ] Concurrent real `createSite` calls (no client) in a fresh org create exactly one default; a `createSite` that fails (bad URL after the default insert) leaves none; a read-only visit creates none
- [ ] A member calling `createClient` after a manager saved `false` leaves it `false`; with no row it writes `true`; archiving or deleting the last named client keeps the mode for a migrated and a new org
- [ ] Concurrent `updateSiteClient` and `archiveClient`/`deleteClient` of the destination (repeated): no deadlock, and the site never ends on an archived client; deleting a client with a moved-in site is refused as today
- [ ] Another org's site, client or setting id on every new function is 404; default client get/archive/delete is 404

### Task 3: Shell, onboarding, Sites, settings, redirects

**Model:** Sonnet
**Files:** modify `routes/app.tsx` (nav: off `Sites` at `/app/sites`; on `Clients` then `Sites`), `routes/app/index.tsx` (redirect by `groupByClient`), `routes/app/clients/index.tsx` (redirect to `/app/sites` when off; "Ungrouped sites" link row when the default owns sites), `routes/onboarding.tsx` (copy without clients; go to `/app`, which redirects), `components/first-run.tsx`, `components/org-switcher.tsx` and the palette's org-switch handler (navigate through `/app`, so the destination follows the new org's mode), `components/not-found.tsx` and `routes/app/sample-report.tsx` (client wording and links), `routes/app/settings` (a "Group sites by client" switch, owners/admins; calls `saveOrgSetting`, then `router.invalidate()`), create `routes/app/sites/index.tsx` (`PageHeader`, table of `listSites` using the summary cells from the Clients list, `EmptyState`, an Add site dialog: name and address, plus a Client select when grouping is on); modify `routes/app/sites/$siteId.tsx` and `routes/app/audits/$auditId.tsx` (breadcrumb and every return after archive, delete or move: named client and grouping on gives Clients > client > site, else Sites > site; a Client select for managers when grouping is on, calling `updateSiteClient`)
**Blocked by:** 2

- [ ] Verify (fresh org): sign up, onboard, Sites empty state, add `http://localhost:4400/` with no client step, run `clean` and `meta-before-consent`, see honest "Not evaluated"/"not fully checked" states; no client wording in nav, breadcrumbs, titles, sample report, not-found; 1440 and 390, light and dark
- [ ] Verify (existing agency org): Clients, client page, site and audit breadcrumbs and counts identical to screenshots taken first
- [ ] Verify toggle: agency org off then on (nav, `/app` redirect, `/app/clients` redirecting when off, a named client URL still opening, breadcrumbs); with grouping on, site, audit, archive, delete and move-to-default flows land where the rule says; a member sees no switch or Client select and the server refuses the calls; accepting an invitation lands correctly via `/app`; switching organizations from the switcher and the palette lands per the target org's mode

### Task 4: Palette copy

**Model:** Sonnet
**Files:** modify `components/command-palette.tsx` only (groups Sites first; Clients group, "New client", "All clients" only when `groupByClient`; "New site"; placeholder "Find a site or action…" when off)
**Blocked by:** 2, 3

- [ ] Verify: Cmd+K in the fresh org has no client wording and finds a site and a recent audit; the agency org's palette is as before; 390px opens the same palette

### Task 5: Report, stamp, CSV

**Model:** Sonnet
**Files:** modify `lib/report-model.ts` (`cover.clientName: Schema.NullOr(Schema.String)`; `REPORT_MODEL_VERSION` 8; the literal list on line 175 becomes `[1,2,3,4,5,6,7,REPORT_MODEL_VERSION]` so stored version 7 still decodes; `UPGRADES` 7 to 8 is the identity), `lib/report-projection.ts` (`cover.clientName` becomes `nullable(author(200))` in `LEAF_VALIDATORS`, with its own null path), `server/report-data.ts` (`clientName` null for a default client; `ReportStamp` and `readStamp` also fingerprint `site.clientId`, the client's name and `is_default`), `server/report-publish-data.ts` (first `select ... for share` on the audit's site row, then the audit row `for update`, then `readStamp` and publication; `for share` suffices because the stamp only needs the site's `client_id` stable until commit, and it still conflicts with `updateSiteClient`'s `for update`, while allowing concurrent publishes of other audits of the site; site then audit matches `createAudit`, so no deadlock), `components/report/cover.tsx` and `public-page.tsx` (the site name or host heads the cover and `<title>` when null), `lib/sample-report.ts`, `server/register-data.ts` (drop the unused client join, since no CSV cell prints a client), `docs/vision.md` (this task owns every vision change)
**Blocked by:** 1, 2

- [ ] Verify stored versions 1 to 7 through `decodeStoredReportModel`, and a real old share link (version 7 snapshot) at `/r/<token>`
- [ ] Verify hashes: the first publish after the bump makes a new version, an unchanged republish reuses it, existing snapshots and `publication_hash` rows are untouched
- [ ] Verify a concurrent publish and a new audit or re-run on the same site/baseline (two requests, repeated): both finish, no deadlock error; a concurrent move and publish: the published version names the client consistent with the site at that time, never a mixture
- [ ] Verify a move after publishing: to a differently named client, or to or from the default, the next publish makes a new version; to a same-named client the stamp changes and forces a rebuild but the model hash does not, so publication reuses the version
- [ ] Site-owner org report and public page show the site and branding only; agency report keeps the client; `rg "report_|org_branding" apps/web/src/workflows` stays empty; CSV has no client column

### Task 6: Docs and end to end

**Model:** Sonnet
**Files:** modify `docs/product.md` (site owners and agencies, clients optional), `docs/ui.md` (nav, Sites page, vocabulary); `AGENTS.md` already updated in Task 1, `docs/vision.md` in Task 5
**Blocked by:** 1 to 5

- [ ] Fresh site-owner org end to end: sign up, site, audit, findings, report, publish, no client wording; a real audit on a default-client site, then compare, re-check, CSV and report; then move the site to a named client (grouping on): triage and report edits survive and the next report names the client
- [ ] Existing agency org unchanged; a second org cannot read the first org's sites, clients or setting (404); `pnpm check && pnpm typecheck && pnpm build`

## Execution order

1 → 2 → (3, 5 in parallel) → 4 → 6. Task 5 needs Task 2 for `updateSiteClient` and the site lock.

## Not in scope

- Renaming or showing the default client; per-site custom client labels.
- A Sites search, filters or paging (add when an organization has hundreds of sites; `listSites` returns all).
- Changing `site.client_id` to nullable or removing the client table.
- Per-user (rather than per-organization) grouping, and a "Group by client" option inside the Sites table.
- Bulk-moving sites between clients.

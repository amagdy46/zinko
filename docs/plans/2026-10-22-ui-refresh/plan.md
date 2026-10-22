---
type: plan
status: in review
design: ../../ui.md
---

# UI Refresh Plan

**Goal:** Zinko looks and reads like the dense, calm debugging tool `docs/ui.md` describes: one visual system (tinted neutrals, the logo's violet as the only accent, severity and status as glyphs with AA contrast), one page frame, and screens that answer their question at a glance (which client needs attention, how far the audit is, what failed, what was not checked, what fired after consent). Verified in the browser on real audits.
**Approach:** Tokens and shared building blocks first, so every screen task consumes the same names; then one task per screen area, each owning its route files and the server-function changes its screen needs. Every shadcn component added is generated source on the already-installed `radix-ui` umbrella package (1.8.1, which already contains Select, Popover, Collapsible, ToggleGroup, Tooltip, HoverCard, Progress, ScrollArea, Separator); the only proposed new npm package is `cmdk`, and nothing waits on it. The trade-off: the global type scale drops `text-sm` to 13px, which changes every shadcn component at once; that is the density we want, and Task 1 checks every screen for regressions before the screen tasks start.

Reviewed by GPT-6.1-Sol on 2026-10-22; findings folded in.

Design sources: `mockups/ui-research/{shell-and-clients,audits-and-runs,findings-and-hits,visual-system}.md` (and their `.html` boards), `docs/ui.md`, `docs/vision.md`, `AGENTS.md` (UI rules, current phase), the current routes and components. Where boards disagree, `visual-system.md` wins on color and shape, and `docs/ui.md` on vocabulary ("Could not check").

## Decisions for the user

Everything else in this plan is decided; these need you.

1. **`cmdk` for a ⌘K command palette** (shell board item 12; `docs/ui.md` promises ⌘K). Without it: no palette in this refresh (the sidebar and breadcrumbs cover navigation at today's scale), or a hand-built Dialog with an Input and a filtered list (no fuzzy match, own keyboard handling). Recommendation: approve `cmdk`; Task 13 runs only if you do.
2. **Triage reason (migration).** Accepting a risk today records who and when (`finding_triage.updated_by`, `updated_at`) but not why. Proposed: a nullable `reason text` column on `finding_triage` (generated migration), required by `setTriage` for `accepted_risk`, shown as "Accepted by Sam, 3 Oct: …". An **expiry** (boards: Snyk-style) is not proposed: it needs a behaviour (reopen on expiry) nobody has specified. Without the migration: Task 8 ships the status menu and the actor line, no reason.
3. **Neutral `checkTitle` per rule.** Each rule in `packages/rules` gets a `checkTitle` ("Consent default is set before Google tags"), shown for "Could not check" items instead of the problem title. No verdict changes, so `RULES_VERSION` stays `"1"`. Where it is stored: (a) recommended, a nullable `check_title` column on `check_result` and `finding` (generated migration), written by `persist` and `finish` like `title`, so an old audit keeps its wording (the vision's rule); rows from before fall back to `ruleById(ruleId)?.checkTitle`, then to `Check: <area>`; or (b) no migration, read live from `ruleById` at `listFindings`/`getFinding` time.
4. **Behaviour changes, not looks:**
   - a. The Findings list opens on **Open** (tabs Open / Accepted risk / Fixed with counts); triaged findings leave the working list. Today they stay in it with a badge.
   - b. A finished audit with at least one failing finding opens on the **Findings** tab instead of Runs (a redirect in the `$auditId` index route on default arrival only: skipped when `view` or `run` is in the search, and the Runs tab link always carries `view=matrix`, so Runs stays reachable). Running audits and clean ones stay on Runs.
   - c. Hits gains **multi-value filters and a free-text search** (`listTimeline` accepts arrays and `q`), a server change; the old single-value search params keep working.

## Global constraints

- **No tests** (`AGENTS.md`, current phase). Every task is verified in a real browser (Playwright MCP) against `pnpm dev`, with Postgres (`docker compose up -d`), the capture engine (`BROWSER_URL=http://localhost:8080`) and the fixture server running. Every screen check is at **1440×900 and 390×844, light and dark**; screenshots go to `$TMPDIR/ui-t<task>-<what>-<width>-<theme>.png` (`TMPDIR=$HOME/.cache/tmp`). Report the commands run and what was seen.
- **Real audits.** Reuse the M3 demo audits if they are in the database; otherwise run, with `blockVendorRequests: true`: (A) `clean`, `meta-before-consent`, `duplicate-purchase` × none/accept/reject, desktop; (B) `no-cmp` × none/accept/reject (partial, could-not-check items); (C) a 44-run audit (11 pages × 4 scenarios, the M3 consent audit) for density; (D) an M2-era audit with no check results if one exists ("Not evaluated"). Keep one audit running while checking live states.
- `pnpm check && pnpm typecheck && pnpm build` exit 0, zero warnings, after every task (real exit codes).
- **shadcn components** are added with `pnpm dlx shadcn@latest add <name>` from `apps/web`, then checked: `apps/web/package.json` and the lockfile unchanged (revert any `@radix-ui/react-*` the CLI adds and import from `radix-ui`, as `dialog.tsx` does), files formatted with `pnpm format`. No new npm package except `cmdk` if decision 1 is approved.
- Theme tokens only (`AGENTS.md`): no hex, no inline `style`, no `text-[13px]`-style arbitrary sizes where a scale token exists. Status and severity are never color alone: glyph plus word.
- **Vocabulary**, everywhere: Critical / Warning / Info (severity); Fail, Could not check, Pass, Not applicable (check results; "inconclusive" never appears in the UI); Open, Accepted risk, Fixed (triage); Queued, Running, Complete, Partial, Failed, Not audited (runs and audits); Not evaluated (an audit without check results), never shown as clean.
- Organization scoping through `activeMembership`; every aggregate added here filters by `org_id` and reaches runs and findings through their audit. An id from another organization stays a 404.
- Search params are validated in `validateSearch` (with `Schema` for new ones) so filtered views stay shareable. Never sudo; never push without asking.

## Review focus

1. **Contrast and shape.** Every severity and status pair meets the ratios in `visual-system.md` in both themes; a grayscale screenshot still tells fail, could not check and pass apart. Task 1, Task 11.
2. **Could not check is never an accusation and never a pass.** Neutral, dashed, the check title, the reason; no severity color. Task 8.
3. **Aggregates are honest and scoped.** "Open findings" counts only failing, open findings of each site's latest settled, evaluated audit; a running audit is its own state; "Not audited", "Not evaluated" and "not fully checked" are distinct from "No open findings"; coverage buckets are exclusive and sum to the runs; the estimate's run count equals the rows created; another organization's data never leaks into counts. Tasks 4, 5, 6, 8.
4. **Live states.** The progress header and matrix update from `AuditRoom` signals without layout shift; the finish toast fires once. Task 6.
5. **Mobile.** At 390px every detail (run, finding, hit) opens where the user is looking. Tasks 6, 8, 9, 11.

### Task 1: Tokens and type

**Model:** Sonnet
**Files:** modify `apps/web/src/styles.css` (the drop-in `:root`, `.dark` and `@theme inline` from `visual-system.md`), `apps/web/src/components/evidence.tsx`, `apps/web/src/components/status-badge.tsx` (its tones only; Task 2 rewrites the component), `apps/web/src/components/ui/sonner.tsx`, `apps/web/src/routes/app/settings/{ai,index,members}.tsx`, `apps/web/src/routes/app/audits/{$auditId.hits,$auditId.findings,$auditId.index}.tsx` (only the `success`/`warning` class swaps), `apps/web/src/components/logo.tsx` (`#8b7cf6` stays: it is the mark's own color, not UI chrome), `docs/ui.md` (Direction: the token names, the meaning map, system font stack)
**Interfaces:** produces Tailwind colors `sev-{critical,warning,info}`, `status-pass`, each with `-bg`, `-border`, `-solid`; `sidebar`; text sizes `text-2xs` … `text-2xl` per the type scale; radius 8px; `--color-success`/`--color-warning` removed (every `text-success`, `bg-warning/15`, `border-warning/50` replaced: warning-severity and partial → `sev-warning*`, pass → `status-pass*`). Font: the system stack (`ui-sans-serif, system-ui, …`); Inter is not loaded, because fontsource is a new dependency, and `docs/ui.md` says so. `@media (prefers-reduced-motion: reduce)` stops `animate-spin` and `animate-pulse`.
**Blocked by:** none

- [ ] `rg -n '\b(text|bg|border|ring|fill|stroke)-(success|warning)\b' apps/web/src` finds nothing (`toast.success` and Sonner's icon names are not token uses)
- [ ] Verify: every existing screen (clients, client, site, new audit, runs, findings, hits, settings ×3, sign-in, onboarding) at both widths and themes: no clipped text, no unreadable badge, primary buttons violet; screenshots `$TMPDIR/ui-t1-*`

### Task 2: Shared building blocks

**Model:** Sonnet
**Files:** add with the shadcn CLI: `components/ui/{table,breadcrumb,sheet,separator,collapsible,tooltip,toggle,toggle-group,progress,popover,select,alert,skeleton,scroll-area,hover-card}.tsx` (all on `radix-ui`; `table`, `breadcrumb`, `alert`, `skeleton` need no Radix at all); create `components/page-header.tsx`, `components/empty-state.tsx`, `components/status-glyph.tsx`, `components/severity.tsx`, `lib/format.ts`; rewrite `components/status-badge.tsx`
**Interfaces:**
- `PageHeader({ breadcrumb?: ReadonlyArray<{ label, to?, params? }>, title, description?, meta?, actions? })`: breadcrumb (shadcn), `text-xl` title, muted description line, actions right-aligned and wrapping under the title below `sm`
- `EmptyState({ title, description, action?, secondary? })`: dashed `border` box, text only (no illustration)
- `StatusGlyph({ meaning, className? })`, `meaning: "critical" | "warning" | "info" | "pass" | "fail" | "could-not-check" | "not-applicable" | "queued" | "running" | "partial" | "failed" | "none"`: lucide icons with the meaning map's shapes (filled diamond, filled triangle, filled dot, check ring, x ring, dashed ring `CircleDashed`, dash ring `CircleMinus`, hollow ring, `LoaderCircle` spinning), colored from the Task 1 tokens, `aria-hidden` (the word always sits next to it)
- `StatusBadge({ status })` for runs and audits, now including `none` ("Not audited"); `SeverityBadge({ severity })`, `SeverityMark` (2px left rule class helper), `CheckStatusBadge({ status: "fail" | "inconclusive" | "pass" | "not_applicable" })` labelled by the vocabulary; tinted backgrounds only in badges, headers and detail views
- `lib/format.ts`: `relativeTime(date)` (`Intl.RelativeTimeFormat`, full date for `title`), `duration(ms)` ("8m 41s"), `count(n, noun)` ("1 site", "3 sites")
- Page frame: list pages `mx-auto max-w-6xl space-y-6`; audit pages full width
**Blocked by:** none (uses the token names above; merge after Task 1)

- [ ] `git diff apps/web/package.json pnpm-lock.yaml` is empty
- [ ] Verify: a temporary route under `routes/app/` renders every `StatusGlyph` meaning, both badges, `PageHeader` and `EmptyState` in both themes; screenshot `$TMPDIR/ui-t2-gallery-*`, including one in grayscale (`filter: grayscale(1)` via devtools) where every meaning is distinguishable; delete the route before merging

### Task 3: App shell, org switcher, account menu

**Model:** Sonnet
**Files:** modify `routes/app.tsx`, `components/org-switcher.tsx`, `components/user-menu.tsx`; `components/theme-toggle.tsx` stays for the landing and auth pages
**Interfaces:** sidebar top row is the switcher (ghost button: org initial in `Avatar`, name, `ChevronsUpDown`; menu: organizations with a check, "Members" → `/app/settings/members`, "Create organization"); `LogoMark` at 20px above it; nav rows `h-8 text-sm`, active `bg-accent font-medium`; Settings last; the account row at the sidebar foot (avatar, name; menu: email, Theme as `DropdownMenuRadioGroup` light/dark/system, Sign out). The desktop top bar is removed; below `md` a top bar keeps the menu button and opens the sidebar in a `Sheet side="left"` (replacing the restyled `DialogContent`). Sidebar `bg-sidebar`.
**Blocked by:** 1, 2

- [ ] Verify: switch organization and land on its clients; Members shortcut; theme changes from the account menu and survives a reload; sign out; at 390px the Sheet opens, navigates and closes on navigation; screenshots `$TMPDIR/ui-t3-*`

### Task 4: Clients, client detail and site pages

**Model:** Sonnet
**Files:** modify `routes/app/clients/index.tsx`, `routes/app/clients/$clientId.tsx`, `routes/app/sites/$siteId.tsx`, `server/clients.ts`; create `components/first-run.tsx`
**Interfaces:**
- `listClients → Array<{ id, name, siteCount, running: number, latest: { auditId, createdAt, status, coverage: "full" | "partial" | "not-evaluated", couldNotCheck: number, openFindings: { critical, warning, info } } | null }>`, built per unarchived site and summed per client. Per site, "latest" is the newest **settled** audit (`complete`, `partial` or `failed`) that has check results; a newer queued or running audit only raises `running`, it never replaces the settled one. `coverage` is `full` when every run of that audit has check results, else `partial`; `not-evaluated` when the site has settled audits but none with check results; `latest` is `null` when the site has none. `openFindings` counts that audit's findings with `kind = fail` and triage `open` (no triage row is open); `couldNotCheck` its `kind = inconclusive` findings. For a client, `coverage` is the worst over its sites and the date the newest
- Display: "Audit running" (with the running glyph) when `running > 0`, beside the last settled result; counts per severity; "No open findings" with the pass glyph **only** when coverage is `full`, `couldNotCheck` is 0 and every site has a settled evaluated audit; zero failures with partial coverage or could-not-check items reads "0 open · not fully checked" (neutral); "Not evaluated", "Not audited" otherwise. Never a bare 0
- `getClient` sites gain `running` and `latest` the same way; `getSite` audits gain `runs: { total, finished }` and `findings: { critical, warning, info, couldNotCheck } | null` (`null` = not evaluated)
- Clients: `PageHeader` with a search `Input` (client-side filter by name) and "New client" opening a `Dialog` with the one-field form; a `Table` (Client, Sites, Last audit: `StatusBadge` + relative date, Open findings: glyph + count per severity); whole row links. Empty: `EmptyState` "Add your first client". `FirstRun`: a three-step card (Add a client, Add a site, Run an audit) derived from the `listClients` data, gone when all three are done, "Dismiss" stored in `localStorage` per organization
- Client: breadcrumb, meta line ("3 sites · last audit 2 days ago"), "Add site" `Dialog` (name, address), sites `Table` (Site, Origin `font-mono`, Last audit, Open findings, Audits), Archive and Delete in a "…" `DropdownMenu` through `ConfirmDialog` (Delete in `text-destructive`); Archived as a muted `Badge`; empty: "Add the site to audit"
- Site: breadcrumb (Clients / Client / Site), origin `font-mono`, "New audit" primary in the header, same overflow menu, history `Table` (Started relative with full date in `title`, Status, Runs "9 of 9", Findings by severity or "Not evaluated"), Newer/Older kept
**Blocked by:** 1, 2

- [ ] Verify: a fresh organization shows the empty state and the checklist, which ticks through client → site → audit and can be dismissed; the clients table shows the right latest status and open counts for audits A and B (cross-check one against its Findings tab), "Not evaluated" for D, and B (could-not-check items) never reads "No open findings"; while a new audit of an A site runs, the row shows "Audit running" and keeps A's counts; triaging a finding as fixed lowers the count after reload; a second organization sees none of it; archive and delete still confirm; screenshots `$TMPDIR/ui-t4-*`

### Task 5: New audit form and live estimate

**Model:** Sonnet
**Files:** modify `routes/app/sites/$siteId_.audits.new.tsx`, `lib/audit-labels.ts`
**Interfaces:** `runBreakdown({ pages, scenarios, viewports, journeySteps }) → { runs, workUnits, lines: Array<{ label, runs, workUnits }>, duration }` replaces `runCount`. `runs` is the rows `startAudit` creates: `pages × scenarios × viewports`, plus one journey run per scenario × viewport when journey is on and there is at least one key page (`server/audits.ts`); `workUnits` weights a journey run as `1 + steps` (steps = `min(key pages, JOURNEY_STEPS)`) and drives `duration` (`workUnits × 12.8 s`). Today's `runCount` returns the work units and the form labels them runs (11 pages × 4 scenarios × 1 viewport with journey: 68 shown, 48 created); the fix shows "48 runs" and the duration from 68 units, and the breakdown says a journey run takes as long as 6 page runs. Form in three sections (Pages, Scenarios and viewports, Options), label and help left from `lg` (`grid lg:grid-cols-[14rem_1fr]`, `border-t pt-6`), a section-local `FormSection` in the route file. Scenarios stay checkbox cards (selected `border-primary bg-primary/5`) with "All" / "Only reject" quick actions; viewports become a `ToggleGroup type="multiple"` (Desktop, Mobile; the stored `viewports` array is unchanged, `choiceOf`/`viewportsOf` go); click IDs and journey under Options, "Answer tracking requests locally" under a collapsed Advanced `Collapsible`. Key pages: per-line client-side errors (invalid URL, not on the site's host, duplicate), "n of 19"; with Journey on, a numbered `ol` of the walk (start, then the first 5 pages; the rest muted with a "not walked" badge). Estimate: sticky aside from `lg` (a bottom bar below it) with the run count (headline), the breakdown lines in `font-mono tabular-nums`, "about 10 minutes", the Start button, and a "How is this estimated?" `Collapsible` (12.8 s per run); `text-sev-warning` note above 100 runs (actual runs). Submit disabled with a reason when no scenario or viewport is chosen. Server-side per-URL errors keep landing under their input.
**Blocked by:** 1, 2

- [ ] Verify: 11 pages × 4 scenarios × 1 viewport reads 44 runs, about 10 minutes, and `startAudit` creates 44 runs; with journey on it reads 48 runs and about 15 minutes, and `select count(*) from run where audit_id = …` returns 48; the journey line and the path preview show; a foreign URL and a duplicate show inline errors before submit; last-used settings still prefill; screenshots `$TMPDIR/ui-t5-*`

### Task 6: Audit header, progress and the runs matrix

**Model:** Opus (live state and the matrix)
**Files:** modify `routes/app/audits/$auditId.tsx`, `routes/app/audits/$auditId.index.tsx`, `server/audits.ts`, `lib/audit-labels.ts`; create `components/run-matrix.tsx`, `components/run-sheet.tsx`
**Interfaces:**
- `getAudit` adds `client: { id, name }`, per run `consentOutcome` (decoded from `run.consent`, `null` before capture), and `summary: { hits, findings: { critical, warning, info, couldNotCheck }, evaluatedRuns }` (failing findings counted by severity, from `finding`)
- Header: `PageHeader` with breadcrumb (Clients / Client / Site / Audit, date), `StatusBadge`, a live dot with `Tooltip` (Connected / Reconnecting). While running: `Progress`, "12 of 44 runs", elapsed, time left as a range from `SECONDS_PER_RUN` (hidden once elapsed exceeds the estimate), counts of running, partial and failed. Finished: a `divide-x` stat strip (Runs 44: 40 complete, 3 partial, 1 failed, with a thin proportion bar; Findings 5: 4 critical; Duration; Started). A failure strip (`sev-critical-bg`, or `sev-warning-bg` when only partial) lists each failed or partial run with its `runReason`. Tab links show counts (Runs 44, Findings 5, Hits 312). A Sonner toast "Audit complete: 5 findings" with a Findings link when the audit finishes while open (once).
- Runs tab: `validateSearch` `{ view?: "matrix" | "list" | "thumbnails", run?: string }`; a `ToggleGroup` switches views; matrix is the default: one row per page (journey runs on their own "Journey from /path" rows), columns per scenario grouped by viewport, sticky first column; each cell a `StatusGlyph` and the hit count (`font-mono tabular-nums`), a `HoverCard` with the screenshot and reason; no row tints. List: a `Table` (Page, Scenario, Viewport, Status, Hits, Duration from `startedAt`/`finishedAt`, Reason). Thumbnails: today's tiles, kept.
- Run sheet (`?run=`): `Sheet side="right"` (`side="bottom"` below `md`): screenshot at the viewport's aspect, facts (scenario, viewport, consent outcome, duration, hits), the reason and errors, a strip of the same page's other scenarios, prev/next buttons and arrow keys, "Open in Hits" (`/hits?runId=`) and the failing findings that cite this run (from their `runIds`, linking `/findings?finding=`)
- Decision 4b, if approved: the redirect to Findings on default arrival only (no `view` and no `run` in the search); the Runs tab link carries `view=matrix`
**Blocked by:** 1, 2

- [ ] Verify on audit C while running: the header counts and progress move with each run, no layout shift in the matrix, the toast appears once at the end; on A: matrix, list and thumbnails agree, a cell opens its sheet, prev/next and arrow keys walk the runs, the scenario strip switches; on B: the failure strip names the partial runs and why; `?run=<id>` reloads into the sheet; with 4b, a finished audit with findings lands on Findings, and clicking Runs stays on Runs (also after a reload); another organization's audit id is a 404; screenshots `$TMPDIR/ui-t6-*`

### Task 7: The evidence viewer

**Model:** Sonnet
**Files:** modify `components/evidence.tsx` only. Task 7 owns the shared rendering primitives (`ConsentTokens`, `KeyValueTable`, `RequestView` with Decoded/Raw, `JsonView`, `CopyButton`); wiring them into the routes, disabling empty evidence tabs (Task 8) and the push presentation in the timeline (Task 9) belong to those tasks
**Interfaces:** Consent as tokens ("ad_storage denied", "analytics_storage granted"; granted `status-pass`, denied `sev-critical`, unknown muted, each with its word); Ids and Params as a two-column `Table` with a hover Copy button per value (`navigator.clipboard`, a Sonner toast), a filter input above more than 12 params, and glosses for known keys (`en` event name, `dl` page location, `tid` measurement ID, `gcs` consent state, `npa`, `oid`); Request: method and URL on one line with Copy, the query string as a decoded table, the body in a `Collapsible` code block, a `ToggleGroup` "Decoded | Raw"; dataLayer values as indented JSON (`JSON.stringify(v, null, 2)`) in a `ScrollArea`, collapsed beyond 20 lines. Existing exports keep working until Tasks 8 and 9 switch to the new ones, which then remove the old ones
**Blocked by:** 1, 2

- [ ] Verify: the Findings and Hits screens are unchanged (old exports intact); the new primitives, rendered in a temporary route on audit A data (a GA4 hit, a raw `ccm` request, a Meta hit with an event id, a cookie, a push), show correctly; Copy copies; Decoded/Raw switches; the route is deleted before merging; screenshots `$TMPDIR/ui-t7-*`

### Task 8: Findings

**Model:** Opus (triage state, coverage and the could-not-check semantics)
**Files:** modify `packages/rules/src/types.ts` and all 19 rule files (`checkTitle`), `routes/app/audits/$auditId.findings.tsx`, `server/findings.ts`. The schema changes follow the decisions independently, each its own generated migration in `packages/db/drizzle/`: decision 2 adds `finding_triage.reason` (`packages/db/src/rules-schema.ts`, `setTriage`); decision 3a adds `check_result.check_title` and `finding.check_title` (same file, plus `workflows/Audit.ts`: `persist` and `finish` write it). With neither, no migration; with 3b, `checkTitle` is read from `ruleById`
**Interfaces:**
- `Rule.checkTitle: string`, a neutral noun phrase per rule, written so it reads true whether the check passes or fails
- `listFindings` adds per finding `checkTitle`, and `coverage.runs: { failing, couldNotCheck, passed, notEvaluated }`: every run in exactly one bucket, by precedence: `failing` (at least one `fail`), else `couldNotCheck` (at least one `inconclusive`), else `passed` (results that are all `pass` or `not_applicable`; a run whose results are all `not_applicable` is `passed`, labelled "passed (nothing applied)" in the tooltip), else `notEvaluated` (no check results); the four sum to `totalRuns`. Separately `coverage.couldNotCheckOnFailingRuns` counts failing runs that also had an inconclusive check, so the line says "2 failing (1 also could not check)" and nothing is hidden by precedence; `getFinding` adds `checkTitle` and `triage.updatedByName` (joined from the Better Auth `user` table through the `member` row of the org); `setTriage` takes `reason?: string` and requires it for `accepted_risk` (decision 2)
- Layout: coverage as one muted line at full coverage ("All 15 runs evaluated · 2 failing · 1 could not check"), an `Alert` with a segmented bar (`sev-critical-solid`, `muted-foreground/40`, `status-pass-solid`, dashed `bg-muted`) when partial or mixed versions; tabs Open / Accepted risk / Fixed with counts (decision 4a; `?triage=` in the URL); under them a small filter row: severity as toggle chips with counts (`ToggleGroup type="multiple"`) and an Area `DropdownMenu` with checkbox items (Consent, Click IDs, Coverage, Duplicates, Dedup, Hygiene), both in the URL (`?severity=`, `?area=`), "Clear" when set, no new dependency; failing findings as two-line rows without cards under sticky severity group headers ("Critical 2" with its glyph), a 2px `SeverityMark` rule, title, "Consent · 1 page · 3 scenarios", triage badge only when not Open, selected row `bg-accent`; then "Could not check (n)", a `Collapsible` (closed when there are failing findings, open when there are none), rows with the `CircleDashed` glyph, `checkTitle` and the reason ("Consent banner not found on 2 pages under Reject all"), no severity color
- Detail: sticky header (severity glyph and word, title, rule id with copy) with one triage `DropdownMenu` (Open, Accept risk, Mark fixed; accepting opens a `Dialog` with the reason `Textarea`) and the line "Accepted by Sam, 3 Oct: reason"; Why it matters; How to fix it with a ghost Copy icon; "Where it was seen" as a compact `Table` (page, scenario, viewport, check status, message) whose selected row drives the evidence tabs, built from the Task 7 primitives (empty tabs disabled with their count), with "Open in Hits" per evidence item. A could-not-check item shows a neutral `Alert` with the reason and `checkTitle`, and hides Why and Fix. The detail pane scrolls on its own from `lg`; below `lg` it opens in a `Sheet side="bottom"` (90svh) with prev/next ("3/12")
- States kept from M3: not evaluated, running ("checks are still to come"), only could-not-check (never clean), no findings at full coverage
**Blocked by:** 1, 2, 6 (the audit header), 7

- [ ] Verify on A, B and D: the rows and groups, a could-not-check item on B shows its `checkTitle` and no red; accept risk with a reason, reload, the actor line and the Accepted risk tab count; reopen; Open in Hits per evidence item; D reads "Not evaluated"; the coverage segments sum to the total runs on A, B and C; a run evaluated before the migration falls back to the registry `checkTitle`; the severity and area filters narrow the list and survive a reload; another organization 404s; 390px opens the bottom sheet; screenshots `$TMPDIR/ui-t8-*`

### Task 9: Hits

**Model:** Opus (pagination with new filters, the consent divider)
**Files:** modify `routes/app/audits/$auditId.hits.tsx`, `server/hits.ts`
**Interfaces:**
- `listTimeline` input: `vendor`, `event`, `scenario`, `runId` accept one value or an array; `q?: string` matches event, destination, ids and params (`ilike` on the text, escaped), hits only; the cursor stays valid under them. Output adds `runs: Array<{ id, ordinal, scenario, consentActionAt: number | null }>` for every run the filters select (not only the runs on the page) and `counts: { hits: { matched, total }, pushes: { matched, total } }` computed on the server (`total` = the audit's rows of that kind, `matched` = under the current filters, whatever page is loaded). `listHitFilters` adds `scenarios` and per-value counts
- Toolbar: search `Input` ("Filter by event, id or parameter, e.g. gclid"), dashed "+ Vendor", "+ Event", "+ Scenario", "+ Source", "+ Run" chips, each a `Popover` with checkbox options and counts that turns into "Vendor: ga4, meta ×"; "Clear filters"; a count line "11 of 342 hits · 40 of 120 pushes" from `counts` (the pushes part hidden when `source = network`, the hits part when `source = dataLayer`). Below `md` the chips collapse into a "Filters (2)" button opening a `Sheet`. The old `vendor=ga4` params still work
- Table: `h-7` rows, `text-xs font-mono`, sticky header; pushes show their event name (`value.event`, or the gtag command and its first argument, e.g. `consent default`) in muted text; consecutive identical pushes of one run collapse into "6 pushes · 716–718 ms" (expandable); a divider row "Consent action: Accept all at 1,240 ms" at each run's `consentActionAt` (inserted exactly once per run across appended pages: before the first item of that run with `at >= consentActionAt`, or after the run's last item when none is later, tracked in the client's accumulated list so a page boundary never duplicates or drops it) replaces the "after consent action" pill (no amber, since after consent is correct under accept); a status cell (HTTP status, a blocked glyph for answered locally); two consent dots (ad, analytics) per hit with a `Tooltip`; vendor as a glyph-free label. Run and Destination columns hide below `md`
- Detail: built from the Task 7 primitives; below `lg` a bottom `Sheet` with prev/next
**Blocked by:** 1, 2, 7

- [ ] Verify on A: two vendors at once, a search for `gclid` and for a transaction id, paging past 200 rows with filters on, the count line against a `select count(*)` per kind; on an accept run with more than 200 items, with the page boundary near the consent action (filter it to one run), the divider appears once, in the right place, after loading every page, and once on a run whose items all precede the action; none in a none run; collapsed pushes expand; `?run=&hit=` from Findings still opens the hit; at 390px the filter sheet and detail sheet; screenshots `$TMPDIR/ui-t9-*`

### Task 10: Auth, onboarding and settings

**Model:** Sonnet
**Files:** modify `components/auth-card.tsx`, `routes/{sign-in,sign-up,onboarding,accept-invite.$id}.tsx`, `routes/app/settings.tsx`, `routes/app/settings/{index,members,ai}.tsx`
**Interfaces:** auth pages: a narrow column, `Brand`, heading, one sentence, the form, the switch link, and one `text-xs` muted line "Open source (AGPL-3.0). Audits from the outside."; `safeRedirect` unchanged. Onboarding: `Brand` top left, "Signed in as email · Sign out" top right, the one-field form, then Clients (where Task 4's checklist appears). Accept invite states the organization and the role granted. Settings keep their three tabs, under a `PageHeader`. Members: one `Table` (member with `Avatar`, role, status or joined), pending invitations as rows with a "Pending" badge and "Copy link"; the native role `select` becomes the shadcn `Select` (owners and admins only, server checks unchanged); "Invite member" `Dialog` with email, role and one line per role. AI: one card with the status line (provider, model, `•••• 1234` in mono), new key input, Test and Remove, and "Rules decide pass or fail; the model only writes explanations." No-key state is a neutral info row
**Blocked by:** 1, 2

- [ ] Verify: sign up, onboard, sign out from onboarding; invite a member, copy the link, accept it in a second browser context, change and remove the role as admin; a member sees no role controls; save, test and remove an AI key (Ollama or a dummy key showing the error); screenshots `$TMPDIR/ui-t10-*`

### Task 11: Mobile and theme sweep, docs

**Model:** Sonnet
**Files:** fixes in any route or component above; modify `docs/ui.md` (navigation as built, states, vocabulary, the visual system summary), `docs/vision.md` (a UI row: what changed and how it was verified; decisions 1–4 as taken)
**Blocked by:** 3–10, and 13 when decision 1 is approved

- [ ] Every screen at 390px and 1440px, light and dark, with no horizontal page scroll (tables scroll inside their container), touch targets at least 32px, focus rings visible on keyboard navigation; a grayscale pass on runs and findings; screenshots `$TMPDIR/ui-t11-*`; save the final set to `mockups/ui-refresh-demo/` (untracked)

### Task 12 (optional): Sales page brand alignment

**Model:** Sonnet
**Files:** `mockups/zinko.html` (untracked, excluded by `.git/info/exclude`)
**Blocked by:** 1 (tokens), 11 (the refreshed screenshots)

- [ ] Its colors, radius and type use the Task 1 values (inline CSS custom properties, it is standalone), the logo matches `LogoMark`, screenshots of the product use the refreshed screens from Task 11; opened offline in a browser at both widths

### Task 13 (only with decision 1): Command palette

**Model:** Sonnet
**Files:** add `components/ui/command.tsx` (shadcn, `cmdk`), create `components/command-palette.tsx`; modify `routes/app.tsx` (a "Find…" row with a `⌘K` hint), `server/clients.ts` (`searchTargets → { clients, sites }`, names and ids, org-scoped)
**Blocked by:** 3, 4

- [ ] Verify: ⌘K / Ctrl+K opens it anywhere in `/app`; go to a client and a site by typing; New client; switch organization; Esc closes; works at 390px from the "Find…" row

## Execution order

```
wave 1:  1 tokens (Sonnet)   2 building blocks (Sonnet)                  merge 1, then 2
wave 2:  3 shell (Sonnet)   4 clients/sites (Sonnet)   5 new audit (Sonnet)
         6 audit + runs (Opus)   7 evidence viewer (Sonnet)   10 auth/settings (Sonnet)
wave 3:  8 findings (Opus, after 6, 7)   9 hits (Opus, after 7)   13 palette (after 3, 4, if approved)
wave 4:  11 sweep and docs (Sonnet, after 13 if approved)
wave 5:  12 sales page (Sonnet, optional, after 11)
```

Tasks 5 and 6 both touch `lib/audit-labels.ts` (different functions); merge 5 first. Each task runs in its own worktree (`wt switch --create`) and merges to local `main` after review of its diff and its pasted verify output. Pushing to GitHub waits for the user.

## Not in scope

- P2 items from the boards: runs filters and grouping toolbar, re-run with the same settings, screenshot compare mode and banner-state corner marks, per-run phase strip, the hits timeline strip with a consent marker, "cited by" backlinks from hits to findings, `j`/`k`/`e` shortcuts, skeleton loading tiers, saved views.
- Backend the boards assumed but that does not exist: single-run retry and "Retry failed", audit cancel, per-phase timings (the list view shows total run duration, which is stored), site settings (banner selector, "what would let us check it"), a demo fixture client ("Try with a demo site"), AI key "last tested", triage expiry.
- Health score, Overview tab, tag matrix and report (M4 and later). The shadcn `sidebar` block, an icon rail and a settings sub-nav (at five settings pages).
- Dropped as contradictions: tinted failed rows in the runs matrix and amber left rules on after-consent hits (the visual system keeps tints out of rows and amber for warning and partial only; Task 9 uses a neutral divider instead); amber for Accepted risk (neutral with its own glyph); "Not checked" as a second name for could not check; `text-success`/`text-warning` from the shell board (replaced by the Task 1 tokens); Command-based chip filters in Hits (Popover with checkboxes needs no `cmdk`); progress counts as filter chips (filters are P2).

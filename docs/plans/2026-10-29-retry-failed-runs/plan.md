---
type: plan
status: proposed
design: ../../vision.md
---

# Retry Failed Runs Plan

**Goal:** When some runs of a finished audit could not finish (Zinko was busy, the browser engine failed, a timeout, a transient network error, results that could not be saved), one button on the audit captures only those runs again, inside the same audit, and the audit's Overview, Findings, Tag matrix, Hits, score, Compare and report then describe all of its runs. Demo: an audit of a fixture with the capture engine stopped half way ends Partial with `EngineBusy` runs; after the engine is back, "Retry 4 runs" captures exactly those four, the audit goes back to Running, then Complete, the "could not finish" notice is gone, the score is computed from every run, and nothing that already finished was captured again.

**Approach:** Reopen the audit as a retry round, not a new audit. A server function marks the retryable runs with the round number (one transaction under the organization's advisory lock, next to `createAudit`), starts a second workflow instance for the same audit, and that instance runs the existing `admit`, `capture`, `persist`, `fail` and `finish` steps over the marked runs only. `persist` and `finish` already replace a run's derived rows and recompute findings idempotently, and triage is never touched. Capture objects of a retried run get a round-numbered key. A retried capture replaces the earlier result only when it is complete or the run had no usable result before, so a retry cannot make a run worse. Two columns and one migration; no new table.

**Effort:** about 4 to 5 working days. Task 0 (read the real failures) half a day, classifier and labels half a day, schema and reopen function 1 day, workflow round 1.5 days, UI 1 day, docs and verification sweep 1 day. The riskiest part is the workflow change (Task 4), not the UI.

Design sources: `AGENTS.md` (Database, Capture admission, Re-checks, Compare, Report), `docs/vision.md` (Durable runs, Capture admission, Re-run, Compare tab), `docs/roadmap.md` ("Left over from UX round 6 (F1)"), `docs/decisions/0003-capture-admission.md`, `docs/ui.md` (vocabulary, Re-run). Code read: `apps/web/src/server/{recheck,audit-create,audits,admission,jobs}.ts`, `apps/web/src/workflows/{Audit,AuditWorkflow}.ts`, `apps/web/src/lib/{compare,findings-from,audit-labels}.ts`, `packages/db/src/audit-schema.ts`, `packages/capture-contract/src/index.ts`, `apps/web/src/routes/app/audits/$auditId.tsx` and `$auditId.overview.tsx`, `components/rerun-dialog.tsx`.

## What a "failed run" is today

Two different things share the "could not finish" notice, and the button must tell them apart:

- **Failed without a result** (`run.status = failed`, `run.failure` set by `fail-<n>`): `EngineBusy` (429 or 503 to the end of the turns and the 240 s busy budget, or the gate did not answer), `EngineFailure`, `PersistFailure` (the capture is stored in R2 and on the row, only the database write failed). `run.failure = null` with `failed` is a refused request (`PolicyDenied`, `InvalidRequest`); it is not retryable.
- **Partial with a capture** (`run.status = partial`, `run.complete = false`): the engine answered and `persist` stored hits and check results, but `run.errors` lists `BotBlocked`, `Timeout`, `Navigation`, `HttpStatus`, `JourneyStep`, `EngineFailure`, `CmpNotFound` or `ConsentNotApplied`. The Overview counts these in "n of m runs could not finish (k partial)", including a `CmpNotFound` run on a site that simply has no banner, which is an observation the rules judge, not a failure.

So the notice's count is not the number of runs worth retrying. The button says "Retry 3 runs" and the dialog says why the rest are left alone.

## Decisions (proposed; the owner may overrule)

1. **Retry in place, as a round of the same audit. Not a narrow audit.** The user wants complete results, and a narrow audit cannot give them.
   - Alternative A, a `narrow` audit of the failed cells (the roadmap's sketch: build a re-check plan from failed runs, same `CellKey`s). Reuses `createAudit`, the cap, the guards and the whole workflow, and never touches a settled audit. Rejected because the result lives in another audit: a re-check has no score, no report ("Re-checks are not reported"), no Compare, and every reader filters `role = target` of its own audit. The original stays Partial and "Incomplete" forever, and merging two audits' runs into one Overview, Findings list, matrix and report would touch every reader of runs (findings, overview, matrix, hits, report, register, digest, compare) and break the rule that a finding is derived from one audit's check results. A re-check is also keyed to one rule (`narrow_rule_id`, `CreateAudit.narrow.ruleId`, the in-progress guard per rule and cells), so a retry would need a new kind, a rule-less variant of every one of those, and `narrowedConfig` takes a cross product (pages x scenarios x viewports) that adds `extra` runs for scattered failed cells, costing captures nobody reads. Re-check stays what it is: a way to confirm one rule.
   - Alternative B, a new `full` audit seeded with the successful runs copied from the original. Rejected: run rows, hits, pushes, check results and R2 objects (`audits/<id>/runs/<run>/...`) are all keyed by audit and run; copying them breaks "derived rows are reproducible from the capture" and duplicates storage, for the same end state as retry in place.
   - Alternative C, more retries inside the original workflow (longer busy budget, more turns). Already tuned in `fix/engine-busy`; it cannot help after the audit has settled, and a longer budget makes every audit slower to say it is partial.
   - Alternative D, status quo (Re-run the whole audit). Costs the full run count, produces a new audit that is compared with the old one, and the old one stays incomplete. Re-run remains the right tool for "check the site again"; retry is for "finish this audit".
   - **Cost of the chosen option, stated plainly:** a settled audit's contents change. The effects, one by one, are in Decision 6.
2. **The audit of record is the original audit.** Overview, Findings, matrix, Hits, score and report of audit X read X's runs, as they always do; after a successful retry they simply have more complete runs. There is no merge, no second audit to explain, and no reader changes (every reader already reads `run`, `check_result` and `finding` rows of the audit). The history shows one row for the audit; its status goes `partial` or `failed` to `queued`/`running` and back to `complete` or `partial`.
3. **Which runs are retryable** (a pure function `retryableRun(run)` in `lib/run-retry.ts`, used by the server to decide and by the UI to count, judged on the same fields as `runReason` so the label and the button agree):

   | Run state | Retry? | Why |
   |---|---|---|
   | `failure = EngineBusy` | yes | Zinko's own capacity, nothing about the site |
   | `failure = EngineFailure` | yes | Browser engine crashed or answered 5xx |
   | `failure = PersistFailure` | yes, no engine needed | The capture is stored; the round only re-runs `persist` (cheap, no admission) |
   | `failure = null`, failed (`PolicyDenied`, `InvalidRequest`) | no | Refused again by the same rule |
   | partial, error `Timeout` | yes | Often load or engine noise; one more round |
   | partial, error `EngineFailure` | yes | As above |
   | partial, `Navigation` with `timed out`, `no response from the server` (connection reset, empty response, closed) | yes | Transient network |
   | partial, `Navigation` with address not found, connection refused, certificate problem, redirect to another site, pop-up, left the site | no | The site is configured that way; it will fail again |
   | partial, `HttpStatus` 429, 500, 502, 503, 504 | yes | Server-side and often transient |
   | partial, `HttpStatus` 4xx other than 429 (404, 401, 403, 410) | no | A real answer the audit should report |
   | partial, `BotBlocked` | no (see open question 2) | Hitting bot protection again gives the same answer and looks like an attack to the client's vendor |
   | partial, `JourneyStep` | no in v1 | Cannot tell a flaky step from a missing selector without a spike |
   | partial, `CmpNotFound`, `ConsentNotApplied` | no | Observations the rules judge, not failures |

   A partial run is retryable when its first error that is a load failure (not `CmpNotFound` or `ConsentNotApplied`) is retryable in this table. Network details are matched with the same patterns `navigationReason` uses (`NETWORK_ERRORS`): one list of patterns, shared, not copied.
4. **No companion runs, no config narrowing.** Banner detection reads the accept and reject runs of the same audit (`bannerDetection` reads every role, and a full audit has only `target` runs), so a retried `none` run is judged against the audit's existing accept and reject runs, and a retried accept or reject run updates detection for the whole audit. The retried run is captured with the stored audit config exactly as the original (same URL with the click IDs on the start page, same journey, same follow host, same `allowedHosts`), because `loadRun` already builds the capture request from the run row and the audit config. Nothing is recomputed from the live site.
5. **A retry never makes a run worse.** The retried capture goes to a new key, `audits/<audit>/runs/<run>/r<round>/capture.json` (and `screenshot.png`); nothing is overwritten. In `capture`, for a run that already had a usable result: store the new capture only if `answer.complete`; otherwise delete the new objects and keep the old result unchanged (the run is still marked as attempted in this round). A run with no earlier result (failed, no capture) takes whatever the new capture is, complete or partial. On a store, `run.capture_key`, `run.screenshot_key` and `run.finished_at` (set to now, not `coalesce`, because `created_at` of the derived rows comes from `finished_at`) are updated, `persist` replaces the derived rows in its one transaction (it already sets `failure = null`, status, errors, `hit_count`), and a later `sweep-<n>` step deletes the old objects (new key, update the row, then delete the old object, as the logo upload does). A `PersistFailure` run is the exception that needs no capture: its stored capture is reused as is (`capture` already returns `Stored` for a run with a key).
6. **What changes for the rest of the system, and why each is acceptable.**
   - **Derived rows.** `persist` for a retried run deletes and reinserts that run's hits, pushes and check results from the new capture with `created_at` = the new `finished_at`; a repeated `persist-<n>` writes identical rows. `finish` recomputes `finding` from all the audit's check results (`findingsFrom`), in one transaction; triage and report edits are never touched (`finding_triage` has no foreign key to `finding`). A rule that newly fails because a retried run exposed it appears as an open finding; a finding the user marked fixed or accepted keeps its mark.
   - **Compare.** Computed on read, nothing stored. The invariant "a cell that failed before is never fixed because it is missing" is kept because a cell is now compared only with a real result; a cell that is still failed stays "Not comparable". Comparisons from this audit and against it improve rather than break: cells that were missing become shared cells. `cellKeyOf` is unchanged because a retry reuses the run row (same page URL, scenario, viewport, journey, follow host). Per-run `rules_version` and `decoder_version` are stored on `check_result` and `run`, so a retry after a deploy yields an audit judged by mixed versions; the existing "mixed rules versions" notice and the compat check already cover that, and the retry dialog names it (open question 3).
   - **Report.** The draft report is a read model and simply reads the completed audit (score, coverage, "could not check" and unfinished-runs sections shrink). Published snapshots are frozen records and do not change; the report's `publication_hash` changes, so the share dialog offers a new version as it does after any edit. Retry takes the audit row `for update` (the lock `publishReportData` holds), is refused while the audit is active, and `publish` must refuse while the audit is queued or running (Task 3 verifies this and adds the check if it is missing), so a version is never published from a half-retried audit.
   - **Score history and the Clients table** read the audit's current figures; a retried audit's score changes after the round. History keeps showing the audit's `finished_at`, which is not moved (`finish` uses `coalesce`); the retry time is `audit.retried_at`.
   - **Explanations** are cached by digest of the finding's evidence; changed evidence gives a new digest and a fresh, explicit click.
   - **The 5-active-audits cap and one-in-progress guards.** The reopened audit counts as active and goes through the same advisory lock and the same cap check as `createAudit`. An audit being retried blocks `setBaseline` on itself (already: active audits are refused) and a Re-run whose baseline is the audit it is a re-run of (the existing per-baseline guard, which is correct: the audit is in progress). One retry round at a time per audit (status check under `for update`), and at most 3 rounds per audit (`MAX_RETRY_ROUNDS`, provisional) so a dead site does not invite endless clicking.
7. **Workflow shape.** A second instance of the same `Audit` workflow, id `<auditId>-r<round>` (Cloudflare instance ids take letters, digits, `-` and `_`; the first instance, id `<auditId>`, is finished and cannot be restarted). Payload gains `round` (optional, default 0): `AuditWorkflow` payload `{ auditId, round? }`, `JobPayloads` in `@repo/core`. For `round > 0`:
   - `start` lists only `run.retry_round = <round>` (marked by the reopen transaction, so a replay sees the same set), and does not need the audit to be `queued`.
   - The admission key is the instance id, not the audit id: `admit(<auditId>-r<round>, turn)`. The gate treats the key as opaque and `admission.ts` wakes a waiter with `Jobs.sendEvent("audit", key, ENGINE_FREE_EVENT)`, which resolves the workflow by that id; using the plain audit id would wake the finished first instance and leave the retry to its one-minute re-ask. Step names are per instance, so `admit-<n>`, `capture-<n>`, `persist-<n>`, `fail-<n>` do not collide with round 0.
   - `capture` and `requeueRun` do not write `run.status` in a round (the run row keeps its last settled status until `persist` or `fail` replaces it), so a kept result never has to be restored; the UI shows "Retrying" from `run.retry_round = audit.retry_round` while the audit is active. The first admission marks the audit `running` (it is `queued` after reopen), as today.
   - `persist` of a `PersistFailure` run needs no admission: such runs skip `admit` and `capture` and go straight to `persist-<n>`.
   - `finish` is unchanged except that it also sets `retried_at = now()` when `round > 0`. `auditStatus` already derives `complete`, `partial` or `failed` from all runs.
   - The busy budget (`BUSY_BUDGET`) is per workflow instance, so the retry has its own 240 s; the two-pass handling of busy runs is unchanged.
8. **Who and where.** Any member may retry (as for Re-run: `membership`, `auditInOrg`-style org check first; an id of another organization is a 404). It is a `mutation` (captures spend money). Only `full` audits that are `partial` or `failed`, not active, on a non-archived site. Both `previewRetry` (a `read`) and `retryFailedRuns` (a `mutation`) compute the set from stored rows; the client sends only the audit id.
9. **Estimate and cost.** The preview counts retryable runs and their work units (a journey run counts as 1 plus its steps, a cross-host run as 2, as `runBreakdown` does), and passes them to the same `estimateDuration`; a `PersistFailure` run counts nothing. The cost to the user is the number of retried runs, not the audit.

## Schema (one migration)

- `audit.retry_round integer not null default 0` (rounds started so far, the high-water mark, raised under the lock and never lowered; the same pattern as `report_version_seq`).
- `audit.retried_at timestamptz` (the last round's settle time).
- `run.retry_round integer not null default 0` (the round that last attempted this run; 0 means never retried).

Existing rows are valid with the defaults (nothing is retried), so there is no backfill. Run `pnpm --filter @repo/db db:generate` then `pnpm db:migrate`; never edit the generated files. No change to `check_result`, `finding`, `finding_triage` or any `report_*` table.

## Global constraints

- No unit or integration tests (current phase). Each task is verified by running the real thing: the dev server, the capture engine, the fixture server, the page in a browser. Paste the command and what was seen.
- `pnpm check && pnpm typecheck && pnpm build` exit 0, zero warnings, after every task.
- Derived rows stay reproducible: no `defaultNow()` or random ids in `hit`, `datalayer_push`, `check_result` or `finding`; `finished_at` of a replaced run is the only clock they read.
- Triage and report edits are never written by the retry path. `rg "report_|org_branding|finding_triage" apps/web/src/workflows` stays empty.
- Every reader still filters `eq(run.role, "target")`; a retry adds no reader and no new role.
- New server functions are registered in `server/entry-points.ts` (`"retry.previewRetry": "read"`, `"retry.retryFailedRuns": "mutation"`), go through `read`/`mutation`, never run an Effect directly.
- Admission is unchanged: every retried capture joins the FIFO tail through `CaptureAdmission`, confirms its token before the browser call, and releases after storage.
- UI follows `AGENTS.md` (shared components, 32px targets, focus ring, focus restored to the opener in `onCloseAutoFocus`) and `docs/ui.md` vocabulary; checked at 390px and 1440px in both themes and in grayscale.

## Tasks

### Task 0: Read the real failures (before any code)

Capture what each failure looks like on the wire and in the database, so the table in Decision 3 is checked, not assumed.

- Run the dev server, the capture engine and the fixture server. Produce one audit with: the engine stopped after two runs (`EngineBusy` after the 240 s budget), a fixture page that exceeds the capture timeout (`Timeout`), a page that returns 404, 503 and 429 (the fixtures inspector may need a route for the last two), a host that does not resolve and a refused port (`Navigation`), a `no-cmp` fixture (`CmpNotFound`), and a forced `persist` failure (as in the M2 verification).
- For each, read `run.status`, `run.failure`, `run.errors`, `run.capture_key` and `hit_count` from the database and write the observed rows into this plan (a short table, no hit values). Fix Decision 3 where it is wrong, in particular: whether a `Navigation` failure to the start page produces a partial run with a capture or a failed one, and what the first error code of a transient network failure is.

Verify: the table in this task is filled from real rows; Decision 3 matches it.

### Task 1: Classifier and wording

Files: `apps/web/src/lib/run-retry.ts` (new: `retryableRun`, `retryReasonOf`, shared `NETWORK_ERRORS` patterns exported from `lib/audit-labels.ts` so there is one list), `lib/audit-labels.ts`.

- `retryableRun(run)` returns `{ retryable: true } | { retryable: false, why }` where `why` is one of a few fixed phrases for the dialog ("the page returned 404", "blocked as a bot", "the address could not be found", "the consent banner is part of the result").
- `FAILURE_TEXT.EngineBusy` changes from "Zinko was busy, re-run the audit" to "Zinko was busy" (the action is now next to it); `FAILURE_TEXT` stays the one definition.

Verify: `pnpm check` clean; feed the rows from Task 0 through the function in a scratch script (not committed) and print the verdict per row; it matches the table.

### Task 2: Schema and migration

Files: `packages/db/src/audit-schema.ts`.

- Add the three columns above. `pnpm --filter @repo/db db:generate`, review the generated SQL (three `ALTER TABLE ... ADD COLUMN` with defaults), `pnpm db:migrate`.

Verify: migration applies on the local database; `select retry_round from audit limit 1` returns 0; the app still loads an existing audit's pages.

### Task 3: Reopen and server functions

Files: `apps/web/src/server/audit-create.ts` (new `reopenForRetry` beside `createAudit`, sharing the advisory lock and cap check), `apps/web/src/server/retry.ts` (new: `previewRetry`, `retryFailedRuns`), `server/entry-points.ts`, `packages/core` (`JobPayloads`: `audit` payload gets `round`), `workflows/AuditWorkflow.ts` (payload schema), `server/report-publish-data.ts` (verify; add a check only if missing).

- `reopenForRetry({ orgId, auditId })`, one transaction: the organization's advisory lock; the audit row `for update` (org-scoped, 404 otherwise); refuse unless `kind = full` and status `partial` or `failed`, site not archived, `retry_round < MAX_RETRY_ROUNDS`; the cap check (`MAX_ACTIVE_AUDITS`, same message); select the audit's runs, keep those `retryableRun` accepts (a pure function, called on rows in the transaction); refuse with "Nothing here can be retried." when none; set `run.retry_round = audit.retry_round + 1` on those runs, `audit.retry_round + 1`, `audit.status = queued`, and clear `audit.error`. Return the round and the run count. `launchAudit(auditId, round)` runs outside the transaction and starts the instance `<auditId>-r<round>`; if the start fails the audit goes back to its previous status with the reason (the failure path of `launchAudit` today saves `failed`; for a retry it must restore, not overwrite, the settled status, so `launchAudit` takes the status to restore).
- `previewRetry`: same selection, read-only; returns `{ retryable, skipped: [{ why, count }], work, duration, mixedVersions, unavailable }`.
- Archived site, active audit, round cap, cap of five: each an `Invalid` with a sentence the dialog shows.
- Publish check: `rg -n "status" apps/web/src/server/report-publish-data.ts`; if a version can be published while the audit is queued or running, refuse it there.

Verify: with the dev server, call the preview and the mutation from the page (Task 5) or `curl` the server function; a second `retryFailedRuns` while one is in progress answers the in-progress error; another organization's audit id answers 404; with five active audits the cap message shows; the audit row shows `status = queued`, `retry_round = 1`, only the retryable runs carry `run.retry_round = 1`.

### Task 4: Workflow round

Files: `apps/web/src/workflows/Audit.ts`, `server/jobs.ts` (pass the instance id; no change expected), `server/admission.ts` (none expected).

- `run` reads `round` (default 0). Round 0 behaves exactly as today (no step name, key or status write changes).
- `start`: for `round > 0` list `run.retry_round = round`, plus `captureKey` so the loop knows which runs go straight to `persist`.
- Admission key and `publish` event target stay the audit id for DB and room; only `admit`, `confirm`, `release` and `grantFor` use the instance id.
- `keysFor(auditId, runId, round)`: `r<round>/` infix when `round > 0`. `capture`: for a retry round, a run with a usable earlier result keeps it unless the answer is `complete` (new `Attempt.Kept`, deleting the new objects); a run without one stores what it gets; no `run.status` writes in a round; `finishedAt` set to now when a new capture is stored.
- `sweep-<n>`: after a successful `persist-<n>` that replaced a capture, delete the previous capture and screenshot objects (idempotent; a failure is logged, never fails the run).
- `finish`: unchanged logic, plus `retried_at` for `round > 0`.
- Keep the decision's non-goals: no change to the busy budget, the turns, the gate, or round 0 step names, so workflows in flight during rollout are unaffected.

Verify, running the real engine and fixture server: (1) engine stopped after two runs of a 6-run audit, restart, Retry: the four failed runs capture in order, the two finished runs are not captured again (count `POST /capture` on the engine and the admission log), the audit ends `complete`, findings and score update, existing triage rows are byte-identical before and after (`select * from finding_triage` diff). (2) Hash the hits of a run before and after a second `persist-<n>` replay: identical. (3) A `Timeout` run retried against a fixture that now answers: the run is replaced, the old objects are gone from R2. (4) A run that was partial with data, retried into a worse result: unchanged row and unchanged `capture_key`, the new objects deleted. (5) A `PersistFailure` run: no engine call, rows appear. (6) Kill the worker mid-round and restart: the round resumes without a second capture of stored runs. (7) The first retry waits behind another audit's captures in the gate and is woken by the event (the admission log shows the wake, not the one-minute re-ask).

### Task 5: UI

Files: `routes/app/audits/$auditId.overview.tsx` (the "n of m runs could not finish" notice), `routes/app/audits/$auditId.tsx` (the problem-runs list and header state), `components/retry-dialog.tsx` (new, modelled on `rerun-dialog.tsx`), `components/run-sheet.tsx`, `server/audits.ts` (the audit view gets `retryable` count, `retryRound`, `retriedAt`), `routes/app/sites/$siteId.tsx` (nothing but the existing status badge), `docs/ui.md`.

- **Where.** Primary: in the Overview notice, after "2 of 28 runs could not finish (2 partial)", a secondary button "Retry 2 runs" (the count is the retryable ones; hidden when none is retryable). The same button in the problem-runs list header on the audit page, and per run in the run sheet ("Retry this run" is not offered in v1: single-run retry is out of scope, see open question 6). Never in the page header; Re-run stays the only header action.
- **Dialog (`RetryDialog`).** Title "Retry runs that could not finish". Body: "2 runs, about 40 seconds, with the same settings. Runs that finished are not captured again. This audit's results and score will update." A second line when some are left out: "3 runs are not retried: the page returned 404 (2), blocked as a bot (1)." A line when versions differ: "Zinko's checks were updated since this audit; the retried runs use the newer checks and the audit will say so." Refusals (cap of five, round cap, in progress, archived) show inside the dialog as an alert. Focus returns to the control that opened it (`onCloseAutoFocus`).
- **States.** Idle with retryable runs: button. Idle with none retryable: no button; the notice stays and, when the reason is useful, says "Not retried automatically: the page returned 404." Active (queued or running, including a retry): button hidden, and while a round runs the notice reads "Retrying 2 runs" with `StatusGlyph` running, live through `useAuditRoom` (no new events; the existing `run` and `audit` signals refetch). Waiting for a slot reuses "Waiting for a capture slot". Finished: the notice disappears when nothing is left, or counts the remaining ("1 of 28 runs could not finish (1 partial). Retried on 29 Oct."). Round cap reached: "Retried 3 times; run the audit again to check the site." The word "retry" is used for runs, "re-run" for the whole audit, "re-check" for one rule; the Runs list says "Retried" on a run with `retry_round > 0`, never "fixed".
- **Wording.** "Could not finish" stays; the run row reason comes from `runReason` (`Zinko was busy`), never from a stored message; never "inconclusive"; a still-unfinished audit stays "Not fully checked", never clean.
- **A11y.** Dialog trigger and buttons are `h-8` or larger with the focus ring from `AGENTS.md`; status is a glyph and a word.

Verify: in the browser at 390px and 1440px, both themes (real theme menu), grayscale, no horizontal page scroll: audit with `EngineBusy` runs shows "Retry 4 runs"; dialog text matches the preview; click retries, the page shows "Retrying 4 runs" and updates live without reload to Complete; a run with a 404 is not offered; the cap-of-five message shows in the dialog; a second member (other organization) cannot reach the audit.

### Task 6: Compare, report and Clients sweep

No planned code. Run the real thing and fix what it shows:

- Re-run the retried audit's site (a new audit) and open Compare: the retried cells are shared cells, nothing the failed cell reported as fixed; a cell still failed shows "Not comparable".
- Open the report draft of a retried audit before and after: the unfinished-runs and coverage sections shrink, the figures agree with the Overview (`scoreSummaryOf`). Publish a version before the retry, retry, open the share link: the old version is unchanged; the share dialog offers a new version.
- The Clients table and the site history show the new status and score; a running retry shows "Audit running".

Verify: screenshots at both widths; the commands and the observed counts pasted in the PR.

### Task 7: Docs

- `AGENTS.md`: add a "Retry rounds" section under Re-checks (reopen only through `reopenForRetry`; round-numbered capture keys; replace only a better result; `run.retry_round`; admission key is the instance id; the workflow still never writes triage or `report_*`).
- `docs/vision.md`: Durable runs and Re-run rows updated (retry rounds, the key scheme, the classifier, the open questions that remain). `docs/ui.md`: the "Retry" section and the vocabulary line. `docs/roadmap.md`: remove "Retry failed runs" from the F1 leftovers and the "single-run retry" out-of-scope note stays. `docs/decisions/0003-capture-admission.md`: one line that the admission key is the workflow instance id for retry rounds.
- Final gate: `pnpm check && pnpm typecheck && pnpm build`.

## Open questions for the owner

1. **Retroactive change to a settled audit.** The plan accepts that a finished audit's score and findings change after a retry (the audit stays the one record, history keeps `finished_at`, snapshots are frozen). If that is too surprising, the fallback is the narrow audit of Alternative A, which never changes a settled audit but gives no complete result and no report. Which do you want?
2. **BotBlocked.** Not retried by default. Offer it behind an explicit second checkbox in the dialog ("Also retry 2 runs blocked as a bot")? A retry will almost always be blocked again.
3. **Mixed versions.** When `RULES_VERSION` or the decoder changed since the audit, should a retry be refused ("run the audit again") instead of producing an audit judged by two versions? The plan allows it and says so in the dialog, because the existing mixed-versions notice covers it.
4. **Report wording.** Should the report's Scope and method say that some runs were captured on a later day? That is a report model change (version bump, an `UPGRADES` step); the plan leaves the model alone and `retried_at` is not printed.
5. **Round cap.** 3 rounds per audit is provisional. Is it right, and should it be per run instead?
6. **Single-run retry.** The roadmap lists it as out of scope; the same machinery would serve it (mark one run). Add a "Retry this run" in the run sheet now, or later?
7. **Who may retry.** Any member (as Re-run). Restrict to owners and admins because it spends capture time?
8. **Cloud.** Round numbering and the instance id scheme assume Cloudflare Workflows ids of letters, digits, `-`, `_`; local workerd matches, the deployed containers remain unverified, as for admission.

---
type: plan
status: proposed
design: ../../vision.md
review: review-r1.md
---

# Retry Failed Runs Plan

**Goal:** "Retry failed runs" on a finished audit creates a new full audit that reuses the original's good captures and captures only the cells that failed for a reason worth retrying. The new audit is complete, scored, comparable and reportable like any other. It says which of its results were captured on which days and which were reused. Demo: an audit of a fixture with the capture engine stopped half way ends Partial with `EngineBusy` runs; after the engine is back, "Retry 4 runs" starts an audit whose other runs finish in seconds without touching the engine, the 4 failed cells go through the capture queue, the new audit ends Complete with the original as its baseline, the report prints the capture date range and "24 of 28 results reused from the audit of 28 Oct", and Compare shows the reused cells as unchanged.

**Approach:** A retry is a re-run with a seeded run list. `createAudit` gets an origin `retry` (same stored config, baseline = the original, everything else as a re-run: carry-over, cap, one in progress per baseline). Each run row is created either as a normal run or as a reused one (`run.reused_from_run_id`). In the `Audit` workflow a reused run takes a new `reuse-<n>` step that copies the source capture objects to new keys, then goes through the existing `persist-<n>`, so its hits, pushes and check results are rebuilt from the copied capture under the current decoders and `RULES_VERSION`, with `created_at` from the source run's original `finished_at`. Reused runs never ask the capture gate. A reuse that cannot be done (object missing, unreadable, capture too old) falls back to a normal capture. Compare, the report and the CSV learn that a reused run is the same observation as its source. Three nullable columns, one migration, a report model bump.

**Effort:** about 7 to 9 working days. Task 0 (read real failures) half a day, classifier and schema 1 day, createAudit and server functions 1 day, workflow 1.5 days, Compare 1.5 days, report and CSV 1.5 days, UI 1 day, docs and sweep 1 day. The riskiest parts are the workflow (Task 4) and the Compare semantics (Task 5).

Design sources: `AGENTS.md` (Database, Capture admission, Re-checks, Compare, Report), `docs/vision.md`, `docs/roadmap.md` ("Left over from UX round 6 (F1)"), `docs/decisions/0003-capture-admission.md`, `docs/ui.md`, `review-r1.md`. Code read: `apps/web/src/server/{recheck,audit-create,audits,admission,storage,compare-data,report-data,register-data}.ts`, `apps/web/src/workflows/Audit.ts`, `apps/web/src/lib/{compare,findings-from,audit-labels,report-model}.ts`, `packages/db/src/audit-schema.ts`, `packages/core/src/storage.ts`, `packages/capture-contract/src/index.ts`.

## Changes after review r1

The review's verdict was "rethink". In-place retry (the previous plan) is dropped; its P1 problems (chronology, report and comparison stamps, worse-than-before results, guards, stranded active audits, progress) do not exist for a new audit. This plan is the review's alternative: a new full audit seeded with reusable captures. The reviewer's recommended answers are adopted: BotBlocked excluded in v1, all captures re-evaluated under the current rules with provenance disclosed, report and CSV disclose the capture date range and reused results (model bump with legacy rendering), any member may retry, single-run retry deferred, no separate round cap (the one-in-progress-per-baseline rule is the cap). Cloudflare ids of the form `<uuid>` are unchanged because the workflow instance is the normal one; no `-r1` id exists any more.

## What a "failed run" is today

- **Failed without a result** (`run.status = failed`, `run.failure` set by `fail-<n>`): `EngineBusy`, `EngineFailure`, `PersistFailure` (the capture is stored, only the database write failed). `failure = null` with `failed` is a refused request (`PolicyDenied`, `InvalidRequest`).
- **Partial with a capture** (`run.status = partial`, `run.complete = false`): `run.errors` lists `BotBlocked`, `Timeout`, `Navigation`, `HttpStatus`, `JourneyStep`, `EngineFailure`, `CmpNotFound` or `ConsentNotApplied`. The Overview counts these in "n of m runs could not finish", including a `CmpNotFound` run on a site with no banner, which is an observation, not a failure.

So the notice's count is not the number of runs worth capturing again. The button says "Retry 3 runs"; the dialog says why the rest are kept.

## Decisions (proposed; the owner may overrule)

1. **A retry is a new full audit, made by `createAudit`.** Origin `{ kind: "retry", auditId }` behaves as a re-run: stored config, baseline = that audit (when it is not a valid baseline, the retry is unavailable and Re-run is the remedy), the same carry-over (`copyCarryOver`: accepted risks, report edits with their origin markers), the cap of five active audits and the one-in-progress-per-baseline guard (a Retry and a Re-run of the same audit exclude each other; the message names both). Because it is a normal audit, chronology by `createdAt`, Compare's `earlierAudits`, re-checks, publication stamps (`readStamp` fingerprints this audit's own `finishedAt`), the cap and the guards all work as they do. No audit is ever reopened.
2. **What is reused and what is recaptured.** For each cell of the original audit (matched by `cellId(cellKeyOf(run, config))` plus the follow host; the new audit's cells come from the same stored config, so they match; a cell the current site declaration no longer produces is simply not in the new audit):
   - **Recaptured:** a run that has no usable capture and is retryable (`failure` EngineBusy or EngineFailure), a partial run whose first load error is retryable (Timeout, EngineFailure, transient Navigation, HttpStatus 429 and 5xx), and a failed run with no capture and no refusal.
   - **Reused:** every run with an intact capture that is not recaptured: complete runs; partial runs whose problem is deterministic (404, DNS, refused, certificate, off-site redirect, `BotBlocked` in v1, `JourneyStep` in v1, `CmpNotFound`, `ConsentNotApplied`); and `PersistFailure` runs (their stored capture is fine).
   - **Recaptured because it cannot be reused:** a refused run (`PolicyDenied`, `InvalidRequest`) has nothing to copy; it is created as a normal run and is refused again at once, which costs one gate turn.
   - A partial capture that is recaptured is not "kept if worse": a new audit records what was observed in it, and the original still holds the earlier partial result as its baseline.
3. **Copy the capture objects, do not reference them.** `reuse-<n>` reads `capture.json` and `screenshot.png` of the source run through `Storage.get` and writes them with `Storage.put` to the new run's own keys (`audits/<newAudit>/runs/<newRun>/...`), so the new audit owns its objects and every reader (`getEvidence`, signed screenshot URLs, `readCaptureTolerant`) keeps working from `run.capture_key` unchanged. Referencing the original's key was rejected: storage has no reference counting, deleting the original audit (or an organization) would break the reused audit's evidence, and storage keys are opaque and generated for exactly one owner. The cost is duplicated storage (a capture is typically hundreds of KB, at most about 10 MB) and one get and one put per reused run, with no browser; no new method on `Storage` (the copy is a `get` then a `put`, written so a replay finds the target with `head` and does nothing).
4. **Reused runs are re-evaluated, not copied as results.** The copied run goes through the existing `persist-<n>`: hits, pushes and check results are derived from the copied capture with the current decoders and `RULES_VERSION`, in the same delete-and-reinsert transaction, with `created_at` = the new run's `finished_at`, which `reuse-<n>` sets to the **source run's** `finished_at` (never `now()`), so a replay writes identical rows. `finish` is unchanged. The audit is judged by one rules version and one decoder version, with no mixed-versions state.
5. **Provenance.** `run.reused_from_run_id uuid null`, with **no foreign key**: it names the run that actually made the capture (if the source was itself reused, the source's own value is copied, so the id is the root and the same capture has the same id in every audit that reuses it). No FK because deleting an audit (cascade to its runs) must stay possible, and the id keeps its meaning as an identity after the source is gone, like `inherited_from_audit_id`. `audit.retry_of_audit_id uuid null` and `audit.retry_of_at timestamptz null` (the original's `created_at`), also no FK, record the origin for display independent of `baseline_audit_id`, which `setBaseline` can move. A reuse that fell back to a normal capture clears `reused_from_run_id` (the run then really was captured in this audit).
6. **Older rules or decoder versions never block reuse.** Because reused captures are re-evaluated under the current rules, an original judged by an older `RULES_VERSION` can still be reused; verdicts that changed between the versions are marked Not comparable by `RULE_CHANGES` against the baseline, which is the existing behaviour for any re-run after a rules bump. The dialog says so ("Zinko's checks changed since this audit; reused results are judged by the current checks"). The one real limit is the capture itself: if the source capture was made by an engine older than what the current rules need, rules would return `inconclusive` for lack of a fact. So reuse is refused (fall back to a normal capture) when the source `run.engine.version` is below `MIN_REUSABLE_ENGINE` (one constant next to `RULES_VERSION`, raised in the same change that makes a rule need a new capture fact, with an entry in the "To add a rule" checklist) or when `decodeStoredCapture` fails.
7. **Missing or unreadable source.** `reuse-<n>` checks, in order: the source run row exists in the same organization and is the retry origin's run; its `capture_key` object exists (`head`); it reads and decodes (`decodeStoredCapture`); its engine version is reusable. Any failure logs the run ids (no content), clears `reused_from_run_id`, and the run continues as a normal run through `admit-<n>` and `capture-<n>`. Storage errors on the copy itself retry with the step's normal policy first. The fallback cost is shown only afterwards (the estimate grows by that run's work; see Decision 9).
8. **Compare treats a reused run as the same observation, never as a fresh one.** Identity is unchanged (`CellKey`); `CellRun` gains `captureId` = `reused_from_run_id ?? run.id`. Rules:
   - Against its baseline (the origin), a reused cell has the same capture, so its verdict is the same under the same rules version: it is **Unchanged**, not "re-confirmed", "repeated" or "seen again". Where the rules version differs the existing `RULE_CHANGES` logic applies first.
   - A **confirmation** (`ConfirmationAudit`, "Seen again when re-checked") exists only for a re-check audit and counts a cell only when its run is a fresh capture (never reused; re-checks are narrow audits and always capture fresh; Task 5 checks it on real data).
   - The **history** logic (regressed, flips over the last five audits, Low confidence "rests on one run") counts observations by `captureId`: two audits that hold the same capture are one observation, so a reused failing cell does not make a persistent failure look confirmed twice, and cannot manufacture "fixed then back" or a flip.
   - **Re-check eligibility** (`recheckPlanOf`, `against`) ignores nothing: a cell that fails in the new audit through a reused capture is still offered for re-check, and the dialog / sheet says "Same capture as the audit of 28 Oct" for such cells, because only a re-check gives a new observation.
   - The Compare summary gains one notice line: "24 of 28 runs reuse captures from the audit of 28 Oct, so they cannot show a change." Score delta rules are unchanged (equivalent scope).
   - Cells that failed in the original and were recaptured are compared by the existing rule "a cell that failed before is never fixed because it is missing, failed to capture or is incompatible": the original side has no usable result for them, so the finding is not marked Fixed or New by them; they appear as cells outside the common scope.
9. **Estimate and progress count only new captures.** The preview and the audit page's estimate use the work units (as `runBreakdown`: a journey run counts as 1 plus its steps, a cross-host run as 2) of runs with `reused_from_run_id` null; a reused run costs a few hundred milliseconds and counts as 0. Progress ("12 of 28 runs") still counts every run, because a reused run is finished once its `persist` commits. A reuse that falls back adds its work units back when it clears the marker, so the estimate can grow by that much and the existing "estimate holds until a unit finishes" rule applies to it. The workflow marks the audit `running` at its first step when it has any reused run (a retry audit is not "queued" while it is already copying), and the usual first-admission update still applies to recaptures.
10. **Admission is unchanged.** Reused runs never call `admit`, `confirm` or `release`; recaptured runs go through `grantFor` and `capture` exactly as today with the audit id as the key, in the same FIFO. The workflow runs the reuse pass first (no engine), then the capture loop. The gate, the busy budget and the turns are untouched.
11. **Report and CSV disclose it.** `ReportModel` version 7 adds `captureSpan`: `{ from, to, reusedRuns, totalRuns, reusedFromDate }` (dates are day-precision strings; `from` and `to` are the min and max of the target runs' `finished_at`; `reusedFromDate` from `audit.retry_of_at`). Scope and method prints "Captured between 28 and 29 Oct 2026. 24 of 28 results were reused from the audit of 28 Oct and judged by today's checks." only when `reusedRuns > 0`; otherwise one line with the date range. A new step in `UPGRADES` (6 to 7) sets `captureSpan` to `null`, rendered as "not recorded in this version". Each leaf (and the object's null path) gets a validator in `LEAF_VALIDATORS`; `ReportView` stays pure. The CSV register (`register-data.ts`, every text cell still through `csvCell`) gets two columns, "Captures from" and "Captures to" (ISO dates), and "Reused results" (a count). No capture text or message column.
12. **Who and when.** Any member (as Re-run), `membership` then the org check on the audit (another organization's id is a 404), a `mutation`. Available for a `full` audit that is `complete`, `partial` or `failed` with at least one reusable run (so a valid baseline), on a non-archived site. When the audit has nothing to recapture ("every run finished" or "nothing here can be retried") there is no button. When a newer full audit of the site exists, the dialog warns: "A newer audit from 29 Oct exists. This retry reuses captures from 28 Oct; Re-run checks the site again." It does not block.

## Schema (one migration)

- `run.reused_from_run_id uuid` (nullable, no FK).
- `audit.retry_of_audit_id uuid` (nullable, no FK) and `audit.retry_of_at timestamptz` (nullable).

Existing rows are valid (null). No backfill. `pnpm --filter @repo/db db:generate`, then `pnpm db:migrate`; never edit generated files. No change to `check_result`, `finding`, `finding_triage` or `report_*`.

## Global constraints

- No unit or integration tests (current phase). Verify by running the real thing (dev server, capture engine, fixture server, the page in a browser) and paste the commands and what was seen.
- `pnpm check && pnpm typecheck && pnpm build` exit 0, zero warnings, after every task.
- Derived rows stay reproducible: no `defaultNow()` or random ids in `hit`, `datalayer_push`, `check_result`, `finding`; a reused run's `created_at` is the source's `finished_at`.
- The workflow never writes triage or `report_*` (`rg "report_|org_branding|finding_triage" apps/web/src/workflows` stays empty). `createAudit` remains the only place an audit row is inserted.
- Every reader still filters `eq(run.role, "target")`; a retry audit has only `target` runs.
- New server functions are registered in `server/entry-points.ts`; no Effect is run outside `read`/`mutation`.
- Keys are generated on the server; the source key is read from the database row, never from client input.
- UI follows `AGENTS.md` and `docs/ui.md` (shared components, 32px targets, focus ring, focus restored in `onCloseAutoFocus`), checked at 390px and 1440px in both themes and in grayscale.

## Tasks

### Task 0: Read the real failures (before any code)

Produce one audit with: the engine stopped after two runs (`EngineBusy`), a fixture page that exceeds the capture timeout (`Timeout`), 404, 503 and 429 pages, an unresolvable host and a refused port (`Navigation`), a `no-cmp` fixture (`CmpNotFound`), a bot-blocked case if a fixture exists, and a forced `persist` failure. For each read `run.status`, `run.failure`, `run.errors`, `run.capture_key`, `run.engine`, `hit_count` and write the observed rows into this plan (a short table, no hit values). Also measure the size of real `capture.json` and screenshot objects and the time of a `get` plus `put` of the largest.

Verify: the table is filled from real rows; the classification in Decision 2 is corrected where wrong (in particular whether a start-page `Navigation` failure is a partial run with a capture).

### Task 1: Classifier

Files: `apps/web/src/lib/run-retry.ts` (new), `apps/web/src/lib/audit-labels.ts`.

- `retryPlanOf(runs)` returns for each run `"reuse" | "recapture"` plus, for the dialog, counts by reason of the runs kept ("the page returned 404 (2)", "blocked as a bot (1)"), using the table in Decision 2 and the same error patterns as `navigationReason` (export `NETWORK_ERRORS` from `audit-labels.ts`; one list).
- `FAILURE_TEXT.EngineBusy` becomes "Zinko was busy" (the action sits next to it).

Verify: `pnpm check` clean; a scratch script (not committed) feeds the Task 0 rows through the function and prints the verdict per row; it matches the table.

### Task 2: Schema and migration

Files: `packages/db/src/audit-schema.ts`, generated migration.

Verify: migration applies; `select reused_from_run_id from run limit 1` is null; existing audits still open.

### Task 3: createAudit origin `retry` and the server functions

Files: `apps/web/src/server/audit-create.ts`, `apps/web/src/server/retry.ts` (new: `previewRetry` read, `retryFailedRuns` mutation), `apps/web/src/server/entry-points.ts`, `apps/web/src/server/audits.ts` (reuse `rerunnable`).

- `CreateAudit.origin` gains `{ kind: "retry"; auditId }`. `baselineFor` treats it as a re-run (`rerunBaseline`, with a retry required to get exactly that audit; otherwise `Invalid`). The in-progress guard is shared and its message names both ("A re-run or retry of this audit is already in progress.").
- New input `reuse: ReadonlyMap<cellId, sourceRunId>` computed by `retry.ts` from the origin's runs with `retryPlanOf` (read in the same org-checked transaction as the baseline). `createAudit` sets `run.reused_from_run_id` (the root id) on the matching planned runs and `audit.retry_of_audit_id`, `audit.retry_of_at`. It refuses a retry with no reused run or no recapture.
- `previewRetry` (same selection, read-only) returns `{ recapture, reuse, kept: [{ why, count }], work, duration, newerAudit, olderChecks, unavailable }`. `retryFailedRuns` runs the start-page preflight like `rerunAudit` (only when something is recaptured), `createAudit`, `launchAudit`.

Verify: on the dev server, preview and start a retry of the Task 0 audit: the new audit row has `baseline_audit_id` = original, `retry_of_audit_id` set, `reused_from_run_id` set exactly on the planned runs; a second click answers the in-progress error; a Re-run while a retry is in progress answers the same; another organization's id is a 404; five active audits give the cap message; accepted risks and report edits of the original appear on the new audit with `inherited_from_*`.

### Task 4: Workflow `reuse-<n>`

Files: `apps/web/src/workflows/Audit.ts` (no payload change).

- `start` also returns `reusedFromRunId` and marks the audit `running` when any run is reused.
- Reuse pass before the capture loop: for each reused run, step `reuse-<ordinal>`: check source, head, get, decode and engine version (Decision 7), `head`-guarded `put` of capture and screenshot to the keys from `keysFor(auditId, runId)`, then one update setting `capture_key`, `screenshot_key` and `finished_at` to the source run's `finished_at`. On success `persist-<ordinal>` follows (the existing step; `settle` is reused); no `admit` or `capture`. On any reuse failure the step returns `Fallback`, clears `reused_from_run_id`, and the run joins the normal loop.
- `persist` and `finish`, the gate and the budget are not changed; round 0 behaviour for non-retry audits is byte-identical.

Verify: (1) With the engine stopped for the capture (kill it after the reuse pass starts), the reused runs still complete: the engine log shows no `POST /capture` for them, the admission log shows no `admit` for them. (2) Rows of a reused run equal a fresh `persist` of the same capture: hash hits, pushes, check results of one reused run, replay `persist-<n>` and hash again: identical, `created_at` equals the source run's `finished_at`. (3) Delete the source `capture.json` from local R2 before the retry: that run falls back, `reused_from_run_id` is cleared, the engine captures it, and the audit completes. (4) Corrupt a source capture: same fallback. (5) Original made under an older `RULES_VERSION` (set the original's `check_result.rules_version` lower by capturing it before a local bump, or run it from a checkout of an older commit): reuse proceeds, the new check results carry the current version, Compare marks changed rules Not comparable. (6) A source engine below `MIN_REUSABLE_ENGINE` falls back. (7) Kill the worker mid-pass and restart: the pass resumes without a second get or put for finished runs.

### Task 5: Compare, history and re-check eligibility

Files: `apps/web/src/lib/compare.ts` (`CellRun.captureId`, the history/flip/confidence logic, `ConfirmationAudit` guard, the summary count), `apps/web/src/server/compare-data.ts` and `apps/web/src/server/recheck-data.ts` (select `run.reused_from_run_id`), `apps/web/src/lib/compare-text.ts`, `apps/web/src/components/compare/{notices,change-sheet}.tsx`, `apps/web/src/components/recheck-dialog.tsx`.

- Implement Decision 8. `captureId` is the identity of an observation for history, flips and confidence; a confirmation counts a cell only when its run's `captureId` equals its own `run.id`.

Verify on the real data: (1) Compare of the retry audit against its original: reused cells are Unchanged, no "Seen again", the notice reads "24 of 28 runs reuse captures ...", recaptured cells are outside the common scope when they were missing before. (2) A failing finding on a reused cell is not shown with raised confidence after a second retry of the retry (two audits, three, hold the same capture): the confidence and "persistent" language do not change. (3) Start a re-check from that finding: the re-check, which captures fresh, shows "Seen again" or "Did not repeat"; before it, the cell says "Same capture as the audit of 28 Oct". (4) A retry of an audit with a newer audit B in between: B vs the retry audit and the retry audit vs the original read correctly in the Compare tab (no stale "What changed").

### Task 6: Estimate and progress

Files: `apps/web/src/lib/audit-labels.ts` (a work-units helper over runs, built on the same constants as `runBreakdown`), `apps/web/src/server/audits.ts` (estimate and progress for a retry audit), `apps/web/src/routes/app/audits/$auditId.tsx`.

Verify: the retry dialog's estimate equals the work of the recaptured runs only; during the retry the audit page shows the reused runs finished within seconds, the estimate does not grow while the queue waits, and grows only when a run falls back (Task 4 test 3), with the estimate line unchanged otherwise.

### Task 7: Report model 7 and CSV

Files: `apps/web/src/lib/report-model.ts` (`REPORT_MODEL_VERSION` 7, schema, `UPGRADES` 6 to 7 setting `captureSpan: null`, `LEAF_VALIDATORS` for every leaf and the null path), `apps/web/src/server/report-data.ts` (read `min/max(run.finished_at)`, `count(reused_from_run_id)` and `audit.retry_of_at` inside the existing read transaction), `apps/web/src/lib/report-projection.ts` (the capture-span sentence helper; the only place the text is built), `apps/web/src/components/report/` (Scope and method; legacy "not recorded in this version"), `apps/web/src/lib/sample-report.ts` (frozen model gets `captureSpan: null` through the upgrade), `apps/web/src/server/register-data.ts` and `REGISTER_COLUMNS`.

Verify: build the report of the retry audit: Scope and method prints the span and the reused count; the report of an ordinary audit prints only the date range; an old published snapshot (version 6) still renders with "not recorded in this version"; publish a version of the retry audit and open the `/r/<token>` page (count the token occurrences as before); download the CSV: the three new columns are right and every text cell still goes through `csvCell` (open it with a formula-prefixed fixture title); `/app/sample-report` still renders.

### Task 8: UI

Files: `apps/web/src/routes/app/audits/$auditId.overview.tsx`, `$auditId.tsx`, `apps/web/src/components/retry-dialog.tsx` (new, modelled on `rerun-dialog.tsx`), `apps/web/src/components/run-sheet.tsx`, `docs/ui.md`.

- **Where.** A secondary "Retry 2 runs" button in the Overview "n of m runs could not finish" notice and in the problem-runs list header; hidden when nothing is recapturable. Re-run stays the only header action. The audit header of a retry audit says "Retry of the audit of 28 Oct" (link), like the baseline line.
- **Dialog.** Title "Retry runs that could not finish". Body: "2 runs, about 40 seconds. The other 26 results are reused from this audit and judged by today's checks. This creates a new audit that is compared with this one." Then, when relevant: the kept runs ("3 runs are not retried: the page returned 404 (2), blocked as a bot (1)."), the older-checks line, the newer-audit warning, and the carry-over preflight shared with Re-run. Refusals (cap of five, in progress, archived) show inside the dialog as an alert. Focus returns to the opener.
- **States.** Settled with recapturable runs: button. Nothing recapturable: no button; the notice may say "Not retried: the page returned 404." Active: hidden. The new audit follows the normal queued, running, partial and complete states; a reused run shows in the run sheet as "Reused from the audit of 28 Oct, captured 28 Oct 14:02" (the source `finished_at`) and a recaptured one has no note.
- **Vocabulary.** "Retry" for runs, "Re-run" for the whole audit, "Re-check" for one rule; never "fixed", "inconclusive" or "clean".

Verify: in the browser at 390px and 1440px, both themes (the real theme menu) and grayscale, no horizontal page scroll: the button and dialog numbers match `previewRetry`; clicking starts the new audit and navigates to it; the run sheet notes work; the cap message shows in the dialog.

### Task 9: Docs and sweep

- `AGENTS.md`: a "Retry (seeded audits)" section under Re-checks (origin `retry` through `createAudit` only; `reused_from_run_id` is the root capture id and has no FK; reuse copies objects, `created_at` from the source `finished_at`, always re-evaluated; fallbacks; admission untouched; Compare counts observations by `captureId`; report model 7).
- `docs/vision.md` (Durable runs, Re-run, Compare, Report rows), `docs/ui.md` (Retry section and vocabulary), `docs/roadmap.md` (remove the F1 leftover), `docs/decisions/0003-capture-admission.md` (one line: reused runs never ask the gate).
- Sweep: retry a retry; retry with a newer audit in between; delete the original audit and confirm the retry's evidence, screenshots and reports still open (the copy decision); organization isolation.
- Final gate: `pnpm check && pnpm typecheck && pnpm build`.

## Alternatives considered (short)

- **Retry in place** (the first version of this plan): rejected after review r1 (chronology, stamps, never-worse, guards, stranded active audits, progress).
- **Narrow audit of the failed cells**: no score, report or Compare; merging results would touch every reader.
- **Reference the source capture instead of copying**: simpler and cheaper, but couples object lifetimes without reference counting; rejected for deletion safety (Decision 3). Revisit only if storage cost turns out to matter (Task 0 measures it).
- **Copy derived rows (hits, check results) instead of re-deriving**: faster, but leaves old-rules verdicts in a new audit and breaks "one audit, one rules version"; rejected.

## Open questions for the owner

1. Is duplicating capture objects acceptable (Decision 3)? Task 0 reports the real sizes.
2. `MIN_REUSABLE_ENGINE` (Decision 6) adds one more thing to remember when a rule needs a new capture fact. Alternative: always reuse and let rules say `inconclusive`. Which?
3. Refused runs (`PolicyDenied`, `InvalidRequest`) are recaptured to get the refusal again. Acceptable, or copy the failure instead?
4. The newer-audit warning does not block a retry. Should it, with Re-run as the only way?
5. Should the original's `BotBlocked` runs get an explicit opt-in retry later (a second checkbox)?
6. Cloud: the `Storage` get and put copy and the engine-less reuse pass are verified locally only; deployed R2 behaviour and Workers memory limits for a 10 MB capture remain unverified.

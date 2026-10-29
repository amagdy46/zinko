---
type: plan
status: proposed
design: ../../vision.md
review: review-r2.md
---

# Retry Failed Runs Plan

**Goal:** "Retry failed runs" on a finished audit creates a new full audit that reuses the original's good captures and captures only the cells that failed for a reason worth retrying (or only re-saves results when the sole problem was the database). The new audit is complete, scored, comparable and reportable like any other, and it says which of its results were captured on which days and which were reused. Demo: an audit of a fixture with the capture engine stopped half way ends Partial with `EngineBusy` runs; after the engine is back, "Retry 4 runs" starts an audit whose other runs finish in seconds without touching the engine, the 4 failed cells go through the capture queue, the new audit ends Complete with the original as its baseline, the report prints the capture date range and "24 of 28 results reused from the audit of 28 Oct", and Compare shows reused cells as unchanged against the original and never as a change against a later audit.

**Approach:** A retry is a re-run with a seeded run list. `createAudit` gets an origin `retry` (same stored config, baseline = the original, everything else as a re-run: carry-over, cap, one in progress per baseline). It resolves, for every cell, the immediate source run in the original audit and snapshots what is needed to copy it onto the new run row. In the `Audit` workflow a reused run takes a crash-safe `reuse-<n>` step that copies the source's capture objects to the new run's own keys, then goes through the existing `persist-<n>`: hits, pushes and check results are rebuilt from the copied capture under the current decoders and `RULES_VERSION`, with `created_at` from the source run's original `finished_at`. Reused runs never ask the capture gate. A reuse that cannot be done falls back to a normal capture. Compare gets an explicit chronology rule for observations older than the thing they are compared with. The report and the CSV disclose capture dates and reuse. Three nullable columns on `run` and two on `audit`, one migration, a report model bump.

**Effort (honest, after review r2):** about 16 to 20 working days (3.5 to 4 weeks) for tasks 0 to 11, plus 1 to 2 days for the deployed smoke gate (Task 12) when deployment is unblocked. The previous 7 to 9 days was optimistic: the copy protocol with crash probes is about 3 days, the Compare chronology about 3 to 4 plus 1.5 for presentation, and the report model, CSV and every reader of the new states add up. See the table in Tasks.

Design sources: `AGENTS.md` (Database, Capture admission, Re-checks, Compare, Report), `docs/vision.md`, `docs/roadmap.md` ("Left over from UX round 6 (F1)"), `docs/decisions/0003-capture-admission.md`, `docs/ui.md`, `review-r1.md`, `review-r2.md`. Code read: `apps/web/src/server/{recheck,audit-create,audits,admission,storage,compare-data,report-data,register-data}.ts`, `apps/web/src/workflows/Audit.ts`, `apps/web/src/lib/{compare,findings-from,audit-labels,report-model}.ts`, `packages/db/src/audit-schema.ts`, `packages/core/src/storage.ts`, `packages/capture-contract/src/index.ts`.


> Note (2026-10-29): report model 7 has since been used for the summary's named check gaps. Read "model 7" below as the next free `REPORT_MODEL_VERSION` at build time, with every earlier version kept in the accepted list.

## Changes after review r1

The verdict was "rethink". In-place retry is dropped; its P1 problems (chronology, stamps, worse-than-before results, guards, stranded active audits, progress) do not exist for a new audit. This plan is the review's alternative: a new full audit seeded with reusable captures. Adopted: BotBlocked excluded in v1, all captures re-evaluated under the current rules with provenance disclosed, report and CSV disclose the capture range and reuse, any member may retry, single-run retry deferred, the one-in-progress-per-baseline rule is the cap.

## Changes after review r2

Verdict "ready after fixes". All eight findings are resolved:

1. **Chronology (P1).** Decision 8 now gives the exact rule for an observation older than the one it is compared with, per change kind, and names the readers that change; the comparison stamp, history windows, tag diffs and re-checks made in between are covered. Task 6 starts by reproducing the reviewer's probe (A fails, B passes, retry C reuses A's capture) on real data.
2. **Copy source (P1).** The source is the immediate run in `retry_of_audit_id` found by `CellKey`; `reused_from_run_id` is capture identity only and may not exist.
3. **Crash safety (P1).** Decision 7 is a protocol (durable snapshot, screenshot then capture, recovery of a complete destination before the source is needed, partial destinations deleted before a fallback, exhausted step errors settled), with a crash probe at every boundary in Task 4.
4. **`MIN_REUSABLE_ENGINE` (P1)** is replaced by a Zinko-owned `CAPTURE_FORMAT` stamped into every stored capture (Decision 6).
5. **Report model (P1).** Version 6 stays explicitly in the accepted versions; validators live in `report-projection.ts`; the sample model is updated by hand (Task 9).
6. **Same capture is not automatically Unchanged (P2).** Compatibility checks stay; reinterpretation is separated from a site change (Decision 8).
7. **Eligibility (P2).** A persistence-only retry (zero browser) is eligible; failed or unevaluated origins are excluded in v1 (Decision 12).
8. **Range and CSV (P2).** The capture range reads only runs that own captures, in UTC days, with durable wording; every CSV value goes through `csvFile`/`csvCell` on ordinary and fixed rows (Decision 11).

Also adopted from the answers: duplicate the objects (Task 0 measures capture and screenshot sizes), refused runs keep the ordinary path in v1, the newer-audit warning stays non-blocking now that chronology is fixed, the BotBlocked opt-in is deferred, Task 4 and Task 5 are split, and a deployed smoke gate is the last task, marked blocked.

## What a "failed run" is today

- **Failed without a result** (`run.status = failed`, `run.failure` set by `fail-<n>`): `EngineBusy`, `EngineFailure`, `PersistFailure` (the capture is stored, only the database write failed; `run.engine` is null for it). `failure = null` with `failed` is a refused request (`PolicyDenied`, `InvalidRequest`). `fail-<n>` sets `finished_at` even though there is no capture.
- **Partial with a capture** (`run.status = partial`, `run.complete = false`): `run.errors` lists `BotBlocked`, `Timeout`, `Navigation`, `HttpStatus`, `JourneyStep`, `EngineFailure`, `CmpNotFound` or `ConsentNotApplied`. The Overview counts these in "n of m runs could not finish", including a `CmpNotFound` run on a site with no banner, which is an observation, not a failure.

So the notice's count is not the number of runs worth capturing again. The button says "Retry 3 runs"; the dialog says why the rest are kept.

## Decisions (proposed; the owner may overrule)

1. **A retry is a new full audit, made by `createAudit`.** Origin `{ kind: "retry", auditId }` behaves as a re-run: stored config, baseline = that audit, the same carry-over (`copyCarryOver`), the cap of five active audits and the one-in-progress-per-baseline guard (a Retry and a Re-run of the same audit exclude each other; the message names both). Because it is a normal audit, chronology by `createdAt`, re-checks, publication stamps (`readStamp` fingerprints this audit's own `finishedAt`), the cap and the guards work as they do. No audit is ever reopened.
2. **What is reused and what is recaptured.** Cells are matched by `cellId(cellKeyOf(run, config))` plus the follow host.
   - **Recaptured:** a run with no usable capture and a retryable failure (`EngineBusy`, `EngineFailure`); a partial run whose first load error is retryable (Timeout, EngineFailure, transient Navigation, HttpStatus 429 and 5xx).
   - **Reused:** every run with an intact capture that is not recaptured: complete runs; partial runs with a deterministic problem (404 and other 4xx, DNS, refused, certificate, off-site redirect, `BotBlocked`, `JourneyStep`, `CmpNotFound`, `ConsentNotApplied`); and `PersistFailure` runs (the stored capture is fine; reusing it is the persistence-only repair).
   - **Ordinary path:** a refused run (`PolicyDenied`, `InvalidRequest`) has nothing to copy; it is created as a normal run and is refused again at once.
   - A recaptured partial run is not "kept if worse": a new audit records what was observed in it, and the original still holds the earlier result as its baseline.
3. **Copy the capture objects from the immediate source; do not reference.** The source of a cell is found through `audit.retry_of_audit_id` plus the cell's `CellKey` in that audit (never through `reused_from_run_id`). Its `capture_key` and `screenshot_key` are what is copied; if the source itself was reused, those are its own copies, so the chain never needs the root. `reuse-<n>` reads them with `Storage.get` and writes the new run's own keys (`audits/<newAudit>/runs/<newRun>/...`) with `Storage.put`, so the new audit owns its objects and every reader keeps working from `run.capture_key`. Referencing was rejected: no reference counting, and deleting the original audit would break the retry's evidence. The cost is duplicated storage; Task 0 measures real capture and screenshot sizes. No new `Storage` method.
4. **Reused runs are re-evaluated, not copied as results.** The copied run goes through the existing `persist-<n>` with current decoders and `RULES_VERSION`; `created_at` = the new run's `finished_at`, which `reuse-<n>` sets to the **source's** `finished_at` (never `now()`), so a replay writes identical rows. `finish` is unchanged. The audit is judged by one rules version and one decoder version.
5. **Provenance (columns).**
   - `run.reused_from_run_id uuid null`, no FK: the **root** run that made the capture (`source.reused_from_run_id ?? source.id`). Capture identity only; the row it names may not exist.
   - `run.reuse_plan jsonb null`: written by `createAudit` in its transaction from the source row: `{ sourceRunId, captureKey, screenshotKey, finishedAt, captureFormat }`. This is the durable snapshot the copy step uses, so a replay never re-resolves a source that may have changed. Cleared on fallback.
   - `audit.retry_of_audit_id uuid null` and `audit.retry_of_at timestamptz null` (the original's `created_at`), no FK, independent of `baseline_audit_id`.
   - A fallback clears `reused_from_run_id` and `reuse_plan` (the run then really was captured in this audit).
6. **A Zinko-owned capture format, not engine strings.** `CAPTURE_FORMAT` (an integer in `@repo/capture-contract`) is written into `capture.json` by the `capture` step (an optional field of the stored capture schema; captures stored before it are format 1). `MIN_REUSABLE_FORMAT` (next to it) is the oldest format whose facts the current rules and decoders need. It is raised, together with `CAPTURE_FORMAT`, in the same change that makes a rule or decoder need a fact the capture did not previously carry; this goes into the "To add a rule" checklist in `AGENTS.md`. The check reads the stored capture's own field after decoding it (so a `PersistFailure` run, whose `run.engine` is null, works), never a third-party engine or library version. A reuse below the minimum falls back to a normal capture. Older `RULES_VERSION` or decoder versions never block reuse: captures are re-evaluated, and rules whose verdict can differ are marked Not comparable against the original by `RULE_CHANGES`.
7. **Crash-safe copy protocol (`reuse-<n>`).** One step per reused run, all of it idempotent:
   1. Read the run. If `capture_key` is set and both destination objects exist (`head`; the screenshot only if the plan names one) and `finished_at` equals `plan.finishedAt`: the destination is complete, return `Reused` without touching the source (recovery after a crash after the row update).
   2. Otherwise check the source from the plan: `head` of the capture and screenshot, `get`, `decodeStoredCapture`, `captureFormat >= MIN_REUSABLE_FORMAT`. Any failure, or a source run/object that is gone, goes to the fallback.
   3. Copy the screenshot first, then `capture.json` last (the invariant `capture` already relies on: a stored `capture.json` means its screenshot is stored). `head` both afterwards and compare sizes with the source.
   4. One row update: `capture_key`, `screenshot_key`, `finished_at = plan.finishedAt`, nothing else. Then `persist-<n>` (existing).
   5. Fallback order: delete the destination objects (idempotent), then clear `reused_from_run_id` and `reuse_plan` in one update, then the run joins the normal `admit` and `capture` loop. Deleting first matters because `capture()` trusts an existing `capture.json` at its key; if the process dies between the two, the replay finds the plan still set and repeats the fallback.
   6. Storage and database errors retry under the normal step policy; if the step is exhausted, a `reuse-fallback-<n>` step runs the fallback; if that is exhausted too, `fail-<n>` records the run with a new failure `ReuseFailure` ("Results could not be copied", in `FAILURE_TEXT`), the audit goes on and the run is retryable by the next retry.
8. **Compare: the exact chronology rule.** Definitions. Every `CellRun` gets `captureId` (`reused_from_run_id ?? run.id`) and `observedAt` (the `finished_at` of the run that owns the capture; a reused run keeps the source's; runs without a capture, such as `fail-<n>`, have none and are "missing" as today). For a comparison of `now` (the audit shown) against `before`, per cell present on both sides:
   - **same**: `captureId` equal. One observation seen twice. Not a change and not evidence of persistence.
   - **older**: different `captureId` and `now.observedAt < before.observedAt`. The audit shown holds an observation older than the one it is compared with. It must not imply a new failure, a fix, a regression or a persistent failure.
   - **fresh**: anything else (different capture, `now.observedAt >= before.observedAt`).
   
   Cells of class older are left out of `commonCells` and listed with a new resolution `older_observation` ("Captured before the audit it is compared with"). Cells of class same stay common. Then the existing machinery decides, with these consequences per change kind:
   - **New / Regressed** (fails now, did not fail before): a failing cell that is older is not counted among `fresh` or `failsNowCommon`. If no failing cell remains, the finding is Not comparable with reason `older_observation` ("These results were captured on 28 Oct, before the 29 Oct audit it is compared with, so they cannot show a new problem."). This is the reviewer's probe: C (retry of A) against B no longer reports Regressed.
   - **Fixed** (failed before, passes now): a passing cell that is older is `older_observation`, not `pass`. It cannot fix a failure observed later. If every cell that settles the finding is older the state is Not comparable `older_observation`; if some cells are fresh and pass, the existing logic applies to those and the older ones are counted in `partly_rechecked` as today's `missing` cells are.
   - **Unchanged** (fails before and now): older failing cells do not count as "still fails". Unchanged requires at least one fresh or same failing cell on a comparable pair; a same-capture failing cell does count (it is the original's own observation), so a retry compared with its original keeps "Unchanged". If every failing cell is older: Not comparable `older_observation`. Spread (`narrowed`, `widened`, `moved`) is computed on non-older cells only.
   - **Verdict changed** (to or from Could not check): cells that are older are excluded; if nothing is left the finding is not listed.
   - **Not comparable** reasons that exist today (rule changed/added/removed, no shared scope, partly rechecked) keep their precedence over `older_observation`.
   - **Reinterpreted** (finding 6): a **same**-capture cell whose stored verdict differs (current decoder or rules re-evaluated the copy; the original's rows keep their old rules version) is never a Fixed/New/Regressed: it gets resolution `reinterpreted` and, when it would decide the state, Not comparable `reinterpreted` ("Judged again by newer checks"). This separates a site change from a reading change. The existing compatibility checks stay: `compatDiffers` (consent class, and banner detection, which is derived from sibling runs and may differ when siblings were recaptured), `ruleChanged`, `decoderVersionsDiffer`, changed measured hosts (a cross-host cell the site no longer declares is outside scope, as today).
   - **History windows.** `earlierFailureOf` skips a witness with the same `captureId` as the current or the baseline cell, and counts a witness only if `witness.observedAt < baseline cell.observedAt`; `flipsOf` builds each cell's answers sequence ordered by `observedAt`, one answer per `captureId` (a capture held by several audits counts once), so reuse can neither create nor hide a flip, and "fixed then back" cannot come from one capture.
   - **Confirmations (re-checks).** A re-check counts for a cell only if its run's `captureId` differs from the audit cell's and its `observedAt` is later than the audit cell's. A re-check made between the original capture and the retry therefore confirms a reused cell ("Re-check, 29 Oct: did not repeat") and is dated; a re-check older than the reused capture is ignored. Reused cells are offered for re-check (`recheckPlanOf` is unchanged) and shown as "Same capture as the audit of 28 Oct" until a re-check exists.
   - **Tags.** `tagSideOf`/`diffTags` take the same per-cell classes: a tag seen only in an older observation is not "New", and one missing only from an older observation is not "Disappeared"; same-capture cells compare equal; the "runs compared" figure counts only non-older cells.
   - **Score.** `scoreDeltaOf` shows no delta when any cell is older ("Some results are older than the audit compared with") and the existing notice lists the counts.
   - **Stamp.** `comparisonStampOf` fingerprints, for the audit and every audit or re-check the comparison read, the target runs' `(run id, captureId, observedAt)` in addition to what it reads today, so a report built before a change in reuse state is detected.
   - **Readers that change:** `lib/compare.ts` (`CellRun`, `compareAudits`, `earlierFailureOf`, `flipsOf`, `confirmationOf`, `Comparability`, `scoreDeltaOf`, tag diff), `server/compare-data.ts` (run selects, history and confirmation loaders, `comparisonStampOf`, `tagSideOf`), `server/recheck-data.ts` (the cells' labels only), `lib/compare-text.ts`, `components/compare/{summary,notices,findings-table,change-sheet}.tsx`, and the report's `changes` section projection in `lib/report-projection.ts` (new reasons need wording and validators). Readers outside Compare (Overview, Findings, matrix, Hits) are unchanged: they read one audit.
9. **Estimate and progress count only new captures.** The preview and the audit page's estimate use the work units (a journey run counts 1 plus its steps, a cross-host run 2, as `runBreakdown`) of runs whose `reuse_plan` is null; a reused run costs a few hundred milliseconds and counts 0. Progress ("12 of 28 runs") counts every run; a reused run is finished once its `persist` commits. A fallback adds that run's work back, so the estimate can grow by that much, and the existing "estimate holds until a unit finishes" rule applies. The workflow marks the audit `running` at its first step when it has a reused run.
10. **Admission is unchanged.** Reused runs never call `admit`, `confirm` or `release`; recaptured runs use `grantFor` and `capture` exactly as today, with the audit id as key, in the same FIFO. The reuse pass runs first (no engine), then the capture loop.
11. **Report and CSV disclose it.** `ReportModel` version 7 adds `captureSpan`: `{ from, to, reusedRuns, totalRuns, reusedFromDate }`.
    - `from` and `to` are the min and max `finished_at` of target runs that **own a capture** (`capture_key is not null`; runs settled by `fail-<n>` have a `finished_at` but no capture and are excluded), as UTC calendar days (`YYYY-MM-DD`); `reusedFromDate` is the UTC day of `audit.retry_of_at`.
    - Durable wording, built only in `lib/report-projection.ts`: "Captured between 28 Oct 2026 and 29 Oct 2026 (UTC). 24 of 28 results were reused from the audit of 28 Oct 2026 and judged by the checks of this report." No "today", "yesterday" or relative dates. Without reuse, one line with the range.
    - `REPORT_MODEL_VERSION` becomes 7, and the accepted versions are written out as `Schema.Literals([1, 2, 3, 4, 5, 6, 7])`, so 6 is explicitly kept. `UPGRADES[6]` sets `captureSpan: null`, rendered as "Not recorded in this version". Every leaf of `captureSpan` (and the null path of the object) gets a validator in `LEAF_VALIDATORS`, which lives in `lib/report-projection.ts`. The frozen sample model in `lib/sample-report.ts` is edited by hand to `modelVersion: 7` with `captureSpan: null`.
    - CSV register: three columns "Captures from", "Captures to" (ISO day) and "Reused results" (count), on ordinary and Fixed rows alike; every cell goes through `csvCell` inside `csvFile`. No capture text or message column.
12. **Who, when.** Any member (as Re-run); `membership`, then the org check on the audit (another organization's id is a 404); a `mutation`. Eligible origin in v1: a `full` audit with status `complete` or `partial` that is evaluated (has check results), on a non-archived site. A `failed` or unevaluated origin is excluded in v1 (it cannot be a valid baseline and has little to reuse); Re-run is the remedy. Within an eligible origin, a retry is offered when at least one run is recapturable **or** is a persistence-only repair (`PersistFailure`); a retry with zero recaptures runs no browser at all and finishes in seconds. When a newer full audit of the site exists the dialog warns ("A newer audit from 29 Oct exists. This retry reuses captures from 28 Oct, so it cannot show changes since then; Re-run checks the site again.") and does not block; Decision 8 is what makes that safe.

## Schema (one migration)

- `run.reused_from_run_id uuid` (nullable, no FK), `run.reuse_plan jsonb` (nullable).
- `audit.retry_of_audit_id uuid` (nullable, no FK), `audit.retry_of_at timestamptz` (nullable).

Existing rows are valid (null). No backfill. `pnpm --filter @repo/db db:generate`, then `pnpm db:migrate`; never edit generated files. No change to `check_result`, `finding`, `finding_triage` or `report_*`. `CAPTURE_FORMAT` is a code constant and an optional field of the stored capture; no migration for it.

## Global constraints

- No unit or integration tests (current phase). Verify by running the real thing (dev server, capture engine, fixture server, the page in a browser) and paste the commands and what was seen.
- `pnpm check && pnpm typecheck && pnpm build` exit 0, zero warnings, after every task.
- Derived rows stay reproducible: no `defaultNow()` or random ids in `hit`, `datalayer_push`, `check_result`, `finding`; a reused run's `created_at` is the source's `finished_at`.
- The workflow never writes triage or `report_*` (`rg "report_|org_branding|finding_triage" apps/web/src/workflows` stays empty). `createAudit` remains the only place an audit row is inserted.
- Every reader still filters `eq(run.role, "target")`; a retry audit has only `target` runs.
- New server functions are registered in `server/entry-points.ts`; no Effect is run outside `read`/`mutation`. Storage keys are generated on the server; a source key is read from a database row, never from client input.
- UI follows `AGENTS.md` and `docs/ui.md` (shared components, 32px targets, focus ring, focus restored in `onCloseAutoFocus`), checked at 390px and 1440px in both themes and in grayscale.

## Tasks

| Task | What | Days |
|---|---|---|
| 0 | Read real failures, measure object sizes, reproduce the chronology probe | 1 |
| 1 | Classifier | 0.5 |
| 2 | Schema, migration, `CAPTURE_FORMAT` | 1 |
| 3 | `createAudit` origin `retry`, server functions | 2 |
| 4 | Copy recovery protocol (`reuse-<n>`) with crash probes | 3 |
| 5 | Workflow integration (pass order, admission, `running`, estimate hooks) | 1.5 |
| 6 | Compare chronology engine | 3.5 |
| 7 | Compare presentation (text, notices, sheets, tags, report `changes`) | 1.5 |
| 8 | Estimate and progress | 1 |
| 9 | Report model 7 and CSV | 2 |
| 10 | UI | 1.5 |
| 11 | Docs and sweep | 1.5 |
| 12 | Deployed smoke gate (blocked: deployment on hold) | 1 to 2 |

Total 19.5 days at the top of each range for tasks 0 to 11 (16 at the bottom with no rework); plan on 16 to 20.

### Task 0: Read real failures; measure; reproduce the probe

- Produce one audit with: the engine stopped after two runs (`EngineBusy`), a fixture page that exceeds the capture timeout, 404, 503 and 429 pages, an unresolvable host and a refused port, a `no-cmp` fixture (`CmpNotFound`), a bot-blocked case if a fixture exists, and a forced `persist` failure. For each read `run.status`, `run.failure`, `run.errors`, `run.capture_key`, `run.engine`, `hit_count`, `finished_at`; put the observed table in this plan (no hit values). Correct Decision 2 where it is wrong (in particular whether a start-page `Navigation` failure is partial with a capture).
- Measure the sizes of real `capture.json` and screenshot objects, and the time of a `get` plus `put` of the largest.
- Reproduce review r2's probe in the database: audit A with a failing cell, later audit B that passes it, then insert a retry-like audit C (hand-built rows with `reused_from_run_id`) and note what Compare says today (Regressed). Keep the three audit ids as the Task 6 fixture.

Verify: the tables and the probe result are in this plan.

### Task 1: Classifier

Files: `apps/web/src/lib/run-retry.ts` (new), `apps/web/src/lib/audit-labels.ts` (export `NETWORK_ERRORS`; `FAILURE_TEXT.EngineBusy` becomes "Zinko was busy"; add `ReuseFailure`).

`retryPlanOf(runs)` returns per run `reuse | recapture | ordinary` plus counts by reason of runs kept ("the page returned 404 (2)"), and `persistOnly` (runs that are `PersistFailure`). Same error patterns as `navigationReason`.

Verify: `pnpm check` clean; a scratch script (not committed) feeds the Task 0 rows through it; the verdicts match Decision 2.

### Task 2: Schema, migration, capture format

Files: `packages/db/src/audit-schema.ts`, generated migration, `packages/capture-contract/src/index.ts` (`CAPTURE_FORMAT`, `MIN_REUSABLE_FORMAT`, optional `captureFormat` in the stored capture schema), `apps/web/src/workflows/Audit.ts` (the `capture` step writes it), `AGENTS.md` rule checklist line.

Verify: migration applies; a new fixture capture has `captureFormat` in its stored `capture.json`; older stored captures still decode and read as format 1; existing audits still open.

### Task 3: createAudit origin `retry` and the server functions

Files: `apps/web/src/server/audit-create.ts`, `apps/web/src/server/retry.ts` (new: `previewRetry` read, `retryFailedRuns` mutation), `apps/web/src/server/entry-points.ts`, `apps/web/src/server/audits.ts` (reuse `rerunnable`).

- `CreateAudit.origin` gains `{ kind: "retry"; auditId }`; `baselineFor` treats it as a re-run and requires the origin itself to be a valid baseline (Decision 12). The guard message names both.
- In the same transaction as the baseline read, `retry.ts` resolves the immediate source run of each reusable cell (origin audit + `CellKey`), and `createAudit` writes `reused_from_run_id` (root), `reuse_plan` and `audit.retry_of_*`. No storage access in the transaction.
- `previewRetry`: `{ recapture, reuse, persistOnly, kept: [{ why, count }], work, duration, newerAudit, olderChecks, unavailable }`. `retryFailedRuns`: preflight of the start page only when something is recaptured, `createAudit`, `launchAudit`.

Verify: on the dev server, preview and start a retry of the Task 0 audit: `baseline_audit_id`, `retry_of_audit_id`, `reused_from_run_id` and `reuse_plan` are as planned; a persistence-only audit (one `PersistFailure` run, nothing else) is offered and starts; a `failed` origin is refused; a second click and a Re-run both answer the in-progress error; another organization's id is a 404; the cap message shows with five active audits; carry-over rows appear with `inherited_from_*`.

### Task 4: Copy recovery protocol

Files: `apps/web/src/workflows/Audit.ts` (the `reuse` step, `reuse-fallback`, `fail` reason `ReuseFailure`).

Implement Decision 7 exactly. Nothing else in the workflow changes in this task (Task 5 wires the order).

Verify, by crashing the real worker (kill the process, restart, let the workflow resume) at each boundary, then reading storage and the run row:
1. After the screenshot is written, before `capture.json`: replay re-copies, no duplicate state, final row correct.
2. After `capture.json`, before the row update: replay completes; `finished_at` equals the source's.
3. After the row update, before `persist`: replay returns `Reused` from the destination without reading the source (delete the source object first to prove it).
4. Source `capture.json` deleted before the step: fallback; destination objects absent; `reused_from_run_id` and `reuse_plan` null; the engine captures the run.
5. Crash between the fallback's object delete and its row update: replay finishes the fallback.
6. Corrupt source capture and source with `captureFormat` below the minimum: fallback.
7. A partial destination (only a screenshot) planted before the step: not trusted by `capture()` after a fallback.
8. Force the copy step to exhaust its retries: `reuse-fallback` runs; force that to exhaust: the run is `failed` with `ReuseFailure`, the audit finishes.
9. Hash hits, pushes and check results of a reused run, replay `persist-<n>`, hash again: identical, `created_at` equals the source `finished_at`.

### Task 5: Workflow integration

Files: `apps/web/src/workflows/Audit.ts`.

- `start` returns each run's `reuse_plan` presence; sets the audit `running` when any run is reused.
- Reuse pass first (`reuse-<n>`, then `persist-<n>`), then the existing capture loop over the rest (and over fallbacks). Round 0 behaviour of audits without reused runs is byte-identical.
- Admission is not touched.

Verify: with the capture engine stopped after the reuse pass starts, the reused runs still complete; the engine log has no `POST /capture` and the admission log no `admit` for them; the recaptured runs queue and capture as before; a persistence-only retry completes with the engine stopped throughout; a normal full audit's step names and results are unchanged.

### Task 6: Compare chronology engine

Files: `apps/web/src/lib/compare.ts`, `apps/web/src/server/compare-data.ts`, `apps/web/src/server/recheck-data.ts`.

Implement Decision 8 up to the stamp: `captureId` and `observedAt` on `CellRun` (selected from `run.reused_from_run_id`, `run.finished_at` where `capture_key is not null`), the three cell classes, `older_observation` and `reinterpreted` resolutions and reasons, history and flips by capture, confirmations by capture and time, tag diff classes, score rule, `comparisonStampOf`.

Verify with real data, from the Task 0 fixture: (1) C against B (the probe) is Not comparable `older_observation` where it was Regressed; (2) C against A: reused failing cells are Unchanged, recaptured cells outside scope when missing before, and no "Seen again" without a re-check; (3) a re-check R made between A and C: C shows R's verdict dated, and an R older than the reused capture is ignored; (4) A retry of a retry (C then D, three audits, one capture): history and flips count the capture once, no Low confidence change; (5) a same-capture cell re-judged under a newer rules version: `reinterpreted`, never Fixed; (6) tags: a tag present only in the older observation is neither New nor Disappeared; (7) change the reuse state of a cell and confirm the comparison stamp changes (a report built before is refused for publication); (8) the 168-run pair still gives the same comparison as before for audits with no reuse (diff the JSON).

### Task 7: Compare presentation

Files: `apps/web/src/lib/compare-text.ts`, `apps/web/src/components/compare/{summary,notices,findings-table,change-sheet}.tsx`, `apps/web/src/components/recheck-dialog.tsx`, `apps/web/src/lib/report-projection.ts` (the `changes` section wording and validators for the new reasons).

- Words: `older_observation` ("Captured before the audit it is compared with"), `reinterpreted` ("Judged again by newer checks"), the notice "24 of 28 runs reuse captures from the audit of 28 Oct, so they cannot show a change", "Same capture as the audit of 28 Oct" in the sheet and the re-check dialog, no score delta line with its reason.
- Each is a glyph and a word (neutral, not colour alone).

Verify in the browser at both widths and themes with the Task 6 fixtures: the three audits show the wording of Decision 8; the report's changes section renders the new reasons and the validators accept them.

### Task 8: Estimate and progress

Files: `apps/web/src/lib/audit-labels.ts` (work units over runs, on the same constants as `runBreakdown`), `apps/web/src/server/audits.ts`, `apps/web/src/routes/app/audits/$auditId.tsx`.

Verify: the dialog's estimate equals the recaptured runs' work; during a real retry reused runs finish within seconds, the estimate does not grow while the queue waits, and grows only on a fallback (Task 4, probe 4).

### Task 9: Report model 7 and CSV

Files: `apps/web/src/lib/report-model.ts` (version 7, literals `1..7` written out, `UPGRADES[6]`), `apps/web/src/lib/report-projection.ts` (sentence helper, `LEAF_VALIDATORS`), `apps/web/src/server/report-data.ts` (capture range query on runs that own captures, UTC days, reused count, `retry_of_at`), `apps/web/src/components/report/` (Scope and method; legacy line), `apps/web/src/lib/sample-report.ts` (edited by hand), `apps/web/src/server/register-data.ts`.

Verify: a retry audit's report prints the range and reuse sentence (no relative dates); an ordinary audit prints only the range; a failed run with `fail-<n>` `finished_at` does not widen the range (set one on a fixture); a published version 6 snapshot still decodes and renders "Not recorded in this version"; publish a version of the retry audit and open `/r/<token>` (count token occurrences as before); the CSV has the three columns on an ordinary and a Fixed row, and a formula-prefixed value still goes through `csvCell`; `/app/sample-report` renders.

### Task 10: UI

Files: `apps/web/src/routes/app/audits/$auditId.overview.tsx`, `$auditId.tsx`, `apps/web/src/components/retry-dialog.tsx` (new, modelled on `rerun-dialog.tsx`), `apps/web/src/components/run-sheet.tsx`, `docs/ui.md`.

- A secondary "Retry 2 runs" button in the Overview "n of m runs could not finish" notice and in the problem-runs list header; for a persistence-only case the label is "Save results again". Re-run stays the only header action. A retry audit's header says "Retry of the audit of 28 Oct" with a link.
- Dialog: "Retry runs that could not finish". "2 runs, about 40 seconds. The other 26 results are reused from this audit and judged by today's checks. This creates a new audit that is compared with this one." Then, when relevant: kept runs by reason, the older-checks line, the non-blocking newer-audit warning, the carry-over preflight. Refusals show inside the dialog. Focus returns to the opener.
- States: nothing recapturable: no button; the notice may say "Not retried: the page returned 404." Active: hidden. Failed or unevaluated origin: no button. Run sheet: "Reused from the audit of 28 Oct 2026, captured 28 Oct 2026 14:02 UTC".
- Vocabulary: "Retry" for runs, "Re-run" for the audit, "Re-check" for one rule; never "fixed", "inconclusive" or "clean".

Verify: in the browser at 390px and 1440px, both themes, grayscale: numbers match `previewRetry`; clicking starts the audit and navigates to it; run sheet notes; cap message in the dialog.

### Task 11: Docs and sweep

- `AGENTS.md`: a "Retry (seeded audits)" section under Re-checks (origin `retry` only through `createAudit`; immediate source by `retry_of_audit_id` + `CellKey`; `reused_from_run_id` is capture identity without FK; the copy protocol; `CAPTURE_FORMAT` / `MIN_REUSABLE_FORMAT` and the checklist line; Compare's three cell classes; report model 7). `docs/vision.md` (Durable runs, Re-run, Compare, Report), `docs/ui.md`, `docs/decisions/0003-capture-admission.md` (reused runs never ask the gate), `docs/roadmap.md` (replace the F1 leftover with the shipped note when built).
- Sweep: retry a retry; retry with a newer audit in between; delete the original audit and confirm the retry's evidence, screenshots and reports still open; organization isolation.
- Final gate: `pnpm check && pnpm typecheck && pnpm build`.

### Task 12: Deployed smoke gate (blocked: deployment on hold)

Not started until deployment is unblocked; the feature is not "done" for the cloud before it passes. On the deployed Worker and R2, with real containers:
- Large copies: reuse of the biggest capture and screenshot from Task 0 (about 10 MB) without a Worker memory or time failure; note the elapsed time per copy and the number of reused runs per audit that fits the step limits.
- Replay after interruption: terminate a retry workflow mid-pass and let Cloudflare resume it; storage and rows match Task 4's expectations.
- Deletion independence: delete the original audit (and the cascade) and confirm the retry's captures, screenshots, evidence and report still load.
- Admission: recaptured runs queue on the containers while reused runs never call the gate; instance id of the retry workflow is the plain audit uuid.

Verify: the commands and observed numbers are pasted here; any failure reopens Tasks 4 or 5.

## Alternatives considered (short)

- **Retry in place** (first version of this plan): rejected after review r1.
- **Narrow audit of the failed cells**: no score, report or Compare; merging results would touch every reader.
- **Reference the source capture instead of copying**: cheaper, but couples object lifetimes without reference counting; revisit only if Task 0 shows storage cost matters.
- **Copy derived rows instead of re-deriving**: leaves old-rules verdicts in a new audit; rejected.
- **Always reuse and let rules say inconclusive instead of a capture format**: hides the cause and degrades results silently; rejected in favour of `CAPTURE_FORMAT`.

## Open questions for the owner

1. Duplicated capture objects are accepted (reviewer's answer); the size numbers from Task 0 go back to you before Task 4 starts.
2. Who owns bumping `CAPTURE_FORMAT` when a rule starts to need a new fact? The plan puts a line in the "To add a rule" checklist; is that enough?
3. The newer-audit warning is non-blocking. Keep it that way once Task 6 is verified?
4. `ReuseFailure` is a new failure word on a run. Acceptable, or fold it into `PersistFailure`?
5. BotBlocked opt-in retry and single-run retry stay deferred.
6. Cloud behaviour (Task 12) is unverified until deployment is unblocked.

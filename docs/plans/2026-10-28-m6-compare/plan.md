---
type: plan
status: proposed
design: ../../vision.md
---

# M6 Compare and Polish Plan

**Goal:** A consultant re-runs an audit with one click, opens a Compare tab and sees, finding by finding and tag by tag, what changed since the last audit of the same site: what was fixed (verified by the re-run, not just marked), what is new, what regressed after a fix, what can no longer be checked, and what cannot be compared at all and why. Accepted risks and notes carry over. A short "What changed" briefing leads the re-run's Overview and the client report. Then the product is releasable: empty and partial states are swept, the README and a self-host guide are true, a deploy to a real Cloudflare account has been tried, and a read-only public demo exists. Demo: "v0.1 release: a Show HN post and a 'we audited N sites' write-up" (`docs/roadmap.md`, M6).
**Approach:** A comparison is a **pure function of two audits' derived rows, computed on read**. Nothing about a comparison is stored except two human acts: the **baseline link** (`audit.baseline_audit_id`, set when an audit is created from a re-run or the New audit form, changeable by the consultant) and the **carried-over triage and report edits** (rows copied once, when the new audit is created, each marked with where it came from). The workflow does not change. The engine compares audits **cell by cell** (a cell is page × scenario × viewport × journey), judges a finding only on the cells that exist and have a verdict on both sides, and answers "not comparable" instead of guessing whenever the rule changed between the two rules versions (a hand-kept `RULE_CHANGES` registry), the banner was detected on one side only, or the scopes share no cell. States: new, regressed, unchanged, fixed, verdict changed, not comparable. A fix is "verified fixed" only when the re-run passes the check; the author's "Fixed" triage mark is a claim that the diff then confirms or contradicts. Tag-level changes (a tag disappeared, appeared, changed destination or event set) come from the same hits the Tag matrix reads. Real-site flakiness is not hidden by capturing everything twice; changes on volatile rules or rules that flip between audits carry a "low confidence" label and a **Re-run these pages** action, which is also the per-finding **Verify fix** (a small `narrow` audit of the pages and scenarios a finding failed on). The report gains a frozen `changes` section (`REPORT_MODEL_VERSION` 4, `UPGRADES` step, a validator for every new leaf). The polish half is a deploy spike first (it can fail, and the answer shapes the release), then docs, an empty-and-partial-states sweep, a demo instance seeded from real captures, and a release checklist that separates blockers from items that can wait.

Design sources: `docs/product.md` (v0.1 item 9), `docs/roadmap.md` (M6 row; "Left over from M2/M3/M4/M5"; "Rules from research"; "UX rounds"), `docs/vision.md` (principles 1, 2, 4; "Compare and polish (M6, v0.1 release)"; "M4 demo", "M5 demo"; "Report (M5)"), `docs/ui.md` (vocabulary, shared blocks, score honesty), `docs/research/2026-10-28-competitors.md` (ranked idea 2: re-audit diff; Elevar's missing-embed alert; DataTrue's Briefing; ObservePoint compares only 3 tags), `docs/research/2026-10-28-pain-points.md` ("For compare (M6)": states beyond new/fixed/unchanged, not comparable when rules version, region or banner detection differ, per-finding re-verify, specific regression wording, real change vs flaky verdicts, accepted risks carry over), `docs/plans/2026-10-28-m5-report/{plan,review-r1,review-r2}.md` (format, disclosure projection, snapshots, `UPGRADES`), `docs/plans/2026-10-27-m4-matrix-overview-llm/{plan,seed-max.sql}` (the 168-run seed and method), `docs/decisions/0003-capture-admission.md`, `AGENTS.md`, and the code as of `9a7d511`: `packages/db/src/{audit,rules,report}-schema.ts`, `packages/core/src/{audit,jobs}.ts`, `packages/rules/src/index.ts`, `apps/web/src/server/{audits,clients,client-summary,findings,findings-data,overview,score-summary,report-data,report-publish-data,register-data,matrix-data,consent-context,audit-data,server-fn}.ts`, `apps/web/src/workflows/Audit.ts`, `apps/web/src/lib/{report-model,report-projection,health-score,page-match,page-title}.ts`, `apps/web/src/routes/app/{audits,sites}/*`, `apps/web/src/components/{report,evidence,status-badge,status-glyph}*`, `packages/fixtures/{sites.mjs,server.mjs,page.mjs,README.md}`, `infra/{alchemy.run.ts,README.md}`, `.github/workflows/deploy.yml`, `README.md`, `CONTRIBUTING.md`.

**Implementation baseline.** `main` at `9a7d511` (M5 merged, UX rounds 1 to 4, rules version 6, `REPORT_MODEL_VERSION` 3, `SCORE_VERSION` 2). Implementation starts from `main` in a fresh worktree. UI is named by role as in the M5 plan ("the audit tab bar", "the audit header", "the Findings filter row"); adapt each browser step to the layout on `main` when the task starts.

## Global constraints

- **No unit or integration tests** (`AGENTS.md`, current phase). Each task is verified by running the real thing: the dev server in a browser at 1440x900 and 390x844 in both themes through the real theme menu, `psql`, `curl -i`, the CLI, and throwaway scripts in `$TMPDIR` (not committed). Report the command and what was seen. Screenshots go to `$TMPDIR/m6t<task>-*.png` (`TMPDIR=$HOME/.cache/tmp`). The comparison engine is the one place where a test would be natural; ending the no-tests phase after v0.1 is open question 9.
- `pnpm check && pnpm typecheck && pnpm build` exit 0 with zero warnings after every task (real exit codes).
- **Docs move with the feature.** Every task ends by updating the matching row of `docs/vision.md` ("Compare and polish") and, where it applies, `docs/ui.md` and `AGENTS.md`. Task 16 only sweeps and closes.
- **Comparisons are computed on read; the workflow is untouched.** `rg "baseline|carried_from|narrow" apps/web/src/workflows` stays empty. The only rows M6 adds are human acts (the baseline link, copied triage and edits, a narrow audit's `kind`), written by server functions inside the transaction that creates an audit. Nothing new is a derived row, so none gets a random id or `defaultNow()` in a way a retry could change.
- **Triage is still never rewritten by the workflow.** The one new writer is the audit-creation transaction (carry-over, Task 4), which only inserts rows for an audit that has no rows yet; `setTriage` stays the only writer afterwards, and it clears `carried_from_audit_id`. Update the Database section of `AGENTS.md` accordingly.
- **Org scoping and the 404 rule.** Every query filters by `org_id` and reaches runs, hits, check results and findings through `auditInOrg(orgId, auditId)`. A comparison takes two audit ids and checks **both**: either one from another organization, or the two on different sites, is a 404 (never a 403, never a message that says which). The baseline must be an earlier audit of the same site that was evaluated.
- **Stored wording, never the live registry.** Finding titles, severities, areas and owners in a comparison come from the `finding` and `check_result` rows (the side that has the row; the newest rules version's text wins when both do). `@repo/rules` is read for exactly two things that are not wording: `RULES_VERSION` and `RULE_CHANGES` (Task 5), plus the `VOLATILE_RULES` set (Task 9).
- **Vocabulary** (`docs/ui.md`): Could not check (never "inconclusive"); Not evaluated is never clean; no "healthy" or "clean". New words, added to `docs/ui.md` in Task 6: **New**, **Regressed**, **Fixed** (verified by a re-run; the author's mark stays "Marked fixed"), **Unchanged**, **Verdict changed**, **Not comparable**. Every state is a glyph and a word, never colour alone, and no new colour token: reuse `status-pass` for Fixed and neutral for the rest.
- **The report never leaks a page path or personal data through a comparison.** The report's `changes` section carries titles from stored static wording, counts, enums, dates and vendor labels. It names no page (pages are counted, because aliases ("Page 2") mean different pages in two audits). Destination IDs follow the existing rule (`destinationLabel`: ad-platform IDs only at the Detailed level). Every new leaf of `ReportModel` gets a validator in `LEAF_VALIDATORS`; an unregistered path fails the build as a defect.
- **No new dependency.** Existing shadcn components and shared blocks (`PageHeader`, `SectionHeading`, `EmptyState`, `StatusGlyph`, `lib/format.ts`). No diff library: the comparison is set arithmetic.
- **No inline `style`, no hard-coded colour, 32px targets, visible focus rings** (`AGENTS.md`). Any controlled `Dialog` or `Sheet` that opens from a menu item or a URL param restores focus (`ConfirmDialog` pattern).
- Never log the demo password or a token. `TMPDIR=$HOME/.cache/tmp`. No sudo, ever, in a worktree (Task 1 builds the container image in CI or with a rootless Docker, never `sudo pnpm`). Never push without asking. Migrations are generated, never edited. Never commit `.env`.

### Working in the worktree

Work in a fresh worktree from `main` (`wt switch --create m6/compare-impl`); copy `.env` from the main checkout. Run `pnpm install`, `pnpm build` and `pnpm typecheck` once. Services as in `CONTRIBUTING.md`: Postgres (`docker compose up -d`, 127.0.0.1:5432), fixtures (`pnpm --filter @repo/fixtures serve`, :4400), the engine (`ALLOW_PRIVATE_NETWORKS=true PORT=8080 pnpm --filter browser start`, :8080), the app (`BROWSER_URL=http://localhost:8080 pnpm dev`, :1337). Only one dev server can hold :1337: ask before stopping another checkout's. **Use a separate database**: create `zinko_m6` (`docker compose exec -T postgres psql -U postgres -c 'create database zinko_m6'`), set `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/zinko_m6` in the worktree's `.env`, and **always export it explicitly for migrations** (`export DATABASE_URL=$(grep ^DATABASE_URL .env | cut -d= -f2-)`): `pnpm db:migrate` reads the process environment, not `.env` (the M5 Task 1 mistake migrated `app`).

## Scope and non-goals

In scope: re-run with the same settings and the baseline link; triage and note carry-over; the comparison engine (finding states per cell, tag diff, comparability, regressed history, confidence); the Compare tab; narrow re-runs (Verify fix, Re-run these pages); the Overview briefing, Findings chips and site-history entry points; the report `changes` section and CSV columns; performance and security of all that; the empty and partial states sweep; README, self-host guide and contributor docs; a deploy spike; a read-only public demo instance and its seed; the v0.1 release checklist.

Not in scope: **single-run retry in place** (deferred after v0.1, see Decisions); audit cancel; scheduled re-runs or alerts (v0.3); a stored `audit_comparison` table; re-judging an old audit's stored captures with today's rules ("re-evaluate", v0.2); comparing across sites or clients; comparing more than two audits at once (the trend is a sparkline already); a diff of raw requests, screenshots or cookies; region simulation (not a capture capability yet, so "region differs" cannot be detected: only the banner-detection and rules-version differences can); AI text about changes; consultant-typed page names; parallel captures inside one audit; a Slack or email "what changed" digest; billing.

## Decisions

| Question | Decision | Why |
|---|---|---|
| What is "the baseline" | `audit.baseline_audit_id`, nullable, **same site, earlier, evaluated, kind `full`**, `on delete set null`. Set at creation: by **Re-run** to the audit that was re-run (even if newer audits exist), by the **New audit** form to the site's latest evaluated full audit (shown on the form: "Compared with the audit of 14 Oct", with Change), and changeable later with **Make this the baseline** on the Compare tab. Any earlier evaluated full audit of the same site can be compared by URL (`?against=`) without changing the link | A stored link gives the Overview, the report and the register one stable answer; computing "the previous audit" on read would make a published draft change under the consultant when someone else started an audit. "Any pair" stays possible for the consultant. A deleted baseline falls back to "no baseline", never to a guess |
| Compare stored or computed | **Computed on read** from `finding`, `check_result` (without `message` and `evidence`), `run`, `finding_triage` and `hit`. The report freezes the result at publication | A stored comparison needs invalidation on every triage change, baseline change and retry, and would be a derived table with the determinism rules of `AGENTS.md`. The inputs are small: 168 runs × 24 rules ≈ 4,000 check rows per side. Budget in "Performance targets"; if missed, narrow the query or add an index, never a stored copy |
| Unit of comparison | A **cell**: `journey | viewport | scenario | page`, the page being `withoutTestClickIds(run.pageUrl)` (the start URL carries test click IDs; `lib/page-match.ts`). A journey cell's key adds the normalized list of pages it walks. A finding is judged on the **common cells that have a check result for that rule on both sides**; failing cells outside the common set are listed ("also fails where the baseline did not run") and never change the state | A re-run with a page removed or a scenario added must not read as "fixed" or "new". This is the pain-points insight "not comparable when the scope differs", made mechanical |
| States | Per finding (rule), over its common cells. Failing before = Fb, failing now = Fc. **Unchanged**: both non-empty (with `spread`: same, narrowed, widened or moved). **New**: Fc non-empty, Fb empty, and the rule passed or did not apply on those cells before. **Regressed**: the same as new, and the rule failed in an earlier audit of the site (up to the 10 before the baseline) and passed or did not apply in the baseline: "Fixed on 14 Oct, failing again". **Fixed**: Fb non-empty, and every cell of Fb now passes or no longer applies (`fixedHow`: `passes` or `no_longer_applies`). **Verdict changed**: a cell moved to or from Could not check (fail → could not check, pass → could not check, could not check → fail or pass), the one thing neither "fixed" nor "new" may claim. **Not comparable**: the rule changed between the two rules versions, the rule did not run on one side (a rule added or removed), the banner detection differs on the cells a banner-dependent rule judges, or no cell is common | Exactly the states the research asks for; each has a reason string. A rule that is `not_applicable` on both sides is not listed |
| Rules version difference | `RULES_VERSION` is global, so two audits under different versions are not wholly incomparable. `packages/rules/src/changes.ts` exports `RULE_CHANGES: Record<version, ruleIds[]>`, the rules **whose verdict can differ for the same run** in that version (a rule added or removed needs no entry: it is not run on one side already). A rule is comparable unless some version `v` with `lo < v <= hi` lists it, where `lo` and `hi` are the lowest and highest versions that judged it in either audit. Raising `RULES_VERSION` now also means listing the changed rules (`AGENTS.md`, Task 5) | Reuses the existing discipline instead of refusing every cross-version comparison or silently trusting it. Re-judging the old audit's stored captures with today's rules would be exact, but it is a v0.2 feature (open question 5) |
| Banner detection | `bannerDetection(orgId, auditId)` (M4) per `none` cell. For `BANNER_DEPENDENT_RULES`, a cell whose detection class differs between the audits (detected, not detected, unknown) is not comparable for that rule and counted in the comparability notice | The verdict of those rules depends on a banner existing; "fixed" because the banner was not detected this time would be a lie |
| Region | Not detectable today (the capture contract records no vantage point). The Compare tab says so once in its notice ("The audits' network location is not recorded") and `docs/vision.md` keeps region simulation open | Honest about what the data cannot say |
| Fixed by the author vs verified fixed | `finding_triage.status = fixed` is a **claim** and is not carried over. **Fixed** in a comparison is an **observation**: the re-run passes the check on every cell that failed. A finding the author marked fixed in the baseline and that still fails reads "Marked fixed on 14 Oct, still fails" (state unchanged or regressed, with that line); one marked fixed whose cells now pass reads "Fixed, confirmed". A baseline finding fixed in fact but never marked shows Fixed with no mark | Separates what a person said from what the re-run saw. The M5 report already prints "marked fixed by the author, not re-verified" |
| Triage carry-over | When an audit is created with a baseline, in the same transaction: the baseline's `accepted_risk` rows (reason, `updated_by` and `updated_at` as they were) and **all** its `report_finding_edit` rows (note, hidden, owner) are inserted for the new audit under the same `rule_id`, with `carried_from_audit_id` = the row's own origin if it has one, else the baseline's id. `report_edit.detail` and `include_changes` are carried; the summary text is not. `open` and `fixed` rows are not. A rule that no longer fails has an inert row (no foreign key to `finding`, by design). `setTriage` or a report edit on the new audit overwrites the row and clears the mark. Carried notes are listed in the share dialog's pre-flight ("2 notes carried over from earlier audits; check they still apply") | Rule-level and one-time, so chains of re-runs carry forward and a late acceptance in the old audit does not leak backwards. Copying at creation keeps every reader (score "excluding accepted risks", Findings, report, register) unchanged: they already read the audit's own rows |
| Capture twice to catch flakiness | **No.** It doubles the engine time (30 runs: about 6 to 12 minutes) and the admission queue for every audit | Instead, a change is labelled **Low confidence** when its rule is in `VOLATILE_RULES` (`consent.default-after-tag`, `consent.mode-classified` and `consent.google-without-denied-state`: the consent rules the roadmap saw change between runs of one page when a default depends on a geo lookup or on which hit goes first; banner-dependent rules whose detection differs are already Not comparable), when the rule's verdict flipped two or more times across the last five audits, or when the change rests on a single run. The row offers **Re-run these pages**, and the Compare tab then shows the confirmation ("Seen again on 2 of 2 runs" or "Did not repeat") |
| Per-finding re-verify | **In M6, as a smaller audit.** `Verify fix` on a finding creates an audit of kind `narrow` (`narrow_rule_id` set, baseline = the audit holding the finding) whose config keeps only the pages, scenarios and viewports the finding failed on (a journey finding keeps its pages and journey flag). Same workflow, same admission queue, nothing new in the engine. Narrow audits are listed in the site history with a badge and no score, and are **excluded from latest-audit selection, score trends and the baseline picker** | The consultant's loop is "dev says fixed, check it in a minute", not another 6-minute audit. Built on the re-run path, so the extra cost is one config function, a badge and four query filters. If time runs out this is the cut line (Tasks 8 and 9), not the release |
| Single-run retry in place | **After v0.1.** A failed or partial run in a settled audit is covered by a full re-run | In-place retry rewrites a dated audit: capture and screenshot keys are deterministic, so the old evidence is overwritten; findings, status and the report stamp are recomputed under a published link; a second workflow shape must be bound and admitted. The narrow re-run gives most of the value with no mutation |
| Re-run and admission | A re-run is a normal audit: same `createAudit` path, its own workflow instance named by the audit id, the same per-capture FIFO. It gets no priority. Guards: the site's row is locked (`siteInOrg(.., true)`) while the audit row is created, a second re-run of the same baseline while one is queued or running is refused ("A re-run of this audit is already in progress"), and an organization may have **at most 5 queued or running audits** (open question 2) | One click makes flooding the global queue easy; the first guard stops double clicks, the second bounds a mistake. Decision 0003's FIFO already stops one big audit starving others |
| "What changed" briefing | A deterministic list of at most six lines from `changesBriefing(comparison)` (pure, `lib/compare.ts`): regressions first, new critical and warning findings, then fixed, then tags that disappeared, then what could not be compared, last the counts and the score. The score delta appears only when both audits are evaluated, the score version and rules versions match and neither has partial coverage; otherwise both scores are shown without a delta and the line says why. No model, no page names in the report | Same discipline as `headlinesOf`: repeatable, free, explainable |
| Tag-level diff | Per audit, the distinct (vendor, destination, event) of each **comparable cell**, from `hit` grouped in SQL. A cell is comparable for tags when both runs finished `complete` (a partial run missing a tag is "could not tell", never "disappeared"). Changes: **disappeared** (a tag on a cell before and not now), **new**, **destination changed** (same vendor on the same cell, one destination gone and one new), **events changed** (same tag, events added or removed). Rolled up per tag across cells ("TikTok ZINKOTT0001: gone on 6 of 6 compared pages") | Elevar's missing-embed alert and the research ask for "tag disappeared"; ObservePoint compares only 3 tags, this compares every one |
| Report | `ReportModel.changes`: `null` or `{ baselineDate, counts, items (at most 12), tags (at most 8), scoreDelta, notices, lines }`, frozen in the snapshot, hash-included, switchable with `report_edit.include_changes` (default on). Model version 4, `UPGRADES[3]` sets `changes: null`. The register CSV gets two columns and a row for each verified-fixed finding | A client who gets a second report wants to see what the work achieved; a consultant must be able to leave it out |
| Demo instance | **Live, read-only**, on its own stage, with sign-up disabled and one public demo account. Every mutation is refused in `respond` when the session's organization is `DEMO_ORG_ID`, and Better Auth account endpoints (password, profile, organization, invitations) are refused for the demo user. Seeded by importing rows and captures exported from a local run of the `drift` fixture (Task 15). Fallback: a published report link plus screenshots | Compare is the product's best story and needs clicking; the audit engine is not needed (no audits can start), so the demo stage skips the container |
| v0.1 blockers | See "What blocks v0.1" | A release list with reasons, so the leftovers do not all become blockers |

## What blocks v0.1

| Leftover | Verdict | Where |
|---|---|---|
| The container image and a deploy are untried | **Blocks** the claim "self-hostable" and the demo. If the spike fails and cannot be fixed, v0.1 ships as "run it locally" with the self-host guide marked untested | Task 1 |
| README says 19 checks, shows a mockup and "early development"; a fresh clone needs a build before `pnpm check` | **Blocks** (first impression, contributor path) | Task 14 |
| Cloudflare rate-limit rule on `/r/*` is an unverified spike | **Blocks the public demo and any shared deployment** (public report links are the one anonymous surface); not the local release | Task 1, Task 15 |
| `/r/` HTML at 237 KB vs the 250 KB budget, compression assumed | Wait, but measure `--compressed` size on the spike deploy | Task 1 |
| Real-provider quality run for explanations (M4 Task 13) | **Blocks** the README claim about explanations; needs a key from the owner | Task 16 |
| Firefox print of the public report by hand | Wait; note in the README's known limits | Task 16 (5 minutes if a Firefox is at hand) |
| Distinct captures at 168 runs unmeasured | Wait for the full measurement; the 19-distinct read is in Task 12 | Task 12 |
| Transient storage failure on publish not injected | Wait | Leftovers |
| Parallel captures: 30 runs take 5 to 6.4 minutes against the 5-minute target in `docs/product.md` | Wait; the README states the measured time instead of the target | Task 1 measures it |
| Banner detection under none and gpc; region defaults; Happy Socks' Cookiebot accept; Ads purchases; vendor-side `hygiene.tag-errors`; click IDs on the start URL only | Wait; they are product limits, listed in the README's "Known limits" | Task 14 |
| Score weights, the 79 cap and the minor-issues band are provisional | Wait; the Compare tab refuses to show a score delta across score versions | Task 6 |
| Flaky navigation timeout; the Overview focus order; "Critical4" style leftovers; page names; code in "Ask for" in monospace | Wait | Leftovers |
| Retention of `finding_explanation`, ledger cleanup, abandoned reservations | Wait | Leftovers |
| CI runs only check, typecheck, build (tests were removed) | Decision for the owner (open question 9) | Task 16 |

## Data model

All additive and nullable or defaulted, so existing audits keep working. Each is added by the task that needs it with `pnpm --filter @repo/db db:generate`, then `pnpm db:migrate` (with `DATABASE_URL` exported).

```ts
// Task 3. audit-schema.ts
audit.baseline_audit_id: uuid references audit(id) on delete set null    // index (org_id, baseline_audit_id)
audit.kind: text not null default 'full'                                  // 'full' | 'narrow'
audit.narrow_rule_id: text                                                // set on a 'narrow' audit made by Verify fix

// Task 4. Where a carried row came from (the audit where the person first acted).
finding_triage.carried_from_audit_id: uuid references audit(id) on delete set null
report_finding_edit.carried_from_audit_id: uuid references audit(id) on delete set null
report_edit.include_changes: boolean not null default true                // Task 11
```

- **No `audit_comparison` table, no change log, no snapshot of states.** The comparison is a function; the report snapshot (`report_snapshot.model`) freezes the part a client sees.
- `AuditConfig` (Schema in `packages/core/src/audit.ts`) is unchanged: a narrow audit is an ordinary config.
- **Narrow audits** are excluded wherever "the latest audit" or a score trend is chosen: `client-summary.ts` (the `lasts` select, the `counts`, the sparkline rank query), `clients.ts` (`searchTargets` recent audits, `getSite`'s `lastConfig`), and the baseline defaults. They remain in the site history list, with a badge and no score.

## The comparison

### Types and the state machine (`apps/web/src/lib/compare.ts`, pure)

```ts
type Verdict = "fail" | "could_not_check" | "pass" | "not_applicable" | "not_run"
type ChangeState = "new" | "regressed" | "unchanged" | "fixed" | "verdict_changed" | "not_comparable"
type NotComparable = "rule_changed" | "rule_added" | "rule_removed" | "banner_differs" | "no_shared_scope"

interface CellKey { journey: boolean; viewport: string; scenario: string; page: string }   // page: normalized URL (or the walked list)
interface FindingChange {
  ruleId: string; title: string; severity: Severity; area: string; owner: OwnerId | null     // stored wording
  state: ChangeState; reason: NotComparable | null
  was: Verdict; now: Verdict                                                                   // the rule's verdict over its common cells
  fixedHow: "passes" | "no_longer_applies" | null
  spread: "same" | "narrowed" | "widened" | "moved" | null                                    // unchanged only
  cells: { common: number; failedBefore: number; failedNow: number; fixed: number; started: number; outside: number }
  cellChanges: { cell: CellKey; before: Verdict; now: Verdict }[]                             // at most 50, failures first
  earlierFailure: { auditId: string; date: string } | null                                    // regressed only
  triage: { before: TriageStatus | null; now: TriageStatus; carriedFrom: string | null }
  confidence: { level: "normal" | "low"; because: ("volatile_rule" | "flips" | "single_run")[] }
  confirmation: { auditId: string; runsFailing: number; runs: number } | null                  // from a narrow audit that re-ran this change
}
interface Comparison {
  now: AuditRef; before: AuditRef            // id, date, status, score summary, rules versions, run count
  findings: FindingChange[]                  // ordered: regressed, new, verdict_changed, fixed, unchanged, not_comparable; then severity, then ruleId (code-unit order)
  counts: Record<ChangeState, number>
  comparability: {
    commonCells: number; onlyBefore: number; onlyNow: number
    rulesChanged: { from: string[]; to: string[]; ruleIds: string[] }
    bannerDiffersCells: number; scoreVersionDiffers: boolean; unevaluatedCellsBefore: number
  }
  score: { before: number | null; now: number | null; delta: number | null; deltaWhyNot: string | null }
}
```

State rules (the engine, in order, per rule):

1. **Verdicts per cell.** From `check_result` rows keyed by (run, rule), mapped to the cell of the run. A cell is *common for the rule* when both audits have a run in that cell **and** a check result for the rule on both runs. A run without check results (not evaluated, failed) contributes no cell for any rule; `unevaluatedCellsBefore` counts them for the notice.
2. **Not comparable first.** (a) `rule_changed`: `RULE_CHANGES` lists the rule for a version in `(lo, hi]`. (b) `rule_added` or `rule_removed`: the rule has check results on only one side. (c) `banner_differs`: a banner-dependent rule, cells under `none`, where `bannerDetection` differs; those cells are removed from the common set and counted. (d) `no_shared_scope`: the rule failed or could not be checked somewhere, but no cell is common. Any of these, with nothing left to compare, gives `not_comparable` with the reason; with some common cells left after (c), the rule is compared on those and the notice counts the cells dropped.
3. **Over the common cells**, Fb, Fc (failing sets), Ub, Uc (could-not-check sets).
   - `Fb ≠ ∅ and Fc ≠ ∅` → **unchanged**; `spread` is `narrowed` if some Fb are not in Fc and none the other way, `widened` for the reverse, `moved` if both, else `same`.
   - `Fb = ∅ and Fc ≠ ∅` → if every Fc cell was could-not-check before, **verdict_changed** ("now fails; was not checkable"); else **regressed** when `earlierFailure` exists, else **new**.
   - `Fb ≠ ∅ and Fc = ∅` → **fixed** when every Fb cell is now pass or not applicable (`fixedHow` is `passes` if any is pass, else `no_longer_applies`); **verdict_changed** otherwise (some cell is now could-not-check: "can no longer be checked").
   - `Fb = ∅ and Fc = ∅`: `Ub ≠ ∅` xor `Uc ≠ ∅` over the same cells → **verdict_changed**; both → **unchanged** (kind could-not-check); neither → not listed.
4. **Regressed history.** One query for the up to 10 earlier evaluated `full` audits of the site before the baseline: `finding.kind = 'fail'` for the rule. `earlierFailure` is the newest such audit. The rule must also be comparable between that audit's versions and the current ones (`RULE_CHANGES` again); if not, the state is `new`, not `regressed`.
5. **Confidence.** `volatile_rule`: `ruleId in VOLATILE_RULES`. `flips`: over the last five audits including these two, the rule's failing/not-failing sequence changes at least twice. `single_run`: the change rests on one cell. Low confidence never changes the state; it adds a label and the **Re-run these pages** action.
6. **Triage line.** `before` is the baseline's status (a carried row counts), `now` the audit's; `carriedFrom` the origin audit's date. A finding whose baseline status was `fixed` and whose state is `unchanged` or `regressed` reads "Marked fixed on <date>, still fails".

`changesBriefing(comparison): string[]` and `scoreDeltaOf` are pure functions in the same file, used by the Overview and the report builder so both print the same words.

### Tag diff (`apps/web/src/server/compare-data.ts`, `tagDiffOf`)

For each audit, one grouped query: `select run.id, hit.vendor, hit.destination_id, hit.event, count(*) from hit join run … where run.audit_id = $1 and run.org_id = $2 and hit.org_id = $2 and run.status = 'complete' group by …` (the shape of `tagsSeenOf`), mapped to cells in TypeScript with `withoutTestClickIds`. Cells present and `complete` on both sides are *tag-comparable*. Output, capped at 40 tag changes and 10 cells each: `{ change: "disappeared" | "new" | "destination_changed" | "events_changed", vendor, destinationId, previousDestinationId?, eventsAdded[], eventsRemoved[], cellsAffected, cellsCompared }`. Vendors outside the known list are labelled "Other vendor" in the report (the existing `vendorLabel`).

### Narrow audits (`narrowedConfig`, pure, `lib/compare.ts`)

`narrowedConfig(config, failingRuns)`: scenarios and viewports are the distinct ones of the failing runs; if any failing run is a journey run, pages and `journey: true` are kept whole; otherwise pages are the distinct failing pages in the baseline's configured order, `clickIds` stays on only when the baseline's start page is among them and stays first, else it is turned off (the first remaining page would otherwise be landed on with test click IDs it never had). The confirm dialog states the run count (the cross product can exceed the failing cells) and the estimate.

## Report: `changes` (Task 11)

```ts
changes: null | {
  baselineDate: string                                   // ISO; "audit of 14 October 2026 (UTC)" through reportDate
  counts: { new: number; regressed: number; fixed: number; unchanged: number; verdictChanged: number; notComparable: number }
  score: { before: number | null; now: number | null; delta: number | null }
  items: { ruleId: string; state: "new" | "regressed" | "fixed" | "verdict_changed"; severity: Severity; title: string; pages: number; pagesCompared: number }[]   // 12
  tags: { change: "disappeared" | "new" | "destination_changed" | "events_changed"; vendor: string; destination: string | null; events: string[]; cellsAffected: number; cellsCompared: number }[]  // 8
  notices: ("rules_changed" | "scope_differs" | "banner_differs" | "score_not_comparable")[]
  lines: string[]                                        // the briefing
}
```

Validators (`LEAF_VALIDATORS`): `count` for every number, `nullable(amount)` for scores, `date` for `baselineDate`, `oneOf(state)`, `oneOf(tagChange)`, `oneOf(notice)`, `stored` for titles (rule wording from the rows), `vendorLabel`, `nullable(destinationLabel)` at the report's detail level, `event` for event names, `ruleId` as the existing rule-id validator, and `stored`-bounded text for `lines` built only from those leaves. Hash and snapshot: `changes` is part of `publicationHashOf` (a new baseline or a changed state reads as "Unpublished changes"). **Gotcha:** `ReportModel.modelVersion` is `Schema.Literals([1, 2, REPORT_MODEL_VERSION])`; bumping to 4 would drop 3 from the accepted values, so list every historic version (`[1, 2, 3, REPORT_MODEL_VERSION]`) and add `UPGRADES[3]: (json) => ({ ...json, changes: null })`. A version 3 snapshot must still render.

## Performance targets (168 runs on both sides)

Seeded with `docs/plans/2026-10-27-m4-matrix-overview-llm/seed-max.sql` (168 runs, 226,918 hits, 19 failing findings) plus `docs/plans/2026-10-28-m6-compare/seed-compare.sql`, written in Task 12: copies that audit as a second audit of the same site with new ids, flips a known set of 6 findings (2 fixed, 2 new, 1 regressed by also seeding an older third audit, 1 verdict changed), removes one tag, changes one destination, and carries 3 accepted risks. Local Postgres, warm, p95 of 20 calls after one warm-up, measured on the serialized response. Before Task 10 and Task 11, record the current p50 and p95 of `getOverview` and `getReportDraft` on the same data, so the budgets below are deltas.

| Call | Target |
|---|---|
| `getComparison` (findings, cells, banner detection, regressed history, confirmations) | <= 1500 ms, <= 120 KB |
| `getTagDiff` (two grouped hit scans, 227k hits per side) | <= 1500 ms, <= 80 KB |
| `getOverview` with the briefing | at most +500 ms over its measured value; the briefing needs `getComparison` only, and tag lines come from a counts-only variant of the tag scan |
| `getReportDraft` / `publishReport` with `changes` | <= 1800 ms / <= 2800 ms, JSON <= 165 KB |
| `rerunAudit` / `createAudit` with carry-over (24 findings, 24 edits) | <= 800 ms to return |
| Findings tab | no regression: change chips load after the list renders |

If a target is missed the fix is a narrower query, an index (for example a covering `hit (run_id, vendor, destination_id, event)`) or a cap, not a stored comparison.

## Security

- Both ids of every comparison go through `auditInOrg`; the second must be on the first's site and older; any failure is the same 404 as a missing id. The site picker lists only that site's evaluated full audits of the organization.
- `rerunAudit`, `verifyFinding` and `setBaseline` take an audit id, never a config from the client: the config is read from the stored audit and re-validated by `AuditConfig` and `normalizePages` (a site address changed since then fails with the usual message). A foreign or archived-site audit is a 404 or the existing "This site is archived".
- Any member may re-run, verify and set the baseline (they can already start audits); the cap of 5 active audits per organization and the in-progress guard bound abuse. Roles for triage and report edits are unchanged.
- Carry-over copies only rows of the baseline selected with `org_id`; the insert is in the audit-creation transaction.
- Report `changes` is built from stored static wording and counts only, checked by `assertProjected`; the hostile seed of M5 (`docs/plans/2026-10-28-m5-report/seed-hostile.sql`) is extended in Task 12 with a baseline whose finding titles, tag events and destinations carry the hostile strings, and the grep table is run over the draft JSON, the snapshot, the public HTML and the CSV.
- Demo: sign-up disabled, mutations refused in one place, account endpoints refused for the demo user, no engine, no LLM key, rate limit on `/r/*`.

## UX

- **Entry points.** The audit header gets **Re-run** (secondary, next to Share report; in the More menu below `sm`), enabled when the audit is settled and the site not archived. Its confirm dialog states the run count and estimate and "It will be compared with this audit." The site history row gets a Re-run action and a **Compare** link when a baseline exists; narrow audits show a "Verification" badge and no score. A new **Compare** tab joins the tab bar after Findings. The Overview of an audit with a baseline starts with the briefing (Task 10). Findings rows get a change chip. The finding detail sheet gets **Verify fix** (failing findings) and the change history line.
- **The Compare tab.** Header "Compared with the audit of 14 Oct 2026" with an Audit select (earlier evaluated full audits of the site: date, score, run count) in `?against=`, and **Make this the baseline** when it differs from the stored one. A summary row of six counts (glyph and word each) and the guarded score line. One inline notice row (not an alert) lists what limits the comparison: rules changed (versions 5 to 6, n checks), scopes (18 of 36 cells shared), banner detection differs on n cells, network location is not recorded. Findings are grouped by state in the order above; Not comparable is collapsed. A row: change chip, severity, title, "Failed on 8 of 26 runs before, 3 of 26 now", the spread, the triage line, the confidence chip. Selecting opens the finding detail sheet with the cell changes table (Page, Scenario, Viewport, Before, Now; at most 50 rows, "and n more"). A **Tags** section below (collapsed by default, count in its heading) lists tag changes with the cells affected. Empty states: first audit of the site ("The next audit of this site will show what changed"), no earlier evaluated audit, baseline deleted, re-run still running (progress and the room's live updates), re-run failed, **nothing changed** ("No finding or tag changed in the 36 shared cells", with the notice if scope differs).
- **Change vocabulary** is a shared `ChangeBadge` (glyph and word, `StatusGlyph` pattern), checked in grayscale.
- **Briefing on the Overview.** A card under the score block: "Since the audit of 14 Oct" and up to six lines, then "See all changes" to the Compare tab. Hidden for an audit with no baseline and for a narrow audit (which shows its verification result instead).
- **Report.** A "What changed since <date>" block after the summary (before Scope), the lines, a counts row, the items, the tags, the notices. Consultant view has a switch "Include what changed" (`include_changes`) and the carried-notes pre-flight.

## Tasks

Demo data for browser checks, recomputed with the fixtures from Task 2 on the dev server: (D0) `drift` at release 0; (D1) the same URLs after `release 1`; (D2) after `release 2`; (F) `flaky-meta` twice; (A) `clean`; (X) the 168-run synthetic pair (Task 12); (P) a partial audit (start the engine, kill it mid-audit, or seed a partial run in SQL). Accounts: an owner of organization one, a plain member of it, an owner of a second organization (for the 404 checks). **Write the expected states from `packages/fixtures/README.md` and SQL before looking at each screen, then compare.** Order of work: start Task 1 immediately and let it run beside Tasks 2 to 12, since it needs the owner's Cloudflare token and can fail; Tasks 8 and 9 are the cut line if time runs out.

### Task 1: Deploy spike: the container image and `alchemy deploy` to a real account

**Model:** Opus
**Files:** `docs/decisions/0004-first-deploy.md` (new: what was run, what failed, what to do), `infra/alchemy.run.ts` and `.github/workflows/deploy.yml` only if the spike shows a change is needed (a `workflow_dispatch` input for the stage), `infra/README.md`, `docs/roadmap.md` ("Left over from M2": Cloudflare), `docs/vision.md` (Open questions: Deploy)
**Interfaces:** none new. A scratch stage `spike-m6` on a Cloudflare account the product owner provides (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`; Containers need the Workers Paid plan), a Postgres reachable by Hyperdrive over TLS (a Neon branch), explicit `DATABASE_URL`
**Blocked by:** the product owner's Cloudflare credentials and approval to spend (open question 13)

- [ ] **Build the image without sudo.** `docker info` as the normal user. If it fails, do **not** use `sudo` in the worktree: build in CI (the manual `deploy.yml` with the stage as an input) or ask the owner to add themselves to the `docker` group. Record the image size and the build time
- [ ] Migrate the spike database with an explicit `DATABASE_URL` (`pnpm db:migrate`), set the secrets (`BETTER_AUTH_SECRET`, `LLM_ENCRYPTION_KEY`, `STORAGE_SIGNING_SECRET`, `MAIL_FROM`), then `pnpm run deploy --stage spike-m6` (or the CI run). Record every error and its fix
- [ ] On the deployed Worker, with the real UI: sign up, create an organization, add a site for a page you own (the Worker's own `/sign-in` page is a good clean target, plus `https://example.com`), run a 12-run audit (4 pages × 3 scenarios), and record: container cold start, time per capture, total time, whether the live progress socket reconnects, three audits started together (`BROWSER_ENGINES=3` and the admission gate on real containers: the first evidence of decision 0003 outside the local engine), the engine's memory (the `standard-1` comment in `alchemy.run.ts`), R2 signed screenshot URLs, an invitation email through the transport
- [ ] Anonymous surface: create a report link and fetch it with `curl -sI`, `curl --compressed -s -o /dev/null -w '%{size_download} %{time_starttransfer}'` (the 237 KB HTML: record the compressed size), and verify the `/r/*` rate-limit binding really limits (60 requests in a second from one IP, count the 429s). Write the rule if the binding is only declared
- [ ] Time a 30-run audit (10 pages × 3 scenarios) and write the number: the README will state it
- [ ] **If it fails.** Image will not build or run Chromium: raise `instanceType`, check the base image, try `patchright` only; record. Containers unavailable on the plan or region: the engine can run elsewhere, which needs `BROWSER_URL` honoured on deployed stages and an engine auth token header (today the engine has no auth and only dev stages read `BROWSER_URL`, so it is a small design: decide in the decision record, implement only then). Alchemy beta error: file upstream, pin the version, and fall back to "v0.1 = run it locally" with the guide marked untested (see "What blocks v0.1"). Hyperdrive and Neon TLS errors: use the direct pooled connection string
- [ ] `docs/decisions/0004-first-deploy.md` lists the exact commands that worked, the numbers, and what Task 14 can promise. Destroy the stage (`pnpm run destroy --stage spike-m6`) and say so
- [ ] `pnpm check && pnpm typecheck && pnpm build`

### Task 2: Fixtures: a site that changes between audits, and a flaky one

**Model:** Sonnet
**Files:** `packages/fixtures/sites.mjs` (a `releases` array for `drift`, new flags), `packages/fixtures/server.mjs` (in-memory release state, `GET/POST /_release/<site>?to=<n>`, the flaky counter, `GET /_flaky/reset`), `packages/fixtures/page.mjs` and `shared/tags.js` (flags: `ga4Id`, `productViewItem`, `tiktok: "off"`), `packages/fixtures/README.md` (**written first**: the table of releases and the expected compare result), `packages/fixtures/package.json` (a `release` script that calls the endpoint)
**Interfaces:** `drift` serves the same URLs (`/drift/`, `/drift/product`, `/drift/thank-you`) with flags chosen by the current release. Releases: **0** Meta fires on load (`consent.pixel-without-consent` fails under none, accept, reject), the purchase is sent twice (`duplicates.purchase-sent-twice`), the email in the URL (`hygiene.pii-in-hits`), TikTok loads after the choice, GA4 `G-ZINKO00001` with `view_item` on `/product`. **1** Meta only after marketing consent (fixed), purchase once (fixed), PII unchanged, **TikTok removed** (tag disappeared), GA4 destination `G-ZINKO00002` (destination changed), `view_item` dropped (events changed), currency `eur` (**new** `coverage.invalid-currency`). **2** Meta fires on load again (**regressed**), currency `EUR` (fixed), the rest as 1. `flaky-meta` fires Meta on load on every second load of `/flaky-meta/` (the counter is per process; `/_flaky/reset` zeroes it)
**Blocked by:** none

- [ ] Write the README table first: for each release and each of the 19 rules that fire on `drift`, the expected rule × scenario result, then the expected compare results for D0→D1 and D1→D2 and D0→D2 (state per rule, tag changes). Commit that before the code
- [ ] Verify by: `pnpm --filter @repo/fixtures serve`, `curl -i localhost:4400/_release/drift?to=1` then `node apps/cli/dist/index.js capture http://localhost:4400/drift/ --scenario all --rules --block-vendors` after each release (0, 1, 2): the output matches the README for every release; `clean` stays at its baseline; `flaky-meta` captured twice in a row gives different `consent.pixel-without-consent` results; a restart resets the release to 0 and the README says so
- [ ] Docs (`packages/fixtures/README.md`, `AGENTS.md` "Rules": a fixture that changes between captures is allowed only through an explicit release switch), then `pnpm check && pnpm typecheck && pnpm build`

### Task 3: Re-run with the baseline link

**Model:** Sonnet
**Files:** modify `packages/db/src/audit-schema.ts` (`baseline_audit_id`, `kind`, `narrow_rule_id`; generated migration), `apps/web/src/server/audits.ts` (extract `createAudit` from `startAudit`; `rerunAudit`; the active-audit cap and in-progress guard; `startAudit` sets the default baseline), `apps/web/src/routes/app/audits/$auditId.tsx` (Re-run in the header, full and compact), `apps/web/src/routes/app/sites/$siteId.tsx` (row action), `apps/web/src/routes/app/sites/$siteId_.audits.new.tsx` (the "Compared with…" line), `apps/web/src/server/client-summary.ts` and `clients.ts` (only to keep `kind = 'full'` in latest-audit selection, ready for Task 8), `docs/vision.md`, `docs/ui.md`
**Interfaces:** `rerunAudit({ auditId }) -> { auditId }`: reads the stored audit through `auditInOrg`, requires status complete or partial (not queued, running or failed-before-start) and a non-archived site, re-validates `config` with `AuditConfig` and `normalizePages`, calls `createAudit({ orgId, userId, siteId, config, baseline: auditId, kind: "full" })` inside `atomically` with the site row locked. Refuses with `Invalid` when the baseline already has a queued or running re-run, or the organization already has 5 queued or running audits. `startAudit` sets `baseline_audit_id` to the site's latest evaluated full audit (or null). The workflow, `Jobs` and admission are not touched
**Blocked by:** none

- [ ] Verify by, in the browser on D0 (a finished 12-run audit): Re-run shows the dialog with "12 runs, about 2 minutes. It will be compared with this audit."; confirm lands on the new audit; `psql -c "select id, baseline_audit_id, kind, config = (select config from audit where id = '<old>') as same_config from audit order by created_at desc limit 2"`: baseline is the old audit, `kind` is `full`, config identical; double-click Re-run: one audit created, the second click answers "A re-run of this audit is already in progress"; start 5 audits with the engine stopped (they queue) and the sixth is refused with the cap message; archive the site: Re-run is disabled and a direct call is refused; as a member of another organization call `rerunAudit` with the audit id: 404; `rg "baseline" apps/web/src/workflows` is empty
- [ ] Verify the admission impact with the engine running: start a 12-run re-run while another 12-run audit is in progress and watch both fill their runs alternately (per-capture FIFO, decision 0003); both finish
- [ ] New audit form: the line "Compared with the audit of <date>" appears for a site with an evaluated audit and is absent for a first audit; the created audit's `baseline_audit_id` matches
- [ ] Docs, then `pnpm check && pnpm typecheck && pnpm build`

### Task 4: Triage and note carry-over

**Model:** Sonnet
**Files:** modify `packages/db/src/rules-schema.ts` and `report-schema.ts` (`carried_from_audit_id`; generated migration), `apps/web/src/server/audits.ts` (the carry-over inside `createAudit`), `apps/web/src/server/findings.ts` (`setTriage` clears the mark; `findingsOf` returns `carriedFrom`), `apps/web/src/server/report-edit.ts` (saves clear the mark), `apps/web/src/server/findings-data.ts`, the finding detail and Findings row (a muted "Carried over from the audit of 3 Oct" line), the share dialog pre-flight, `AGENTS.md` (Database: triage writers), `docs/vision.md`
**Interfaces:** in the same transaction as the audit insert: `insert into finding_triage select <new audit>, org_id, rule_id, status, reason, updated_by, updated_at, coalesce(carried_from_audit_id, <baseline>) from finding_triage where audit_id = <baseline> and org_id = <org> and status = 'accepted_risk'`; the same for every `report_finding_edit` row; `report_edit` carries `detail` and `include_changes` only. Nothing is copied for a `narrow` audit
**Blocked by:** 3

- [ ] Verify by, on D0: accept the Meta finding's risk ("Client has a contract exception") on the old audit, add a note, set an owner override and leave one finding out; mark another finding Fixed; Re-run; on the new audit `psql -c "select rule_id, status, reason, updated_by, carried_from_audit_id from finding_triage where audit_id = '<new>'"`: exactly the accepted risk, `carried_from_audit_id` = the old audit, `updated_by` and `updated_at` unchanged; the Fixed row is absent; `report_finding_edit` has the note, hidden flag and owner with the mark; `report_edit.summary` is null on the new audit
- [ ] Open the new audit's Findings once its runs have finished: the finding shows Accepted risk with the reason and "Carried over from the audit of <date>"; the Overview score shows "excluding 1 accepted risk" as for any accepted risk; change the reason on the new audit: `carried_from_audit_id` becomes null and the old audit's row is untouched; re-run again (a chain): the origin stays the first audit
- [ ] A rule that does not fail in the new audit (release 1 fixed Meta): the inert row exists, the Findings tab, the register CSV and the report do not show it (`select` the CSV from the register route)
- [ ] Share dialog on the new audit says "1 note carried over from earlier audits; check it still applies"
- [ ] Another organization cannot read the rows: `psql` check that every inserted row has the right `org_id`; the cross-organization 404 from Task 3 still holds; `rg "finding_triage" apps/web/src/workflows` is empty
- [ ] Docs (`AGENTS.md`), then `pnpm check && pnpm typecheck && pnpm build`

### Task 5: The rules-change registry

**Model:** Sonnet
**Files:** create `packages/rules/src/changes.ts` (`RULE_CHANGES`), modify `packages/rules/src/index.ts` (export it), `AGENTS.md` (Rules: raising `RULES_VERSION` also lists the changed rules), `docs/roadmap.md` is untouched
**Interfaces:** `RULE_CHANGES: Readonly<Record<string, ReadonlyArray<string>>>` keyed by the version string (`"3"` to `"6"`), each list the rule ids whose verdict can differ for the same run in that version. Backfilled from git: for each bump, `git log -S'RULES_VERSION = "<n>"' -- packages/rules/src/index.ts`, then the diffs of the commits since the previous bump; a rule added or removed is not listed. Examples to confirm from the diffs: version 3 `clickid.lost-across-navigation`; version 6 the region-default change to `consent.mode-classified` and the rules it touched
**Blocked by:** none

- [ ] Verify by: a throwaway script in `$TMPDIR` that imports the built package and prints, for versions 2 to 6, the rules listed, and a second script that checks every listed id exists in `rules`; paste the table of version → rule ids with the commit each came from; for one entry confirm by running `zinko capture <fixture> --scenario all --rules` at the commit before and after (a worktree at that commit) that the verdict really differs for the same fixture
- [ ] Docs (`AGENTS.md`, `docs/vision.md`), then `pnpm check && pnpm typecheck && pnpm build`

### Task 6: The comparison of findings and the Compare tab

**Model:** Opus
**Files:** create `apps/web/src/lib/compare.ts` (types, the state machine, `changesBriefing`, `scoreDeltaOf`, `narrowedConfig` is added in Task 8), `apps/web/src/server/compare-data.ts` (`comparisonOf(orgId, auditId, againstId)`), `apps/web/src/server/compare.ts` (`getComparison`, `setBaseline`), `apps/web/src/components/change-badge.tsx`, `apps/web/src/components/compare/{summary,findings-table,notices}.tsx`, `apps/web/src/routes/app/audits/$auditId.compare.tsx` (search `against`, `state`), the tab in `$auditId.tsx`, `docs/ui.md`, `docs/vision.md`
**Interfaces:** `getComparison({ auditId, against? }) -> Comparison | { baseline: null }`; `against` defaults to `audit.baseline_audit_id`; both ids through `auditInOrg`, same site, `against` older and evaluated, else 404; `setBaseline({ auditId, against })` (any member; same checks; writes `baseline_audit_id`). Reads `findingsOf`, a `check_result` select without `message` and `evidence` joined to `run` for both audits, `bannerDetection` for both, the earlier audits' `finding.kind`, and `RULE_CHANGES`. Cells are keyed as in "Types and the state machine"
**Blocked by:** 2, 3, 4, 5

- [ ] Write the expected states first from the Task 2 README: D0 (audit 1), D1 (audit 2), D2 (audit 3), each 12 runs on `/drift/`, `/drift/product`, `/drift/thank-you` and `/clean/` as a control, scenarios none, accept, reject, desktop, vendor requests answered locally, run in order with `release` switched between them, each started with Re-run so the baselines chain. Expected: audit 2 vs 1: Meta **fixed**, duplicate purchase **fixed**, PII **unchanged**, currency **new**; audit 3 vs 2: Meta **regressed** (it passed in audit 2, the baseline, and failed in audit 1, so `earlierFailure` is audit 1 and the row reads "Passed in the audit of <audit 2 date>, fails again"), currency **fixed**; audit 3 vs 1 (picker): Meta **unchanged**, purchase **fixed**
- [ ] Verify by, in the browser at 1440x900 and 390x844, both themes: the Compare tab shows exactly those states with the glyph and word of each; counts match; the spread and the per-cell table for PII (unchanged) match `select` queries on `check_result` joined to `run` for both audits (paste both); the picker lists only this site's earlier evaluated full audits; **Make this the baseline** writes the link; grayscale screenshot tells all six states apart
- [ ] Not comparable, each produced for real: (a) change the scope: re-run with the `/drift/product` page removed and scenario gpc added: cells outside the common set are counted, no false "fixed"; (b) `update check_result set rules_version = '5' where run_id in (select id from run where audit_id = '<baseline>')` (scratch database) and a `RULE_CHANGES["6"]` entry for one rule present in the data: that rule reads Not comparable "The rule changed in version 6" while the others still compare, and the notice names versions 5 and 6; (c) a banner-dependent rule where the second audit's accept and reject runs used the `no-cmp` site's URL for the same page key (scratch SQL: update `run.consent` outcome to `not-found` on the accept and reject runs): `banner_differs` on the `none` cells; (d) a rule missing from one side (delete its `check_result` rows): `rule_added`
- [ ] Score line: compare an audit against a partial-coverage one (P): the line shows both scores and "Not compared: coverage differs", no delta; the different-`SCORE_VERSION` branch is read from the code path, since no old-version audit exists to run
- [ ] Empty states: first audit of a site; baseline set to null; baseline deleted (`delete from audit` in scratch, `on delete set null` leaves the audit working); re-run still running (progress, live update through the room); nothing changed (compare an audit with a re-run of the unchanged `clean` fixture: "No finding or tag changed in the 12 shared cells")
- [ ] Security: another organization's audit id, an audit of another site in the same organization, a newer `against`, a non-uuid: all 404; `against` equal to the audit id: `Invalid`
- [ ] Docs (`docs/ui.md`: the Compare tab, the change vocabulary), then `pnpm check && pnpm typecheck && pnpm build`

### Task 7: Tag-level diff

**Model:** Sonnet
**Files:** modify `apps/web/src/server/compare-data.ts` (`tagDiffOf`), `apps/web/src/server/compare.ts` (`getTagDiff`), `apps/web/src/lib/compare.ts` (tag types), `apps/web/src/components/compare/tags.tsx`, the Compare route (the collapsed Tags section, loaded when opened), `docs/vision.md`
**Interfaces:** `getTagDiff({ auditId, against? })`, the same checks as `getComparison`. Output as in "Tag diff"
**Blocked by:** 6

- [ ] Verify by, on the Task 6 audits: audit 2 vs 1 shows TikTok `ZINKOTT0001` **disappeared** on every compared cell, GA4 `G-ZINKO00001` gone and `G-ZINKO00002` new on the same cells as one **destination changed**, `view_item` removed from the `/drift/product` GA4 tag as **events changed**; audit 3 vs 2 shows no tag change; cross-check each line against `select distinct vendor, destination_id, event from hit join run … where audit_id = '<id>'` for both audits (paste the diff of the two result sets)
- [ ] A partial run is never "disappeared": delete a run's capture-derived hits and set the run `partial` (scratch SQL) for one cell: that cell is dropped from the compared set and the Tags section says "1 cell was not compared (the run did not finish)"
- [ ] `EXPLAIN (ANALYZE, BUFFERS)` of the grouped scan on the 227k-hit audit (seed-max.sql): record time and plan; if over budget add the covering index in a generated migration
- [ ] Docs, then `pnpm check && pnpm typecheck && pnpm build`

### Task 8: Narrow re-runs: Verify fix

**Model:** Sonnet
**Files:** modify `apps/web/src/lib/compare.ts` (`narrowedConfig`), `apps/web/src/server/audits.ts` (`verifyFinding`, uses `createAudit` with `kind: "narrow"`), `apps/web/src/components/finding-detail.tsx` (Verify fix, the result block), the audit header and site history (Verification badge, no score), `client-summary.ts` and `clients.ts` (finish the `kind = 'full'` filters), `docs/ui.md`, `docs/vision.md`
**Interfaces:** `verifyFinding({ auditId, ruleId }) -> { auditId }`: the audit and the finding through `auditInOrg`, the failing runs from `finding.run_ids`, `narrowedConfig(config, runs)`, `createAudit({ kind: "narrow", narrowRuleId: ruleId, baseline: auditId })`; the same guards as `rerunAudit` (a verify already running for that finding is refused). A narrow audit carries nothing over and is not offered as a baseline
**Blocked by:** 3, 6

- [ ] Verify by, on D0 then `release 1`: Verify fix on the Meta finding: the dialog states the run count (compute the expected number first: the distinct pages × scenarios × viewports of `select page_url, scenario, viewport from run where id = any(<finding.run_ids>)`, which can exceed the failing cells) and the estimate; the new audit has `kind = 'narrow'`, `narrow_rule_id`, the narrowed config (`psql`), is listed in the site history with a "Verification" badge and no score; the Clients table and the sparkline and the command palette's recent audits **do not** include it (compare screenshots before and after); the finding detail on the old audit shows "Re-checked <time>: passes on n of n runs" once it finishes
- [ ] A journey finding (`redirect-gclid`, journey on) keeps its pages and journey flag in the narrow config; a `clickid.*` finding on the start page keeps `clickIds`; a finding on a non-start page gets `clickIds: false` (check the stored config)
- [ ] Verify while another audit runs: the narrow audit finishes before the earlier large audit's remaining captures (decision 0003), observed by run timestamps
- [ ] Verify with the cap and the in-progress guard as in Task 3; the Compare tab of the narrow audit shows only common cells (other rules read Not comparable "No shared page and scenario" or compare normally where cells overlap)
- [ ] Docs, then `pnpm check && pnpm typecheck && pnpm build`

### Task 9: Flaky verdicts: confidence and confirmation

**Model:** Sonnet
**Files:** modify `apps/web/src/lib/compare.ts` (confidence), `packages/rules/src/changes.ts` (`VOLATILE_RULES`, with the reason for each, next to `RULE_CHANGES`), `apps/web/src/server/compare-data.ts` (flip history, confirmations), the Compare finding row and detail (Low confidence chip with its reasons, **Re-run these pages**, the confirmation line), `docs/vision.md`, `docs/roadmap.md` (the "Flaky verdicts on real sites" leftover)
**Interfaces:** `Re-run these pages` calls `verifyFinding` for the changed finding (so a flaky *new* or *fixed* change can be re-checked the same way). Confirmation = the newest settled narrow audit with `baseline_audit_id` = this audit and the rule: "Seen again on 2 of 2 runs" or "Did not repeat on 2 of 2 runs"
**Blocked by:** 6, 8

- [ ] Verify by: audit `flaky-meta` (D flaky) three times with Re-run, resetting the counter between the first two (`/_flaky/reset`) and not before the third: the second and third audits' Meta finding shows Low confidence with `flips` after the second flip, with the words "Changed 2 times in the last 3 audits"; the `consent.default-after-tag` finding on `consent-default-late` compared with itself is Low confidence for `volatile_rule`; a change resting on one run shows `single_run`; Low confidence never changes the state (the state column is identical with and without the chip)
- [ ] Click **Re-run these pages** on the flaky change: a narrow audit runs; after it finishes the row says "Seen again on n of m runs" or "Did not repeat on n of m runs", matching `select status, count(*) from check_result … where rule_id = 'consent.pixel-without-consent' and run_id in (<narrow audit runs>) group by 1`
- [ ] A real-site check (the product owner's pick, or `https://example.com`): audit twice back to back and read the Compare tab; record any change that appears and whether the confidence chip explained it, as a leftover in `docs/roadmap.md`
- [ ] Docs, then `pnpm check && pnpm typecheck && pnpm build`

### Task 10: The briefing, change chips and entry points

**Model:** Sonnet
**Files:** modify `apps/web/src/routes/app/audits/$auditId.overview.tsx` and `apps/web/src/server/overview.ts` (the briefing card; the comparison is fetched in the loader, tag lines from a counts-only tag variant), `apps/web/src/routes/app/audits/$auditId.findings.tsx` (change chips fetched after the list renders), `apps/web/src/routes/app/sites/$siteId.tsx` (Compare link per history row), `apps/web/src/components/command-palette.tsx` (nothing new unless it already knows the audit), `docs/ui.md`, `docs/vision.md`
**Interfaces:** `changesBriefing` from `lib/compare.ts`. The briefing card: heading "Since the audit of 14 Oct", at most six lines, "See all changes" to the Compare tab; hidden with no baseline and for narrow audits
**Blocked by:** 6, 7

- [ ] Verify by, on audit 3 of Task 6 (regressed Meta, fixed currency, unchanged PII): the Overview opens with the briefing: the regression first ("Regressed: Ad pixel fired without consent passed on 21 Oct and fails again"), then fixed, then the score line with a delta; the same audit with a different `against` is not on the Overview (it follows the stored baseline); the first audit and a narrow audit have no briefing; a baseline whose rules changed shows the "could not compare n checks" line; tag lines on audit 2 ("TikTok ZINKOTT0001 no longer fires on any page checked in both audits")
- [ ] Findings tab: each failing row shows its change chip only after the list is on screen (throttle the network in devtools and watch order); filtering by state is not added (YAGNI); at 390px the chip does not push the row to a third line
- [ ] The site history: Compare link on each row with a baseline; screenshot at 390 and 1440 in both themes and grayscale
- [ ] Record the Overview's p50/p95 before and after on (X) once Task 12 exists; until then note the local numbers on D0 to D2
- [ ] Docs, then `pnpm check && pnpm typecheck && pnpm build`

### Task 11: The report's "What changed" and the register

**Model:** Opus
**Files:** modify `apps/web/src/lib/report-model.ts` (`changes`, `REPORT_MODEL_VERSION` 4, the `modelVersion` literals, `UPGRADES[3]`), `apps/web/src/lib/report-projection.ts` (a validator for every new leaf path, `destinationLabel` use), `apps/web/src/server/report-data.ts` (`buildReport` builds `changes` from `comparisonOf` and the tag diff, in the same `REPEATABLE READ` read; the stamp gains the baseline id and its newest `finished_at`), `apps/web/src/server/report-edit.ts` and `packages/db/src/report-schema.ts` (`include_changes`; generated migration), `apps/web/src/components/report/changes.tsx` and `report-view.tsx`, `apps/web/src/server/register-data.ts` (columns "Change since baseline" and "Baseline date", and a row for each verified-fixed finding), `docs/vision.md`, `docs/ui.md`
**Interfaces:** as in "Report: `changes`". The consultant view has the "Include what changed" switch and the carried-notes pre-flight in the share dialog. Pages are counted, never named. `include_changes = false` or no baseline gives `changes: null`
**Blocked by:** 4, 6, 7

- [ ] Verify by: build the report of Task 6's audit 3; `getReportDraft` JSON has `changes` with the counts of the Compare tab (cross-check each number), `assertProjected` passes, and a deliberately unregistered path (add a field in a scratch edit) fails the build as a defect (revert it); publish version 1 (Share dialog), change the baseline (Make this the baseline on another audit): the status chip reads "Unpublished changes", publishing again creates version 2, version 1 still shows its original `changes` (`select model->'changes' from report_snapshot` for both)
- [ ] Old snapshots: a snapshot published before this task (model version 3) still renders at `/r/<token>`; `decodeStoredReportModel(3, json)` upgrades it with `changes: null` (check on a snapshot written on `main` before the migration, or write one with the old code in a scratch worktree); a version 4 snapshot opened with the old code is not required
- [ ] The public page at 390 and 1440 and the print: "What changed since <date>" after the summary, no page names, counts of pages ("fixed on 3 of 4 pages compared"), Standard level shows no ad-platform ID in the tag lines and Detailed shows them; `grep -c` the hostile strings of the extended seed over the draft JSON, snapshot, public HTML and the CSV: zeros under Standard (Task 12 completes the matrix); the switch off removes the section from the draft and the next snapshot
- [ ] Register CSV opened in LibreOffice: two new columns, a Fixed row for the verified-fixed Meta finding with the baseline's severity, formula escaping intact
- [ ] Docs (`REPORT_MODEL_VERSION` 4 in `docs/vision.md` "Report (M5)"), then `pnpm check && pnpm typecheck && pnpm build`

### Task 12: Performance, security and the hostile matrix

**Model:** Opus
**Files:** create `docs/plans/2026-10-28-m6-compare/seed-compare.sql` and extend `docs/plans/2026-10-28-m5-report/seed-hostile.sql` (as a new file `seed-hostile-compare.sql` next to the new plan); an index or a narrower query only if a target is missed; `docs/vision.md` (measured numbers)
**Interfaces:** the targets in "Performance targets"; the matrix in "Security"
**Blocked by:** 10, 11

- [ ] Seed (X): load `seed-max.sql`, then `seed-compare.sql` (a second audit of the same site with the six known flips, a third older audit for the regression, three accepted risks, one removed tag, one changed destination); state the expected `getComparison` counts from SQL first
- [ ] Performance: 20 calls, p50 and p95 and sizes (serialized responses) for `getComparison`, `getTagDiff`, `getOverview` before and after the briefing, `getReportDraft` and `publishReport` before and after `changes`, `rerunAudit`, the Findings tab; `EXPLAIN (ANALYZE, BUFFERS)` on the check-result select and the hit scan; the Compare tab at 390 on (X) (the cell table capped, no horizontal page scroll); report print page count with `changes`; the 19-distinct-captures evidence read for the report (the M5 leftover): count R2 reads and time them
- [ ] Security: the 404 matrix over `getComparison`, `getTagDiff`, `setBaseline`, `rerunAudit`, `verifyFinding` (foreign organization, other site, newer `against`, non-uuid, archived site) with a second organization's session; a member can re-run, verify and set a baseline but cannot do what only owners do (unchanged)
- [ ] Hostile matrix: with the hostile baseline (finding titles are static, so the strings go into tag events, destinations, page paths, accepted-risk reasons and notes), run the `grep -c` table over the draft JSON, `report_snapshot.model::text`, the public HTML, the print text and the CSV, under Standard then Detailed; paste it. Reasons and notes appear exactly as typed only where M5 allows them
- [ ] `pnpm check && pnpm typecheck && pnpm build`

### Task 13: Empty and partial states sweep

**Model:** Sonnet
**Files:** whatever the sweep finds (components under `apps/web/src/components`, the audit routes), `docs/qa/2026-10-28-ux-sweep-r5.md` (new, in the format of rounds 1 to 4: table of issues with batch, severity, issue, fix), `docs/ui.md` (States), `docs/roadmap.md` (UX rounds)
**Interfaces:** none new
**Blocked by:** 10, 11

- [ ] Walk the product as a first-time consultant at 390 and 1440, light and dark (the dark theme was not re-run in round 4), grayscale where status matters, on these states: no clients; a client with no sites; a site with no audits; queued; running with the engine stopped (the "waiting" copy); partial (P); failed before start; an audit with nothing captured (no 100/100); not evaluated; mixed rules versions (the Findings alert, never exercised); a null `check_result.check_title`; Open in Hits from every evidence kind; the "Audit failed" and "not evaluated" completion toasts; a 44-run audit for density; a run matrix legend (the half ring and spinner are told apart only by a word); the Report with no findings, with only Could not check, with the summary "Could not check: n rules" naming the first rules; every Compare empty state of Task 6; the briefing absent; the narrow audit's pages; a member versus an owner on Compare, Re-run and Branding
- [ ] Fix every major and medium item in batches; list the rest. Re-check the previously open items from rounds 3 and 4 that touch these states (focus order of the Overview, "Reconnecting" label on a deployed build is Task 1's)
- [ ] `pnpm check && pnpm typecheck && pnpm build`

### Task 14: Docs: README, self-host guide, contributor path

**Model:** Sonnet
**Files:** `README.md` (rewrite), `docs/self-hosting.md` (new), `infra/README.md`, `CONTRIBUTING.md`, `SECURITY.md` (new, short), `package.json` / `turbo.json` (only the smaller of the two fixes below), `docs/architecture.md`, `docs/product.md` (v0.1 item 9 now true; "Not in v0.1" unchanged), `docs/vision.md` ("Compare and polish" rows to built), `AGENTS.md` (a Compare section: the baseline link, computed on read, `RULE_CHANGES`, carry-over, narrow audits excluded from latest selection)
**Interfaces:** the README follows the `readme-optimization` skill: what it is, why it beats the alternative, the first command in a minute, claims verified against the source. The self-host guide is written from the commands that worked in Task 1's decision record, with the container image, the Workers Paid requirement, Postgres and Hyperdrive, every secret and how to generate it, `pnpm db:migrate` against the production URL with `DATABASE_URL` exported, first sign-up, `BETTER_AUTH_URL`, mail, the rate-limit rule, upgrading and backing up, and a plain statement of what is untested. If Task 1 failed, the guide says so and shows the local run only
**Blocked by:** 1, 10 (for screenshots), and the demo for a real screenshot (Task 15; use fixtures until then)

- [ ] README claims checked one by one against the code: the number of checks (`rules.length`, not "19"), the vendors, "re-runs mark findings new or fixed" (now true), the white-label report (true), the mockup image replaced by a real screenshot from the demo, "Status: early development" replaced by the honest v0.1 line and a **Known limits** section (banner detection under none and gpc, no region simulation, Cookiebot accept on Happy Socks, click IDs on the start URL only, 30 runs take about `<Task 1 number>` minutes, scores provisional)
- [ ] Fresh clone: in an empty directory, `git clone`, follow the README and CONTRIBUTING exactly (`pnpm install`, `pnpm build`, `docker compose up -d`, `pnpm db:migrate` with an explicit `DATABASE_URL`, fixtures, engine, `pnpm dev`), run a first audit of a fixture, paste the commands and the time. Fix the "fresh clone needs a build before `pnpm check`" leftover: either make `check` depend on the builds in `turbo.json` or put `pnpm build` first in the "Before you finish" line of `AGENTS.md`; pick the smaller change after reading `vite.config.ts` and `package.json`
- [ ] Follow `docs/self-hosting.md` verbatim against a clean stage (reuse Task 1's account), fix what is wrong, destroy the stage
- [ ] `pnpm check && pnpm typecheck && pnpm build`

### Task 15: The public demo instance

**Model:** Opus
**Files:** `scripts/demo/export.ts` and `scripts/demo/import.ts` (run with an explicit `DATABASE_URL`, not committed to a package), `apps/web/src/server/server-fn.ts` (`respond` refuses when the session's organization is `DEMO_ORG_ID`), `apps/web/src/server/auth.ts` (`disableSignUp` when `DEMO_MODE`; a `hooks.before` refusing account, password, user, organization and invitation endpoints for the demo user), `apps/web/src/routes/sign-in.tsx` (a "Try the demo" box showing the public credentials when `DEMO_MODE`), `infra/alchemy.run.ts` (a demo stage: no Container, `DEMO_MODE`, `DEMO_ORG_ID`, the rate-limit rule), `docs/decisions/0005-demo-instance.md`, `docs/vision.md`
**Interfaces:** the export reads one organization's `client`, `site`, `audit`, `run`, `hit`, `datalayer_push`, `check_result`, `finding`, `finding_triage`, `report_*` and branding rows and the captures and screenshots named by `run.capture_key` and `run.screenshot_key`, rewrites the host `localhost:4400` to a fictional `shop.harbor-demo.example` in rows and in the stored capture JSON, rewrites the organization and user ids to fixed demo ids, and writes SQL plus an object list. The import is idempotent (`on conflict do nothing`, natural keys on `hit` and `datalayer_push`) and uploads objects to R2. The seeded story is the three `drift` audits of Task 6 with baselines chained, one accepted risk, a note, branding, and a published report with a **known** token whose hash is inserted (the token is printed in the README as the demo report link)
**Blocked by:** 1, 11, 12

- [ ] Verify locally with `DEMO_MODE=true DEMO_ORG_ID=<id>` and a fresh `zinko_m6_demo` database: import, sign in with the public credentials; Clients, the three audits, Compare (regressed, fixed, tag disappeared), the Overview briefing, Hits, the report and its CSV all work; **every mutation is refused with one message**: create client, start audit, Re-run, Verify, triage, report edit, branding, share link, AI settings, explain (try each in the UI and with a direct server-function POST); change password and update profile through the Better Auth client are refused; sign-up is closed (`/sign-up` and the API); `rg -n "createServerFn" apps/web/src/server` lists no mutation that bypasses `respond` (list any exception and fix it)
- [ ] Deploy the demo stage on the Task 1 account: the same checks against the deployed URL, the public report link, `/r/*` rate limit, `curl -I` headers, a page weight check; the footer says what the demo is; destroy or keep it per the owner
- [ ] Fallback if the live path fails: publish the seeded report as a link and put the screenshots in the README, and record why in the decision record
- [ ] `pnpm check && pnpm typecheck && pnpm build`

### Task 16: Release readiness, the sweep and the demo

**Model:** Sonnet
**Files:** `docs/roadmap.md` (M6 row done locally with the date; leftovers rewritten; the v0.1 blockers table copied with outcomes), `docs/vision.md` (an "M6 demo" section, measured numbers), `docs/ui.md`, `docs/product.md` only where behaviour differs, `AGENTS.md` (one consistency read), `CHANGELOG.md` if the owner wants one (open question), this plan (`status: implemented`, an execution status paragraph)
**Interfaces:** none new
**Blocked by:** 1 to 15

- [ ] Sweep at 390x844 and 1440x900, both themes, grayscale: the Compare tab and its notices, the briefing, the narrow audit, the report with `changes`, the demo sign-in; no horizontal page scroll, 32px targets, focus rings, no hard-coded colours or inline `style` (`rg` over the new files), vocabulary (`rg -i "inconclusive|healthy|clean"` over the new strings finds only "No failing checks" and the `clean` fixture name)
- [ ] The demo end to end on a real client-style site, recorded in `docs/vision.md`: audit, mark one finding fixed and accept one risk, share a report, make a fix on the fixture (`release 1`), Re-run, read the briefing, open Compare, Verify one fix, see the carried risk, publish the second report with "What changed", open it signed out on a phone-width viewport, save the PDF, export the CSV
- [ ] The real-provider explanation run (M4 Task 13) with a key from the owner on `meta-before-consent` and `consent-default-late`; the Firefox print of a public report by hand; record both
- [ ] The "we audited N sites" dataset: with the owner's approved list of public sites (open question 8), one audit each (start page, two key pages, four scenarios, click IDs on, vendor requests answered locally, no crawling beyond those pages), each finding triaged by hand into true, false positive or cannot tell; every false positive becomes a fixture and a rule fix (`AGENTS.md` rule workflow) or a leftover; the write-up is outside this repo and is the owner's
- [ ] Release checklist: version tag `v0.1.0`, `LICENSE` and `SECURITY.md` present, issue templates, the README's first command works from a clean clone, the demo is up, the self-host guide has been followed once, the roadmap's "Show HN" row marked ready. `pnpm check && pnpm typecheck && pnpm build` exit 0, zero warnings

## Open questions for the product owner

Each with a recommendation; the plan proceeds on the recommendation.

1. **Default baseline for the New audit form.** Recommend: the site's latest evaluated full audit, shown on the form with Change, so "what changed" works for people who never press Re-run. The alternative is baselines only from Re-run.
2. **Cap of active audits per organization.** Recommend 5 queued or running audits (narrow audits included). The queue is global (decision 0003), so per-organization fairness is still open.
3. **Carrying notes and "leave out" to a re-run.** Recommend carrying them, marked, with the share dialog's pre-flight line, because a consultant re-sending a report expects the same wording; the risk is a stale note on a client report.
4. **"What changed" in the client report by default.** Recommend on, with the per-report switch. A first re-run report that says "3 new" to a client may not be what the consultant wants to send.
5. **Rules-change registry vs re-judging old captures.** Recommend the registry now and "Re-evaluate this audit with today's rules" as a v0.2 feature; the registry needs a hand-kept list each time `RULES_VERSION` is raised (`AGENTS.md` enforces it).
6. **Narrow audits in the site history.** Recommend visible, badged, scoreless, and out of the baseline picker, so the trail of a verification is not hidden.
7. **Demo shape.** Recommend the live read-only demo with a public credential and sign-up closed; the fallback is a published report link and screenshots.
8. **Which public sites for "we audited N sites", and whether the owners are told first.** Recommend 10 to 20 sites, a list approved by you, no site named in the write-up with a critical finding that was not first reported to its owner, and the false-positive rate published.
9. **End the no-tests phase after v0.1?** Recommend yes: start with the comparison engine and the rules (pure functions) and a CI job that runs the fixture README check (`zinko capture … --rules` against the expected sets). Not part of M6.
10. **Engine elsewhere if Containers are unavailable.** Recommend deciding after Task 1: if needed, honour `BROWSER_URL` on deployed stages with a shared-secret header, not before.
11. **Score delta across score versions.** Decided: not shown (both scores, no delta, with the reason). Say if you want the old score recomputed under the new weights instead.
12. **Single-run retry in place after v0.1.** Recommend yes, with its own plan: the run's evidence is overwritten, so it needs a decision on keeping the previous capture.
13. **Who pays for the spike and the demo stage.** Containers need the Workers Paid plan; Task 1 and Task 15 need a Cloudflare account and token from you, and a Neon (or other) Postgres.

## Not in this plan

Single-run retry in place, audit cancel, parallel captures within an audit, scheduled re-runs and alerts, re-judging an old audit with current rules, region simulation or a recorded vantage point, comparing across sites, a stored comparison table, a screenshot or cookie or raw-request diff, AI text about changes, a "what changed" email or Slack digest, consultant-typed page names, a custom accent, a changelog UI, billing, a free public single-URL scan, a Chrome extension.

## Task list at a glance

1. Deploy spike: the container image and `alchemy deploy` (start first, runs beside the rest).
2. Fixtures: `drift` releases and `flaky-meta`, README expected results first.
3. Re-run with the baseline link, guards and the active-audit cap.
4. Triage and note carry-over (accepted risks, notes, owner, leave-out).
5. The rules-change registry (`RULE_CHANGES`).
6. The comparison of findings and the Compare tab.
7. Tag-level diff.
8. Narrow re-runs: Verify fix (cut line).
9. Flaky verdicts: confidence and confirmation (cut line).
10. The briefing, change chips and entry points.
11. The report's "What changed" and the register (model version 4).
12. Performance, security and the hostile matrix.
13. Empty and partial states sweep.
14. Docs: README, self-host guide, contributor path.
15. The public demo instance.
16. Release readiness, the sweep and the demo.

## Execution status

Not started. This plan is proposed; implementation begins after the product owner answers the open questions that block a task (13 for Task 1, 8 for Task 16) and a review round.

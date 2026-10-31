# Design pass: the job loop in the app

Status: approved after review r3. Findings and answers of each round are at the end.

## Why

A design exploration (Penpot, 2026-10-31; boards exported to the untracked `design/exports/`, research in
`design/research/mobbin-inspiration.md`) placed every screen on one job loop:
Set up → Scope → Capture → Diagnose → Decide → Deliver → Verify. It kept every colour token (all text
pairs measure at least 4.5:1 in both themes) and proposed four changes to how screens are ordered. This plan
builds those four changes in code, and writes the design system down as a living page and a section of
`docs/ui.md`. No new colours, fonts or dependencies, and no schema change.

Out of scope: the Retry failed runs UI (it ships with the retry plan's UI task, which owns its data), any
change to stored data, rules, the report model or the public report.

## Decisions

### 1. The audit says where it is in the loop

A stage strip under the header of a **full** audit (a re-check shows none), four steps. Each step is a
`StatusGlyph` plus words, never colour alone; "done" is a glyph and the word, not a fill. The strip has no
"current" colour; the first step that is not done carries the word "Next". Each step is a link (32px target,
`focus-visible` ring) to where it moves. At 390px it is a 2×2 grid. All of it is computed on read in
`getAudit`, scoped by the organization and the audit already checked there.

- **Capture** (links to Evidence › Runs).
  - Active (`queued`/`running`): "n of m runs finished", glyph `running`.
  - Settled, every run `complete`: "m of m runs captured", glyph done.
  - Settled with gaps: "c captured, p partial, f failed" (zero parts omitted) with the `partial` glyph, or the
    `failed` glyph when nothing was captured. Settlement never implies a successful capture.
- **Decisions** (links to Findings).
  - Denominator k = the audit's current failing findings (the rows Findings lists as failing).
    Numerator n = those of them with an organization-scoped `finding_triage` row whose status is
    `accepted_risk` or `fixed`; a missing row or `open` is undecided, and triage rows of rules that are not
    current failing findings are ignored.
  - Words: "n of k decided"; when some of the n were carried over from the baseline
    (`inherited_from_audit_id` set), add "(i carried over)". Done when n = k > 0.
  - Not yet evaluated (active, or settled with no check results): "Not evaluated", glyph `not-evaluated`,
    never done. Evaluated with k = 0: "No failing findings", done.
  - "Fixed" here is the author's mark; the strip never calls it verified.
- **Report** (links to Report; with a live link, to Report › Share).
  - Published versions are the surviving `report_snapshot` rows of the audit (organization-scoped); the
    published version is the highest surviving `version`, never `audit.report_version_seq`.
  - A live share is a `report_share` joined through a surviving snapshot of the audit with
    `revoked_at is null and (expires_at is null or expires_at > now())` (the predicate `overview.ts` already
    used; it is `liveShares(orgId, auditIds)` in `server/report-share-data.ts`, committed with this plan and
    already used by `overview.ts`, so every task starts from the one copy).
  - n = the highest surviving version, s = the highest version with a live link. Words: "Draft" (no
    snapshot), "Published v<n>" (no live link), "Shared v<s>" (s = n), "Shared v<s>, latest v<n>" (s < n).
    Done when shared. The strip never says the current draft is what readers see.
- **Re-audit** (renamed from "Verified": a baseline link records a comparison choice, not verification).
  - The successor is the newest full audit of any status, of the same site in the organization, whose
    `baseline_audit_id` is this audit, ordered by `created_at desc, id desc`.
  - None: "Re-run after fixes", not done. The step is a button that opens the existing Re-run dialog through
    the same open handler as the header's Re-run button, and the dialog restores focus to whichever opener
    was used (`onCloseAutoFocus`, as `ConfirmDialog` does). While this audit is active, or its site is
    archived, the step is plain text with the reason ("after this audit finishes", "site archived"), like the
    header button's own states.
  - A settled successor with check results: "Re-run <relative time>", done, links to that audit's Changes tab
    (the comparison tells what was fixed; the strip does not).
  - A successor that is active or not evaluated: "Re-run in progress" or "Re-run not evaluated" with its
    status glyph, not done, links to it. A deleted successor simply is not found.

The Overview's `NextSteps` card is removed (T2) and its server fields deleted: the strip replaces it, and the
two must not disagree. Its one-line "Active share link. Manage in Share" becomes the Report step's link.

### 2. Five audit tabs instead of seven

Overview, Findings `n`, Changes, Evidence `runs`, Report. Evidence holds Runs, Tags and Hits behind a
secondary tab row; the URLs `/app/audits/$id`, `/matrix` and `/hits` stay, so links keep working, and the
Evidence tab is active (underline plus `aria-current="page"`) on all three. Both rows scroll horizontally
inside their container at 390px with inset focus rings. Compare is renamed Changes wherever it names the tab
or page (the tab, the page title from `auditTabName`/`pageTitle` callers, the route heading, the "See all
changes" links); "comparison" as a noun in prose stays. Files: `routes/app/audits/$auditId.tsx`,
`$auditId.compare.tsx`, `lib/audit-labels.ts` if it names the tab, and any `Compare` link text in
`routes/app/sites/$siteId.tsx`, `components/compare/*`, `components/recheck-dialog.tsx`.

### 3. Overview leads with the worst finding and its proof

Directly under the score card and above the comparison briefing (as in the export), a "Start with" card for
the open failing finding ranked first by severity, then most failing runs, then rule id. Open = failing and
not triaged `accepted_risk` or `fixed`. It shows the severity badge, the stored title, one line of scope
("Failed on 8 of 26 runs where it could be checked, on 3 pages"), the stored why, the first stored fix step,
and the proof:

- The proof run is the first failing **target** run in run order (`candidateRunsOf(..., { candidates: 1 })`).
  The proof is the first `EvidenceRef` of kind hit or request in that run's `check_result.evidence` for the
  rule, resolved through `readCaptureTolerant` and rendered with the existing `RequestView`. Only the fields
  `RequestView` needs are returned.
- When the cited evidence has no hit or request (a cookie, push or document): "This finding cites a cookie /
  dataLayer push / the page; open it in Findings to see it."
- When the capture cannot be read: "The captured request could not be loaded." The card stays in both cases.
- Actions: Open in Findings (`?finding=<ruleId>`), and Open in Hits (`?run=&hit=<requestId>:<batchIndex>`)
  only when the proof is a cited **hit** (it carries its batch index and a decoded hit exists). A cited raw
  request (`EvidenceRef` of kind request, e.g. `hygiene.tag-errors`) still shows `RequestView` but offers only
  Open in Findings.

When nothing is open it keeps today's "No open failing findings" line. Wording comes from the stored
`finding`/`check_result` rows, never the live rules registry and never `check_result.message`.

### 4. Sites starts with what needs attention

Above the table, a "Needs attention" list (absent when empty), at most one row per active site, the first
reason that applies. Only full audits count; re-checks never do. Data comes from a new helper
`attentionOf(orgId, siteIds)` in `server/client-summary.ts`, called by `listSites`; `siteSummaries` and the
score semantics other pages rely on do not change. Per site it reads, with deterministic order
(`created_at desc, id desc`):

- **latest settled**: the newest settled full audit (status, `finished_at`, run counts by status);
- **latest evaluated**: the newest settled full audit with check results (its open Critical count from
  `auditDetails`, the same count the table shows, and the live-share predicate above).

Reasons, first match wins:

1. latest settled is `failed`, or `partial` with incomplete runs: "f failed, p partial of m runs", action
   Open (its Runs);
2. latest evaluated has open Critical findings: "n Critical open", action Open (its Findings);
3. latest evaluated finished more than 24 hours ago, has failing findings, and no live share link: "Report not
   shared", action Open the report.

The header meta gains "n need attention" (a glyph plus words). Regressions are not a reason: they need the
comparison per site, which stays on the audit's Overview.

## The design system, written down

- `docs/ui.md` gains a "Design system" section: tokens by role (surfaces, text, borders, the severity and
  status sets, the report accents), the type roles, spacing and radius steps, the shared components and when
  to use each, the patterns (page frame, header, stage strip, tabs and secondary tabs, row, notice, empty
  state, "Start with"), and the 390/1440, keyboard and grayscale checks. It names tokens, never copies values.
  The vocabulary list gains Changes (the tab), Decisions, Re-audit.
- `/app/design-system` (signed in, not linked from navigation, `noindex`) renders each token swatch with its
  name, the type roles, and the shared components in their states (buttons, badges, glyphs, rows, notices,
  stat and score pieces, the stage strip in its states, evidence views with a fixed sample request) from the
  real components. No server function, no data.
- `docs/vision.md` records the stage strip, the tab regrouping and Needs attention under the UI section.

## Tasks

Each task is built by its own agent in its own worktree. Before building, the agent loads the
`frontend-design` and `ui-ux-pro-max` skills (both installed for the building agents), follows `AGENTS.md`'s
UI section, and checks in the browser at 390 and 1440 in both themes through the real theme menu, with a
grayscale look at status, keyboard through every new link and both tab rows (visible ring, inset where
clipped), 32px targets, and the edge cases named in its decision. `pnpm check && pnpm typecheck && pnpm
build` clean. No tests (current phase). Each task is reviewed before merge.

- **T1 Audit frame**: decisions 1 and 2. `routes/app/audits/$auditId.tsx`, a new
  `components/stage-strip.tsx`, `server/audits.ts` (`getAudit` gains `stage`, using `liveShares`),
  `components/rerun-dialog.tsx` if the opener needs lifting, and the Compare files listed in decision 2.
- **T2 Overview "Start with"**: decision 3 and the `NextSteps` removal. `routes/app/audits/$auditId.overview.tsx`,
  `server/overview.ts`, `components/evidence.tsx` (`RequestView` takes a `Pick<CapturedRequest, ...>` of the
  fields it reads, so the server returns only those). Removing `NextSteps` removes `overview.ts`'s `liveShares` call; the helper stays,
  used by T1 and T3.
- **T3 Sites "Needs attention"**: decision 4. `routes/app/sites/index.tsx`, `server/clients.ts` (`listSites`),
  `server/client-summary.ts` (`attentionOf`), calling the committed `liveShares`. It does not change the
  helper.
- **T4 Design system page and docs**: after T1–T3 are merged. `routes/app/design-system.tsx`, `docs/ui.md`,
  `docs/vision.md`. Sole owner of the docs.

T1, T2 and T3 run in parallel. Merge order T1, T2, T3, then T4.

## r1 review and answers

1. Verified did not establish verification: renamed Re-audit, defined successor selection and states.
2. Reviewed: now Decisions, numerator `accepted_risk`/`fixed` on current failing findings, orphans ignored,
   inherited disclosed, unevaluated never done.
3. Failed audit completed Capture: settled with gaps keeps the partial or failed glyph and counts.
4. Sites data: a separate `attentionOf` with chronological latest-settled and latest-evaluated references and
   `finished_at`; re-checks excluded; `siteSummaries` unchanged.
5. Report state: surviving snapshots, highest surviving version, live predicate through the snapshot, older
   shared version named.
6. Proof: a cited hit/request ref of the first failing target run, through `readCaptureTolerant`; cited
   other evidence and unreadable capture are separate states; Hits action only with a request.
7. `NextSteps` removed in T2; "Start with" sits above the briefing.
8. `ui-ux-pro-max` is installed for the building agents; T4 owns `docs/ui.md` and `docs/vision.md`; T1's
   Compare files listed; keyboard and focus checks added.

## r2 review and answers

1. Active re-audit unreachable: the successor is now the newest of any status, then branched.
2. Hits needs a batch index: the Hits action only for a cited hit; a raw request shows `RequestView` and
   Open in Findings only.
3. Re-audit action: a button sharing the Re-run dialog's open handler, focus restored to the opener, plain
   text with a reason while active or archived.
4. Shared version: n = highest surviving, s = highest live-shared.
5. Helper ownership: `liveShares` is committed with the plan (used by `overview.ts` at once), so T1 and T3
   only call it; T1 no longer touches `overview.ts`.

## r3 review

Approved. One minor, taken into T2: `RequestView` narrows its prop to the fields it reads.

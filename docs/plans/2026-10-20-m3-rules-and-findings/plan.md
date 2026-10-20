---
type: plan
status: draft
design: ../../vision.md
---

# M3 Rules and Findings Plan

**Goal:** Every audit produces deterministic findings with evidence, for the v0.1 checks in `docs/product.md`, shown on a Findings screen; demonstrated on the fixtures and on one real client site.
**Approach:** A pure TypeScript `packages/rules` evaluates one run at a time from its stored capture and decoded hits, returning a check result per rule (pass, fail, inconclusive, not applicable) with evidence references. The workflow's `persist` step evaluates the rules inside the same transaction that writes the hits, and `finish` groups failing checks into audit-level findings. Triage is stored separately, so recomputing findings never loses it. The CLI runs the same rules, which is how each rule is proven on its fixture. The trade-off: rules see one run at a time; comparisons across scenarios (for example "fires under accept but not under reject") wait for a later milestone.

Design sources: `docs/product.md` (Checks in v0.1), `docs/vision.md` (Rules and findings M3, and the M2 notes for M3), `docs/ui.md` (screen 4, Findings), `docs/architecture.md` (Key design rules 1 and 2), the M2 code.

## Global constraints

- **No unit or integration tests** (`AGENTS.md`, current phase). A rule is proven by running it: `zinko capture <fixture> --rules` must report it `fail` on its bug fixture and `pass` (or `not_applicable`) on `clean`, under the scenarios it applies to. Each task's "Verify" lines are its acceptance check.
- `pnpm check && pnpm typecheck && pnpm build` exit 0 with zero warnings after every task (real exit codes, not piped).
- **Rules decide, the LLM explains.** Rules are pure functions with no Effect, no I/O and no clock; the same input gives the same result. The text a finding shows (title, why it matters, fix steps) is static per rule in M3; LLM explanations are M4.
- **Every failing check cites evidence:** at least one `EvidenceRef` that resolves to a stored hit, request, cookie, `dataLayer` push or document of that run.
- **Consent semantics** (decided in M2): `after_consent_action` is `actionAt !== null && startedAt >= actionAt`. Rules branch on `consent.outcome` first: `accepted`/`rejected` use `actionAt` to split before and after; `none`, `gpc` and `not-found` have no action, so every hit counts as "without consent".
- **Logical purchases, not transport hits** (decided in M2): one purchase can send Google Ads' denied conversion (googlesyndication, `npa=1`) and its granted one (googleadservices, `npa=0`); duplicate and coverage rules group by `(vendor, destination, transaction id or Ads label + order id)`.
- **Inconclusive, never a false finding:** a run that is not `complete`, a consent rule on a run whose banner was `not-found` (except the `none` and `gpc` scenarios), or a rule whose input was answered locally when it needs the vendor's response is `inconclusive` with the reason.
- Organization scoping through `activeMembership`; ids from another organization behave as missing (404).
- Migrations are generated, never hand-edited. No new dependencies without asking. `TMPDIR=$HOME/.cache/tmp`. Never use sudo. Never push.
- Fixture traffic never reaches vendors: every fixture capture and audit uses `blockVendorRequests: true`.

## The rules

Severity: `critical` (money or compliance at risk), `warning` (data quality), `info`. Titles reuse Google Tag Diagnostics wording where the check overlaps (marked TD). "Non-Google" means Meta and TikTok. Ad and analytics cookies are `_ga`, `_ga_*`, `_gid`, `_gcl_*`, `_fbp`, `_fbc`, `_ttp`, `_tt_*`, `ttcsid*`, `IDE`, `test_cookie`.

| Id | Area | Sev. | Applies to | Fails when | Bug fixture |
|---|---|---|---|---|---|
| `consent.cookies-before-consent` | Consent | critical | accept, reject: the `before-consent` snapshot; none, gpc: the `end` snapshot | an ad or analytics cookie is present | `meta-before-consent` |
| `consent.pixel-before-consent` | Consent | critical | all | a non-Google hit is sent before the action (accept, reject) or at all (none) | `meta-before-consent` |
| `consent.pixel-after-reject` | Consent | critical | reject | a non-Google hit is sent at or after the action | `tiktok-after-reject` |
| `consent.google-without-denied-state` | Consent | critical | all | a Google hit before the action (accept, reject) or in none has no consent state or a granted one (TD: "tag fired before consent default") | `consent-default-late` |
| `consent.default-after-tag` | Consent | warning | all | the `consent default` push comes after the first Google `config` push or the first Google hit | `consent-default-late` |
| `consent.gpc-ignored` | Consent | critical | gpc | a non-Google hit is sent or an ad cookie is set | `meta-before-consent` |
| `clickid.cookie-missing` | Click IDs | warning | accept, on a run whose URL has a click ID | after consent, the matching cookie (`_gcl_aw`, `_fbc`, `_ttp`) is missing at `end` (TD: "missing conversion linker") | `lost-gclid` |
| `clickid.lost-on-redirect` | Click IDs | warning | all, on a run whose URL has a click ID | the landing redirects and the final document's URL has lost the click ID (TD: "redirects dropping GCLIDs") | `redirect-gclid` |
| `clickid.lost-across-navigation` | Click IDs | warning | journey runs (Task 4), accept | the landing had a click ID, and a later document's Ads conversion or Meta `Purchase` lacks it (`gclaw`/`gclid`, `fbc`) and its cookie is missing | `lost-gclid` journey |
| `coverage.purchase-missing-fields` | Coverage | critical | all | a purchase (GA4 `purchase`, Meta `Purchase`, TikTok `Purchase`, Ads conversion) lacks transaction id (GA4: `transaction_id`; Ads: `oid`), `value` or `currency` (TD: "missing transaction ID") | `purchase-missing-fields` (new) |
| `coverage.invalid-currency` | Coverage | warning | all | a `currency` is not three uppercase letters | `bad-currency` (new) |
| `coverage.no-page-view` | Coverage | warning | accept | a document has no GA4 `page_view` | `no-page-view` (new) |
| `duplicates.same-event-twice` | Duplicates | critical | all | the same logical event (vendor, destination, event, transaction id; or for non-purchases identical params) is sent twice on one document (TD: "likely overcounting") | `duplicate-purchase` |
| `duplicates.multiple-ga4-ids` | Duplicates | warning | all | one document sends hits to more than one GA4 measurement ID | `multiple-ga4` (new) |
| `duplicates.meta-init-twice` | Duplicates | warning | all | one document loads Meta's `signals/config/<pixel>` twice or sends two `PageView`s for one pixel | `meta-init-twice` (new) |
| `dedup.meta-eventid-missing` | Dedup | warning | all | a Meta standard event other than `PageView` has no `eventId` | `meta-no-eventid` (new) |
| `dedup.meta-eventid-reused` | Dedup | warning | all | one `eventId` is used by two different Meta events in a run | `meta-eventid-reused` (new) |
| `hygiene.pii-in-hits` | Hygiene | critical | all | an email address or phone number appears in a document URL, a hit URL or a hit param | `pii-in-url` (new) |
| `hygiene.tag-errors` | Hygiene | warning | all | a tracking request that reached its endpoint got 4xx or 5xx; inconclusive for requests answered locally | `sgtm-errors` (new: a first-party server-side endpoint on the fixture host answering 500) |
| `hygiene.staging-host` | Hygiene | warning | all | a hit's page location host is not the audited document's host | `staging-host` (new) |

`clean` must pass every rule (or be `not_applicable`) under none, accept, reject and gpc. Each new fixture sets the fields `clean` sets except its one bug.

## Review focus

1. **False positives on `clean`.** Every rule passes on `clean` under all four scenarios, desktop and mobile. Verified in Tasks 3 and 4.
2. **The Ads denied/granted pair.** `duplicates.same-event-twice` must not flag gtag's googlesyndication + googleadservices conversion for one purchase. Verified in Task 3 on `clean/thank-you` under accept.
3. **Inconclusive instead of wrong.** A `partial` run, a `not-found` banner under accept, and `hygiene.tag-errors` on answered-locally requests give `inconclusive` with a reason. Verified in Tasks 1 and 3.
4. **Retries and triage.** A retried `persist` reproduces identical check results; recomputing findings keeps every triage status. Verified in Task 5.
5. **Evidence resolves.** Every evidence reference on a failing check opens the right hit, request, cookie or push on the Findings screen. Verified in Task 6.

### Task 0: Remove the M2 leftovers

**Model:** Sonnet
**Files:** remove `apps/web/src/routes/app/index.tsx`'s scaffold content (notes, greeting), `apps/web/src/server/{greeting,notes,example-job}.ts`, `apps/web/src/workflows/Example.ts`, the `Example` export in `server.ts`, its `JobPayloads.example` entry, the `EXAMPLE_WORKFLOW` binding and resource in `infra/alchemy.run.ts`; the `note` table only if nothing else uses it (a generated migration drops it); add a favicon from `.github/assets/logo.svg`
**Interfaces:** `/app` becomes a short "Recent audits" list for the active organization (the latest 10, linking to each audit) with an empty state pointing to Clients
**Blocked by:** none

- [ ] `rg -n "Example|example-job|greeting|notes|EXAMPLE_WORKFLOW|note\b" apps packages infra docs AGENTS.md` shows no leftovers
- [ ] Verify in the browser: `/app` lists recent audits (and the empty state for a new organization); no favicon 404 in the console; `pnpm dev` starts

### Task 1: The rules package and the first consent rules

**Model:** Opus
**Files:** create `packages/rules/` (`@repo/rules`, built to `dist` like `packages/decoders`, depends on `@repo/capture-contract` types and `@ovriq/zinko-decoders` types only), `packages/rules/src/{index,types,evidence,cookies}.ts`, `packages/rules/src/rules/consent/*.ts`; modify `apps/cli/src/index.ts` (`--rules`)
**Interfaces:** produces, in `@repo/rules`:
- `RunInput = { scenario: Scenario, viewport, pageUrl: string, siteHost: string, journey: boolean, capture: CaptureResult, hits: DecodedHit[] }` where `DecodedHit = Hit & { requestId: string, batchIndex: number, documentId: string, startedAt: number }`
- `EvidenceRef = { kind: "hit", requestId, batchIndex } | { kind: "request", requestId } | { kind: "cookie", label: CookieSnapshot["label"], documentId, name } | { kind: "push", seq } | { kind: "document", documentId }`
- `CheckStatus = "pass" | "fail" | "inconclusive" | "not_applicable"`
- `CheckResult = { ruleId: string, status: CheckStatus, message: string, evidence: EvidenceRef[] }`
- `Rule = { id, area: "consent" | "clickids" | "coverage" | "duplicates" | "dedup" | "hygiene", severity: "critical" | "warning" | "info", title, why, fix: string[], evaluate(input: RunInput): CheckResult }`
- `rules: readonly Rule[]`, `evaluateRun(input: RunInput): CheckResult[]` (one result per rule; a run that is not `complete` yields `inconclusive` for every rule that needs a full capture), `RULES_VERSION = "1"`
- helpers: `isAdOrAnalyticsCookie(name)`, `beforeAction(input, startedAt)`, `isNonGoogle(vendor)`
- the six `consent.*` rules from the table
- CLI: `zinko capture … --rules` prints, per scenario, one line per rule: status, id, message, evidence count; `--json` adds `checks`
**Blocked by:** Task 2 for the bug fixtures it proves against (`meta-before-consent`, `tiktok-after-reject` and `consent-default-late` already exist, so it can start at once)

- [ ] Verify with `zinko capture --rules --block-vendors` against the fixtures: each `consent.*` rule fails on its bug fixture under the scenarios it applies to and passes on `clean` under all four; a `no-cmp` capture under accept gives `inconclusive` for the banner-dependent rules; paste the outputs

### Task 2: Fixtures for the remaining rules

**Model:** Sonnet
**Files:** modify `packages/fixtures/sites.mjs`, `packages/fixtures/README.md`, the shared page code as needed
**Interfaces:** produces the new sites in the rules table: `purchase-missing-fields`, `bad-currency`, `no-page-view`, `multiple-ga4`, `meta-init-twice`, `meta-no-eventid`, `meta-eventid-reused`, `pii-in-url`, `sgtm-errors`, `staging-host`; and makes `clean` send every field the rules need (`transaction_id`, `value`, `currency`, Meta `eventID`, one GA4 ID, page_location on its own host)
**Blocked by:** none

- [ ] Each new site differs from `clean` by exactly its one bug, described in the README with the rule id it exercises
- [ ] Verify: `node packages/fixtures/inspect.mjs <site> accept` on each new site shows its bug in the printed requests; `clean` still shows no collection request reaching a vendor

### Task 3: The remaining rules

**Model:** Sonnet
**Files:** create `packages/rules/src/rules/{clickids,coverage,duplicates,dedup,hygiene}/*.ts`; modify `packages/rules/src/index.ts`
**Interfaces:** consumes Task 1's types; produces the 13 remaining rules except `clickid.lost-across-navigation`, which Task 4 adds
**Blocked by:** 1, 2

- [ ] `duplicates.same-event-twice` and `coverage.purchase-missing-fields` group by logical purchase (Global constraints)
- [ ] `hygiene.tag-errors` is `inconclusive` for requests answered locally (`blocked: true`)
- [ ] Verify with `zinko capture --rules --block-vendors`: each rule fails on its bug fixture and passes on `clean` under none, accept, reject and gpc, desktop and mobile; `clean/thank-you` under accept does not flag the Ads denied/granted pair; paste a table of rule × fixture × status

### Task 4: Journey runs

**Model:** Opus
**Files:** modify `packages/core/src/audit.ts` (`AuditConfig.journey`), `apps/web/src/server/audits.ts`, `apps/web/src/workflows/Audit.ts`, `packages/db/src/audit-schema.ts` (`run.journey boolean not null default false`, generated migration), `apps/web/src/routes/app/sites/$siteId_.audits.new.tsx` (a "Journey through the key pages" checkbox), `packages/rules/src/rules/clickids/lost-across-navigation.ts`
**Interfaces:** `AuditConfig.journey: boolean`; when on, `startAudit` adds one run per scenario × viewport that loads the start URL (with click IDs when `clickIds` is on), then `goto`s the first 5 key pages in order in the same browser context; the run's `page_url` is the start URL and `journey = true`; `RunInput.journey` carries it
**Blocked by:** 1

- [ ] Journey runs reuse the engine's journey (`CaptureRequest.journey`, at most 5 steps) and the site allow-list; the grid labels them "Journey"
- [ ] Verify: an audit of `lost-gclid` with key page `/lost-gclid/product`, `clickIds` and `journey` on gives a journey run under accept where `clickid.lost-across-navigation` fails with evidence on the second document; the same on `clean` passes; paste both

### Task 5: Persisting checks and findings

**Model:** Opus
**Files:** create `packages/db/src/rules-schema.ts` (generated migration); modify `apps/web/src/workflows/Audit.ts`, `apps/web/src/server/audits.ts`, `packages/db/src/index.ts`
**Interfaces:**
- `check_result` (primary key `(run_id, rule_id)`): `run_id uuid references run on delete cascade`, `org_id`, `rule_id text`, `rules_version text`, `status text`, `message text`, `evidence jsonb`, `created_at` (the run's `finished_at`)
- `finding` (primary key `(audit_id, rule_id)`): `audit_id uuid references audit on delete cascade`, `org_id`, `rule_id`, `area`, `severity`, `title`, `failing_runs integer`, `inconclusive_runs integer`, `run_ids uuid[]`
- `finding_triage` (primary key `(audit_id, rule_id)`, no foreign key to `finding`, so recomputing findings keeps it): `audit_id uuid references audit on delete cascade`, `org_id`, `rule_id`, `status text` (`open | accepted_risk | fixed`), `updated_by text`, `updated_at timestamptz`
- `persist-<n>` evaluates `evaluateRun` on the stored capture and the decoded hits and writes the run's `check_result` rows in the same transaction as its hits (delete then insert)
- `finish` recomputes the audit's `finding` rows from its `check_result` rows in one transaction: one finding per rule with at least one `fail`
- server functions `listFindings({ auditId })` (findings with triage status, ordered by severity then area), `getFinding({ auditId, ruleId })` (the rule's static text and every failing run's check result with evidence), `setTriage({ auditId, ruleId, status })`
**Blocked by:** 1, 3

- [ ] Verify: an audit of `clean`, `meta-before-consent` and `duplicate-purchase` × none/accept/reject gives findings only for the rules the bug fixtures exercise and none from `clean`; a forced `persist` failure after its inserts reproduces identical `check_result` rows; setting triage, then re-running `finish` (a temporary hook), keeps the status; another organization gets 404

### Task 6: The Findings screen

**Model:** Sonnet
**Files:** create `apps/web/src/routes/app/audits/$auditId.findings.tsx`; modify `apps/web/src/routes/app/audits/$auditId.tsx` (Findings tab), `apps/web/src/routes/app/audits/$auditId.hits.tsx` (selection and filters in the URL, so a finding can open a specific hit)
**Interfaces:** consumes `listFindings`, `getFinding`, `setTriage`, `getHitDetail`
**Blocked by:** 5

- [ ] Layout per `docs/ui.md` screen 4: the list (severity, title, area, affected page and scenario count, triage status) and the selected finding (title, why it matters, fix steps, and evidence tabs: Hit, Request, Screenshot, Cookies, dataLayer)
- [ ] Actions: mark as accepted risk or fixed (owners and admins and members alike), copy the fix steps, open in Hits (the hits URL with run and hit selected)
- [ ] Empty state when there are no findings; inconclusive counts shown on a finding
- [ ] Verify in the browser on the Task 5 audit: open each finding and each evidence tab; "Open in Hits" lands on the right hit; triage survives a reload; screenshots under `$TMPDIR/m3t6-*.png`

### Task 7: M3 demo and docs

**Model:** Sonnet
**Files:** modify `docs/vision.md`, `docs/roadmap.md`, `docs/architecture.md`, `README.md`, `AGENTS.md` (the rules package and the fixture-first workflow for a new rule)
**Blocked by:** 0–6

- [ ] Run an audit of every fixture site × none/accept/reject/gpc with `clickIds` and `journey` on; save the Findings screen to `mockups/m3-demo/` (untracked); paste the finding list and confirm each bug fixture produced exactly its rules and `clean` none
- [ ] `vision.md`: M3 rows working with how each was verified; the proposed rows decided (three outcomes and Google's names done; click ID through redirects done; approved vendor list moved to a later milestone)
- [ ] `AGENTS.md`: how to add a rule (fixture with the bug, then the rule, then prove it with `zinko capture --rules`)
- [ ] The roadmap's M3 demo, "audit a real client site", needs a site the user is allowed to audit: leave that acceptance unticked with a note until the user names one

## Execution order

```
wave 1:  0 leftovers (Sonnet)   1 rules core + consent (Opus)   2 fixtures (Sonnet)
wave 2:  3 remaining rules (Sonnet)   4 journeys (Opus)          after 1 (3 also after 2)
wave 3:  5 persistence (Opus)                                     after 1, 3
wave 4:  6 Findings screen (Sonnet)                               after 5
wave 5:  7 demo and docs (Sonnet)
```

Each task runs in its own worktree and merges to `main` after GPT-6.1-Sol (Fable 5.1 when Sol is over its limit) reviews its diff and its pasted verify output.

## Not in M3

- Rules that compare scenarios (for example "this tag fires under reject but not under accept"): later.
- The approved vendor list per client (needs client settings): later.
- LLM explanations and fix steps: M4. Overview score and tag matrix: M4.
- Parallel captures and audit admission control (M2 leftovers): a later milestone.

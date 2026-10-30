---
type: plan
status: implemented
design: ../../vision.md
---

# M3 Rules and Findings Plan

**Goal:** Every audit produces deterministic findings with evidence, for the v0.1 checks in `docs/product.md`, shown on a Findings screen; demonstrated on the fixtures and on one real client site.
**Approach:** A pure TypeScript `packages/rules` evaluates one run at a time from its stored capture and decoded hits, returning one check result per rule (pass, fail, inconclusive, not applicable) with evidence references. The workflow's `persist` step evaluates the rules in the same transaction that writes the hits, and `finish` groups failing checks into audit-level findings. Triage is stored apart from findings, so recomputing never loses it. The CLI runs the same rules, which is how each rule is proven on its fixture. The trade-off: rules see one run at a time, and several observe a proxy (a cookie snapshot, a request count) rather than the underlying fact; each rule names what it observes.

Design sources: `docs/product.md` (Checks in v0.1), `docs/vision.md` (Rules and findings M3, the M2 notes for M3), `docs/ui.md` (screen 4), `docs/architecture.md` (Key design rules 1 and 2), the M2 code. Reviewed by GPT-6.1-Sol on 2026-10-20 in two rounds; its findings are folded in.

## Global constraints

- **No unit or integration tests** (`AGENTS.md`, current phase). A rule is proven by running it: `zinko capture <fixture> --rules --block-vendors` prints each rule's status, and the result must match that fixture's **expected result set** in `packages/fixtures/README.md` (which rules fail under which scenarios; every other rule `pass`, `not_applicable`, or `inconclusive` with the reason the README names). Each task's "Verify" lines are its acceptance check.
- `pnpm check && pnpm typecheck && pnpm build` exit 0 with zero warnings after every task (real exit codes).
- **Rules decide, the LLM explains.** Rules are pure functions: no Effect, no I/O, no clock. Title, why it matters and fix steps are static per rule in M3; LLM text is M4.
- **Every failing check cites evidence:** at least one `EvidenceRef` that the evidence resolver (Task 5) returns for that run.
- **Consent semantics** (decided in M2): rules branch on `consent.outcome` first. `accepted` and `rejected` split hits at `actionAt` (`startedAt >= actionAt` is after). `none`, `gpc` and `not-found` have no action: every hit is "without consent". Under `accepted`/`rejected` with outcome `not-found`, consent rules are `inconclusive` ("the banner was not found").
- **Google consent state** comes from decoded GA4 and Ads hits (`consent`) and from raw `ccm` requests (their `gcs` query parameter), which the decoders deliberately do not decode. `gcs=G100` means both storages denied and is correct before consent.
- **Purchases.** Required fields per vendor: GA4 `purchase`: `transaction_id`, `value`, `currency`; Meta `Purchase` and TikTok `Purchase` (TikTok's `CompletePayment` arrives as `Purchase`): `value`, `currency` (no order id is sent). Google Ads cannot say which conversion labels are purchases, so Ads uses a stated, broader policy: an Ads conversion that carries `value` is treated as a purchase and needs `transaction_id` (decoded from `oid`) and `currency`. An event id is not an order id.
- **The Ads denied/granted pair** (decided in M2): gtag sends one purchase as a googlesyndication conversion with `npa=1` while ad storage is denied and as a googleadservices conversion with `npa=0` once granted. Duplicate rules pair them **one to one**: same destination, label and `transaction_id`, one with denied ad storage on googlesyndication and one with granted ad storage on googleadservices. Grouping always includes destination and label, so different conversion labels are never duplicates of each other; any transmission beyond the pair counts as a duplicate.
- **Inconclusive, never a false finding:** a run that is not `complete` (except a run whose only error is `CmpNotFound`: the page loaded fully, so every rule is still evaluated, and the consent rules are the ones that answer "the banner was not found"; decided in Task 1, so a site whose banner autoconsent cannot detect still gets its other checks); a consent rule whose banner was `not-found` under accept or reject; `hygiene.tag-errors` for requests answered locally (`blocked: true`). The message names the reason.
- **Unevaluated is not clean.** An audit, or a run, with no check results shows "not evaluated", never zero findings.
- Organization scoping through `activeMembership`; ids from another organization behave as missing (404). Triage is per audit; carrying it across audits of a site is M6 (compare).
- Migrations are generated. `AuditConfig.journey` is optional and defaults to `false`, so stored M2 configs still decode. No new dependencies without asking. `TMPDIR=$HOME/.cache/tmp`. Never use sudo. Never push without asking.
- Every fixture capture and audit uses `blockVendorRequests: true`.

## The rules

Severity: `critical` (money or compliance at risk), `warning` (data quality), `info`. "TD" marks wording reused from Google Tag Diagnostics. "Non-Google" means Meta and TikTok. Ad and analytics cookies are `_ga`, `_ga_*`, `_gid`, `_gcl_*`, `_fbp`, `_fbc`, `_ttp`, `_tt_*`, `ttcsid*`, `IDE`, `test_cookie`. "Observes" says what the rule actually reads, where that is a proxy.

| Id | Sev. | Applies to | Fails when | Observes | Bug fixture |
|---|---|---|---|---|---|
| `consent.cookies-without-consent` | critical | all | accept/reject: an ad or analytics cookie is in the `before-consent` snapshot; none/gpc: in any `document-end` or `end` snapshot | cookie snapshots (a cookie set and removed between snapshots is not seen) | `meta-before-consent` |
| `consent.pixel-without-consent` | critical | all | a non-Google hit before the action (accept, reject) or at all (none, gpc); under gpc the title says the GPC signal was ignored | decoded hits | `meta-before-consent` |
| `consent.pixel-after-reject` | critical | reject | a non-Google hit at or after the action | decoded hits | `tiktok-after-reject` |
| `consent.google-without-denied-state` | critical | all | a Google hit or `ccm` request before the action (accept, reject) or at all (none, gpc) has no consent state or a granted one (TD: "tag fired before consent default") | decoded GA4/Ads consent, raw `ccm` `gcs` | `consent-default-late` |
| `consent.default-after-tag` | warning | all | on a document with Google tags, the `["consent","default",…]` push comes after the first `["config",…]` push or the first Google hit or `ccm` ping, or is missing while that first hit carries no consent state. Missing with a consent state on the first hit is `inconclusive`: GTM consent templates set the default with `setDefaultConsentState`, which never reaches `dataLayer` | normalized `dataLayer` pushes per document | `consent-default-late` |
| `consent.mode-v2-incomplete` | warning | all (added in rules v4) | a Google request (GA4, Ads, `ccm` ping) that has Consent Mode state at all leaves `ad_user_data` or `ad_personalization` unset in `gcd` (letter `l`: no default, no update) while the run sends an Ads signal (an Ads hit, or a `ccm` ping to an `AW-` tag); `inconclusive` when no request has a readable `gcd`; `not_applicable` without an Ads signal or any Consent Mode state | `gcd` of decoded GA4/Ads hits and raw `ccm` requests (Google's format is undocumented; letters per community decoders) | `consent-mode-v1` (new) |
| `consent.mode-classified` | info | all (added in rules v5; informational) | classifies the Google tag's Consent Mode type, never fails: `pass` "advanced" when a Google request (GA4, Ads hit or `ccm` ping) sent before consent (or at any time under none/gpc) says storage is denied and no later request in the same document says granted without a consent action (rules v6; that flip is `inconclusive`, "denied by default, then granted without a visitor choice", a region-based default); `pass` "basic" when Google requests exist but none came before the consent action; `inconclusive` when the banner outcome is unusable, when no Google request was sent but a consent default or `gtag.js`/`gtm.js` was seen (basic mode and a never-loaded tag look alike), or when the requests before consent carry no denied state; `not_applicable` when no Google tag, default or request was seen | decoded hits' `consent`, raw `ccm` pings, `consent default` pushes, `/gtag/js` and `/gtm.js` requests | `clean` (advanced), `consent-mode-basic` (new) |
| `clickid.cookie-missing` | warning | accept, run URL has a click ID | per vendor, only when the landing URL carries **that vendor's** click ID and the run has that vendor's hits: `gclid` and Ads → `_gcl_aw`; `fbclid` and Meta → `_fbc`; `ttclid` and TikTok → `_ttp`; the cookie is missing at `end` (TD: "missing conversion linker") | `end` snapshot | `lost-gclid` |
| `clickid.lost-on-redirect` | warning | all, run URL has a click ID | the landing document's redirects end at a URL without the click ID (TD: "redirects dropping GCLIDs") | document redirects | `redirect-gclid` |
| `clickid.lost-across-navigation` | warning | journey runs, accept | per vendor, gated on that vendor's landing click ID: with `gclid`, a later document's Ads conversion lacks `ids.gclid`; with `fbclid`, a later document's Meta `Purchase` lacks `ids.fbc`; and that document's `document-end` snapshot (`end` for the last) has no `_gcl_aw` or `_fbc` respectively, so attribution is not carried by cookie across navigations. TikTok is deferred: its click ID is only seen in the `ttp`/callback payload | hits per document, snapshots per document | `lost-gclid` journey |
| `coverage.purchase-missing-fields` | critical | all | a purchase lacks a required field for its vendor (Global constraints) (TD: "missing transaction ID") | decoded params | `purchase-missing-fields` (new) |
| `coverage.invalid-currency` | warning | all | a purchase `currency` is not three uppercase letters | decoded params | `bad-currency` (new) |
| `coverage.no-page-view` | warning | accept | a document with GA4 hits has no GA4 `page_view` | decoded hits | `no-page-view` (new) |
| `duplicates.purchase-sent-twice` | critical | all | after one-to-one Ads pairing, a document sends the same purchase twice: same vendor, destination and `transaction_id`, or for Meta and TikTok (no order id) the same event name more than once (TD: "likely overcounting") | decoded hits per document | `duplicate-purchase` |
| `duplicates.multiple-ga4-ids` | info | all | one document sends hits to more than one GA4 measurement ID | decoded hits | `multiple-ga4` (new) |
| `duplicates.client-and-server-ga4` | warning | all (added in rules v5) | the same GA4 event reaches Google and a first-party collector (`Hit.collector`) in one run: same document, measurement ID and event name, and either the same `transaction_id` or, without one, the same `page_location` (host and path) starting less than 5 s apart, paired one to one; `pass` when every GA4 hit went to the first-party collector; `not_applicable` without GA4 or without a first-party GA4 hit. Intentional dual-send to the same stream cannot be told from a mistake | decoded hits | `ga4-client-and-server` (new), `ga4-gateway` and `sgtm-errors` (pass) |
| `duplicates.meta-loaded-twice` | warning | all | one document requests Meta's `signals/config/<pixel>` twice for one pixel, or sends two `PageView`s for it | raw requests, decoded hits (a proxy for a second `fbq('init')`) | `meta-init-twice` (new) |
| `dedup.meta-eventid-missing` | warning | all | a Meta standard event other than `PageView` (`AddPaymentInfo`, `AddToCart`, `AddToWishlist`, `CompleteRegistration`, `Contact`, `CustomizeProduct`, `Donate`, `FindLocation`, `InitiateCheckout`, `Lead`, `Purchase`, `Schedule`, `Search`, `StartTrial`, `SubmitApplication`, `Subscribe`, `ViewContent`) has no `ids.eventId` | decoded hits | `meta-no-eventid` (new) |
| `dedup.meta-eventid-reused` | warning | all | within one pixel, the same event name and `ids.eventId` appear on more than one hit (Meta keeps one and drops the rest) | decoded hits | `meta-eventid-reused` (new) |
| `dedup.tiktok-eventid-missing` | warning | all (added in rules v4) | a TikTok standard event other than `Pageview` (`AddPaymentInfo`, `AddToCart`, `AddToWishlist`, `ClickButton`, `CompletePayment`, `CompleteRegistration`, `Contact`, `Download`, `InitiateCheckout`, `PlaceAnOrder`, `Purchase`, `Search`, `SubmitForm`, `Subscribe`, `ViewContent`) has no `ids.eventId`; like the Meta rule it cannot see whether the Events API is also in use | decoded hits | `tiktok-no-eventid` (new) |
| `hygiene.pii-in-hits` | critical | all | after URL-decoding, an email address (`[^\s@]+@[^\s@]+\.[A-Za-z]{2,}`) appears in a document URL, hit URL or hit param, or a phone number (`+` and 8–15 digits, or any digits in a param named like `phone`, `tel` or `mobile`) appears in a hit param | decoded URLs and params | `pii-in-url` (new) |
| `hygiene.tag-errors` | warning | all | a tracking request that reached its endpoint got 4xx or 5xx; `inconclusive` when every tracking request was answered locally | request status and `blocked` | `sgtm-errors` (new) |
| `hygiene.location-mismatch` | warning | all | a hit's `params.page_location` host (GA4, and Meta, whose decoder maps `dl` to `page_location`) is not the host of the document it was sent from | decoded params, documents | `location-mismatch` (new) |
| `debug.preview-or-debug-leak` | warning | all (added in rules v4; area `hygiene`) | a `/gtm.js` request carries `gtm_preview`, `gtm_auth` or `gtm_debug`, or a GA4 hit carries `_dbg=1` or `debug_mode` `1`/`true` | raw requests, decoded GA4 params | `debug-leak` (new) |

`clean`'s expected result set: every rule `pass` or `not_applicable` under none, accept, reject and gpc, except `hygiene.tag-errors`, which is `inconclusive` (answered locally).

## Review focus

1. **False positives on `clean`** under all four scenarios, desktop and mobile. Verified in Tasks 1 and 3.
2. **The Ads pair and real duplicates.** `duplicates.purchase-sent-twice` passes on `clean/thank-you` under accept (one denied and one granted conversion) and fails on `duplicate-purchase`. Verified in Task 3.
3. **Inconclusive instead of wrong.** A `partial` run, a `not-found` banner under accept, and `hygiene.tag-errors` on answered-locally requests. Verified in Tasks 1 and 3.
4. **Retries, cleanup and triage.** A retried `persist` reproduces identical check results; `fail-<n>` removes a run's check results; recomputing findings keeps triage. Verified in Task 5.
5. **Old audits.** An M2 audit with no check results shows "not evaluated". Verified in Task 6.
6. **Evidence resolves**, including raw `ccm` requests, cookies and pushes. Verified in Task 6.

### Task 0: Remove the M2 leftovers

**Model:** Sonnet
**Files:** remove the scaffold content of `apps/web/src/routes/app/index.tsx` (it redirects to `/app/clients`), `apps/web/src/server/{greeting,notes,example-job}.ts`, `apps/web/src/workflows/Example.ts`, the `Example` export in `server.ts`, `JobPayloads.example`, the `EXAMPLE_WORKFLOW` binding and resource in `infra/alchemy.run.ts`; the `note` table if nothing else uses it (a generated migration drops it); add a favicon from `.github/assets/logo.svg`
**Blocked by:** none

- [x] Verify: `rg -n "Example|example-job|greeting|notes|EXAMPLE_WORKFLOW|\bnote\b" apps packages infra docs AGENTS.md` shows no leftovers; in the browser `/app` lands on Clients and there is no favicon 404; `pnpm dev` starts

### Task 1: The rules package and the consent rules

**Model:** Opus
**Files:** create `packages/rules/` (`@repo/rules`, built to `dist` like `packages/decoders`; depends on `@repo/capture-contract` and `@zinko/decoders`), `packages/rules/src/{index,types,consent-state,cookies,documents}.ts`, `packages/rules/src/rules/consent/*.ts`; modify `apps/cli/src/index.ts` (`--rules`)
**Interfaces:** produces, in `@repo/rules`:
- `RunInput = { scenario: Scenario, viewport, pageUrl: string, siteHost: string, journey: boolean, capture: CaptureResult, hits: DecodedHit[] }`, `DecodedHit = Hit & { requestId: string, batchIndex: number, documentId: string, startedAt: number }`
- `EvidenceRef = { kind: "hit", requestId, batchIndex } | { kind: "request", requestId } | { kind: "cookie", label: CookieSnapshot["label"], documentId, name, domain, path } | { kind: "push", seq } | { kind: "document", documentId }`
- `CheckStatus = "pass" | "fail" | "inconclusive" | "not_applicable"`; `CheckResult = { ruleId, status, message, evidence: EvidenceRef[] }`
- `Rule = { id, area: "consent" | "clickids" | "coverage" | "duplicates" | "dedup" | "hygiene", severity: "critical" | "warning" | "info", title, why, fix: string[], evaluate(input: RunInput): CheckResult }`
- `rules: readonly Rule[]`, `ruleById(id)`, `evaluateRun(input): CheckResult[]` (a run that is not `complete` yields `inconclusive` for every rule), `RULES_VERSION = "1"`
- helpers: `isAdOrAnalyticsCookie(name)`, `withoutConsent(input, startedAt)`, `isNonGoogle(vendor)`, `googleConsentFromCcm(request)`, `pushesByDocument(input)`
- the five `consent.*` rules
- CLI: `zinko capture … --rules` prints, per scenario, one line per rule (status, id, message, evidence count); `--json` adds `checks`
**Blocked by:** none (its rules verify against fixtures that already exist)

- [x] Verify with `zinko capture --rules --block-vendors`: `meta-before-consent`, `tiktok-after-reject` and `consent-default-late` fail the consent rules the table names, under the scenarios it names; `clean` matches its expected result set under all four scenarios; `no-cmp` under accept gives `inconclusive` with "the banner was not found"; paste the outputs

### Task 2: Fixtures for the remaining rules

**Model:** Sonnet
**Files:** modify `packages/fixtures/sites.mjs`, `packages/fixtures/server.mjs`, `packages/fixtures/inspect.mjs`, `packages/fixtures/README.md`, shared page code as needed
**Interfaces:** produces `purchase-missing-fields`, `bad-currency`, `no-page-view`, `multiple-ga4`, `meta-init-twice`, `meta-no-eventid`, `meta-eventid-reused`, `pii-in-url`, `sgtm-errors`, `location-mismatch`; and changes `clean` so it sends: GA4 `purchase` with `transaction_id`, `value`, `currency`; Ads conversion with `transaction_id`; Meta `eventID` on every standard event; one GA4 ID; `page_location` on its own host
**Blocked by:** none

- [x] `sgtm-errors` sends GA4 hits as `POST /g/collect?v=2&tid=…&en=…` to the fixture host, which `server.mjs` answers with 500; `inspect.mjs` reports first-party collection requests too
- [x] `location-mismatch` overrides `page_location` to `https://staging.shop.example/…` without navigating anywhere
- [x] `pii-in-url` puts an email in a page query parameter that reaches GA4's `page_location`; no other fixture contains anything the PII rule matches (check timestamps and pixel ids)
- [x] The README gives each site's expected result set (rule × scenario × status), including the existing sites
- [x] Verify: `node packages/fixtures/inspect.mjs <site> accept` on each new site shows its bug; `clean` still sends nothing to a vendor

### Task 3: The remaining rules

**Model:** Opus (the duplicate and hygiene semantics are subtle)
**Files:** create `packages/rules/src/rules/{clickids,coverage,duplicates,dedup,hygiene}/*.ts`; modify `packages/rules/src/index.ts`
**Interfaces:** consumes Task 1; produces the 14 remaining rules except `clickid.lost-across-navigation` (Task 4)
**Blocked by:** 1, 2

- [x] Verify with `zinko capture --rules --block-vendors` on every fixture × none, accept, reject, gpc × desktop, mobile: every result matches the README's expected result set; paste a rule × fixture × scenario table; `clean/thank-you` under accept passes `duplicates.purchase-sent-twice` with one denied and one granted Ads conversion; `duplicate-purchase` fails it

### Task 4: Journey runs

**Model:** Opus
**Files:** modify `packages/core/src/audit.ts` (`AuditConfig.journey?: boolean`), `apps/web/src/server/audits.ts`, `apps/web/src/workflows/Audit.ts`, `packages/db/src/audit-schema.ts` (`run.journey boolean not null default false`, generated migration), `apps/web/src/routes/app/sites/$siteId_.audits.new.tsx` ("Also walk through the key pages in one session"), `apps/web/src/lib/audit-labels.ts` (estimate), `packages/rules/src/rules/clickids/lost-across-navigation.ts`
**Interfaces:** when `journey` is on, `startAudit` adds, **in addition to** the per-page runs, one run per scenario × viewport that loads the start URL (with click IDs when `clickIds` is on) and then `goto`s the first 5 key pages in order in one browser context; the form says only the first 5 are walked; `run.page_url` is the start URL and `run.journey` is true; the estimate counts a journey run as (1 + steps) runs; `RunInput.journey` carries it
**Blocked by:** 1

- [x] Journey runs use `CaptureRequest.journey` and the site allow-list; the grid labels them "Journey"; the engine's 135 s budget at 5 steps fits the workflow's 4-minute step timeout
- [x] Verify with `zinko capture --rules --block-vendors --goto …`: on `lost-gclid` (`?gclid=TEST`, then `/lost-gclid/thank-you`) under accept, `clickid.lost-across-navigation` fails with evidence on the second document; on `clean` the same walk passes; paste both

### Task 5: Persisting checks and findings, and the evidence resolver

**Model:** Opus
**Files:** create `packages/db/src/rules-schema.ts` (generated migration), `apps/web/src/server/findings.ts`; modify `apps/web/src/workflows/Audit.ts`, `packages/db/src/index.ts`
**Interfaces:**
- `check_result` (primary key `(run_id, rule_id)`): `run_id uuid references run on delete cascade`, `org_id`, `rule_id`, `rules_version`, `status`, `message`, `evidence jsonb`, `created_at` (the run's `finished_at`)
- `finding` (primary key `(audit_id, rule_id)`): `audit_id uuid references audit on delete cascade`, `org_id`, `rule_id`, `kind` (`fail`: at least one run failed; `inconclusive`: no run failed and at least one was inconclusive), `rules_versions text[]`, `area`, `severity`, `title`, `why`, `fix jsonb`, `failing_runs integer`, `inconclusive_runs integer`, `run_ids uuid[]`. The displayed text is stored on the finding, so an old audit keeps the wording it was evaluated with
- `finding_triage` (primary key `(audit_id, rule_id)`, no foreign key to `finding`): `audit_id uuid references audit on delete cascade`, `org_id`, `rule_id`, `status` (`open | accepted_risk | fixed`), `updated_by`, `updated_at`
- `persist-<n>` writes the run's `check_result` rows in the same transaction as its hits (delete, then insert); `fail-<n>` deletes them; `finish` recomputes the audit's `finding` rows from its `check_result` rows in one transaction: one per rule with at least one `fail` (`kind = fail`), or with no `fail` and at least one `inconclusive` (`kind = inconclusive`); text comes from `ruleById` at that moment and is stored. When an audit's runs were evaluated with different `RULES_VERSION`s (a re-run under a newer version), `rules_versions` lists them and the screen says so
- `listFindings({ auditId }) → { coverage: { totalRuns, evaluatedRuns }, findings }` (`evaluatedRuns` is 0 for an M2 audit, which then reads "not evaluated"), `getFinding({ auditId, ruleId })` (the stored text, and every failing and inconclusive run's check result), `setTriage({ auditId, ruleId, status })`
- `getEvidence({ auditId, runId, ref: EvidenceRef })`: resolves a hit (decoded row and raw request), a raw request (from `capture.json`, including `ccm`), a cookie (name, value, domain, path, snapshot), a push (value) or a document (URL, redirects, title), checked through the audit; the run's screenshot (the final one) separately
**Blocked by:** 1, 3, 4

- [x] Verify: an audit of `clean`, `meta-before-consent` and `duplicate-purchase` × none/accept/reject finds exactly the rules their expected result sets name and nothing from `clean`; a forced `persist` failure after its inserts reproduces identical `check_result` rows; an exhausted `persist` leaves no check results for that run; setting triage and recomputing `finish` (a temporary hook) keeps it; `getEvidence` resolves one of each evidence kind; another organization gets 404

### Task 6: The Findings screen

**Model:** Sonnet
**Files:** create `apps/web/src/routes/app/audits/$auditId.findings.tsx`; modify `apps/web/src/routes/app/audits/$auditId.tsx` (Findings tab), `apps/web/src/routes/app/audits/$auditId.hits.tsx` (`run` and `hit=<requestId>:<batchIndex>` search params that open the hit's detail directly, even when it is not on the first page)
**Interfaces:** consumes `listFindings`, `getFinding`, `setTriage`, `getEvidence`
**Blocked by:** 5

- [x] Layout per `docs/ui.md` screen 4: the list of failing findings (severity, title, area, affected page and scenario count, inconclusive count, triage status), then a separate "Could not check" group for `kind = inconclusive`, and the evaluation coverage ("9 of 9 runs evaluated") and the selected finding (title, why it matters, fix steps, evidence tabs: Hit, Request, Screenshot (the run's final screenshot), Cookies, dataLayer)
- [x] Actions: mark accepted risk or fixed (any member), copy the fix steps, open in Hits (the hit selected)
- [x] States: no findings with full coverage; not evaluated (an M2 audit); only inconclusive checks (never shown as clean); rules evaluated with mixed versions
- [x] Verify in the browser on the Task 5 audit: open each finding and each evidence tab, including a raw `ccm` request and a cookie; "Open in Hits" lands on the right hit even beyond the first 200 rows; triage survives a reload; an M2 audit shows "not evaluated"; screenshots under `$TMPDIR/m3t6-*.png`

### Task 7: M3 demo and docs

**Model:** Sonnet
**Files:** modify `docs/vision.md`, `docs/roadmap.md`, `docs/architecture.md`, `README.md`, `AGENTS.md` (the rules package, and how to add a rule: fixture with the bug and its expected result set, then the rule, then prove it with `zinko capture --rules`)
**Blocked by:** 0–6

- [x] Run an audit of every fixture site × none/accept/reject/gpc with `clickIds` and `journey` on; save the Findings screen to `mockups/m3-demo/` (untracked); paste the finding list against the expected result sets
- [x] `vision.md`: M3 rows working with how each was verified; the proposed rows decided (three outcomes, Google's wording and click IDs through redirects done; the approved vendor list moved to a later milestone)
- [x] The roadmap's M3 demo, "audit a real client site": the user asked us to pick one. `https://www.happysocks.com/eu/` (GTM, GA4, Cookiebot; autoconsent accepts it, checked 2026-10-22) is the main one, and `https://www.allbirds.com/` (GA4, Meta, TikTok; no banner from our region) the second. Always with `blockVendorRequests: true`, so nothing reaches their vendors; one audit each, no crawling beyond the key pages

## Execution order

```
wave 1:  0 leftovers (Sonnet)   1 rules core + consent (Opus)   2 fixtures (Sonnet)
wave 2:  3 remaining rules (Opus)   4 journeys (Opus)              3 after 1, 2; 4 after 1
wave 3:  5 persistence + evidence (Opus)                           after 1, 3, 4
wave 4:  6 Findings screen (Sonnet)                                after 5
wave 5:  7 demo and docs (Sonnet)
```

Each task runs in its own worktree and merges to local `main` after GPT-6.1-Sol (Fable 5.1 when Sol is over its limit) reviews its diff and its pasted verify output. Pushing to GitHub waits for the user.

## Not in M3

- Rules that compare scenarios (for example a tag that fires under reject but not under accept): later.
- The approved vendor list per client (needs client settings): later.
- Instrumentation for facts the rules now observe by proxy (cookie writes as they happen, `fbq('init')` calls, user actions): later, if the proxies prove too coarse on real sites.
- LLM explanations and fix steps, the Overview score and the tag matrix: M4.
- Triage carried across audits of a site: M6. Parallel captures and audit admission control: later.

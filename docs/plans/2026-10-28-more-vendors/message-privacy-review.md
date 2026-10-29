# Message privacy review

Reviewed 2026-10-29. **Verdict: merge after fixes.** Three major privacy gaps remain. The runtime changes examined preserve verdicts and evidence; a rules-version bump is not justified by these wording changes.

## Scope

Head: `5d18679c20735655c3f263b0f3f72d8248f06ddb` (`fix/message-privacy`). Base: `main`, resolved to `72063f4ba001447c5a36787a0443bddf86a1b2e5`. Reviewed the requested `git diff main..HEAD`, all rule message construction, helpers, decoder inputs and the `evaluateRun` entry point. The checkout began clean; staged, unstaged and untracked changes were not part of the reviewed patch. Only this review file was written intentionally; the authorized `pnpm check` also runs package builds/cache restoration.

The two-dot comparison includes an older vendor plan and the absence of `review-r2.md`. Those are divergence from three newer documentation commits on main, not changes introduced by `5d18679`: `git diff main...HEAD` contains only the rules changes. They are not rollback findings against this commit. Preserve main's newer planning work when integrating.

Requirements: the task brief, finding 7 of `review-r1.md`, and AGENTS.md: “Messages never repeat a value that may be personal data”; wording-only changes must preserve status and evidence. Privacy/specification and repository standards received separate delegated read-only passes; findings below were reconciled against source and executable probes.

## Specification findings

### 1. Major — The evaluation entry point still copies raw capture errors into every message

**Location:** `packages/rules/src/index.ts:106-119`, especially line 113 (unchanged, but within the requested remaining-path audit).

When `capture.complete` is false and there is a non-consent error, `unusableBecause` interpolates `first.message`, then `evaluateRun` writes it into all 28 results. Removing `cut.message` from individual journey rules does not protect this earlier path. This is reachable with real engine output: `apps/browser/src/engines/playwright.ts:346-349` records `Navigation` as `${url}: ${reason}` for a refused off-site navigation; navigation exceptions at lines 934-938 also include error text.

**Reproduced:** an incomplete capture with a Navigation message containing `https://shop.example/?email=SECRET@example.com&msclkid=SECRET-CLICK` returned 28 inconclusive results, each retaining the full URL and both sentinels. The first message was:

```text
the run did not complete (Navigation: goto https://shop.example/?email=SECRET@example.com&msclkid=SECRET-CLICK failed)
```

**Fix:** construct the entry-point reason from fixed wording and the schema-enumerated error code only. Keep raw error content in its existing capture/evidence boundary. Probe incomplete runs through `evaluateRun`, rather than only calling individual rules.

### 2. Major — The destination filter accepts personal data that is not a valid ID for that vendor

**Location:** `packages/rules/src/event-names.ts:97-101`; consumers include `coverage/no-page-view.ts:40`, `duplicates/multiple-ga4-ids.ts:43` and `clickids/crossdomain-linker-missing.ts:103`.

`destinationLabel` has no vendor context. Its union accepts any 6–20 digit number or 10–24 character uppercase alphanumeric string, including a phone number or a short hexadecimal identifier, even for a GA4 destination. The GA4 decoder copies any nonempty `tid` into `destinationId` (`packages/decoders/src/providers/ga4.ts:26-29,56`), so the filter is reachable from a page-controlled request.

**Reproduced:** decoding a real-shaped `/g/collect?v=2&tid=15551234567&en=login` request and evaluating `coverage.no-page-view` produced:

```text
1 document sent GA4 events (GA4 login) to 15551234567 without a page_view
```

`destinationLabel("ABCDEF0123456789ABCDEF01")` also returned the input unchanged. An email containing `@` was rejected, which does not address these opaque values.

**Fix:** pass the vendor into the labeler and allow only that vendor's destination syntax; GA4 must not accept a numeric Meta-shaped pixel ID or arbitrary TikTok-shaped text. The repository already documents vendor-specific formats and their limits in `packages/llm/src/vocab.ts:10-27`; follow that policy without introducing a rules-to-LLM dependency. If the intended guarantee includes personal values deliberately placed into a syntactically valid pixel ID, syntax cannot prove their provenance: use fixed/numbered destination labels instead. Do not claim that a regex eliminates that residual ambiguity.

### 3. Major — Host-only output still repeats page-controlled identifiers

**Locations:** `packages/rules/src/rules/hygiene/tag-errors.ts:52-53`, `hygiene/location-mismatch.ts:47-51`, `consent/lost-across-subdomain.ts:83-89,106-135`, and `clickids/crossdomain-linker-missing.ts:77-84,110-141`.

Dropping a URL's path/query does not make its host safe. First-party collection hosts and page-location overrides can contain user/tenant identifiers in subdomains. `location-mismatch` prints the reported host directly from `hit.params.page_location`; the journey rules print arrival hosts even in the unrecognised-host branch. These paths need no legitimate destination ID or matching measurement configuration.

**Reproduced with decoded GA4 requests:** `dl=https://user-15551234567.example/` yielded:

```text
1 hit with another host's page location: GA4 reported user-15551234567.example on shop.example
```

An HTTP 500 from a first-party `/g/collect` on that host yielded:

```text
1 tracking request got an HTTP error: GET user-15551234567.example → 500
```

**Fix:** use fixed roles or numbered labels for uncontrolled hosts (“reported another host”, “first-party collector”, “later host 1”), retaining document/request evidence. A parsed host or declared-host list is not itself a privacy allowlist. Also choose HTTP-method wording from a fixed vocabulary: the capture contract permits an arbitrary string, so blindly copying `request.method` is not a general sanitization boundary.

### 4. Minor — Missing-snapshot count counts vendor checks as pages

**Location:** `packages/rules/src/rules/clickids/lost-across-navigation.ts:98-107,124`.

`unseen` increments inside the vendor loop, but its message calls the result a number of later pages. One later document with both Meta and Google Ads hits missing click IDs and no departure/end snapshot produces `no cookie snapshot when leaving 2 later pages`. This was reproduced against the built rule. The verdict remains inconclusive, but the newly introduced count misstates the capture.

**Fix:** count distinct document IDs with missing snapshots, or increment once per document. Keep the existing verdict and evidence behavior.

## Repository standards finding

### 5. Minor — The cookie refactor leaves an unused public helper

**Location:** `packages/rules/src/rules/consent/cookies-without-consent.ts:34-38`, `packages/rules/src/cookies.ts:28`, `packages/rules/src/index.ts:43`.

Replacing the last call to `isAdOrAnalyticsCookie` leaves only its definition and public re-export. A repository search of `packages`, `apps` and `scripts` found no remaining consumer. AGENTS.md says “No unused exports”.

**Fix:** remove the unused wrapper and re-export, or retain an actual necessary use. The new `event-names.ts` exports all have consumers; no further export/style issue was found.

## Cleared risks and actionability

- The moved Meta and TikTok event lists match the old lists exactly, including their PageView exclusions. Dedup rules still filter events before printing names; those raw-looking interpolations are bounded by the fixed sets.
- Cookie classification is equivalent: the previous predicate is exactly `cookieFamily(name) !== null`. The new flatMap preserves ordering and calls `cookieRef` with the original cookie, preserving evidence, while replacing only its display name.
- Replacing the unseen array with a counter preserves its empty/nonempty decision. Enumerating later documents preserves iteration order. Destination/event labels feed messages, not grouping, matching or evidence selection. No status, verdict, rule ID, static rule metadata or evidence-reference change was found in the executable diff.
- The remaining `cut.code` interpolations are safe here: the capture contract enumerates error codes and each rule selects them through a fixed `CUT_SHORT` set. `cut.message` is no longer printed in those individual rules.
- PII parameter labels are now exact allowlist members or fixed text. Other message parameter/signal/click-ID names traced back to fixed inventories. Cookie family labels are fixed strings. Custom event names and repeated transaction/event IDs removed by this patch no longer appear through those changed message paths.
- The revised messages generally remain actionable: they retain vendor, count, cause, timing or later-page position, together with original evidence references and unchanged fix instructions. Omitting raw order IDs, event IDs, cookie suffixes and paths is appropriate. No material actionability blocker was found beyond finding 4.

## Verification and limits

Ran `pnpm check` successfully with the installed tools explicitly selected:

```sh
PATH=/home/pokerface/.local/share/mise/installs/node/24.21.0/bin:/home/pokerface/.local/share/mise/installs/pnpm/12.4.2:$PATH pnpm check
```

Observed: entry points valid (55 server functions, 5 Worker routes); four package build tasks successful from cache; 389 files correctly formatted; zero warnings, lint errors or type errors in 316 files. The initial plain `pnpm check` failed before running because the mise shim reported `T3-Code.AppImage is not a valid shim`; the explicit paths resolved that environment issue. `git diff --check main..HEAD` also passed.

Executed one-off Node 24 heredoc probes importing `evaluateRun`, `ruleById`, `decodeHits` from `packages/rules/dist/index.js` and `destinationLabel` from its built module. They exercised the actual entry point, actual GA4 decoding followed by evaluation, and the missing-snapshot rule. Inputs used synthetic sentinels only; observed messages are quoted above. These are runtime probes, not new unit/integration tests. No database, live vendor capture, app/browser session, publication or commit was performed. Full workspace `pnpm typecheck` and `pnpm build` were not run under this read-only review scope; `pnpm check` was explicitly permitted.

The delegated specification pass additionally compiled main/head sources through an in-memory esbuild CommonJS loader and compared `{ ruleId, status, evidence }`: 1,000 deterministic generated inputs across all 28 rules, 1,000 `evaluateRun` comparisons, and 36 explicit cross-domain cases covering linker presence, equal/different/missing client IDs, granted/denied storage and normal/phone/email destination IDs. It reported zero differences across 28,036 direct rule comparisons and the 1,000 entry-point comparisons. This supplements source inspection; it is sampled parity evidence, not proof for every possible capture. The old/new Meta and TikTok sets had exactly 17 and 15 identical ordered members respectively.

The privacy findings concern newly evaluated messages. Existing persisted messages are unchanged by this patch; no backfill or historical cleanup was reviewed. Close findings 1–3 before merging; findings 4–5 are small corrections in the same scope.

## Round 2 (Sol, 2026-10-29)

Verdict: merge. No remaining findings. All five round-1 findings are resolved; the capture error code is an eight-value `Schema.Literals` enum validated at capture and storage. Message construction traced across all 28 rules: event names, cookie labels, parameter names, signals and vendor names are fixed or allowlisted. Numbered labels are deterministic for the same input. A read-only probe compared 4,592 rule results with main: zero status or evidence differences, zero sentinel leaks, so no `RULES_VERSION` change.

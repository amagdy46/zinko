# More vendors — review R1

Reviewed 2026-10-28 on `main` at `27226a9`, against the working-tree plan. The working tree was clean before this review. Scope: the plan, binding Rules/Report/Compare instructions in `AGENTS.md`, decoder and rules consumers, fixtures, both engine blocking paths, report projection and vendor vocabulary. This is a plan review, not implementation approval or a security audit. Spec coverage and repository standards were checked in separate passes by this reviewer; there was no independent second reviewer.

## Findings: correctness and requirement coverage

### 1. Blocker — Task 6 omits a rule whose verdict definitely changes

**Plan:** `plan.md:103-104,129-131`. **Code:** `packages/rules/src/rules/hygiene/tag-errors.ts:23-43`, `packages/rules/src/decode.ts:10-26`.

`hygiene.tag-errors` recognizes both decoded hit request IDs and `isCollectionRequest`. Adding the new endpoints changes its result on the same stored capture: a lone previously unrecognized new-vendor request with HTTP 500 changes from n.a. to fail; a locally answered request changes from n.a. to inconclusive. Task 6's enumerated list omits this rule. `DECODER_VERSION` is not a substitute for `RULE_CHANGES`: Compare uses `ruleChangedBetween` to decide whether a rule's verdict is trustworthy, while decoder differences are a separate notice (`server/compare-data.ts:355`, `lib/compare.ts:565,744`). A fixture sweep using successful or blocked traffic cannot establish completeness for the HTTP-error case.

**Fix:** Include `hygiene.tag-errors` in the new version. Trace every changed decoder/helper/endpoint consumer, then confirm with old/new decoding **and** evaluation of identical stored captures. `evaluateRun` takes supplied hits; calling two versions with the same pre-decoded hits misses decoder effects. Include explicit errored and locally answered requests. Publish the final change inventory together with the implementation; see finding 2 for additional conditional entries.

### 2. Blocker — The new Vendor union breaks purchase evaluation; its policy is missing

**Plan:** `plan.md:103,108-114`. **Code:** `packages/rules/src/purchases.ts:9-24,35-36`.

`PURCHASE` and `REQUIRED` are exhaustive `Record<Hit["vendor"], …>` maps. They are absent from the tasks. Expanding Vendor without updating them fails type checking; executing current purchase evaluation with a new vendor throws `PURCHASE[hit.vendor] is not a function`. This happens even for a page-view hit because the coverage/duplicate rules filter all hits through `isPurchase`. It can prevent all results from being persisted.

**Fix:** Explicitly decide whether the new vendors participate in purchase coverage/duplicate rules. The minimum bounded choice is to return false for their purchase predicates and document that purchase checks remain scoped to the existing four vendors; fill the required-field map consistently. If support is intended, capture and normalize value/currency/order fields, define purchase identity and retransmission behavior per vendor, add fixture expectations first, and list `coverage.purchase-missing-fields`, `coverage.invalid-currency` and `duplicates.purchase-sent-twice` in `RULE_CHANGES` wherever their verdict can change. Do not silently broaden them as a compiler fix.

### 3. Major — Endpoint generation alone does not provide vendor egress blocking

**Plan:** `plan.md:56,65,103-104,177`. **Code:** `apps/browser/src/inject/vendors.json`, `apps/browser/src/browser-config.ts:43-66`, `apps/browser/src/egress-proxy.ts:198-215`, `apps/browser/src/engines/playwright.ts:1207-1221`, `apps/browser/scrapling/capture.py:303-385`, `packages/capture-contract/src/index.ts:207-235`, `packages/fixtures/inspect.mjs:12-32,112-145`.

The collection copy covers listed request shapes, not every request to vendor hosts. The host list and SDK exception regex contain none of these five vendors. Unknown paths, ancillary matching/sync beacons and OPTIONS to newly listed collection paths can therefore escape blocking. HTTPS CONNECT policy sees only the host; it cannot rescue an omitted vendor host. Conversely, adding a host without its SDK exceptions answers scripts with 204 and stops the pixel loading. There is no general vendor SDK allowlist rejection today for these unlisted public hosts: the immediate risk is unblocked traffic, followed by broken SDK loading when the host list is fixed.

The fixture inspector has its own four-vendor endpoint list. Its output cannot currently prove any new-vendor behavior, and using it unchanged for the spike would send the new requests upstream.

**Fix:** Add a capture task **before the spike**: establish local interception for all candidate hosts and SDK exceptions, then refine it from observed dependency URLs. Update both `vendors.json` and its capture-contract mirror, collection definitions/copy, and the inspector's recognition/output. Verify Playwright and Scrapling separately, including preflights, ancillary requests, redirects and SDK dependencies. Evidence should show SDKs loading, collections recorded as `blocked: true` with local responses, and no non-SDK vendor egress. Do not infer parity from their shared JSON file alone.

### 4. Major — One dedup rule carries accepted risk across different vendors

**Plan:** `plan.md:41,114,175`. **Code/contract:** `AGENTS.md` Database triage and Compare sections; findings and triage are keyed by `(audit_id, rule_id)`.

Suppose a consultant accepts a Snap-only failure. A subsequent audit fixes Snap but introduces missing Reddit IDs. `createAudit` copies the same accepted-risk row, and the combined rule still fails, so the new Reddit problem inherits Snap's acceptance. Compare sees a continuing rule failure instead of a fixed Snap issue and a new Reddit issue. Report notes, exclusions and owner overrides also act at rule level. This is a consequence of the existing identity model, not merely an inability to filter the UI. Report-row reduction does not justify losing independent decisions.

**Fix:** Use stable per-vendor dedup rule IDs, optionally sharing evaluation code. Add fixtures/verification for two vendors failing together, accepting only one, and swapping which fails in the next audit. Update rule counts accordingly. Retaining one rule requires an explicit product decision accepting cross-vendor triage/inheritance and comparison semantics; changing triage identity would be a larger project.

### 5. Major — Location mismatch does not work unchanged, and no fixture would catch it

**Plan:** `plan.md:103,112`. **Code:** `packages/rules/src/rules/hygiene/location-mismatch.ts:26-35`.

The rule explicitly filters out every vendor except GA4 and Meta. Adding `params.page_location` does not make it judge the new vendors. The proposed PII URL fixture does not override the hostname, so it cannot prove this rule even after the filter is fixed.

**Fix:** Add the new supported vendors to the predicate (decide separately whether TikTok should join), write a fixture with a wrong reported host and expected per-vendor evidence before changing the rule, and verify matching-host and missing/invalid-location cases. Keep `hygiene.location-mismatch` in `RULE_CHANGES` when its behavior is actually widened.

### 6. Major — The report has another allowlist that would collapse five vendors into one

**Plan:** `plan.md:135-160`. **Code:** `apps/web/src/server/report-data.ts:154-157`.

`KNOWN_VENDORS` drives the SQL aggregation for the consent summary. It still knows only four vendors and maps all others to `other`. Updating `VENDOR_LABELS`, digest decoding and projection validators leaves the five new vendors merged into “Other vendor” in that section. This contradicts the promised five-vendor report even if finding evidence is correct.

**Fix:** Add `report-data.ts` to Task 7 and use a consistent supported-vendor inventory where practical. Verify five separate consent-summary rows as well as evidence, matrix and comparison tag labels. The existing report shape need not change solely to extend this enum of labels; retaining `REPORT_MODEL_VERSION` is reasonable if stored snapshots remain renderable.

### 7. Major — Check-message privacy is not guaranteed by report projection

**Plan:** `plan.md:55,110-114,150-162`. **Code:** `packages/rules/src/rules/clickids/lost-on-redirect.ts:49-54`, `clickids/lost-across-navigation.ts:69-73,118-135`, `consent/pixel-after-reject.ts:32-33` and `consent/pixel-without-consent.ts`.

The redirect failure prints the entire landing URL; navigation failures print pathname plus query. A dropped click ID with a surviving `msclkid`, hashed-email query field or email therefore prints personal data in a check message. A read-only execution reproduced the full `msclkid=SECRET-CLICK&email=SECRET@example.com` URL in the redirect message. The pixel rules also interpolate raw `hit.event`; newly supported vendor custom event/action strings can contain personal data. Saying that messages “name vendor and event” is insufficient when the event is page-controlled.

**Fix:** Extend the touched rules' tasks to emit fixed labels/counts and document evidence references instead of raw URLs or custom event names. Allowlist event wording; do not rely only on email-pattern scrubbing, which does not recognize opaque click IDs or hashes. Verify sentinel values in raw check-result messages as well as report output. Keep raw values out of all newly constructed messages, including decoder-derived parameter names if those are page-controlled.

The report's digest/projection boundary is a sound existing defense, but it is not evidence that check messages are safe. The projection registry must remain fail-closed; adding a regex for a destination field is not permission to print other vendor identifiers.

### 8. Major — Fixture expectations and reproduction commands cannot prove the proposed behavior

**Plan:** `plan.md:72-85,91-99,118-125,162`. **Code:** `packages/fixtures/README.md:133-145`, `shared/tags.js:69-73`, `page.mjs:24-31`, `packages/core/src/audit.ts:59-63`, `server/audit-create.ts:40-44`.

Specific contradictions/missing controls:

- `vendors-clean` cannot be exclusively pass/n.a. under `--block-vendors`: `hygiene.tag-errors` is inconclusive, as the existing clean baseline explicitly records.
- `hygiene.pii-in-hits` checks document URLs independently of whether any pixels fire. A captured document URL containing the fixture email fails on reject/GPC too; the proposed pass cells are unsafe assumptions. Existing Google tags also run before consent by default.
- `vendors-before-consent` firing once on load does not imply a hit after rejection. The proposed `pixel-after-reject` fail needs an explicitly scheduled post-choice event; otherwise pass is possible. Spell out timing instead of deriving it from the name.
- Removing the query does not remove SDK-written click-ID cookies. Once the spike verifies cookie persistence, `vendors-lost-click-id` may correctly pass. `conversionLinker: false` controls Google, not these five SDKs.
- `/product` and `/thank-you` in `--goto` are origin-relative and omit the fixture site's prefix (`/<site>/product`). The shown commands also supply none of the new landing click IDs. A query introduced after navigation cannot stand in for `input.pageUrl`, which the click-ID rules inspect.
- The app's click-ID toggle injects only gclid/fbclid/ttclid. There is no task to extend `TEST_CLICK_IDS`, so ordinary app audits do not exercise attribution for the new vendors.

**Fix:** Preserve the existing `clean` result set exactly, with new vendor flags defaulting to off. Freeze exact expectations per page, scenario and supported vendor after the spike; explicitly include inconclusive rows. Separate cookie-storage failure from navigation loss with deliberate vendor-specific fixture controls, and disclose any simulated SDK behavior. Supply fully qualified site paths and syntactically valid synthetic IDs in reproducible commands. Extend the shared click-ID inventory used by audit creation/page matching, or explicitly scope this feature to manually entered URLs and stop claiming the normal toggle covers it. Capture regression baselines before implementation and compare exact statuses, not merely absence of failures.

### 9. Major — The spike gate is inconsistent and does not establish consent semantics

**Plan:** `plan.md:17,21,33,47,60-68,170-176`.

The order correctly requires observation before coding. However, line 47 drops an uncapturable vendor, while question 7 permits replay when the SDK is silent without explaining where the real Task 1 sample comes from. A replay of an assumed request cannot confirm its own shape. Test values `T1`–`T5` may also be rejected by SDK validation and cannot prove cookie retention or payload behavior for real-shaped IDs.

Observing `asc=D` proves a parameter mapping, not by itself that all tracking on the request honors rejection. The plan treats that semantic conclusion as established and exempts it from two critical rules. Pin a primary vendor contract or bound the claim explicitly; capture cookie/identifier behavior under denied consent as well as the flag.

**Fix:** Define per-vendor capability gates: observed browser collection, event/dedup mapping, click-ID storage/forwarding, consent semantics. Support only the capabilities each vendor actually proves. Use valid-format synthetic IDs. If real requests require an account, obtain authorized capture evidence or defer that vendor/capability; replay may reproduce an already verified sample but cannot replace discovery. Resolve the silent-tag fallback before building fixtures.

Primary-source checks on 2026-10-28: [Microsoft's CAPI guide](https://learn.microsoft.com/en-us/advertising/guides/uet-conversion-api-integration?view=bingads-13) confirms the browser `event_id` API example and shared-ID dedup approach, but does not establish the browser wire parameter `asc`. [Snap's dedup documentation](https://developers.snap.com/marketing-api/Conversions-API/Deduplication) confirms automatic `@-` IDs and the browser/server field pairing; it also documents transaction/order-ID fallback for purchases. Thus “not deduplicable” is too broad when an order ID exists: describe missing explicit cross-channel event ID, not proof that deduplication is impossible. LinkedIn browser dedup support, Pinterest/Reddit wire fields, SDK dependency URLs and cookie contracts remain gates, not validated facts from this review.

## Findings: repository standards and delivery completeness

### 10. Major — Stored-audit behavior is still an open implementation choice

**Plan:** `plan.md:104,129-133,174`. **Code:** `packages/decoders/src/index.ts:34-39`, `apps/web/src/workflows/Audit.ts:419-456,514`; binding frozen-snapshot/derived-row rules in `AGENTS.md`.

Raising `DECODER_VERSION` identifies newly persisted results; it does not update finished audits. Their persisted hits/checks/findings remain unchanged, although stored raw requests can be decoded differently by new code. A re-run captures a new observation; it is not historical re-decoding. “Re-persist” is not currently an exposed workflow and must not become an improvised update that mixes versions, overwrites human state or suggests a published snapshot has changed.

**Fix:** Choose the bounded policy now: no backfill in this feature, finished audits retain stored decoder/rules versions, frozen shares remain unchanged, and a fresh full audit is required for new coverage. Document it and verify old draft/share rendering and old-vs-new Compare, including tag additions caused by expanded recognition. A decoder-difference notice does not make every tag delta a proven website change. If historical re-decode is required, plan it separately with atomic hit/check/finding regeneration, preserved triage/edits, accurate version provenance and frozen snapshots. Do not leave an essential behavior to an open question during build.

### 11. Minor — The task boundaries and verification budget need revision

**Plan:** `plan.md:47,52,101-146,162-166`.

Task 4 expands Vendor while exhaustive maps in rules/LLM are repaired only in later tasks; the all-workspace check demanded after every task will fail at that boundary. The endpoint-generation script imports `dist`, so running it immediately after editing source can copy stale endpoints. URL-only `decode '<hit-url>'` cannot validate POST bodies. The plan also has no effort estimate despite five uncertain SDKs, two engines, seven fixtures, mobile/journey variants, old/new evaluation, database-backed UI and two report disclosure modes. Task 5 alone implies dozens of captures before regressions and the second engine are included.

**Fix:** Give the spike a time limit and a supported-vendor exit list, then re-estimate. Treat decoder/endpoint copies/exhaustive consumer updates as one checkable integration slice; compile decoder output before `--write`, format the generated copy, then run the full build. Validate POST samples through the CLI's request-file/HAR input where supported, or a one-off read-only invocation of `decode({ url, method, body })`. Define a concrete capture matrix and output location, with baseline/diff work and UI/report checks budgeted separately. Publication verification should use local disposable audit data, not create an external share as an incidental check.

## Cleared risks and validation limits

The high-level sequence—spike, written expectations, fixtures, then production decoding/rules—is correct and follows the fixture-first rule once the contradictory gates and expectations above are fixed. A new `vendors-clean` rather than modifying `clean` is the right baseline boundary. Adding a never-before-existing rule needs a rules-version bump but no `RULE_CHANGES` entry for that new ID. A decoder-version bump to the next available version is appropriate. Raw hit params/IDs/URLs need no new report selection; the existing digest, fixed event vocabulary, destination shape checks and leaf registry should stay in place. No database migration is inherently required for new vendor strings.

Read-only verification used an absolute Node 24 binary to import existing built packages and invoke current rules with synthetic inputs. It reproduced the purchase-helper exception, full redirect-message URL disclosure, and document-only PII failure; vendor-host probes returned false for candidate hosts across all five vendors. Source reads confirmed the report allowlist and tag-errors consumer. These probes demonstrate present code constraints; they do not validate any future decoder or live SDK behavior. The default `node` command initially failed because the local mise shim points at `T3-Code.AppImage`; the absolute binary succeeded.

No live vendor capture, browser audit, database operation, publication, test creation or commit was performed. `pnpm check`, `pnpm typecheck` and `pnpm build` were not run: this review is explicitly read-only except for this file, and these scripts build packages/regenerate artifacts. No claim is made that the proposed implementation builds or works. Only `review-r1.md` was written.

## Verdict

**Ready after fixes.** Keep the spike-first direction, but resolve the two blockers and the major identity, privacy, egress and fixture gaps before treating this as an executable build plan. Prefer per-vendor dedup identity and an explicit no-backfill policy; neither requires a schema redesign.

# More vendors — review R2

Reviewed 2026-10-29 on `main` at `1749586`, against the working-tree plan and R1. Working tree initially clean. Read-only except this file; no commit. Spec and repository standards were checked in separate passes by this reviewer, without an independent reviewer.

**Verdict: ready after fixes.** Both R1 blockers are resolved in the plan. Three major gaps remain in historical comparison and execution order; none requires reconsidering the five-vendor direction. Vendor support remains conditional on the spike.

## R1 disposition

“Resolved” means addressed by the revised plan, not demonstrated by an implementation.

| R1 | Status | Reason |
|---|---|---|
| 1. Blocker: missing changed rule | Resolved | Tasks 5–6 explicitly include `hygiene.tag-errors`, errored/local responses, consumer tracing, and old/new decoding before evaluation. The version boundary still needs fixing below. |
| 2. Blocker: purchase maps | Resolved | Decision 7 and Task 4 explicitly exclude the new vendors using false predicates and empty required-field arrays. No purchase expansion or corresponding change entries are implied. |
| 3. Major: egress | Resolved | Task 0 precedes the spike, covers host lists, SDK exceptions, contract mirror, inspector, and separate engine checks including OPTIONS and ancillary traffic. Task 1 refines the list. Live proof remains a build requirement. |
| 4. Major: dedup identity | Resolved | Stable per-vendor IDs preserve independent triage and report decisions. The POST-controlled two-vendor fixture and cross-audit check exercise the failure swap. Adapt that fixture if either named vendor is deferred. |
| 5. Major: location predicate | Resolved | Task 5 explicitly widens the predicate; Tasks 2–3 add wrong-host evidence and matching/missing/invalid controls. |
| 6. Major: report allowlist | Resolved | Task 7 adds `report-data.ts` and verifies separate consent-summary rows. |
| 7. Major: message privacy | Resolved | The separate `fix/message-privacy` work is an accepted dependency. This plan independently requires safe new/touched messages and raw-message/report sentinel checks; Task 5 covers the redirect/navigation fallback if that work has not landed. Projection remains fail-closed. |
| 8. Major: fixtures and commands | Partly resolved | Timing, document PII, blocked-response inconclusive results, cookie controls, full site paths, and click-ID-bearing landing URLs are addressed. The new `TEST_CLICK_IDS` instruction creates the compatibility problem below. Task 2 must still freeze every provisional row before implementation. |
| 9. Major: evidence gates | Resolved | Decision 8 and Task 1 separate capabilities, require real samples and valid synthetic IDs, prohibit discovery by replay, and condition the Microsoft exemption on consent evidence. The unconditional Microsoft sentence and obsolete dedup name need editorial correction below. |
| 10. Major: stored audits | Partly resolved | No backfill and frozen snapshots are now explicit. However, Task 6 promises decoder-aware tag comparison without planning the code needed to achieve it. |
| 11. Minor: boundaries/budget | Partly resolved | Time box, exit list, re-estimate, effort, POST verification and local publication are supplied. Task 0 still conflicts with the later integration/version boundary, and the decoder build command needs the correction below. |

## Remaining findings — correctness and requirements

### 1. Major — Extending the injection inventory changes old cell identity

**Plan:** `plan.md:126`. **Code:** `apps/web/src/lib/compare.ts:57-95`; `apps/web/src/lib/page-match.ts:4-23`. **Binding standard:** AGENTS.md Compare: structural cell identity must remain stable.

`injectionOf` requires every current `TEST_CLICK_IDS` entry. After adding even one new ID, an old injected run no longer qualifies: its cell changes from the configured page with `injected: true` to its full query-bearing URL with `injected: false`. An old-vs-new audit therefore loses shared cells, affecting findings, tag comparison, history and re-check matching. Merely listing this in the PR or checking that Compare renders does not preserve identity.

A read-only execution of the current `cellKeyOf`, first with today's inventory and then with one extra `msclkid` entry, reproduced both changes on the same old URL (`identityChanged: true`).

**Fix:** Add an explicit compatibility task before widening the inventory. Recognize exact historical injection signatures as well as the new signature, preserving the same normalized page and injected flag; do not classify arbitrary campaign IDs as injected. Verify an old injected audit against a new injected audit, plain runs and genuine campaign URLs, including journey/re-check consumers. Alternatively take the already permitted manual-URL scope and leave the inventory unchanged. Keep SDK forwarding coverage distinct from purchase-rule participation.

### 2. Major — Decoder-aware tag changes are promised but have no implementation task

**Plan:** `plan.md:46,170`. **Code:** `apps/web/src/server/compare-data.ts:387-426`; `apps/web/src/lib/tag-diff.ts`; `apps/web/src/components/compare/tags.tsx:13-40`; `apps/web/src/lib/report-changes.ts:108`.

Task 6 requires recognition-only additions to appear as a decoder difference “rather than new tags as site changes.” Currently `tagSideOf` does not select decoder versions, `TagRun` carries none, and `diffTags` compares stored triples alone. Its output is rendered as “New” / “now fires” and copied into the report's What changed section. The separate comparison notice cannot change that classification. A read-only invocation with identical complete cells, no old decoded tag and one newly recognized Snap tag returned `change: "new"`.

**Fix:** Add an explicit task to carry decoder provenance into tag comparison and withhold or qualify deltas whose recognition coverage differs, in both Compare and report changes. A conservative decoder-mismatch gate is sufficient; no backfill is needed. Verify an unchanged fixture across old/new decoder versions and a genuine tag addition with equal versions. If the chosen representation adds report fields or notice enums, include `REPORT_MODEL_VERSION`, upgrade and projection-registry work; Task 8's unconditional no-model-change assumption then needs revision.

## Remaining findings — repository standards and execution

### 3. Major — Task 0 crosses the integration/version boundary before the baseline

**Plan:** `plan.md:57-61,71-72,108,130-139,166`. **Code:** `packages/decoders/src/collection.ts:10-11`; `packages/rules/src/rules/hygiene/tag-errors.ts`; `packages/rules/src/changes.ts`.

Task 0 adds candidate endpoints to production `COLLECTION_ENDPOINTS`, but those entries require the widened `Vendor` union and exhaustive consumers deferred to Task 4. It cannot meet its full-check gate as written. Even if they are initially `decoded: false`, `isCollectionRequest` already changes `hygiene.tag-errors` verdicts before the Task 6 version bump. Capturing the “before any implementation” baseline in Task 2 is also too late: Task 0 has already changed capture interception and evaluation inputs. Later deferred vendors could leave provisional registry coverage behind.

**Fix:** Capture the old baseline before Task 0. Keep pre-spike production changes to host interception/SDK exceptions and inspector recognition; host interception already handles unknown vendor paths locally. Put provisional spike-specific endpoint matching in the scratch capture if needed. Move final collection definitions, Vendor widening, exhaustive consumers and decoder/rules provenance into one versioned integration boundary. List `hygiene.tag-errors` when that boundary first changes its verdict, and do not release intermediate behavior under the old version. Remove any provisional coverage for deferred vendors. This preserves egress-before-spike and fixture-before-decoder order.

### 4. Minor — The decoder build instruction hits its own stale-copy guard

**Plan:** `plan.md:61,139`. **Code:** `packages/decoders/package.json:18`; `packages/decoders/scripts/engine-endpoints.mjs`.

The package build runs `tsc` and then checks the endpoint copy. Once endpoints change, “build, then --write” emits fresh dist but exits nonzero at the guard; a normal success-dependent sequence never reaches `--write`.

**Fix:** Specify compiler-only emission (`pnpm --filter @zinko/decoders exec tsc -p tsconfig.build.json`), then the writer, formatting and normal full checks. Include the exact working directory or root-relative script path.

### 5. Minor — Two stale statements contradict the accepted decisions

**Plan:** `plan.md:35,210`.

Line 35 still declares `asc=D` evidence of honoring denial while requiring only wire existence; Decision 8 correctly requires semantic proof. Open question 3 still references the abandoned combined `dedup.ad-pixel-eventid-missing` rule.

**Fix:** Make line 35 conditional on the consent-semantics gate and replace the obsolete rule name with `dedup.linkedin-eventid-missing` (omit that rule when the capability is unproven).

## Evidence and limits

Source tracing and two executable, read-only probes support the major comparison findings. The probes used Node 24.21.0 with `stripTypeScriptTypes` on the current source, supplying the current inventory extracted from `packages/core/src/audit.ts`; they wrote no files. An initial import of nonexistent `packages/core/dist/audit.js` failed; the source-only retry exited 0 and produced the identity-change and `new`-tag outputs above. Node emitted its experimental type-stripping warning; this is not an application build result.

No vendor fact was newly validated: endpoint, cookie, dedup and consent claims remain Task 1 gates. No browser, capture, database, publication or network operation was performed. Full repository checks were intentionally not run because this assignment permits writing only this review and those commands regenerate/build artifacts. No implementation-readiness claim is made beyond the plan verdict. Only `review-r2.md` was written.

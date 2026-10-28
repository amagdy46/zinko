---
type: plan
status: proposed
design: ../../vision.md
---

# More Vendors Plan

**Goal:** Zinko reads LinkedIn, Microsoft Ads (UET), Pinterest, Reddit and Snap hits the way it reads Meta and TikTok today. The existing consent, click-ID and PII rules judge them. One new rule per vendor checks their dedup IDs. Demo: `zinko capture <fixture-url> --scenario all --rules --block-vendors` on the new fixtures prints the README's expected result set, and an audit shows the five vendors in the tag matrix, finding evidence and report, under one name each.

**Approach:** Make capture safe for the new hosts first (Task 0), then a time-boxed spike, because most wire shapes below come from secondary sources. Then fixtures and README rows, then one integration slice (decoders, endpoint copies, every exhaustive consumer), then rule changes, then UI and report labels. No new dependency, table or capture capability. Hits are plain `text` in the `hit` table, so no migration. No backfill: finished audits keep their stored decoder and rules versions, frozen shares do not change, and new coverage needs a fresh full audit.

**Effort (re-estimate after Task 1):** about 8 to 12 working days if all five vendors survive the spike. Task 0 about 1 day, Task 1 one session (time-boxed), fixtures and README 2 days, integration slice 2 days, rules and baselines 2 days, UI, report and docs 2 days. Each vendor dropped at the spike saves about a day.

Design sources: `docs/roadmap.md` ("Rules from research", item 9), `docs/research/2026-10-28-competitors.md` (row 13), `AGENTS.md` (Rules, Report), `docs/plans/2026-10-28-capture-capabilities/plan.md` (format). Code read: `packages/decoders/src/{types,collection,index}.ts` and `providers/{meta,tiktok}.ts`, `packages/rules/src/{consent-state,landing,documents,changes,index}.ts` and the rules named below, `packages/llm/src/vocab.ts`, `apps/web/src/lib/{report-projection,tag-matrix}.ts`, `apps/web/src/server/digest-data.ts`, `packages/fixtures/{sites.mjs,README.md,shared/tags.js}`.

## What the hits look like

Source grades: **P** = vendor documentation read for this plan. **S** = secondary source (integration vendors, blogs, search snippets). **M** = from memory of past captures, unchecked. Anything not P is a hypothesis for Task 1 to confirm or kill. Do not code a decoder from an S or M row before Task 1 has a captured sample.

| | LinkedIn Insight Tag | Microsoft UET | Pinterest Tag | Reddit Pixel | Snap Pixel |
|---|---|---|---|---|---|
| Endpoint | `px.ads.linkedin.com/collect` (S); hashed-email matching may go to `/wa/` (S, conflicting) | `bat.bing.com/action/0` (P, help article 60123 via search snippet; one guide says `bat.bing.net` (S)) | `ct.pinterest.com/v3/` (M); S sources talk only of the Conversions API v5 | `alb.reddit.com/rp.gif` (M); no source confirmed it | `tr.snapchat.com/p` (M); the P docs only show the server API `tr.snapchat.com/v3/{PIXEL_ID}/events` |
| Method | GET image beacon, `fmt=gif` (S) | GET, 204 answer (P) | GET (M) | GET (M) | GET or POST (M) |
| Destination ID | `pid` partner ID (S) | `ti` UET tag ID (P) | `tid` (M) | pixel ID, `a2_…` (M) | pixel ID (M) |
| Event name | none for page views; a conversion adds a conversion ID (S: `conversion_id` in `lintrk('track', …)`; wire name unverified) | `evt=pageLoad` or `evt=custom`; custom labels `ea`, `ec`, `el`, `ev` (P) | `event=` (M) | `event=` (M) | `ev=` (M) |
| Click ID | `li_fat_id`, appended to the landing URL when Enhanced conversion tracking is on; first-party cookie `li_fat_id`, 30 days (P, Microsoft Learn, 2026-09) | `msclkid` URL param, sent on UET calls; suggested cookie `_uetmsclkid`, 90 days (P for param and retention, S for the cookie name) | `epik`, URL param and first-party cookie (S) | `rdt_cid` (S, one source) | `ScCid`, appended to the destination URL (P) |
| Dedup ID | Server side `eventId` (P). Browser side field unknown. | `event_id` in `uetq.push('event', …)`, must equal the CAPI `eventId`, same `eventName` and same tag ID (P). Wire name unknown. | `event_id`, with the same event name, 48 h window (S) | `conversionId`, with the same event name; without it, session-based dedup (S) | Pixel `client_dedup_id` = CAPI `event_id`, 48 h window. Unset: the SDK makes one prefixed `@-` that cannot match a server event (P) |
| Personal-data IDs | `li_fat_id`; page URL; hashed email in `/wa/` (S) | `vid` visitor ID, `mid` machine ID, `uid` user ID, `msclkid`, page URL `p` (P for the first four names); hashed `em`/`ph` on CAPI only (P) | `epik`; page URL; hashed email `pd[em]` (M) | `rdt_cid`, `uuid`, page URL (M) | `ScCid`, `_scid`, page URL, hashed email (M) |
| Consent signal on the hit | none known | `asc` = `G` or `D` (S, one CMP vendor, "diagnostic hint, not a contract"). CAPI has `adStorageConsent` `G`/`D` (P). | none known (M) | none known (M) | none known (M) |

Facts that shape the rules:

- Snap's auto-made `@-…` dedup ID is not an explicit cross-channel event ID. A rule that only checks "present" would pass a hit that has no explicit ID to pair with a server event. Snap's docs also describe an order-ID fallback for purchases, so the wording says "no explicit event ID", never "cannot be deduplicated".
- Microsoft is the only one of the five with a per-hit consent flag, so `consent.pixel-without-consent` cannot treat it like Meta: a UET hit with `asc=D` is the vendor honouring denied consent, like a denied Google ping. Needs Task 1 to confirm `asc` exists on the wire.
- LinkedIn and Pinterest set their click-ID cookies themselves; whether a vendor tag stores the ID with no extra setup is exactly what `clickid.cookie-missing` asks, so each vendor's cookie name must be verified before it joins `CLICK_IDS`.
- Zinko sees the browser side only; the server-side half of every dedup pair is invisible. The wording stays as `dedup.tiktok-eventid-missing` has it.

## Decisions (proposed; the owner may overrule)

1. **Vendor ids and labels.** `linkedin`, `microsoft-ads`, `pinterest`, `reddit`, `snap`. Labels: LinkedIn, Microsoft Ads, Pinterest, Reddit, Snap. "Microsoft Ads", not "Bing" or "UET": UET is the tag, the product is Microsoft Advertising, and the label must make sense to a client.
2. **One definition of the name.** Today four files each carry a vendor name map (`@repo/llm` `VENDOR_LABELS`, `rules/documents.ts` `VENDOR_NAMES`, `web/tag-matrix.ts` `VENDOR_NAMES` which says "Google Analytics 4" where the others say "GA4", and `web/report-projection.ts` `VENDORS`). Task 8 makes `@repo/llm`'s `VENDOR_LABELS` the one source for the web app, and `rules` keeps its own map only if it cannot import `llm` (it should not; see Open question 4). Do not add a fifth copy.
3. **Dedup: one rule per vendor**, sharing one evaluation function: `dedup.linkedin-eventid-missing`, `dedup.microsoft-ads-eventid-missing`, `dedup.pinterest-eventid-missing`, `dedup.reddit-eventid-missing`, `dedup.snap-eventid-missing`. Meta and TikTok keep their rules. Reason: triage, report notes, exclusions and owner overrides are keyed by `(audit_id, rule_id)` and copied to the next audit. One combined rule would let an accepted Snap failure hide a new Reddit failure, and Compare would show a continuing failure instead of one fixed and one new. A vendor dropped at the spike drops its rule id.
4. **New fixtures, `clean` untouched.** A new baseline `vendors-clean` carries the five pixels. `clean` is the baseline of the 168-run audits and the other fixture README tables; moving it moves everything.
5. **No new Consent Mode rule for Microsoft** in this plan. `asc` exempts a denied hit from the pixel rules only if Task 1 passes the consent-semantics gate for Microsoft (Decision 8); otherwise Microsoft is judged like Meta.
6. **No backfill.** Finished audits keep their stored hits, check results, findings, decoder version and rules version. Published snapshots are frozen. To get the new vendors an audit must be run again. Compare treats the bumped `RULES_VERSION` through `RULE_CHANGES`, and a tag that only appears because recognition widened is a decoder difference, not proof the site changed. A historical re-decode is a separate project (atomic regeneration of hits, checks and findings, kept triage and edits, version provenance).
7. **Purchase rules stay at four vendors.** The new vendors do not join `coverage.purchase-missing-fields`, `coverage.invalid-currency` or `duplicates.purchase-sent-twice` in this plan. Their `PURCHASE` predicates return false and their `REQUIRED` entries are empty arrays, so nothing throws and nothing is silently judged. Joining them is a later item: it needs captured value, currency and order fields, a purchase identity per vendor, fixture expectations first, and `RULE_CHANGES` entries.
8. **Capability gates per vendor.** A vendor is supported only for the capabilities Task 1 proves: (a) browser collection observed, (b) event name and dedup field mapping, (c) click-ID storage and forwarding (cookie name, writer), (d) consent semantics. A capability without proof is left out and the rules that need it skip that vendor. A vendor whose real requests need an account we do not have is deferred, not replayed. Replay (a fixture answering with a verified sample) may reproduce a sample that Task 1 already captured for real; it never replaces discovery.

## Order

Task 0 makes capture safe: both engines answer the candidate hosts locally. Task 1 is a time-boxed gate: if a vendor's real requests do not look like the table, its row is rewritten before anything depends on it, and a vendor that cannot be captured is deferred, not guessed. Tasks 2 and 3 are README and fixtures with the expected results written first. Task 4 is one integration slice (decoders, endpoint copies, all exhaustive consumers). Task 5 rules, Task 6 registry bumps, Task 7 labels and report data, Task 8 report disclosure, Task 9 sweep.

## Global constraints

- No unit or integration tests (current phase). Each task is verified by running the real thing and pasting the command and what was seen.
- `pnpm check && pnpm typecheck && pnpm build` exit 0, zero warnings, after every task.
- Fixture first: the README's expected set (rule x scenario x status) exists before the rule or decoder it tests. `vendors-clean` must stay at its stated baseline, and `clean` and `consent-*` must give the same results as before except where Task 6 lists a change.
- Decoders say what a request is; rules say whether it is a problem. A fact a rule needs that a decoder drops (the page URL, `asc`, `@-` dedup prefix) is added to the decoder.
- Rule messages never print a click ID, visitor ID, dedup ID, email, raw URL or page-controlled event name. A separate branch is fixing the existing rules' messages. Any message this plan adds or touches follows it: fixed wording, event names only from an allowlist (else "a custom event"), counts, and evidence references instead of values. Verify with sentinel values (see Task 5).
- Every task that changes `Vendor` or a decoder output ends with the full check green, so Task 4 includes every exhaustive consumer. Run the build of `packages/decoders` before `scripts/engine-endpoints.mjs --write` (it reads `dist`), then format the generated copy.
- Local verification only: audits, shares and publication checks use disposable local data, never an external share.
- Both capture engines read the endpoint list from `apps/browser/src/inject/collection.json`, written by `scripts/engine-endpoints.mjs --write`; the build checks the copy.

## Tasks

### Task 0: Egress and interception for the new hosts (before the spike)

The collection copy lists request shapes, not every request to a vendor host. The host list and SDK exceptions know none of the five vendors, so an unlisted path, a matching or sync beacon, or an OPTIONS request would reach the network. Adding a host without its SDK exceptions would instead answer the scripts with 204 and stop the pixel loading.

- Add the candidate hosts (collection hosts and SDK script hosts, see Open question 8) to `apps/browser/src/inject/vendors.json` and its mirror in `packages/capture-contract/src/index.ts`, with the SDK exceptions so the script files still load.
- Add the candidate collection endpoints to the collection definitions and regenerate the copy. Extend the fixtures inspector (`packages/fixtures/inspect.mjs`) to recognise and print the new vendors and to answer them locally; today it sends them upstream.
- Check Playwright and Scrapling separately. Do not infer parity from the shared JSON file.
- The candidate list is refined in Task 1 from the dependency URLs actually observed; Task 1 repeats this check with the final list.

Verify, for each engine: an SDK script loads; a collection request is recorded `blocked: true` with a local response; preflight (OPTIONS), redirects and an ancillary beacon to the same host are answered locally; no non-SDK request to a vendor host leaves the machine (show the network log).

### Task 1: Spike, capture the real requests (gate, time-boxed)

Goal: replace every S and M cell above with a captured sample or mark it unverifiable.

**Time box:** one working session. At the end, write an exit list: for each vendor, which of the four capabilities in Decision 8 are proven, and which vendors are supported, partly supported or deferred. Then re-estimate the plan and delete the tasks and fixtures of deferred vendors. Do not extend the box to rescue a vendor.

- Make a throwaway page outside the repo (or a scratch fixture not committed) that installs each vendor's published snippet with a test ID, fires a page view and one purchase-like event with a dedup ID, and has the five click IDs on its URL as syntactically valid synthetic values in each vendor's real format (length and alphabet from its docs), because an SDK may reject `T1`-style values. Install snippets from each vendor's docs, as `packages/fixtures/vendor/tiktok-pixel/` does.
- Run it through `inspect.mjs`-style capture (vendor requests answered locally, as `--block-vendors` does) and record per vendor: URL, method, query or body, status, every cookie set with name and lifetime, and what changes when consent is denied (Microsoft: does `asc` exist and what values).
- Save one sample per vendor and event type to `packages/decoders/samples/` (existing format, see `tiktok-Purchase.json`). Test IDs only. If a vendor's tag stays silent without a real account, the vendor is deferred (Decision 8); there is no sample to replay until one has been captured for real.
- Capture cookies and identifiers under denied consent as well as granted, and for Microsoft pin `asc` to a primary vendor document or bound the claim to "parameter observed", not "all tracking honours denial".
- Questions this must close: wire name of the dedup ID for LinkedIn, Microsoft, Pinterest and Reddit; where Snap's pixel posts; whether Reddit still uses `rp.gif`; which click-ID cookies exist and who writes them; whether any of the five send a consent flag.
- Output: this plan's table edited in place with grades, the exit list, and `docs/vision.md` updated. Verify: list the sample files, the grade changes and the exit list.

### Task 2: README expected results (before any code)

Write in `packages/fixtures/README.md`: the five test IDs next to the existing ones, the new sites (Task 3) in the Sites table, and an "Expected result sets" subsection with these rows (all scenarios `none`, `accept`, `reject`, `gpc`; `--block-vendors`; a rule not listed is pass or n.a.):

| Site | Rule | none | accept | reject | gpc |
|---|---|---|---|---|---|
| `vendors-clean` | all | pass or n.a., plus `hygiene.tag-errors` inconclusive (as in `clean`) | same | same | same |
| `vendors-before-consent` | `consent.pixel-without-consent` | fail | fail (hits before the action) | fail | fail (GPC wording) |
| `vendors-before-consent` | `consent.pixel-after-reject` | n.a. | n.a. | pass unless the site schedules an event after the choice; the fixture does (Task 3), so fail | n.a. |
| `vendors-after-reject` | `consent.pixel-after-reject` | n.a. | n.a. | fail | n.a. |
| `vendors-no-dedup` | the supported vendors' `dedup.<vendor>-eventid-missing` | fail | fail | fail | fail (only where the pixels fired: scenario `none` and `gpc` fire nothing if they load on consent, so those are n.a.; settle in this task) |
| `vendors-two-dedup` | `dedup.snap-eventid-missing` fails, `dedup.reddit-eventid-missing` passes; next audit swaps them | see Task 3 | | | |
| `vendors-pii-url` | `hygiene.pii-in-hits` | fail | fail | fail (the document URL carries the email whether or not a pixel fires; the pixel hits add evidence only where they fired) | fail |
| `vendors-wrong-host` | `hygiene.location-mismatch` | fail | fail | fail | fail (matching-host hits pass, a missing or invalid location is n.a.) |
| `vendors-lost-click-id` | `clickid.cookie-missing`, `clickid.lost-across-navigation` | n.a. | per Task 1 (the SDK may keep the cookie, then the navigation rule is the only one that can fail) | n.a. | n.a. |
| `uet-consent-denied` | `consent.pixel-without-consent` | pass | pass | pass | pass |

The rows marked "settle" must be filled from Task 1's observations, not from this plan, per page, scenario and supported vendor, and every status including inconclusive is written out. Every supported vendor must appear in the evidence of the failing rows; the README lists which vendors each row's evidence names. Before any implementation, capture the current statuses of `clean`, `meta-before-consent`, `tiktok-after-reject`, `pii-in-url`, `lost-gclid` and the other fixtures (same four commands as Task 5) and keep them as the regression baseline; compare exact statuses afterwards, not only the absence of failures. Verify: README is format-clean and a reviewer can reproduce each row with one fully qualified command.

### Task 3: Fixture sites

In `packages/fixtures/sites.mjs` and `shared/tags.js`, add config keys, all defaulting to off so every existing site, `clean` above all, keeps its result set exactly (`vendors: "consent" | "immediate" | "after-choice" | "off"`, `vendorEventId: "unique" | "none" | "per-vendor"`, `vendorEventAfterChoice`, `vendorReportedHost`; reuse `piiInUrl`, `keepQuery`, `cleanUrl` where they apply; `conversionLinker` controls Google only and does nothing here) and vendor snippets under `packages/fixtures/vendor/<name>-pixel/`. Sites, one bug each:

- `vendors-clean`: the five load only after marketing consent; every purchase event carries the vendor's dedup ID; the landing click IDs are kept (links keep the query).
- `vendors-before-consent`: all five fire on load, and one purchase-like event is scheduled after the choice, so `consent.pixel-after-reject` has something to see on reject.
- `vendors-after-reject`: all five fire after any choice.
- `vendors-no-dedup`: no dedup ID on any event (Snap: no `client_dedup_id`, so its SDK makes the `@-` one).
- `vendors-two-dedup`: two vendors, one with the explicit ID and one without; a release switch (explicit POST, as `drift`) swaps which one fails, to exercise independent triage and inheritance.
- `vendors-pii-url`: `?email=jane.doe@example.com` on the page URL before the tags run.
- `vendors-wrong-host`: each pixel reports a page host other than the real one (`vendorReportedHost`), plus one hit with a missing location.
- `vendors-lost-click-id`: landing URL carries the five click IDs in valid synthetic form, links drop the query, the page clears its own URL after the choice. Cookie storage and navigation loss are separate controls per vendor, because removing the query does not remove a cookie the SDK wrote. If the SDK behaviour is simulated by the fixture, say so in the README.
- `uet-consent-denied`: not a bug; UET Consent Mode default `ad_storage: denied` before the choice, updated on accept.

Verify: `node packages/fixtures/inspect.mjs <site> accept` and `reject` for each site (Task 0 made the inspector recognise the vendors); paste the vendor request lines and compare with the Task 2 rows. Re-run the baseline from Task 2 for the old fixtures and diff exact statuses.

Click-ID inventory: `TEST_CLICK_IDS` in `@repo/core/audit` holds only gclid, fbclid and ttclid, and `audit-create.ts`, `page-match.ts` and `compare.ts` use it. Extend it with the supported vendors' IDs in valid synthetic form (a change to what an audit's toggle adds to the URL, so list it in the PR and check page matching and Compare for old audits). If the owner prefers not to, scope the feature instead: the new click IDs are covered only by a manually entered URL, and the plan and README say so.

### Task 4: Integration slice (decoders, endpoint copies, exhaustive consumers)

This is one checkable slice: it ends with the full check green. Widening `Vendor` breaks every exhaustive consumer, so they are all fixed here:

- `packages/rules/src/purchases.ts`: `PURCHASE` returns false and `REQUIRED` is `[]` for the five (Decision 7); update the doc comment to say purchase checks cover the first four vendors.
- `packages/llm/src/vocab.ts` and other `Record<Vendor, …>` maps and `Schema.Literals` lists (found by `pnpm typecheck`; list them in the PR).
- The endpoint copies: `COLLECTION_ENDPOINTS`, `apps/browser/src/inject/collection.json` and the Task 0 host lists must agree.

Decoders:

`packages/decoders`: one file per vendor under `src/providers/`, shaped like `tiktok.ts` and `meta.ts`; add the ids to `Vendor`, the endpoints to `COLLECTION_ENDPOINTS` (decoded: true, with the non-event beacons, like TikTok's `pixel/act`, listed decoded: false), export in `index.ts`. Per hit: `destinationId`, `event` (LinkedIn: `PageView` or `conversion`), `ids` with `eventId` for the dedup ID in every vendor (so the rule is one code path), `ids.clickId`-style keys named per vendor (`lifatid`, `msclkid`, `epik`, `rdtcid`, `sccid`), `ids` for visitor IDs only where the report and digest ignore them, `params.page_location` from the page URL parameter (so `hygiene.pii-in-hits` and `hygiene.location-mismatch` work unchanged), Microsoft `consent.adStorage` from `asc`. Snap: set `ids.eventId` only when `client_dedup_id` does not start with `@-`, and set `ids.autoDedupId = "true"` otherwise so a rule can say why.
Raise `DECODER_VERSION` to the next free number ("5" now). Build the decoders package, then run `node scripts/engine-endpoints.mjs --write` (in the decoders package) so the engines' copy matches, then format it.

Verify: `node apps/cli/dist/index.js decode '<hit-url>'` on each GET sample, paste the decoded hit. For a POST sample use the CLI's request-file/HAR input if it has one, else a one-off read-only call of `decode({ url, method, body })`. Then `capture <vendors-clean URL> --scenario accept --block-vendors` shows the five vendors' hits in the output.

### Task 5: Rules

- `consent.pixel-without-consent`, `consent.pixel-after-reject`: replace the Meta/TikTok test (`isNonGoogle`) with a vendor set that includes the supported vendors. Microsoft hits whose `consent.adStorage` is `denied` are exempt only if Task 1 passed the consent-semantics gate; `unknown` counts as fired. Their messages stop interpolating the raw `hit.event`: use the allowlisted event name or "a custom event". Update the rule `why` and `fix` text (names, and the vendors' own consent APIs, from Task 1) and the `isNonGoogle` doc comment. Rename `isNonGoogle` only if it stops being true to its name; otherwise keep it, it is exported.
- `clickid.cookie-missing`, `clickid.lost-on-redirect`, `clickid.lost-across-navigation`: add each vendor to `CLICK_IDS` and `VENDORS` only if Task 1 verified its cookie and which hit should carry the ID. A vendor without a verified cookie is left out with a comment, as TikTok is in `lost-across-navigation`. `lost-on-redirect` prints the whole landing URL and `lost-across-navigation` prints path and query today; if the separate message branch has not landed, these two rules are changed here to fixed wording, ID names from the allowlist and counts.
- `hygiene.pii-in-hits`: no code change expected (it reads `params` and `url`); proven on `vendors-pii-url`. Update the `why` text, which names "Google, Meta and TikTok", to name the others.
- `hygiene.location-mismatch`: its predicate keeps only GA4 and Meta, so `params.page_location` alone does nothing. Add the supported vendors to the predicate (whether TikTok joins is decided separately and listed), update the "no GA4 or Meta hit" message, and prove it on `vendors-wrong-host` (wrong host fails with per-vendor evidence; matching host passes; missing or invalid location is skipped). The expected set is written in Task 2 first.
- `hygiene.tag-errors`: recognises decoded hits and `isCollectionRequest`, so the new endpoints change it (an HTTP 500 to a new-vendor endpoint goes from n.a. to fail; a locally answered one goes from n.a. to inconclusive). No code change; it goes in `RULE_CHANGES` (Task 6) and is proven with an errored and a locally answered request to a new endpoint.
- `cookies-without-consent` family list (`rules/src/cookies.ts`): add the five vendors' cookie names verified in Task 1 (`li_fat_id`, `_uetmsclkid`, `_epik`, and the Reddit and Snap ones), each with its label. Labels follow Decision 1.
- New per-vendor dedup rules in `packages/rules/src/rules/dedup/`, registered in `index.ts`, with stable ids `dedup.linkedin-eventid-missing`, `dedup.microsoft-ads-eventid-missing`, `dedup.pinterest-eventid-missing`, `dedup.reddit-eventid-missing`, `dedup.snap-eventid-missing` (only for vendors that pass the event/dedup gate): area `dedup`, severity `warning`, owner `developer`, the TikTok rule's shape, one shared evaluation function taking the vendor. Each has its table of conversion event names (settled from Task 1); fail when such a hit has no `ids.eventId`; n.a. when that vendor sent no hit; `pass` otherwise. The message names the vendor and an allowlisted event, never the ID. Fix steps per vendor (the field name from Task 1). Same Zinko-sees-the-browser-only sentence as TikTok's `why`. Snap wording: "no explicit event ID".

Verify, per fixture, the Task 2 rows (a fixture's path is part of its URL: `<fixture-url>` is the full site URL including the `/<site>` prefix, and `--goto` takes fully qualified paths such as `/<site>/product`; a landing URL for the journey case carries the synthetic click IDs, because the click-ID rules read the captured page URL):

```
node apps/cli/dist/index.js capture <fixture-url>/ --scenario all --rules --block-vendors
node apps/cli/dist/index.js capture <fixture-url>/thank-you --scenario all --rules --block-vendors
node apps/cli/dist/index.js capture <fixture-url>/ --scenario all --rules --block-vendors --mobile
node apps/cli/dist/index.js capture <fixture-url>/ --scenario all --rules --block-vendors --goto /<site>/product --goto /<site>/thank-you
```

The last form is for `vendors-lost-click-id`. Also run the same on `clean`, `meta-before-consent`, `tiktok-after-reject`, `pii-in-url`, `lost-gclid`, and compare with the README: they must not change. Compare exact statuses against the baseline captured in Task 2. Also run `vendors-two-dedup` before and after its release POST in two audits, accept one vendor's failure in the first, and show that the second audit inherits only that rule's acceptance and Compare shows one fixed and one new. Sentinel check: use a fixture page whose URL and custom event names carry `SECRET-CLICK` and `SECRET@example.com`, then `rg` every `check_result.message` of the run for them (zero hits) and for the same values in the report. Paste the commands and output in the PR.

### Task 6: `RULES_VERSION` and `RULE_CHANGES`

Raise `RULES_VERSION` (the next free number at merge time; it is "11" now) once, in the same change as Task 5. In `packages/rules/src/changes.ts` list under the new version every rule whose verdict can differ for the same stored run. A stored capture that contains a request to one of the five hosts was never judged for it, so the verdict can change for: `consent.pixel-without-consent`, `consent.pixel-after-reject`, `consent.cookies-without-consent`, `hygiene.pii-in-hits`, `hygiene.location-mismatch` (its behaviour is widened), `hygiene.tag-errors` (certain: new endpoints change its result), `clickid.cookie-missing`, `clickid.lost-on-redirect`, `clickid.lost-across-navigation` (the last three only if Task 5 added a vendor to them). The purchase rules need no entry while Decision 7 holds. The five dedup rules are only added, so they need no entry.

Do not trust this list; derive it. Trace every changed decoder, helper and endpoint consumer, then run every fixture (and the saved captures of the two M3 sites, if available) through the old and new code: decode the stored raw requests with each version's decoder and evaluate with each version's rules. Calling two rule versions on the same pre-decoded hits misses decoder effects. Include a stored capture with an errored and a locally answered request to a new endpoint. List each rule whose status changed on any of them. A rule that only changes on captures with the new hosts is still listed, because a real site can have them. Record the diff in the PR.

Also: hits stored by `persist` before the bump have no rows for the new vendors, and that stays so (Decision 6). Verify with a local audit finished before the change: its draft report, an existing share link and a Compare of old against a fresh audit of the same fixture all still render, the old audit's findings and stored versions are unchanged, and Compare shows the rules-version caveat and the decoder difference rather than new tags as site changes. Publish the final change inventory with the implementation.

### Task 7: UI vendor labels

One name everywhere (Decision 2):

- `packages/llm/src/vocab.ts`: `VENDOR_LABELS`, `DESTINATION_FORMATS` (shape per vendor from Task 1 samples), `KNOWN_EVENTS` (each vendor's fixed standard event names; anything else prints as "custom event").
- `apps/web/src/server/digest-data.ts`: the `Vendor` `Schema.Literals` list. Required, or a digest of a run with a new vendor fails to decode.
- `apps/web/src/lib/tag-matrix.ts`: `VENDOR_NAMES` and the order in `vendorRank` (ga4, google-ads, meta, tiktok, then the five in the order in this plan). Make it read `VENDOR_LABELS`; this changes "Google Analytics 4" to "GA4" in the matrix, which Task 7 reports as an intended change, or keeps the long name for the matrix only (Open question 4).
- `apps/web/src/lib/report-projection.ts`: `VENDORS` array.
- `apps/web/src/server/report-data.ts`: `KNOWN_VENDORS` drives the consent-summary SQL and maps every other vendor to `other`; without a change the five merge into "Other vendor". Extend it from the same vendor inventory as the labels where practical.
- `packages/rules/src/documents.ts` `VENDOR_NAMES` and `apps/cli/src/index.ts` help text ("Decode a GA4, Meta, Google Ads or TikTok request").
- `apps/web` UI vocabulary stays: "Could not check", "Not evaluated".

Verify: run the dev server, audit `vendors-clean` and `vendors-before-consent` from the fixtures server, open the matrix, a finding with evidence, the report's consent summary (one row per supported vendor, not "Other vendor") and a Compare tag label, at 1440px and 390px in both themes, grayscale pass on the matrix. Report what the columns, summary rows and evidence rows show, with screenshots described.

### Task 8: Report disclosure projection

Rules are the existing ones in `lib/report-projection.ts` and the Report section of `AGENTS.md`; the report never selects `hit.params`, `hit.ids` or `hit.url`, so no click ID, visitor ID or dedup ID can reach it. What changes:

| Item | Standard | Detailed |
|---|---|---|
| Vendor name | the label from Decision 1 | same |
| Event name | a fixed standard name, else "custom event" | same |
| Destination ID of the five (LinkedIn `pid`, UET `ti`, Pinterest `tid`, Reddit pixel ID, Snap pixel ID) | hidden. Only `G-…` and `AW-…` stay (`tagDestination`, `destinationLabel`). | shown if it fits the vendor's `DESTINATION_FORMATS` regex |
| `li_fat_id`, `msclkid`, `epik`, `rdt_cid`, `ScCid`, `vid`, `mid`, `uid`, dedup IDs | never | never |
| Page URL parameter | never printed; pages are "Page 2" or the entered path | same |

Also change the words "Meta and TikTok IDs" (`report-model.ts` `disclosure` comment; the share dialog pre-flight text, `components/report/share-dialog.tsx`) to "ad pixel IDs", so the pre-flight still describes what Detailed adds. The `ReportModel` shape does not change (labels are strings and destinations are already nullable), so `REPORT_MODEL_VERSION` stays; if a field is added anyway, add its validator to `LEAF_VALIDATORS` and an `UPGRADES` step. `vendorLabelValidator` is built from `VENDOR_LABELS`, so the new labels pass `assertProjected` once Task 7 lands.

Verify: build the report for an audit of `vendors-clean` at Standard and at Detailed (consultant preview), save the HTML text, and `rg` it for each test ID, each test click-ID value and the test email: the five destination IDs appear only at Detailed, the others never. Publish a share link on local disposable data, open `/r/<token>`, and repeat the `rg`. Check that a snapshot published before this change still renders. Paste the counts.

### Task 9: Docs sweep

Update `docs/vision.md` (decoders, the vendor table, the "LinkedIn decoder: planned" row, `DECODER_VERSION` 5, the new rules, no-backfill policy, purchase scope, deferred vendors and the later purchase item), `docs/roadmap.md` item 9 (strike "more vendors", keep the spikes), `docs/ui.md` if the vendor names are listed, and the rule count in `README.md` (28 now; plus one per supported vendor's dedup rule). Run `pnpm check && pnpm typecheck && pnpm build`.

## Open questions

1. **Wire shapes (Tasks 1, 2).** Pinterest, Reddit and Snap endpoints, all dedup parameter names except Snap's `client_dedup_id` and Microsoft's `event_id`/`eventId`, and the click-ID cookie names are not confirmed by a vendor document I could open. Search found no primary text for `alb.reddit.com`, `rp.gif`, `ct.pinterest.com/v3` or `tr.snapchat.com/p`; Reddit's help page and API docs returned 404 or were blocked. Task 1 decides.
2. **`asc`.** Only one CMP vendor's guide names it. If the real tag sends something else (or nothing, and consent is expressed only by whether the tag loads), Microsoft is judged like Meta and the `uet-consent-denied` fixture is dropped.
3. **LinkedIn browser-side dedup.** LinkedIn's CAPI schema has `eventId` "used for deduplication" and points to a deduplication page I did not read. The browser field may be in `lintrk('track', {conversion_id, event_id})` or may not exist for the Insight Tag at all. If it does not exist, LinkedIn leaves `dedup.ad-pixel-eventid-missing`.
4. **Label for GA4.** The matrix says "Google Analytics 4"; everything else says "GA4". Unify on "GA4", or keep the long name in the matrix only? Also: can `@repo/rules` import `VENDOR_LABELS` from `@repo/llm`, or should the label map move into `@ovriq/zinko-decoders` (it owns the `Vendor` type, and both already depend on it)? Prefer the decoders package; needs the owner's call because it is a public package name.
5. **Old audits.** Settled: Decision 6, no backfill.
6. **One dedup rule or five.** Settled: Decision 3, per vendor.
7. **Capture reality.** Settled: a tag that stays silent without a real account defers its vendor (Decision 8). Replay may reproduce a sample captured for real; it never substitutes discovery.
8. **Ad-blocker lists.** `--block-vendors` answers collection requests locally; the five vendors' script hosts (`snap.licdn.com`, `bat.bing.com`, `s.pinimg.com`, `www.redditstatic.com`, `sc-static.net`) must load for the fixtures to work, which the egress allow-list for the real engine may refuse. Task 0 settles this.
9. **Sites with real accounts.** Real-site checks only on the sites the owner authorises (M3's Happy Socks and Allbirds); their vendors are unknown to me.

## Sources

Primary (read): [Enabling Click IDs, LinkedIn on Microsoft Learn](https://learn.microsoft.com/en-us/linkedin/marketing/conversions/enabling-first-party-cookies); [LinkedIn Conversions API schema](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/conversions-api-schema); [Microsoft Advertising Conversions API](https://learn.microsoft.com/en-us/advertising/guides/uet-conversion-api-integration); [Snap Conversions API deduplication](https://developers.snap.com/marketing-api/Conversions-API/Deduplication).
Seen only as search snippets: Microsoft UET parameter help article (60123); [Snap Conversions API](https://developers.snap.com/marketing-api/Conversions-API/UsingTheAPI).
Secondary: [Clickio on UET consent](https://docs.clickio.com/books/clickio-consent-cmp/page/microsoft-uet-consent-mode-with-clickio-cmp), [Taggrs on Pinterest dedup](https://taggrs.io/docs/server-side-tracking/pinterest/event-deduplication), [Datahash on Reddit dedup](https://www.datahash.com/docs/signals/destinations/web-conversions/reddit-conversions-api/), [Nuxt Scripts on the LinkedIn Insight Tag](https://scripts.nuxt.com/scripts/linkedin-insight).

## Changes after review r1

1. `hygiene.tag-errors` added to `RULE_CHANGES` (Task 5, Task 6), with errored and locally answered cases; old/new check decodes stored raw requests with each version.
2. `Vendor` widening breaks `purchases.ts`: Decision 7 and Task 4. Predicates false, `REQUIRED` empty, joining the purchase rules is a later item.
3. Task 0 added before the spike: hosts, SDK exceptions, `vendors.json` and its contract mirror, both engines checked separately, inspector updated.
4. Per-vendor dedup rules with stable ids (Decision 3); Task 3 and Task 5 add `vendors-two-dedup` and a triage and Compare check.
5. `hygiene.location-mismatch` predicate widened, with a `vendors-wrong-host` fixture and expectations written first.
6. `KNOWN_VENDORS` in `report-data.ts` added to Task 7; consent summary verified per vendor.
7. Messages: any new or touched message follows the separate message-fix branch; sentinel check on raw `check_result.message` (Task 5).
8. Fixture expectations fixed (inconclusive rows, PII rows, scheduled post-choice event, separate cookie and navigation controls), fully qualified `--goto` paths, baselines captured first, `TEST_CLICK_IDS` extended or scope stated (Tasks 2, 3, 5).
9. Per-vendor capability gates and valid synthetic IDs (Decision 8, Task 1); replay never replaces discovery; Snap wording softened; Microsoft `asc` exemption conditional.
10. No backfill (Decision 6); Task 6 verifies old drafts, shares and old-vs-new Compare.
11. Spike time-boxed with an exit list and re-estimate; Task 4 is one integration slice; build order and POST decoding stated; effort estimate added; verification uses local data only.

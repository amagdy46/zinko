---
type: plan
status: proposed
design: ../../vision.md
---

# More Vendors Plan

**Goal:** Zinko reads LinkedIn, Microsoft Ads (UET), Pinterest, Reddit and Snap hits the way it reads Meta and TikTok today. The existing consent, click-ID and PII rules judge them. One new rule checks their dedup IDs. Demo: `zinko capture <fixture-url> --scenario all --rules --block-vendors` on the new fixtures prints the README's expected result set, and an audit shows the five vendors in the tag matrix, finding evidence and report, under one name each.

**Approach:** Spike first, because most wire shapes below come from secondary sources. Then fixtures and README rows, then decoders, then rule changes, then UI and report labels. No new dependency, table or capture capability. Hits are plain `text` in the `hit` table, so no migration.

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

- Snap's auto-made `@-…` dedup ID is not a dedup ID. A rule that only checks "present" would pass a hit that is not deduplicable. This is the one real new check.
- Microsoft is the only one of the five with a per-hit consent flag, so `consent.pixel-without-consent` cannot treat it like Meta: a UET hit with `asc=D` is the vendor honouring denied consent, like a denied Google ping. Needs Task 1 to confirm `asc` exists on the wire.
- LinkedIn and Pinterest set their click-ID cookies themselves; whether a vendor tag stores the ID with no extra setup is exactly what `clickid.cookie-missing` asks, so each vendor's cookie name must be verified before it joins `CLICK_IDS`.
- Zinko sees the browser side only; the server-side half of every dedup pair is invisible. The wording stays as `dedup.tiktok-eventid-missing` has it.

## Decisions (proposed; the owner may overrule)

1. **Vendor ids and labels.** `linkedin`, `microsoft-ads`, `pinterest`, `reddit`, `snap`. Labels: LinkedIn, Microsoft Ads, Pinterest, Reddit, Snap. "Microsoft Ads", not "Bing" or "UET": UET is the tag, the product is Microsoft Advertising, and the label must make sense to a client.
2. **One definition of the name.** Today four files each carry a vendor name map (`@repo/llm` `VENDOR_LABELS`, `rules/documents.ts` `VENDOR_NAMES`, `web/tag-matrix.ts` `VENDOR_NAMES` which says "Google Analytics 4" where the others say "GA4", and `web/report-projection.ts` `VENDORS`). Task 8 makes `@repo/llm`'s `VENDOR_LABELS` the one source for the web app, and `rules` keeps its own map only if it cannot import `llm` (it should not; see Open question 4). Do not add a fifth copy.
3. **Dedup: one new rule for all five**, `dedup.ad-pixel-eventid-missing`, not five copies. Meta and TikTok keep their rules (no churn in finished findings). Reason: five more rules would be five more rows in every report for one idea.
4. **New fixtures, `clean` untouched.** A new baseline `vendors-clean` carries the five pixels. `clean` is the baseline of the 168-run audits and the other fixture README tables; moving it moves everything.
5. **No new Consent Mode rule for Microsoft** in this plan. `asc` is used only to exempt a denied hit from the pixel rules.

## Order

Task 1 is a gate: if a vendor's real requests do not look like the table, its row is rewritten before anything depends on it, and a vendor that cannot be captured is dropped from this plan, not guessed. Tasks 2 and 3 are README and fixtures with the expected results written first. Task 4 is decoders, Task 5 rules, Task 6 registry bumps, Task 7 labels, Task 8 report, Task 9 sweep.

## Global constraints

- No unit or integration tests (current phase). Each task is verified by running the real thing and pasting the command and what was seen.
- `pnpm check && pnpm typecheck && pnpm build` exit 0, zero warnings, after every task.
- Fixture first: the README's expected set (rule x scenario x status) exists before the rule or decoder it tests. `vendors-clean` must stay at its stated baseline, and `clean` and `consent-*` must give the same results as before except where Task 6 lists a change.
- Decoders say what a request is; rules say whether it is a problem. A fact a rule needs that a decoder drops (the page URL, `asc`, `@-` dedup prefix) is added to the decoder.
- Rule messages never print a click ID, visitor ID, dedup ID, or email. They name the vendor and event.
- Both capture engines read the endpoint list from `apps/browser/src/inject/collection.json`, written by `scripts/engine-endpoints.mjs --write`; the build checks the copy.

## Tasks

### Task 1: Spike, capture the real requests (gate)

Goal: replace every S and M cell above with a captured sample or mark it unverifiable.

- Make a throwaway page outside the repo (or a scratch fixture not committed) that installs each vendor's published snippet with a test ID, fires a page view and one purchase-like event with a dedup ID, and has `?li_fat_id=T1&msclkid=T2&epik=T3&rdt_cid=T4&ScCid=T5` on its URL. Install snippets from each vendor's docs, as `packages/fixtures/vendor/tiktok-pixel/` does.
- Run it through `inspect.mjs`-style capture (vendor requests answered locally, as `--block-vendors` does) and record per vendor: URL, method, query or body, status, every cookie set with name and lifetime, and what changes when consent is denied (Microsoft: does `asc` exist and what values).
- Save one sample per vendor and event type to `packages/decoders/samples/` (existing format, see `tiktok-Purchase.json`). Test IDs only, no real account.
- Questions this must close: wire name of the dedup ID for LinkedIn, Microsoft, Pinterest and Reddit; where Snap's pixel posts; whether Reddit still uses `rp.gif`; which click-ID cookies exist and who writes them; whether any of the five send a consent flag.
- Output: this plan's table edited in place with grades, and `docs/vision.md` updated. Verify: list the sample files and the grade changes.

### Task 2: README expected results (before any code)

Write in `packages/fixtures/README.md`: the five test IDs next to the existing ones, the new sites (Task 3) in the Sites table, and an "Expected result sets" subsection with these rows (all scenarios `none`, `accept`, `reject`, `gpc`; `--block-vendors`; a rule not listed is pass or n.a.):

| Site | Rule | none | accept | reject | gpc |
|---|---|---|---|---|---|
| `vendors-clean` | all | pass or n.a. | pass or n.a. | pass or n.a. | pass or n.a. |
| `vendors-before-consent` | `consent.pixel-without-consent` | fail | fail (hits before the action) | fail | fail (GPC wording) |
| `vendors-before-consent` | `consent.pixel-after-reject` | n.a. | n.a. | fail | n.a. |
| `vendors-after-reject` | `consent.pixel-after-reject` | n.a. | n.a. | fail | n.a. |
| `vendors-no-dedup` | `dedup.ad-pixel-eventid-missing` | fail | fail | fail | fail (only where the pixels fired: scenario `none` and `gpc` fire nothing if they load on consent, so those are n.a.; settle in this task) |
| `vendors-pii-url` | `hygiene.pii-in-hits` | fail | fail | pass | pass (same: depends on what fires) |
| `vendors-lost-click-id` | `clickid.cookie-missing`, `clickid.lost-across-navigation` | n.a. | fail | n.a. | n.a. |
| `uet-consent-denied` | `consent.pixel-without-consent` | pass | pass | pass | pass |

The rows marked "settle" must be filled from Task 1's observations, not from this plan. Every vendor must appear in the evidence of the failing rows; the README lists which vendors each row's evidence names. Verify: `prettier`-clean README, and a reviewer can reproduce each row with one command.

### Task 3: Fixture sites

In `packages/fixtures/sites.mjs` and `shared/tags.js`, add one config key per vendor group (`vendors: "consent" | "immediate" | "after-choice" | "off"`, `vendorEventId: "unique" | "none"`, reuse `piiInUrl`, `keepQuery`, `cleanUrl`, `conversionLinker`-style flags where they apply) and vendor snippets under `packages/fixtures/vendor/<name>-pixel/`. Sites, one bug each:

- `vendors-clean`: the five load only after marketing consent; every purchase event carries the vendor's dedup ID; the landing click IDs are kept (links keep the query).
- `vendors-before-consent`: all five fire on load.
- `vendors-after-reject`: all five fire after any choice.
- `vendors-no-dedup`: no dedup ID on any event (Snap: no `client_dedup_id`, so its SDK makes the `@-` one).
- `vendors-pii-url`: `?email=jane.doe@example.com` on the page URL before the tags run.
- `vendors-lost-click-id`: landing URL carries the five click IDs, links drop the query, the page clears its own URL after the choice.
- `uet-consent-denied`: not a bug; UET Consent Mode default `ad_storage: denied` before the choice, updated on accept.

Verify: `node packages/fixtures/inspect.mjs <site> accept` and `reject` for each site; paste the vendor request lines and compare with the Task 2 rows.

### Task 4: Decoders

`packages/decoders`: one file per vendor under `src/providers/`, shaped like `tiktok.ts` and `meta.ts`; add the ids to `Vendor`, the endpoints to `COLLECTION_ENDPOINTS` (decoded: true, with the non-event beacons, like TikTok's `pixel/act`, listed decoded: false), export in `index.ts`. Per hit: `destinationId`, `event` (LinkedIn: `PageView` or `conversion`), `ids` with `eventId` for the dedup ID in every vendor (so the rule is one code path), `ids.clickId`-style keys named per vendor (`lifatid`, `msclkid`, `epik`, `rdtcid`, `sccid`), `ids` for visitor IDs only where the report and digest ignore them, `params.page_location` from the page URL parameter (so `hygiene.pii-in-hits` and `hygiene.location-mismatch` work unchanged), Microsoft `consent.adStorage` from `asc`. Snap: set `ids.eventId` only when `client_dedup_id` does not start with `@-`, and set `ids.autoDedupId = "true"` otherwise so a rule can say why.
Raise `DECODER_VERSION` to "5". Run `node scripts/engine-endpoints.mjs --write` (in the decoders package) so the engines' copy matches.

Verify: `node apps/cli/dist/index.js decode '<hit-url>'` on each saved sample, paste the decoded hit; then `capture <vendors-clean URL> --scenario accept --block-vendors` shows the five vendors' hits in the output.

### Task 5: Rules

- `consent.pixel-without-consent`, `consent.pixel-after-reject`: replace the Meta/TikTok test (`isNonGoogle`) with a vendor set that includes the five. Microsoft hits whose `consent.adStorage` is `denied` are exempt (the vendor honoured the denial); `unknown` counts as fired. Update the rule `why` and `fix` text (names, and the vendors' own consent APIs, from Task 1) and the `isNonGoogle` doc comment. Rename `isNonGoogle` only if it stops being true to its name; otherwise keep it, it is exported.
- `clickid.cookie-missing`, `clickid.lost-on-redirect`, `clickid.lost-across-navigation`: add each vendor to `CLICK_IDS` and `VENDORS` only if Task 1 verified its cookie and which hit should carry the ID. A vendor without a verified cookie is left out with a comment, as TikTok is in `lost-across-navigation`.
- `hygiene.pii-in-hits`, `hygiene.location-mismatch`: no code change expected (they read `params` and `url`); Task 5 proves it on `vendors-pii-url` and updates the `why` text, which names "Google, Meta and TikTok", to name the others.
- `cookies-without-consent` family list (`rules/src/cookies.ts`): add the five vendors' cookie names verified in Task 1 (`li_fat_id`, `_uetmsclkid`, `_epik`, and the Reddit and Snap ones), each with its label. Labels follow Decision 1.
- New `dedup.ad-pixel-eventid-missing` in `packages/rules/src/rules/dedup/`, registered in `index.ts`: area `dedup`, severity `warning`, owner `developer`, the TikTok rule's shape. For each of the five vendors, a table of its conversion event names (Purchase-like and Lead-like; settled from Task 1) and which hits count; fail when such a hit has no `ids.eventId`; n.a. when none of the five sent a hit; `pass` otherwise. Message names vendor and event, never the ID. Fix steps per vendor (the field name from Task 1). Same Zinko-sees-the-browser-only sentence as TikTok's `why`.

Verify, per fixture, the Task 2 rows:

```
node apps/cli/dist/index.js capture <fixture-url>/ --scenario all --rules --block-vendors
node apps/cli/dist/index.js capture <fixture-url>/thank-you --scenario all --rules --block-vendors
node apps/cli/dist/index.js capture <fixture-url>/ --scenario all --rules --block-vendors --mobile
node apps/cli/dist/index.js capture <fixture-url>/ --scenario all --rules --block-vendors --goto /product --goto /thank-you
```

The last form is for `vendors-lost-click-id`. Also run the same on `clean`, `meta-before-consent`, `tiktok-after-reject`, `pii-in-url`, `lost-gclid`, and compare with the README: they must not change. Paste the commands and output in the PR.

### Task 6: `RULES_VERSION` and `RULE_CHANGES`

Raise `RULES_VERSION` (the next free number at merge time; it is "11" now) once, in the same change as Task 5. In `packages/rules/src/changes.ts` list under the new version every rule whose verdict can differ for the same stored run. A stored capture that contains a request to one of the five hosts was never judged for it, so the verdict can change for: `consent.pixel-without-consent`, `consent.pixel-after-reject`, `consent.cookies-without-consent`, `hygiene.pii-in-hits`, `hygiene.location-mismatch`, `clickid.cookie-missing`, `clickid.lost-on-redirect`, `clickid.lost-across-navigation` (the last three only if Task 5 added a vendor to them). `dedup.ad-pixel-eventid-missing` is only added, so it needs no entry.

Do not trust this list; derive it. Run every fixture (and the saved captures of the two M3 sites, if available) through the old and new `evaluateRun` and list each rule whose status changed on any of them. A rule that only changes on captures with the new hosts is still listed, because a real site can have them. Record the diff in the PR.

Also: hits stored by `persist` before the bump have no rows for the new vendors. Re-deciding is a re-run or a re-persist from the stored capture (see Open question 5).

### Task 7: UI vendor labels

One name everywhere (Decision 2):

- `packages/llm/src/vocab.ts`: `VENDOR_LABELS`, `DESTINATION_FORMATS` (shape per vendor from Task 1 samples), `KNOWN_EVENTS` (each vendor's fixed standard event names; anything else prints as "custom event").
- `apps/web/src/server/digest-data.ts`: the `Vendor` `Schema.Literals` list. Required, or a digest of a run with a new vendor fails to decode.
- `apps/web/src/lib/tag-matrix.ts`: `VENDOR_NAMES` and the order in `vendorRank` (ga4, google-ads, meta, tiktok, then the five in the order in this plan). Make it read `VENDOR_LABELS`; this changes "Google Analytics 4" to "GA4" in the matrix, which Task 7 reports as an intended change, or keeps the long name for the matrix only (Open question 4).
- `apps/web/src/lib/report-projection.ts`: `VENDORS` array.
- `packages/rules/src/documents.ts` `VENDOR_NAMES` and `apps/cli/src/index.ts` help text ("Decode a GA4, Meta, Google Ads or TikTok request").
- `apps/web` UI vocabulary stays: "Could not check", "Not evaluated".

Verify: run the dev server, audit `vendors-clean` and `vendors-before-consent` from the fixtures server, open the matrix, a finding with evidence, and the report at 1440px and 390px in both themes, grayscale pass on the matrix. Report what the five columns and the evidence rows show, with screenshots described.

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

Verify: build the report for an audit of `vendors-clean` at Standard and at Detailed (consultant preview), save the HTML text, and `rg` it for each test ID, each test click-ID value and the test email: the five destination IDs appear only at Detailed, the others never. Publish a share link, open `/r/<token>`, and repeat the `rg`. Paste the counts.

### Task 9: Docs sweep

Update `docs/vision.md` (decoders, the vendor table, the "LinkedIn decoder: planned" row, `DECODER_VERSION` 5, new rule), `docs/roadmap.md` item 9 (strike "more vendors", keep the spikes), `docs/ui.md` if the vendor names are listed, and the rule count in `README.md` (28 now; the new rule makes 29). Run `pnpm check && pnpm typecheck && pnpm build`.

## Open questions

1. **Wire shapes (Tasks 1, 2).** Pinterest, Reddit and Snap endpoints, all dedup parameter names except Snap's `client_dedup_id` and Microsoft's `event_id`/`eventId`, and the click-ID cookie names are not confirmed by a vendor document I could open. Search found no primary text for `alb.reddit.com`, `rp.gif`, `ct.pinterest.com/v3` or `tr.snapchat.com/p`; Reddit's help page and API docs returned 404 or were blocked. Task 1 decides.
2. **`asc`.** Only one CMP vendor's guide names it. If the real tag sends something else (or nothing, and consent is expressed only by whether the tag loads), Microsoft is judged like Meta and the `uet-consent-denied` fixture is dropped.
3. **LinkedIn browser-side dedup.** LinkedIn's CAPI schema has `eventId` "used for deduplication" and points to a deduplication page I did not read. The browser field may be in `lintrk('track', {conversion_id, event_id})` or may not exist for the Insight Tag at all. If it does not exist, LinkedIn leaves `dedup.ad-pixel-eventid-missing`.
4. **Label for GA4.** The matrix says "Google Analytics 4"; everything else says "GA4". Unify on "GA4", or keep the long name in the matrix only? Also: can `@repo/rules` import `VENDOR_LABELS` from `@repo/llm`, or should the label map move into `@ovriq/zinko-decoders` (it owns the `Vendor` type, and both already depend on it)? Prefer the decoders package; needs the owner's call because it is a public package name.
5. **Old audits.** Stored runs have no rows for the new vendors. Re-persisting from the stored capture would add them; no job does that now. Accept "re-run the audit" as the answer, or add a re-decode path? (Comparison treats the rules version bump as a changed rule via `RULE_CHANGES`, so old-vs-new audits compare with a caveat, not wrongly.)
6. **One dedup rule or five.** Decision 3 picks one. A consultant who wants "Snap only" cannot triage per vendor.
7. **Capture reality.** Some of these tags only run on a page with a valid account; a test ID may make the tag do nothing, as TikTok's test pixel does send. If a vendor's tag stays silent on a test ID, its fixture must stub the tag's network call by replaying the Task 1 sample, and the "read the real shape" claim for that vendor is weaker. Task 1 reports which.
8. **Ad-blocker lists.** `--block-vendors` answers collection requests locally; the five vendors' script hosts (`snap.licdn.com`, `bat.bing.com`, `s.pinimg.com`, `www.redditstatic.com`, `sc-static.net`) must load for the fixtures to work, which the egress allow-list for the real engine may refuse. Not checked.
9. **Sites with real accounts.** Real-site checks only on the sites the owner authorises (M3's Happy Socks and Allbirds); their vendors are unknown to me.

## Sources

Primary (read): [Enabling Click IDs, LinkedIn on Microsoft Learn](https://learn.microsoft.com/en-us/linkedin/marketing/conversions/enabling-first-party-cookies); [LinkedIn Conversions API schema](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/conversions-api-schema); [Microsoft Advertising Conversions API](https://learn.microsoft.com/en-us/advertising/guides/uet-conversion-api-integration); [Snap Conversions API deduplication](https://developers.snap.com/marketing-api/Conversions-API/Deduplication).
Seen only as search snippets: Microsoft UET parameter help article (60123); [Snap Conversions API](https://developers.snap.com/marketing-api/Conversions-API/UsingTheAPI).
Secondary: [Clickio on UET consent](https://docs.clickio.com/books/clickio-consent-cmp/page/microsoft-uet-consent-mode-with-clickio-cmp), [Taggrs on Pinterest dedup](https://taggrs.io/docs/server-side-tracking/pinterest/event-deduplication), [Datahash on Reddit dedup](https://www.datahash.com/docs/signals/destinations/web-conversions/reddit-conversions-api/), [Nuxt Scripts on the LinkedIn Insight Tag](https://scripts.nuxt.com/scripts/linkedin-insight).

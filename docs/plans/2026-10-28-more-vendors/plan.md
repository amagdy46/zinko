---
type: plan
status: proposed (Tasks 0 and 1 done)
design: ../../vision.md
---

# More Vendors Plan

**Goal:** Zinko reads LinkedIn, Microsoft Ads (UET), Pinterest, Reddit and Snap hits the way it reads Meta and TikTok today. The existing consent, click-ID and PII rules judge them. One new rule per vendor checks their dedup IDs. Demo: `zinko capture <fixture-url> --scenario all --rules --block-vendors` on the new fixtures prints the README's expected result set, and an audit shows the five vendors in the tag matrix, finding evidence and report, under one name each.

**Approach:** Make capture safe for the new hosts first (Task 0), then a time-boxed spike, because most wire shapes below come from secondary sources. Then fixtures and README rows, then one integration slice (decoders, endpoint copies, every exhaustive consumer), then rule changes, then UI and report labels. No new dependency, table or capture capability. Hits are plain `text` in the `hit` table, so no migration. No backfill: finished audits keep their stored decoder and rules versions, frozen shares do not change, and new coverage needs a fresh full audit.

**Effort (re-estimated after Task 1, 2026-10-29):** about 9 to 11 working days. All five vendors survived the spike (Pinterest partly), so no task or fixture is deleted. Fixtures and README 2 days, integration slice 2.5 days (Pinterest needs its two-endpoint handling), rules and baselines 2 days, Task 6a 1 day, UI, report and docs 2 days. Tasks 0 and 1 are done.

Design sources: `docs/roadmap.md` ("Rules from research", item 9), `docs/research/2026-10-28-competitors.md` (row 13), `AGENTS.md` (Rules, Report), `docs/plans/2026-10-28-capture-capabilities/plan.md` (format). Code read: `packages/decoders/src/{types,collection,index}.ts` and `providers/{meta,tiktok}.ts`, `packages/rules/src/{consent-state,landing,documents,changes,index}.ts` and the rules named below, `packages/llm/src/vocab.ts`, `apps/web/src/lib/{report-projection,tag-matrix}.ts`, `apps/web/src/server/digest-data.ts`, `packages/fixtures/{sites.mjs,README.md,shared/tags.js}`.

## What the hits look like

Source grades: **P** = vendor documentation read for this plan. **C** = captured in the Task 1 spike (2026-10-29): the vendor's published snippet with a test ID, in Chromium, every non-SDK vendor request answered locally; samples in `packages/decoders/samples/`. **S** = secondary source. **M** = from memory, unchecked. A C cell is what the tag did with no account behind the test ID and with the vendors' remote configs answered empty, so account-driven behaviour (auto events, enhanced matching) is not covered. Anything not P or C is a hypothesis.

| | LinkedIn Insight Tag | Microsoft UET | Pinterest Tag | Reddit Pixel | Snap Pixel |
|---|---|---|---|---|---|
| SDK file | `snap.licdn.com/li.lms-analytics/insight.min.js` (C) | `bat.bing.com/bat.js` (C) | `s.pinimg.com/ct/core.js`, then `ct/lib/main.<hash>.js` (C) | `www.redditstatic.com/ads/pixel.js` (C) | `sc-static.net/scevent.min.js` (C) |
| Endpoint | `px.ads.linkedin.com/collect` (C). `POST /wa/?medium=fetch&fmt=g` is a website-signal beacon (gzip, base64, JSON; page URL, `liFatId`, no event): not a hit (C) | `bat.bing.com/action/0` (C); `bat.bing.net/action/0` when consent is denied (C). Consent signal `POST /actionp/0` with `evt=consent` (C). Remote config `bat.bing.com/p/action/<ti>.js` is not an SDK file | `ct.pinterest.com/v3/?event=init` on load (C). A conversion goes to `ct.pinterest.com/user/?event=<name>&ed=<json>&tid=<id>&dep=…EVENT_TAGS_ABSENT` when vendor requests are answered with an empty 204, which is what the engine does (C, the real local-blocking path). Only when `/user/` answers with a config (a stub `{}` in the spike, never a real one) does the tag also send `/v3/?event=<name>&ed=…` (C, stub-config). `/user/` without `event` is the config fetch; `/stats/` is diagnostics `/stats/` is diagnostics | `alb.reddit.com/rp` (C). Not `rp.gif`. Config `pixel-config.reddit.com/pixels/<id>/config` | `tr.snapchat.com/p` (C). Also `GET /cm/i` (id sync) and `GET /config/<host>/<pixel>.js` |
| Method | GET image, `fmt=js` (C) | GET image; consent ping is POST (C) | GET xhr / fetch (C) | POST fetch, form body `application/x-www-form-urlencoded` (C) | POST, JSON body `{ctx, req:[{t:{...}}]}` (C) |
| Destination ID | `pid` (C) | `ti` (C) | `tid` (C) | `id` query and body (C), `a2_…` | `req[].t.pid` (C), a UUID |
| Event name | none for a page view; a conversion adds `conversionId` (C) | `evt=pageLoad`, `evt=custom` with `ea` (action), `ec`, `el`, `gv`, `gc`; `evt=consent` for the consent ping (C) | `event=` (C): `init` on load, `checkout` for the conversion. A `page` call was not seen to send its own event (C, with stub config; open) | `event=` (C): `PageVisit`, `Purchase` | `t.ev` (C): `PAGE_VIEW`, `PURCHASE` |
| Click ID | URL `li_fat_id` is sent as `li_fat_id` on `/collect` and `liFatId` on `/wa/` (C). The tag writes cookie `li_fat_id`, 30 days, host-only, Lax, with no extra setup (C). `li_adsId` in localStorage | URL `msclkid` is sent as `msclkid=<id>-<n>` (C). The tag writes `_uetmsclkid` (value `_uet<id>`), 90 days; `_uetsid` 1 day; `_uetvid` 390 days (C) | URL `epik` is sent in `pd={"epik":…}` (C). The tag writes `_epik`, 365 days (C) | URL `rdt_cid` is sent as `click_id` in the query and body (C). The tag writes `_rdt_cid`, 90 days, SameSite Strict, and `_rdt_uuid`, 90 days (C) | URL `ScCid` is sent as `ctx.sr` and `s_r_id` on `/cm/i` (C). No cookie holds it: `_scid`, `_scid_r`, `_scsrid` (395 days) are Snap's own IDs (C) |
| Dedup ID | `eventId` on `/collect` next to `conversionId` (C; P: LinkedIn deduplication page names `eventId` / `event_id`). Absent when not passed (C) | `event_id` on the `evt=custom` hit (C). Absent when not passed (C) | `event_id` inside the JSON `ed` parameter (C). Absent when not passed (C) | `m.conversionId`, the SHA-256 hex of the ID the page passed (C: sha256 of the test ID matches). Empty when not passed (C) | `t.cdid` (C). Set from `client_dedup_id`; when it is not passed the SDK sends `@-<uuid>` (C, matches P) |
| Personal-data IDs | `li_fat_id`, `li_adsId`, `pageLoadId`, page URL with its query (`url`) (C); `hem` null (C) | `vid`, `sid`, `mid`, `msclkid`, page URL `p` with its query on `pageLoad`, without it on `custom`; under `asc=D` `p` still has the query, `vid`/`sid`/`msclkid` are gone (C) | `epik`, page URL in `ad.loc` with its query (C) | `uuid`, `click_id`, `esurl` = the page origin and path with only `rdt_cid` kept in the captures made, including one with an email in the page URL (C, observed query stripping only) | `u_c1`, `u_sclid`, `u_scsid`, `ctx.sr`, `ctx.url` with its query (C) |
| Consent signal on the hit | none (C) | `asc=G` or `D` on every `action/0` hit and on the consent ping (C). Under `D`: no `vid`, `sid`, top-level `msclkid` or `_uet*` storage; `mid` and `p` (with the landing query) stay (C) | none on the hit. `pintrk('setconsent', false)` makes the tag send nothing and set no cookie (C) | `opt_out=0` or `1` on every hit (C). With `optOut: true` the hits and the cookies still happen (C) | none (C) |

Facts that shape the rules:

- Snap's auto-made `@-…` dedup ID (`t.cdid`, seen on the wire) is not an explicit cross-channel event ID. A rule that only checks "present" would pass a hit that has no explicit ID to pair with a server event. Snap's docs also describe an order-ID fallback for purchases, so the wording says "no explicit event ID", never "cannot be deduplicated".
- Microsoft is the only one of the five whose hit says what consent state it was sent in (`asc`). Two separate observations, not one claim. (1) What the tag omitted under `asc=D` in a fresh denied context: no top-level `vid`, `sid` or `msclkid`, no `_uet*` cookie or localStorage key; the machine ID `mid` and the hit itself still went, to `bat.bing.net`. (2) What it did not omit: the `p` page-URL parameter of the `pageLoad` hit still carries the whole landing URL, including `msclkid`, `li_fat_id`, `epik`, `rdt_cid`, `ScCid` and any email in it (the `custom` hit's `p` has no query). The exemption decision (Decision 5) rests on (1) alone and only covers `consent.pixel-without-consent` and `consent.pixel-after-reject`: a UET hit with `asc=D` is treated like a denied Google ping there. `hygiene.pii-in-hits`, `hygiene.location-mismatch` and the click-ID rules keep reading every UET hit, denied or not, so a click ID or email in `p` is still found. The claim is bounded to what was observed, not to "all tracking honours denial". Reddit has a flag (`opt_out`) that changes nothing the tag does, so it is not an exemption.
- LinkedIn and Pinterest set their click-ID cookies themselves; whether a vendor tag stores the ID with no extra setup is exactly what `clickid.cookie-missing` asks, so each vendor's cookie name must be verified before it joins `CLICK_IDS`.
- Zinko sees the browser side only; the server-side half of every dedup pair is invisible. The wording stays as `dedup.tiktok-eventid-missing` has it.

## Task 1 results (spike, 2026-10-29)

Method: a scratch page outside the repo (`/tmp`) with each vendor's published snippet (test IDs: LinkedIn partner `9000001`, UET `400000001`, Pinterest `2600000000001`, Reddit `a2_zinkotest001`, Snap `11111111-2222-4333-8444-555555555555`), the five click IDs on the URL in each vendor's format, a page view and one purchase-like event (with and without a dedup ID), and three consent variants (granted, denied, denied then granted). It ran in headless Chromium through a router that let only the five SDK files reach the network and answered every other non-local request locally; the log of each run lists every request with its disposition. Samples: 17 files in `packages/decoders/samples/` (`linkedin-*`, `microsoft-*`, `pinterest-*`, `reddit-*`, `snap-*`; the Pinterest file with `-stubconfig` in its name was taken with a stub config answer and is not the path the engine sees), test IDs only, plus the reproducible inputs in `spike-evidence/`, page URL rewritten to `https://shop.example/vendors-spike/`.

### Exit list (Decision 8: a collection observed, b event and dedup mapping, c click-ID storage and forwarding, d consent semantics)

| Vendor | a | b | c | d | Verdict |
|---|---|---|---|---|---|
| LinkedIn | yes | yes: `conversionId`, dedup `eventId`; a page view has no event name | yes: cookie `li_fat_id` (tag-written), forwarded on every `/collect` | no flag; judged like Meta | **Supported.** `dedup.linkedin-eventid-missing` is built. |
| Microsoft Ads | yes | yes: `evt`, `ea`, dedup `event_id` | yes: `_uetmsclkid`, forwarded as `msclkid` | **yes**: `asc=G/D` on the wire; the `asc=D` exemption rests on the omitted `vid`/`sid`/`msclkid`/cookies only (see Facts); `p` still carries the landing query | **Supported**, including the `asc` exemption for the two consent rules and `uet-consent-denied`; PII and URL checks stay on. |
| Pinterest | yes | partly: `checkout` seen on `/user/` under real local blocking with `ed.event_id` (and a missing-ID variant); `/v3/` checkout only under a stub config; no page-view event seen, so page view stays unverified and out of the Task 2 expectations | yes: `_epik`, forwarded in `pd` | no flag on the hit; `setconsent(false)` = silence | **Partly.** Built for the observed events; the page-view event name stays unverified and is listed as such in the README and `vision.md`. |
| Reddit | yes | yes: `event`, dedup `m.conversionId` (hashed) | yes: `_rdt_cid`, forwarded as `click_id` | `opt_out` flag exists but changes nothing; judged like Meta | **Supported.** `esurl` is projected to `page_location` (origin, path and the one `rdt_cid` parameter), so `hygiene.location-mismatch` applies to Reddit and `hygiene.pii-in-hits` still evaluates it. In the one capture made, `esurl` dropped every query parameter but `rdt_cid` (an email on the page URL did not appear); that is a single observation, so the decoder must not assume it and the rule keeps reading whatever `esurl` contains. |
| Snap | yes | yes: `ev`, dedup `t.cdid`, `@-` prefix when unset | forwarding yes (`ctx.sr`, `s_r_id`); no ScCid cookie, so not in `CLICK_IDS` | no flag; judged like Meta | **Supported**; `clickid.cookie-missing` skips Snap. |

No vendor is deferred: no task or fixture is deleted. Pinterest is the only one with a stated gap.

### Questions closed

- Dedup wire names: LinkedIn `eventId` (`/collect`), Microsoft `event_id`, Pinterest `event_id` inside the JSON `ed`, Reddit `m.conversionId` (SHA-256 hex of the page's ID, empty when absent), Snap `t.cdid`.
- Snap posts to `tr.snapchat.com/p`, JSON, a batch in `req[]`. Reddit does not use `rp.gif` any more: `POST alb.reddit.com/rp`.
- Click-ID cookies: `li_fat_id` (30 days), `_uetmsclkid` (90), `_epik` (365), `_rdt_cid` (90), all written by the tag's JavaScript on the page host. Snap has none. Observed without an account; a real account with Enhanced conversion tracking (LinkedIn) may change what is stored. Cookies set by the vendors' own responses cannot be observed offline.
- Consent flags on the wire: Microsoft `asc` (D/G) and Reddit `opt_out` (0/1). Pinterest honours `setconsent` by sending nothing. LinkedIn and Snap have no consent API in the tag we installed.
- Microsoft `asc` is pinned to the wire, not to a vendor document: the Microsoft help article 60119 was not retrievable; the observation is on `bat.bing.com/bat.js`.
- LinkedIn browser dedup exists (`eventId`), so Open question 3 is closed in favour of building the rule.

### What this changes below

- Task 4: Snap's dedup field is `t.cdid` (not `client_dedup_id`); the `@-` rule stays. Pinterest (decision, stateless per-request decoder): decode `/user/` with an `event` parameter as the event hit (it is the request present in both modes: under local 204 answers it is the only one, with a real config it comes first), decode `/v3/` only for `event=init` (the load hit), and mark `/v3/` with any other event, `/user/` without `event` (the config fetch) and `/stats/` as `decoded: false`. A decoder sees one request and cannot pair a `/user/` with its `/v3/` follower, so it decodes only the one that always exists; the follower is a repeat delivery of the same event, and `decoded: false` keeps it from counting twice. Cost: in an unblocked capture the `/v3/` copy is invisible, which is harmless because nothing reads it. Reddit and Snap bodies need the POST path of `decode` (form body, JSON body). LinkedIn `/wa/` is `decoded: false`. Microsoft `evt=consent` is a consent signal, not an event hit (`decoded: false`, or a hit with `event: "consent"` that no rule counts).
- Task 5: `hygiene.location-mismatch` uses `url` (LinkedIn), `p` (Microsoft), `ad.loc` (Pinterest) and `ctx.url` (Snap); Reddit: `esurl` is projected to `page_location` (see the exit list), so Reddit joins the `location-mismatch` predicate and `vendors-wrong-host` expects it to fail like the others. `cookies-without-consent` family names: `li_fat_id`, `_uetmsclkid` (and `_uetvid`, `_uetsid`), `_epik`, `_rdt_cid` and `_rdt_uuid`, `_scid`, `_scid_r`, `_scsrid`. `CLICK_IDS`: LinkedIn, Microsoft, Pinterest, Reddit; not Snap.
- Task 3: the UET snippet is installed with an `https://` source (the published one is protocol-relative and would load `http://bat.bing.com` on the fixtures' `http://localhost`, which the SDK exception does not match).
- Task 0 follow-up: remote configs (`bat.bing.com/p/action/*.js`, `tr.snapchat.com/config/*`, `pixel-config.reddit.com`, Pinterest `/user/`) are answered locally and empty, so audits see the tags in their account-less default state. This is the same position the plan already takes for `--block-vendors`.

### Known limitation: the older vendor entries are whole domains

`google.com`, `facebook.com`, `instagram.com` and `tiktok.com` were already intercepted as whole registrable domains before this plan, and this branch leaves them alone. With `--block-vendors` that suppresses legitimate documents, embeds and assets on those domains (a Google Map or YouTube embed, a Facebook or Instagram post, a TikTok embed, an audited site on one of them): they are answered with a local 204. They should be narrowed to observed tracking hosts and paths in the same way as the five new vendors, with a regression run. Tracked as item 9a in `docs/roadmap.md`.

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

**Done 2026-10-29.** Baseline: `baseline/` (110 files, `README.md` there). Hosts and SDK exceptions: commit `9a35d6a`. Both engines verified (SDK loads, collection blocked with a local answer, preflight, redirect hops, unlisted paths and beacons local, egress log shows no vendor host contacted beyond the SDK files).

First capture the old baseline: every fixture in the README, `--scenario all --rules --block-vendors`, exact statuses saved under `docs/plans/2026-10-28-more-vendors/baseline/` (status lines only, no hit values). Task 2 and Task 6 diff against this baseline, taken before any production change.


The collection copy lists request shapes, not every request to a vendor host. The host list and SDK exceptions know none of the five vendors, so an unlisted path, a matching or sync beacon, or an OPTIONS request would reach the network. Adding a host without its SDK exceptions would instead answer the scripts with 204 and stop the pixel loading.

- Add the vendors' tracking, config and sync hosts (and the hosts that serve their SDK files, see Open question 8) to `apps/browser/src/inject/vendors.json` and its mirror in `packages/capture-contract/src/index.ts`, with the SDK exceptions so the script files still load. **Not whole registrable domains** (gate review, 2026-10-29): `px.ads.linkedin.com`, `snap.licdn.com`, `bat.bing.com`, `bat.bing.net`, `ct.pinterest.com`, `s.pinimg.com`, `alb.reddit.com`, `pixel-config.reddit.com`, `www.redditstatic.com`, `tr.snapchat.com`, `sc-static.net`: exactly the hosts the spike saw. `www.linkedin.com`, `www.reddit.com`, `www.bing.com` (Maps), `i.pinimg.com` and the other sites' documents, embeds and images are not intercepted. The four script hosts (`s.pinimg.com`, `www.redditstatic.com`, `sc-static.net`, `snap.licdn.com`) are whole hosts because the proxy sees no path inside an HTTPS tunnel, so only the SDK files get through from them; `ct/lib/*.js` on `s.pinimg.com` is a directory wildcard (the tag loads one hashed chunk). `bat.r.msn.com` and `dc.ads.linkedin.com` were guessed, never observed, and are not listed.
- Do not touch `COLLECTION_ENDPOINTS` or the `Vendor` union here: both change evaluation inputs (`isCollectionRequest` feeds `hygiene.tag-errors`) and belong to the versioned integration boundary (Task 4 with Tasks 5 and 6). Host interception already answers unknown vendor paths locally. Spike-specific endpoint matching, if needed, lives in the scratch capture script, not in production code. Extend the fixtures inspector (`packages/fixtures/inspect.mjs`) to recognise and print the new vendors and to answer them locally; today it sends them upstream.
- Check Playwright and Scrapling separately. Do not infer parity from the shared JSON file.
- The candidate list is refined in Task 1 from the dependency URLs actually observed; Task 1 repeats this check with the final list.

Verify, for each engine: an SDK script loads; a collection request is recorded `blocked: true` with a local response; preflight (OPTIONS), redirects and an ancillary beacon to the same host are answered locally; no non-SDK request to a vendor host leaves the machine (show the network log).

### Task 1: Spike, capture the real requests (gate, time-boxed)

**Done 2026-10-29.** Results, exit list and samples are in "Task 1 results" above.

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
| `vendors-wrong-host` | `hygiene.location-mismatch` | fail | fail | fail | fail (matching-host hits pass, a missing or invalid location is n.a.). Evidence names LinkedIn, Microsoft, Pinterest, Reddit (`esurl`) and Snap; Pinterest and Reddit count through the hits Task 4 decodes |
| `vendors-lost-click-id` | `clickid.cookie-missing`, `clickid.lost-across-navigation` | n.a. | per Task 1 (the SDK may keep the cookie, then the navigation rule is the only one that can fail) | n.a. | n.a. |
| `uet-consent-denied` | `consent.pixel-without-consent` | pass | pass | pass | pass |

Pinterest page view is unverified (the spike saw no page-view event): no Task 2 row may depend on it, and the Pinterest evidence in any row is its `/user/` checkout hit and its `/v3/?event=init` load hit only. The rows marked "settle" must be filled from Task 1's observations, not from this plan, per page, scenario and supported vendor, and every status including inconclusive is written out. Every supported vendor must appear in the evidence of the failing rows; the README lists which vendors each row's evidence names. Before any implementation, capture the current statuses of `clean`, `meta-before-consent`, `tiktok-after-reject`, `pii-in-url`, `lost-gclid` and the other fixtures (same four commands as Task 5) and keep them as the regression baseline; compare exact statuses afterwards, not only the absence of failures. Verify: README is format-clean and a reviewer can reproduce each row with one fully qualified command.

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

Click-ID inventory: `TEST_CLICK_IDS` in `@repo/core/audit` stays unchanged (gclid, fbclid, ttclid). `injectionOf` in `compare.ts` requires every entry of the current inventory, so widening it would change the cell identity of every old injected run (review r2, finding 1). In this plan the new vendors' click IDs are covered only by a manually entered URL that carries them; the README, the New audit hint and `docs/vision.md` say so. Widening the toggle is a later item that first teaches `injectionOf` the exact historical signatures.

### Task 4: Integration slice (decoders, endpoint copies, exhaustive consumers)

This is one checkable slice: it ends with the full check green. Widening `Vendor` breaks every exhaustive consumer, so they are all fixed here:

- `packages/rules/src/purchases.ts`: `PURCHASE` returns false and `REQUIRED` is `[]` for the five (Decision 7); update the doc comment to say purchase checks cover the first four vendors.
- `packages/llm/src/vocab.ts` and other `Record<Vendor, …>` maps and `Schema.Literals` lists (found by `pnpm typecheck`; list them in the PR).
- The endpoint copies: `COLLECTION_ENDPOINTS`, `apps/browser/src/inject/collection.json` and the Task 0 host lists must agree.

Decoders:

`packages/decoders`: one file per vendor under `src/providers/`, shaped like `tiktok.ts` and `meta.ts`; add the ids to `Vendor`, the endpoints to `COLLECTION_ENDPOINTS` (decoded: true, with the non-event beacons, like TikTok's `pixel/act`, listed decoded: false), export in `index.ts`. Per hit: `destinationId`, `event` (LinkedIn: `PageView` or `conversion`), `ids` with `eventId` for the dedup ID in every vendor (so the rule is one code path), `ids.clickId`-style keys named per vendor (`lifatid`, `msclkid`, `epik`, `rdtcid`, `sccid`), `ids` for visitor IDs only where the report and digest ignore them, `params.page_location` from the page URL parameter (so `hygiene.pii-in-hits` and `hygiene.location-mismatch` work unchanged), Microsoft `consent.adStorage` from `asc`. Snap: set `ids.eventId` only when `t.cdid` (the wire name of `client_dedup_id`) does not start with `@-`, and set `ids.autoDedupId = "true"` otherwise so a rule can say why.
Raise `DECODER_VERSION` to the next free number ("5" now). The package build runs `tsc` and then fails on a stale endpoint copy, so emit with the compiler only, then write the copy, then format and run the full checks: `pnpm --filter @ovriq/zinko-decoders exec tsc -p tsconfig.build.json && node packages/decoders/scripts/engine-endpoints.mjs --write && pnpm format` (from the repository root; adjust the script path if it resolves relative to the package). Tasks 4, 5 and 6 are one versioned boundary: nothing between them is merged or released under the old `RULES_VERSION`. Remove any provisional coverage for a vendor deferred at the spike.

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

### Task 6a: Decoder-aware tag comparison

Today `tagSideOf` (`server/compare-data.ts`) selects no decoder version, `TagRun` carries none and `diffTags` (`lib/tag-diff.ts`) compares stored triples only, so a tag that appears only because recognition widened shows as "New" in Compare and in the report's What changed (review r2, finding 2). Carry each run's decoder version into `TagRun`. When the two sides' decoder versions differ, a tag of a vendor the older decoder could not recognise is not a change: leave it out of the diff and count it under the existing decoder-difference notice ("n tags are new only because this version recognises more vendors"). Apply the same filter before `report-changes.ts` builds What changed. If this needs a new report field or notice value, raise `REPORT_MODEL_VERSION` with an `UPGRADES` step and a `LEAF_VALIDATORS` entry, and Task 8's no-model-change assumption no longer holds.

Verify: an unchanged fixture captured under the old and new decoder shows no new tags (only the notice); a genuine tag addition with equal decoder versions still shows as New, in Compare and in a draft report.

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

1. **Wire shapes (closed by Task 1).** Superseded by the table and the results section; the original text follows. Pinterest, Reddit and Snap endpoints, all dedup parameter names except Snap's `client_dedup_id` and Microsoft's `event_id`/`eventId`, and the click-ID cookie names are not confirmed by a vendor document I could open. Search found no primary text for `alb.reddit.com`, `rp.gif`, `ct.pinterest.com/v3` or `tr.snapchat.com/p`; Reddit's help page and API docs returned 404 or were blocked. Task 1 decides.
2. **`asc` (closed: the flag exists and the gate passes).** Original text: Only one CMP vendor's guide names it. If the real tag sends something else (or nothing, and consent is expressed only by whether the tag loads), Microsoft is judged like Meta and the `uet-consent-denied` fixture is dropped.
3. **LinkedIn browser-side dedup (closed: `eventId` exists).** Original text: LinkedIn's CAPI schema has `eventId` "used for deduplication" and points to a deduplication page I did not read. The browser field may be in `lintrk('track', {conversion_id, event_id})` or may not exist for the Insight Tag at all. If it does not exist, `dedup.linkedin-eventid-missing` is not built.
4. **Label for GA4.** The matrix says "Google Analytics 4"; everything else says "GA4". Unify on "GA4", or keep the long name in the matrix only? Also: can `@repo/rules` import `VENDOR_LABELS` from `@repo/llm`, or should the label map move into `@ovriq/zinko-decoders` (it owns the `Vendor` type, and both already depend on it)? Prefer the decoders package; needs the owner's call because it is a public package name.
5. **Old audits.** Settled: Decision 6, no backfill.
6. **One dedup rule or five.** Settled: Decision 3, per vendor.
7. **Capture reality.** Settled: a tag that stays silent without a real account defers its vendor (Decision 8). Replay may reproduce a sample captured for real; it never substitutes discovery.
8. **Ad-blocker lists (closed by Task 0).** Original text: `--block-vendors` answers collection requests locally; the five vendors' script hosts (`snap.licdn.com`, `bat.bing.com`, `s.pinimg.com`, `www.redditstatic.com`, `sc-static.net`) must load for the fixtures to work, which the egress allow-list for the real engine may refuse. Task 0 settles this.
9. **Sites with real accounts.** Real-site checks only on the sites the owner authorises (M3's Happy Socks and Allbirds); their vendors are unknown to me.

## Sources

Primary (read): [Enabling Click IDs, LinkedIn on Microsoft Learn](https://learn.microsoft.com/en-us/linkedin/marketing/conversions/enabling-first-party-cookies); [LinkedIn Conversions API schema](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/conversions-api-schema); [Microsoft Advertising Conversions API](https://learn.microsoft.com/en-us/advertising/guides/uet-conversion-api-integration); [Snap Conversions API deduplication](https://developers.snap.com/marketing-api/Conversions-API/Deduplication).
Seen only as search snippets: Microsoft UET parameter help article (60123); [Snap Conversions API](https://developers.snap.com/marketing-api/Conversions-API/UsingTheAPI).
Read in Task 1 (search results, snippets): [LinkedIn Conversions API deduplication](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/conversions/deduplication) and its [Insight Tag variant](https://learn.microsoft.com/en-us/linkedin/marketing/conversions/deduplication?view=li-lms-2024-05) (browser `event_id`, image-pixel `eventId`); [Pinterest, install the base code](https://help.pinterest.com/en/business/article/install-the-base-code) (`core.js`, `load`, `page`, `fp_cookie`, `setconsent`); [Pinterest developer docs, Pinterest tag](https://developers.pinterest.com/docs/api-features/pinterest-tag/); [Snap Conversions API deduplication](https://developers.snap.com/api/marketing-api/Conversions-API/Deduplication) (`client_dedup_id`, `@-` prefix); [Microsoft, Setting up UET for consent mode](https://help.ads.microsoft.com/apex/index/3/en/60119) (snippet only, the page itself did not load); [Reddit pixel guide (Stackmatix)](https://www.stackmatix.com/blog/reddit-pixel-setup) and [c15t on the Reddit pixel](https://c15t.com/docs/integrations/reddit-pixel.md) (base code, `conversionId`, `optOut`); [Snap pixel base code (Intercom/checkout help)](https://intercom.help/checkouthelpcenter/en/articles/3429737-snapchat-integration-with-extension-code). The install snippets in the spike are the published shapes written from these pages and from memory of the vendors' generated code, not copied from an account. The wire shapes are observed (C), not read from a vendor document.
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

## Changes after review r2

1. Cell identity: `TEST_CLICK_IDS` stays unchanged; new click IDs only through manual URLs (Task 3).
2. Decoder-aware tag comparison: new Task 6a, with a report model bump if it needs a field.
3. Version boundary: baseline captured first in Task 0; Task 0 changes only host interception, SDK exceptions and the inspector; endpoints and `Vendor` move to the Task 4–6 boundary; deferred vendors leave no coverage.
4. Decoder build: compiler-only emit, then the writer, then format.
5. Editorial: the Microsoft consent sentence is conditional on the gate; the obsolete combined rule name is gone.

## Changes after Task 1 (2026-10-29)

1. Table graded in place (C = captured); Task 1 results and the exit list added; all five vendors proceed, Pinterest partly.
2. Effort re-estimated to 9 to 11 days; no task deleted.
3. Task 4 decoder notes: Snap `t.cdid`, Pinterest `/user/` plus `/v3/` de-duplication, POST bodies for Reddit and Snap, Microsoft consent ping.
4. Reddit does not send the page query: `hygiene.pii-in-hits` and `location-mismatch` skip it; Snap is not a click-ID cookie vendor.
5. Microsoft `asc` gate passed (bounded claim). Task 0 done: the five vendors' hosts and SDK exceptions are in `vendors.json` and its contract mirror, both engines verified.

## Changes after the spike gate review (2026-10-29, `spike-review.md`)

1. Interception narrowed to the observed tracking, config and sync hosts (see Task 0); the older whole-domain entries are untouched and recorded as a known limitation and roadmap item 9a. Probes and the regression runs are in `spike-evidence/regression.md`.
2. Regression: the committed Scrapling baseline was rerun after the fix and a Playwright baseline was taken before Task 0 and after the fix; see `spike-evidence/regression.md`.
3. Pinterest: observed `/user/` checkout samples (with and without an event ID), stub-config samples labelled `-stubconfig` in the file name, page view unverified and out of Task 2, and the stateless mapping decided in Task 4.
4. Microsoft: the `asc=D` observation (what was omitted) kept apart from the exemption decision, and the fact that `p` carries the landing query stated; PII and URL checks stay on.
5. Reddit: `esurl` projected to `page_location`, Reddit in the `location-mismatch` expectations, claim limited to observed query stripping, PII evaluation kept.
6. Evidence kept: `spike-evidence/` holds the page with the exact snippets, the probe page, the harness, the SDK file hashes and the commands.
7. Regression found a Task 0 gap: Reddit's `pixel.js` arrives gzipped even for `accept-encoding: identity` and the SDK path dropped `content-encoding`, so the pixel never ran in either engine. Fixed in `egress-proxy.ts` (pass the header) and `scrapling/capture.py` (gunzip). Details and the full diff results in `spike-evidence/regression.md`; the Playwright baselines are in `baseline-playwright/`.

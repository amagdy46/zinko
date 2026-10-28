---
type: plan
status: proposed
design: ../../vision.md
---

# Capture Capabilities Plan

**Goal:** The capture engine can do the three things the next research-driven rules need, and four rules use them. After a consent choice a journey run can reload the page and say, per document, whether the banner came back and what consent state the page was in. A run can follow a real link to another host the site measures. Every script and tag request records who asked for it, so a finding can say "loaded by Google Tag Manager" or "hardcoded in the page" and the report can name who fixes it. Rules: `consent.not-persisted-across-navigation`, `duplicates.purchase-on-reload`, `consent.lost-across-subdomain`, `clickid.crossdomain-linker-missing`. Demo: `zinko capture` against the new fixtures prints the expected rule x scenario result set from each fixture's README, and an audit's finding detail shows "Loaded by".
**Approach:** Three capabilities, each backward compatible with stored captures (new fields are `optionalKey`, nothing is renamed). One shared foundation does most of the work: the capture records, for every document loaded after the consent action, how it was reached (`navigation`) and whether the banner was shown (`banner`), using the banner check the engine already runs to verify the consent choice. The reload is a new journey step, not a new run kind, so it adds no runs and no admission turns. Cross-host is a new `follow` step (click the real link, because gtag decorates links with `_gl` at click time) plus a per-site list of measured hosts that feeds the existing `allowedHosts` guard; it adds at most three runs per audit. Initiators come from CDP `Network.requestWillBeSent` in both engines (both drive Playwright's API, so both can open a CDP session) and are classified later by a pure function in `@repo/rules`, so a better classifier re-reads old captures. No new dependency, no new table; two additive columns.

Design sources: `docs/roadmap.md` ("Rules from research", items 6 to 9), `docs/research/2026-10-28-pain-points.md` (rule ideas table), `docs/vision.md` (capture engine, "Site allow-list", "Journeys", "Consent scenarios", "Banner detection uncertainty", "Journey runs"), `docs/decisions/0003-capture-admission.md`, `AGENTS.md` (Rules, Capture admission, Storage, Database), `docs/plans/2026-10-27-m4-matrix-overview-llm/plan.md` (format), and the code as of `075220d`: `apps/browser/src/{capture,contract,server,egress-proxy,url-policy}.ts`, `apps/browser/src/engines/{playwright,cdp-frames}.ts`, `apps/browser/scrapling/capture.py`, `apps/browser/src/inject/datalayer-shim.js`, `packages/capture-contract/src/index.ts`, `apps/web/src/workflows/Audit.ts`, `packages/core/src/audit.ts`, `packages/db/src/audit-schema.ts`, `packages/rules/src/**`, `packages/decoders/src/providers/ga4.ts`, `apps/cli/src/index.ts`, `packages/fixtures/*`. The M5 report plan is not in the repository yet; the "who fixes it" consumer below is written against the pain-points research ("an owner and effort hint per finding").

## Global constraints

- **No unit or integration tests** (`AGENTS.md`, current phase). Each task is verified by running the real thing and reporting the command and what was seen: `zinko capture <fixture-url> --scenario all --rules --block-vendors` (add `--mobile`, `--goto`, `--reload`, `--follow` as the task says), the fixtures server (`pnpm --filter @repo/fixtures serve`), `node packages/fixtures/inspect.mjs`, `psql`, and the dev server in a browser at 1440x900 and 390x844 in both themes for any UI change.
- `pnpm check && pnpm typecheck && pnpm build` exit 0 with zero warnings after every task (real exit codes).
- **Fixture first** (`AGENTS.md`, Rules): for each rule, the fixture site and its expected result set (rule x scenario x status) go into `packages/fixtures/README.md` before the rule exists, and `clean` stays at its baseline. The expected sets in this plan are the starting point, not the final word; the README is.
- **Both engines, same change.** Every engine change lands in `apps/browser/src/engines/playwright.ts` and `apps/browser/scrapling/capture.py` in the same task, and in `apps/browser/src/contract.ts` and `packages/capture-contract/src/index.ts` (the two are kept in step by hand). `contract.ts` goes first: Node decodes checkpoints with it and an unknown field is dropped silently.
- **Backward compatible contract.** Every new field is `Schema.optionalKey`. Stored `capture.json` files decode unchanged. A rule that needs a new field and finds it absent returns `inconclusive` ("this capture predates ..."), never `pass`.
- **Deploy order.** The browser app first (it accepts both old and new requests), then the web app (it starts sending `reload`, `follow` and `measuredHosts`). A new step sent to an old engine is a 400 `InvalidRequest` and the run records a refusal, so the order matters.
- **Rules decide, rules are pure.** `evaluate(input)` stays a pure function of one run: no I/O, no clock. Every `fail` cites evidence `getEvidence` resolves. Messages never repeat a value that may be personal data (the `_gl` value, a client id, a transaction id is named by position, not printed).
- **A rule that cannot tell says so.** Banner state `unknown`, no Google consent signal, no GA4 hit, an engine that did not record initiators: `inconclusive` with the reason.
- **Derived rows** keep `AGENTS.md`'s rule: nothing new is a derived row with a random id or `defaultNow()`. Attribution is computed on read from the stored capture; it is not stored.
- **SSRF stays where it is.** Measured hosts widen the allow-list (scope), not the network policy: the egress proxy still resolves every name and refuses private addresses, redirects included. Nothing in this plan relaxes `checkUrl`, `resolveHost` or `isPrivateHost`.
- **No new dependency.** The public suffix question is answered without a library (see "Same site", open question 2).
- **Docs move with the feature.** Each task ends by updating `docs/vision.md` (the capture rows and "Rules from research") with what was built and how it was verified; Task 8 sweeps and closes. Vocabulary from `docs/ui.md`: Could not check (never "inconclusive" in the UI), Not evaluated (never clean).

## Scope and non-goals

In scope: the three capabilities (reload, cross-host follow, request initiators), the four rules that use them, the fixtures, one site setting (measured hosts), one audit option (reload the last page, on by default with journeys), the CLI flags, and the "Loaded by" annotation in the finding detail.

Not in scope:

- Banner symmetry, regional defaults from an EEA vantage point and more vendors (roadmap item 9); they are spikes with different capabilities.
- Following links automatically to hosts nobody listed. Measured hosts are configured, never discovered (open question 3).
- A verdict from initiators. "Loaded by" is an annotation; no rule fails on it.
- Initiators for requests made inside cross-origin iframes and workers beyond what the existing frame auto-attach reaches; those requests are "not recorded" (Task 6).
- A reload outside a journey run. A single-page run does not reload; `consent.not-persisted-across-navigation` and `duplicates.purchase-on-reload` are `not_applicable` there ("only checked on journey runs"), like `clickid.lost-across-navigation`.
- Form input, login and checkout automation (`coverage.enhanced-conversions-payload` stays P2 and separate).
- The LLM digest. Attribution does not enter the digest in this plan (it is a new category of text); see open question 9.

## Order and why

1. **Reload and per-document banner state (Tasks 1 to 3).** Smallest change, and it builds the piece the cross-host rules also need: banner state and consent state per document after the choice. It touches only steps already in the engine (`runStep`, `navigate`, `bannerShown`). It exercises the whole path (contract, both engines, persist, rule, fixture, CLI) once, cheaply, before the harder capabilities.
2. **Cross-host follow (Tasks 4 and 5).** Needs the per-document state from 1, plus a schema column, a site setting and an allow-list decision; more moving parts, so second.
3. **Initiators (Tasks 6 and 7).** Independent of 1 and 2 and changes no verdict, so it could run in parallel with Task 4 onwards. It is last in the list because nothing blocks on it, but it is what the M5 report's "who fixes it" needs; if M5 starts first, pull Tasks 6 and 7 forward.
4. **Rules come right after their capability**, each its own task, so a capability that does not work out does not hold back a rule that can ship.

Rule priority from the research: both consent and click-ID rules are P1, `duplicates.purchase-on-reload` is P2 (Task 3 is last in its group and the first to drop if time is short).

## Capture contract changes

All in `packages/capture-contract/src/index.ts`, mirrored in `apps/browser/src/contract.ts`. Everything optional.

| Change | Shape | Why |
|---|---|---|
| `JourneyStep` gains `reload` | `{ action: "reload" }` | Task 1 |
| `JourneyStep` gains `follow` | `{ action: "follow", host: CanonicalHost }` | Task 4 |
| `CaptureRequest.journey` max | 5 to 8 steps | 5 key pages, a reload, room for follows |
| `CapturedDocument.navigation` | optional `"start" \| "goto" \| "click" \| "follow" \| "reload"` | how the document was reached; rules and evidence show it |
| `CapturedDocument.banner` | optional `"shown" \| "hidden" \| "unknown"` | set only for documents loaded after a verified consent action, when a CMP is known; absent otherwise |
| `ConsentObservation.documentId` | optional string | the TCF read per document (today it is read once at the end) |
| `CapturedRequest.initiator` | optional `{ type: "parser" \| "script" \| "preload" \| "other"; url?: string; frames: string[] }` | Task 6; script URLs without query strings (except the `id` of a `gtm.js`), at most 8 frames, each at most 300 characters |
| `CaptureError.code` | no new code | a failed `reload` or `follow` is a `JourneyStep` error, as a failed click is today |

`RunInput` (`packages/rules/src/types.ts`) does not change: rules read `capture.documents`, `capture.requests`, `capture.cookies` and `hits`, which already carry what they need. `Hit` and the decoders do not change, so `DECODER_VERSION` stays "4". GA4 `cid` is already decoded as `ids.clientId`.

`RULES_VERSION` goes 5 to 6 when Task 2 lands, 7 with Task 3, 8 with Task 5 (both rules together are one bump), and stays at 8 for Task 7 (an annotation changes no verdict). If tasks ship in one merge, one bump per merge is enough; the value only has to rise when the rule set or a verdict changes.

## Capability 1: a reload after the consent action

**Where it sits.** A reload is a journey step. Journey steps run in the same browser context after the start URL, the consent action and its verification (`playwright.ts`, `run`, then `runStep`). The audit's journey run (start URL, then up to 5 key pages as `goto` steps, `JOURNEY_STEPS`) gets one more step at the end when the new `AuditConfig.reload` option is on: reload the last page. At the end, because the click-ID rules treat the second document as "the next page" (`landingDocument` is `documents[0]`, later documents follow), and a reload in the middle would insert a same-URL document into that reasoning. `purchase-on-reload` needs it last anyway: the last key page is the order confirmation page.

**What the engine records.** `page.reload({ waitUntil: "load" })` is a main-frame navigation request, so `onRequest` already opens a new document `d<n>` with the same URL. A reload step does what `runStep` does today for a navigation: `flushBeacons`, the `document-end` cookie snapshot, `checkpoint`, then the navigation, then `observeWindow`. New:

- `navigation: "reload"` on the new document (and `start`, `goto`, `click`, `follow` on the others, set where the document is created or, for a click, when `currentDocument` changed).
- `banner` for the new document. Today `settleConsent` turns autoconsent off (`autoconsentActive = false`) once the choice is verified, so a reloaded page has no instance. Instead the engine keeps autoconsent injected after the outcome is settled in a watch-only mode: no `optIn`/`optOut` is ever sent, and the init reply sets `enableCosmeticRules: false` so autoconsent cannot hide the banner it is about to look for. The banner check is the existing `bannerNow(frame, cmp, true)` (every frame of the new document, `shown anywhere is shown`), started right after the navigation commits and awaited after `observeWindow`, so it adds at most the 2 s `BANNER_CHECK_MS`. `shown`/`hidden` when it answers, `unknown` when it does not. Only when `consent.outcome` is `accepted` or `rejected` and `consent.cmp` is known; otherwise the field is absent.
- The same banner check runs for every document loaded after the action, whatever step loaded it. So a banner that returns on the next key page is recorded too, and `consent.not-persisted-across-navigation` evaluates every post-action document, with the reload as the same-URL control (it separates "the site forgets the choice" from "this page has its own banner").
- The TCF read and the Google consent pushes are per document: `observeConsent` runs at the end of each step with `documentId`, and the `dataLayer` pushes already carry `documentId`. No new consent structure.

**Hits split per document.** Already true: `hit.document_id`, `dataLayer` entries and cookie snapshots (`document-end`) carry the document. The reloaded document's hits are the ones with its `documentId`; `after_consent_action` is true for all of them (their `startedAt` is after `actionAt`).

**Journey model and time.** A reload is one of at most 8 steps, so the engine deadline is `60 s + 15 s x steps`: a journey of 5 key pages and a reload is 150 s (was 135 s). The workflow step timeout is 4 minutes (`Audit.ts`), the admission lease is 5 minutes and is renewed at `confirm`, so 150 s and even 8 steps (180 s) fit. A reload costs `flushBeacons` (about 2.2 s) + load + `observeWindow` (3 s quiet, 10 s cap) + the banner check (at most 2 s): typically 7 to 10 s, worst case just inside the 15 s per-step allowance. The stale comment "135 s at JOURNEY_STEPS" in `Audit.ts` is updated. No extra runs, so the 168-run maximum and admission turns are unchanged; journey runs (at most 8 of 168) get longer by one step. Engine time added at the maximum: 8 x about 10 s = 80 s over three engines.

**Storage size.** A reload adds one document (about 200 bytes) and the reloaded page's requests and hits: the last page's, once more, in at most 8 runs. At the M4 stress size (226,918 hits) that is well under 1 percent. `hit` rows are keyed `(run_id, request_id, batch_index)` as before; nothing about persistence changes.

**Both engines.** Both drive Playwright's API, so `page.reload` and the banner check are the same calls. The Python engine mirrors `run_step`, `settle_consent` and the init reply. Neither engine lacks the capability, so rules do not need a "this engine cannot" path. A capture stored before this plan has no `navigation` or `banner`; the rules say "this capture predates banner checks".

**False-positive risks and how the rules answer them.**

- The banner check is a heuristic on autoconsent's own detection. `unknown` is never treated as `shown`. The rule fails on `shown` only, and a banner `unknown` on every post-action document is `inconclusive`.
- A CMP whose banner is a small persistent widget or re-prompt link (not a popup) may or may not be detected as "popup"; the rule fails only when the CMP's own `detectPopup` says shown, and the message names the document and how it was reached, not a guess.
- Some CMPs legitimately ask again after a period; within one session that is still a finding ("the banner asked again at the next page"), worded as behaviour, not as a legal verdict.
- A reload of a page reached by POST (some thank-you pages) may resubmit or fail. A failed reload is a `JourneyStep` error that ends the run (like a failed click); the run is partial and `purchase-on-reload` is `inconclusive`. Spike in Task 1 on a POST-reached fixture page.
- The reload revalidates from cache, so SDK scripts may not be requested again. Collection requests are never cached, and the rule cares about hits, not scripts.

## Capability 2: cross-host journey steps

**The step.** `{ action: "follow", host }`: on the current page, find the first visible `a[href]` whose host is `host` or a subdomain of it, scroll it into view, click it with a real mouse click and wait for `load`. Not a `goto`, because the Google tag decorates links with `_gl` when the visitor clicks them (and on `mousedown`/`keydown`), so a navigation the engine started itself never carries the linker parameter and `clickid.crossdomain-linker-missing` would always fail. The arrival document keeps the decorated URL in `documents[n].url` (and `redirects`), so no extra field is needed; `navigation: "follow"` marks it. No matching link is a `JourneyStep` error ("step 2 follow checkout.shop.com: no visible link to that host"), the run is partial and the rules answer `inconclusive`.

**Allow-list and the site binding.** `allowedHosts` already guards every top-level navigation (start URL, redirect hops, journey steps) with `Fetch` at the request stage in both engines, and fails an off-site hop before it is sent. The audit workflow passes `[site.host]`, so today a link to `checkout.shop.com` from a site whose host is `www.shop.com` ends the capture with a `Navigation` error, as does any other registrable domain. What changes:

- `site.measured_hosts` (new `jsonb` column, default `[]`, additive migration): other hosts the site's tags measure, canonical (as `URL` writes them), at most 3, each at least two labels, no IP literal, no port, not private (`isPrivateHost`, unless the stage sets `ALLOW_PRIVATE_SITES`). Edited in the site settings by owners and admins (server-checked, like the site's other fields). Organization-scoped like every site column; the site list query and `requireSite` already filter by `org_id`.
- The workflow passes `allowedHosts: [site.host, ...site.measuredHosts]` (the contract's limit is 20). Key pages of an audit may be on any of those hosts (`isOnSite` in the audit preflight accepts the measured hosts); nothing else is reachable. The allow-list semantics (host or any subdomain) are unchanged and the form says so.
- The engine still goes through the egress proxy for every connection: a measured host that resolves to a private address, or redirects to one, is refused exactly as a start URL would be. A measured host is scope, not authorization to reach the internal network.
- Popups stay blocked. A `follow` that opens a new tab is a `JourneyStep` error.
- The CLI sends no `allowedHosts` today and so follows anything; `--follow <host>` works there unchanged, and a new `--allow-host` flag (repeatable) lets a CLI run exercise the guard (open question 10).

**Which runs.** Cross-host runs are separate runs, not steps in the main journey: the main journey's documents stay exactly what `clickid.lost-across-navigation` expects. With `AuditConfig.crossHost` on (new optional field, default off; the form checkbox "Also follow links to the site's other hosts", shown when the site has measured hosts), `startAudit` adds, after the journey runs, one run per measured host (at most 3): scenario `accept` only, the first selected viewport only, `run.journey = true`, `run.page_url` the start URL (with click IDs when `clickIds` is on), and a new nullable `run.follow_host` (additive). The workflow builds the request `journey: [{ action: "follow", host }]`. Accept only because both rules need the choice to have been made and honoured on the first host, and the linker is not viewport-dependent. Subdomain consent loss under reject would show the banner returning too, but the accept run already proves the cookie scope; adding reject doubles the cost for the same cause.

**Same site.** `consent.lost-across-subdomain` must not fire for hosts that cannot share a cookie (an unrelated registrable domain), and `clickid.crossdomain-linker-missing` must not fire when they can (the `_ga` cookie is already shared). Both questions are answered from the captured cookies, with no public suffix list: a cookie in the first document's `end` snapshot whose `domain` domain-matches the target host is shared with it. Consent shared means the CMP's consent cookie (a cookie that appears between `before-consent` and `after-consent` and is not an ad or analytics cookie, `isAdOrAnalyticsCookie`) is domain-scoped to cover the target host. If the hosts are related by name (the target is a subdomain of the start host, or both end in the same two or more labels that are not a short built-in list of multi-part suffixes such as `co.uk`) and the consent cookie is host-only, that is the finding. If the names are unrelated, the rule is `not_applicable`; if it cannot tell, `inconclusive`. The built-in list is the only shared knowledge and is a handful of lines in `packages/rules` (open question 2).

**Time and admission.** A cross-host run is a start page, the consent action and one step: well inside `60 s + 15 s`. At most 3 extra runs make the supported maximum 171 runs (168 + 3). Each is an ordinary capture turn through `AdmissionGate`; nothing about grants, tokens or the lease changes. Task 5 re-measures the 171-run case with the existing `seed-max.sql` extended by three runs.

**Storage.** A cross-host run is a normal run: two documents, their hits.

**Both engines.** `follow` is `page.locator(...).click()`, available in both. The Python engine mirrors it. The frame guard (`guardNavigations`, `guard_navigations`) already applies to clicks (`framenavigated` and the `Fetch` document pause), so a link to an unlisted host is refused the same way.

**False-positive risks.** A link to the host exists only on a page the capture did not reach (a checkout link appears only with a non-empty cart): `JourneyStep` error, `inconclusive`, never `pass`. A site that shares consent through a server-side mechanism (a consent ID in the URL, a CMP cross-domain feature) looks like "banner shown again" only if it really is; the rule reports the observed banner on the arrival page. The linker rule is silent unless the target host is one the user listed, because the listing is the claim that the tags measure it.

## Capability 3: request initiators

**What a consultant needs.** For a hit or finding about a vendor, who loaded that vendor's tag: Google Tag Manager (which container), the page's own code (hardcoded in the theme or a plugin), or another vendor's script. The report's "who fixes it" is the GTM owner, the theme developer or the third party.

**Engine.** One extra CDP session on the page (`context.newCDPSession(page)`, already used for the navigation guard) with `Network.enable`, listening to `Network.requestWillBeSent`: `{ requestId, request: { url, method }, initiator: { type, url, stack: { callFrames, parent } } }`. The engine keeps `{ method, url, initiator }` records in browser order and, when it writes a request checkpoint, joins them to the Playwright request by the k-th occurrence of `method url` (both sequences are in the same browser order per key, the same trick `blockedRedirects` uses), so the join does not depend on which event arrives first. The record is reduced to `{ type, url?, frames }`: the distinct script URLs in the top stack and its async parents, query strings removed except the `id` parameter of a `gtm.js` (a container id is not personal data and tells the reader which container), at most 8 frames. Kept only for `script` requests and for requests to vendor hosts or recognised collection endpoints (`isVendorHost`, `isCollectionRequest`), at most 500 per capture (`truncated` beyond that). A request with no record keeps no `initiator`.

**Scrapling.** `capture.py` already calls `context.new_cdp_session(self.page)` and subscribes to CDP events (`guard_navigations`), so the same `Network.enable` and `Network.requestWillBeSent` handler is a mirror of about 60 lines. The unverified part is whether patchright (Scrapling's patched Playwright) lets a second session enable the Network domain without disturbing its Runtime patches; Task 6 settles it by running the fixture. If it cannot, that engine emits no initiators, every attribution reads "not recorded by this engine" and nothing else changes: no verdict depends on initiators. Cross-origin iframes are separate targets (the frame auto-attach in `cdp-frames.ts` is only active with `allowedHosts` or vendor blocking); v1 covers the main session, and a vendor request made from an out-of-process iframe has no initiator.

**Classification** is a pure function `loaderOf(input, vendor)` in `packages/rules/src/attribution.ts`, run on read, never stored, so a better classifier re-reads old captures. For a vendor, take its SDK script request (`isSdkFile` for gtag, GTM, Meta and TikTok; the first hit's request when there is none) and read its `initiator`:

| Initiator | Answer |
|---|---|
| Top frame script is a `gtm.js` (any host: a server-side loader on the site's own domain looks the same) | Google Tag Manager, container from its `id` |
| Top frame is `gtag/js` | the Google tag (for a Google Ads or GA4 tag it loaded) |
| `parser`, or a script whose frames are only the page's own document (inline script) | in the page's HTML or inline script (hardcoded) |
| Top frame is a script on the site's host or a subdomain | the site's own script (theme or plugin; hardcoded) |
| Top frame is a script on another host | a third-party script, named by host |
| No `initiator`, or type `other` with no frames | unknown, with the reason (not recorded, or the engine lost the stack) |

Classification returns evidence refs (the request ids it read) so the annotation is checkable. It is an annotation: no rule consumes it. Consumers: the finding detail ("Loaded by Google Tag Manager, container GTM-XXXX" on the failing run's cited vendor), and the M5 report's owner hint. The server function computes it from the stored capture of the first failing run, the same read `getEvidence` does.

**Cost.** A CDP event per request is a few microseconds; no Fetch interception is added, so latency is unchanged. Size: at most 500 records of at most about 300 bytes, 150 KB at the very worst, typically 30 to 60 KB against 1 to 3 MB captures, inside the existing `resultBytes` cap. No new run, no admission change.

**False-positive risks.** A custom HTML tag inside GTM injects a script; whether its stack still includes the `gtm.js` frame depends on how the snippet runs (an async callback may drop the parent stack). The classifier says "unknown" when the stack has no frames, never guesses, and Task 6 tests this on a stand-in `gtm.js`; a real container is open question 7. A bundler that concatenates the site's own code and GTM's loader is "the site's script", which is correct (it is hardcoded).

## Same fixtures, new behaviour

Fixture work (all in `packages/fixtures`, `sites.mjs`, `page.mjs`, `server.mjs`, `README.md`):

- **Guarded purchase in `clean`.** The thank-you page fires `purchase` on every load, so `clean` would fail `duplicates.purchase-on-reload`. Add a site option `purchaseOnReload` (`"guarded"` by default, `"every-load"`): guarded remembers the order id in `sessionStorage` and does not fire again on a reload. A single load behaves as before, so every existing expected result is unchanged; verified by re-running `clean` and `duplicate-purchase`.
- **Virtual hosts.** The server already answers on any `Host` header. Fixture pages show a link to the checkout host when requested on a `www.` host (and to `127.0.0.1:4400` for the cross-domain case), computed from the request host. With the stage's `ALLOW_PRIVATE_NETWORKS`, `*.localhost` must resolve to loopback in the egress proxy (RFC 6761; glibc does not do it everywhere): a small dev-only rule in `resolveHost` when `allowPrivate` is set (open question 5).
- **Cookie scope.** The banner library's `cookie.domain` is a site option (`consentScope`: `"host"` or `"domain"`).
- **Linker.** A site option `linker` adds `linker: { domains: [...] }` to the GA4 config.
- **Stand-in GTM and third-party loaders** for the initiator task, below.

| Fixture | Known bug | Used by |
|---|---|---|
| `consent-not-persisted` | The choice is written and then removed on the next load, so the banner returns on every document | Task 2 |
| `consent-reverts` | The banner stays hidden after the choice but the page pushes its `default` denied and never the `update` on later documents | Task 2 |
| `purchase-reload` | `/thank-you` fires `purchase` with the same order id on every load (`purchaseOnReload: "every-load"`) | Task 3 |
| `consent-subdomain` | The consent cookie is host-only on `www.shop.localhost`; `checkout.shop.localhost` asks again | Task 5 |
| `linker-missing` | GA4 is on both `localhost` and `127.0.0.1` with no linker domains; the client ID differs across the link | Task 5 |
| `loaders` | The same pixels loaded four ways: from the page HTML, from an inline script, through a stand-in `gtm.js`, through a script on another host | Task 7 |

## Tasks

Each task lists the files, what it changes in both engines where relevant, and how it is verified by running the real thing. Unless a task says otherwise, "verify" means the command output reported with the command, and `pnpm check && pnpm typecheck && pnpm build` as the last step.

### Task 1: Reload, per-document banner and navigation, in both engines

**Files:** modify `packages/capture-contract/src/index.ts`, `apps/browser/src/contract.ts` (`reload` step, journey max 8, `navigation`, `banner`, `ConsentObservation.documentId`), `apps/browser/src/server.ts` (journey policy loop: `reload` has no URL), `apps/browser/src/capture.ts` (comment on the deadline), `apps/browser/src/engines/playwright.ts` and `apps/browser/scrapling/capture.py` (the step, watch-only autoconsent, per-document banner check, TCF per document), `apps/web/src/workflows/Audit.ts` (stale 135 s comment only), `packages/core/src/audit.ts` (`AuditConfig.reload`, optional), `apps/cli/src/index.ts` (`--reload`, in step order with `--goto` and `--click`; `--json` and the table show `navigation` and `banner` per document), `docs/vision.md`
**Interfaces:** `JourneyStep` `{ action: "reload" }`; `CapturedDocument.navigation?`, `CapturedDocument.banner?`; `ConsentObservation.documentId?`; `AuditConfig.reload?: boolean`
**Blocked by:** none

- [ ] Contract first, in both files. Run the browser app's own type check; the schema must still decode a stored capture from before (use a `capture.json` from an earlier audit in the local R2 or a saved CLI `--json`).
- [ ] Playwright engine: the `reload` step; `navigation` set where documents are created; autoconsent kept injected and watch-only after `settleConsent` (no `optIn`/`optOut`, `enableCosmeticRules: false` in the init reply for documents after the action); the banner check started at navigation commit and awaited after `observeWindow`, for every post-action document; `observeConsent` per step with `documentId`.
- [ ] Python engine: the same, function by function (`run_step`, `settle_consent`, `inject_autoconsent`, the init reply).
- [ ] Spike while building (record the result in `docs/vision.md`): reload of a page that was reached by a POST; does a CMP that restores consent from its cookie still trip `bannerShown` as `hidden`; does `enableCosmeticRules: false` change anything on the `clean` fixture's banner.
- [ ] Verify by: serve the fixtures; `zinko capture http://localhost:4400/clean/ --scenario accept --block-vendors --goto http://localhost:4400/clean/product --reload --json` on each engine (`CAPTURE_ENGINE=playwright` for one, the default Scrapling for the other): three documents `d1`..`d3`, `navigation` `start`, `goto`, `reload`; `banner` `hidden` on `d2` and `d3` and absent on `d1`; a `document-end` snapshot before each navigation; the run's total time (report it; expect the journey under 150 s). Repeat with `--scenario none` (no `banner` anywhere) and with `no-cmp` under accept (outcome `not-found`, no `banner`). Check the old-capture decode.
- [ ] `pnpm check && pnpm typecheck && pnpm build`

### Task 2: `consent.not-persisted-across-navigation`

**Files:** create `packages/rules/src/rules/consent/not-persisted-across-navigation.ts`; modify `packages/rules/src/index.ts` (register, `RULES_VERSION` "6"), `packages/rules/src/documents.ts` only if a helper is shared with Task 5 (per-document final consent state from the `dataLayer` pushes and hits), `packages/fixtures/{sites.mjs,page.mjs,README.md}` (`consent-not-persisted`, `consent-reverts`), `apps/web/src/components/evidence.tsx` (document evidence shows how the page was reached and the banner state), `docs/vision.md`
**Interfaces:** the rule, `id = "consent.not-persisted-across-navigation"`, area `consent`, severity `warning`
**Blocked by:** 1

Logic. Branch on `consent.outcome`: `accepted` or `rejected` with `actionAt`, else `not_applicable` for `none` and `gpc` ("no choice was made"), `inconclusive` for `not-found` and `not-applied` (the choice is unknown). Not a journey run: `not_applicable` ("only checked on journey runs"). Take the documents after the action (`startedAt > actionAt`, `navigation` not `start`). None: `not_applicable`. If `banner` is absent on all of them: `inconclusive` ("this capture predates banner checks"). Fail when a post-action document has `banner: "shown"` (the message names how it was reached: "the banner was shown again after the reload", "... at the next page"), citing that document, plus the first document's `banner`/cookie evidence. Fail also when the banner is `hidden` or unknown but the document's Google consent state is denied after an accepted choice (the last `consent` command per signal in its pushes, `consentTimeline`), citing the pushes and the first denied-consent hit. Pass when every post-action document has `banner: "hidden"` and, where a Google consent signal exists, the state matches the choice. Everything else `inconclusive` with the reason (`unknown` banner and no Google signal).

- [ ] Write the expected set into `packages/fixtures/README.md` first, then the fixtures. Expected (journey run, desktop, `--reload` on): `consent-not-persisted` accept fail, reject fail, none and gpc not_applicable; `consent-reverts` accept fail, reject pass (denied is the right state after reject); `clean` accept pass, reject pass; `no-cmp` accept and reject inconclusive (banner not found). Without `--goto`/`--reload` (a single-page run): not_applicable everywhere.
- [ ] Rule, registration, evidence display.
- [ ] Verify by: `zinko capture http://localhost:4400/<site>/ --scenario all --rules --block-vendors --goto http://localhost:4400/<site>/product --reload` for the five fixtures above, desktop and `--mobile`; the output must match the README. `clean` must also match its baseline for every other rule (diff the full rule list against the run before the change; report the differences, expect none). Then one audit through the app on `consent-not-persisted` with journey and reload on: the finding appears, its evidence opens, and the document evidence shows "reached by reload, banner shown".
- [ ] `pnpm check && pnpm typecheck && pnpm build`

### Task 3: `duplicates.purchase-on-reload`, and the audit option

**Files:** create `packages/rules/src/rules/duplicates/purchase-on-reload.ts`; modify `packages/rules/src/index.ts` (register, `RULES_VERSION` "7"), `packages/rules/src/purchases.ts` (reuse; no change expected), `apps/web/src/workflows/Audit.ts` (append `{ action: "reload" }` after the key pages of a journey run when `config.reload`), `apps/web/src/server/audits.ts` and the new audit form route (`reload` option under the journey option, on by default when journey is on; the run-count estimate is unchanged; the form says it reloads the last key page, which should be the order confirmation page), `packages/fixtures/{sites.mjs,page.mjs,README.md}` (`purchaseOnReload`, `purchase-reload`), `docs/vision.md`
**Interfaces:** the rule, `id = "duplicates.purchase-on-reload"`, area `duplicates`, severity `warning`
**Blocked by:** 1 (2 only for the shared per-document helper)

Logic. Journey run only; the run's last step must be a `reload` (the last document has `navigation: "reload"`), else `not_applicable`. Take the document the reload re-loaded (the one before it) and the purchases in it (`purchases.ts`: GA4 `purchase`, Meta and TikTok purchase events, an Ads conversion with a label and value). None before the reload: `not_applicable` ("no purchase on that page"). A purchase in the reloaded document with the same vendor and the same transaction id as one before: `fail`, evidence both hits; the message says "the same order id was sent again after a reload" without printing the id. A purchase with no transaction id on either side: `inconclusive` ("cannot tell a repeat from a new order"). No purchase after the reload: `pass`. Not a verdict on server-side deduplication (GA4 and Ads may deduplicate on the order id); the why says so and the fix is to fire once per order.

- [ ] Expected set in the README first: `purchase-reload` accept fail (GA4, Ads, Meta, TikTok each cited), none fail, reject: the purchase tags do not fire without marketing consent in the fixture, so pass is wrong and not_applicable is right ("no purchase on that page"); `clean` (guarded) accept pass; `duplicate-purchase` accept fail (also failing `purchase-sent-twice`; the README records that both fire for it); `purchase-missing-fields` accept inconclusive (no transaction id).
- [ ] Verify by: `zinko capture http://localhost:4400/<site>/ --scenario all --rules --block-vendors --goto http://localhost:4400/<site>/thank-you --reload` for the fixtures above; match the README; run `clean` before and after for the baseline diff. In the app: the audit form shows the option, a journey audit on `purchase-reload` shows the finding, an audit with the option off shows `not_applicable` ("no reload in this run").
- [ ] `pnpm check && pnpm typecheck && pnpm build`

### Task 4: Measured hosts and the `follow` step

**Files:** modify `packages/db/src/audit-schema.ts` (`site.measured_hosts jsonb not null default '[]'`, `run.follow_host text`), generated migration in `packages/db/drizzle/` (`pnpm --filter @repo/db db:generate`, then `pnpm db:migrate`, never by hand), `packages/capture-contract/src/index.ts` and `apps/browser/src/contract.ts` (`follow` step), `apps/browser/src/server.ts` (a `follow` host passes the text policy: canonical, not private), `apps/browser/src/engines/playwright.ts`, `apps/browser/scrapling/capture.py` (the step), `apps/browser/src/egress-proxy.ts` or `url-policy.ts` (`*.localhost` to loopback only when `allowPrivate`), `apps/web/src/server/clients.ts` (site settings: read and write `measuredHosts`, owner and admin only, validated: canonical, at least two labels, no IP, at most 3, `isPrivateHost` unless `ALLOW_PRIVATE_SITES`), the site settings route and component (a field with the exact wording "The tags on this site also measure these hosts. Zinko may open them and any of their subdomains."), `apps/web/src/server/audits.ts` (`isOnSite` accepts measured hosts; `crossHost` adds the runs), `packages/core/src/audit.ts` (`AuditConfig.crossHost?: boolean`), `apps/web/src/workflows/Audit.ts` (`allowedHosts`, the `follow` journey from `run.follow_host`), `apps/cli/src/index.ts` (`--follow <host>`, `--allow-host <host>`), `docs/vision.md`
**Interfaces:** `JourneyStep` `{ action: "follow", host }`; `site.measuredHosts: string[]`; `AuditConfig.crossHost?`; `run.followHost: string | null`
**Blocked by:** 1

- [ ] Fixtures first for this capability (README, `sites.mjs`, `page.mjs`, `server.mjs`): the host-dependent checkout link, `consentScope`, `linker`. No rule yet; `clean` and the existing fixtures render unchanged on `localhost`.
- [ ] Engine: `follow` in both engines (`page.locator("a[href]")` filtered by host, first visible, `scrollIntoViewIfNeeded`, `click`, wait for `load`); `navigation: "follow"`; a missing link is a `JourneyStep` error naming the host; a popup stays refused.
- [ ] Web: the migration, the setting, the audit form checkbox (only with measured hosts), the run planning (one run per host, accept, first viewport; at most 3), the workflow request. Org scoping: every query filters by `org_id`; another organization's site is a 404.
- [ ] Verify by, SSRF first (report each): (a) `zinko capture http://www.shop.localhost:4400/clean/ --scenario accept --follow checkout.shop.localhost --allow-host www.shop.localhost` with the checkout host not allowed: the capture ends with a `Navigation` error naming the host and no request to it is sent (check the egress log line `egress: contacted ... refused ...`); (b) with `--allow-host checkout.shop.localhost` it navigates and the arrival document has `navigation: "follow"`; (c) a measured host that resolves to a private address with `ALLOW_PRIVATE_NETWORKS` off is refused by the proxy (use a name resolving to 169.254.169.254 or 10.x in a throwaway `/etc/hosts` entry and say so); (d) a redirect from an allowed host to an unlisted host is refused. Then in the app: add a measured host as owner, as a member (rejected, server-side), as another organization (404); an audit with `crossHost` plans `1 + hosts` extra runs and the form estimate says so; a run with no link to the host ends partial with the `JourneyStep` error.
- [ ] Verify the SDK-less path on both engines (`CAPTURE_ENGINE=playwright` and Scrapling).
- [ ] `pnpm check && pnpm typecheck && pnpm build`

### Task 5: `consent.lost-across-subdomain` and `clickid.crossdomain-linker-missing`

**Files:** create `packages/rules/src/rules/consent/lost-across-subdomain.ts`, `packages/rules/src/rules/clickids/crossdomain-linker-missing.ts`, `packages/rules/src/same-site.ts` (cookie-scope test and the short multi-part suffix list); modify `packages/rules/src/index.ts` (register, `RULES_VERSION` "8"), `packages/fixtures/{sites.mjs,page.mjs,README.md}` (`consent-subdomain`, `linker-missing`), `docs/plans/2026-10-27-m4-matrix-overview-llm/seed-max.sql` (extended by three runs for the 171-run measurement), `docs/vision.md`
**Interfaces:** `id = "consent.lost-across-subdomain"` (area `consent`, severity `warning`); `id = "clickid.crossdomain-linker-missing"` (area `clickids`, severity `warning`); `sameSite(input, fromHost, toHost)` returns `"shared-cookie" | "related-host-only" | "unrelated" | "unknown"`
**Blocked by:** 2 (shared helpers), 4

`consent.lost-across-subdomain`: needs a document with `navigation: "follow"` and an accepted outcome; else `not_applicable` (no cross-host step) or `inconclusive` (outcome unknown, the follow failed). `sameSite` decides: `unrelated`: `not_applicable` ("different registrable domain, consent cannot be shared by cookie"); `shared-cookie`: the rule continues; `related-host-only`: the consent cookie is host-only, so the arrival page cannot read it: continues and explains. Fail when the arrival document's `banner` is `shown`, or (banner `unknown`/`hidden`) its Google consent state is denied after the accept, citing the arrival document and the consent cookie; pass when `hidden` and consent matches; `inconclusive` otherwise.

`clickid.crossdomain-linker-missing`: needs the `follow` document and GA4 hits on both sides; accept only (`not_applicable` otherwise, "tags did not run"). `sameSite` `shared-cookie` for the `_ga` cookie: `not_applicable` (the cookie already crosses). Otherwise a linker is needed: pass when the arrival URL carries `_gl` and the GA4 client id (`ids.clientId`) is the same on both documents; fail when there is no `_gl` and the client id differs (the visit is counted as a new user, and with click IDs the conversion loses its source); `inconclusive` when either side has no GA4 hit or ids are absent. Message names the hosts (they are the site's own) and never prints the identifiers.

- [ ] README first. Expected (cross-host run: accept, first viewport): `consent-subdomain` lost-across-subdomain fail; `clean` served on `www.shop.localhost` with a domain-scoped cookie pass; the unrelated-host case (`localhost` to `127.0.0.1`) not_applicable; `linker-missing` crossdomain-linker fail, `linker-missing` with `linker: true` pass, `clean` on subdomains (shared `_ga`) not_applicable; every other scenario is not run (no cross-host runs), so those rules are `not_applicable` ("no cross-host step") elsewhere.
- [ ] Verify by: `zinko capture http://www.shop.localhost:4400/<site>/ --scenario accept --rules --block-vendors --follow checkout.shop.localhost` (and `--follow 127.0.0.1` with `localhost` as the start for the cross-domain pair) for each fixture; match the README; `--json` shows the `_gl` presence in the arrival document URL without printing its value; `clean` baseline diff on `localhost` unchanged. In the app: a `crossHost` audit shows the finding, the evidence opens both documents. Measure the 171-run synthetic audit with the extended `seed-max.sql` (Overview, Findings, matrix load times against the M4 numbers; report both) and report the wall time of a 3-host cross-host audit on the local engine.
- [ ] `pnpm check && pnpm typecheck && pnpm build`

### Task 6: Request initiators in both engines

**Files:** modify `packages/capture-contract/src/index.ts`, `apps/browser/src/contract.ts` (`CapturedRequest.initiator`), `apps/browser/src/engines/playwright.ts` and `apps/browser/scrapling/capture.py` (the CDP session, the join, the reduction, the cap), `apps/browser/src/capture.ts` (limit constant if not inline), `apps/cli/src/index.ts` (`--json` carries `initiator`; the hit table gets an optional "via" column behind `--initiators`), `docs/vision.md`
**Interfaces:** `CapturedRequest.initiator?: { type; url?; frames }`
**Blocked by:** none (can start any time after the contract changes of Task 1 are merged, to avoid conflicting edits in the same two files)

- [ ] Playwright engine: a CDP session with `Network.enable`; the occurrence-ordered join; the reduction (strip queries, keep a `gtm.js` `id`, at most 8 frames, 300 characters each); only script, vendor and collection requests; at most 500, then `truncated`.
- [ ] Python engine: the same through patchright's `new_cdp_session`. **First do the feasibility check:** a ten-line run that enables `Network` on a second session next to the existing `Fetch` session and prints initiators for the `clean` fixture. If it fails, stop, record the reason in `docs/vision.md`, and ship Playwright only with the explicit "not recorded by this engine" behaviour (the capture field stays absent; nothing else changes).
- [ ] Verify by: fixtures served; `zinko capture http://localhost:4400/clean/ --scenario accept --json --initiators` on each engine; the Meta pixel script has `initiator.type: "script"` and a frame on the fixture's `tags.js`; gtag's script has `type: "parser"` or the inline script; the size of the `initiator` data in the result (report bytes, expect under 60 KB); the capture time compared with a run before the change (report both, expect no difference beyond noise); the same run with `--block-vendors`. Check a request that has several redirects joins the right record.
- [ ] `pnpm check && pnpm typecheck && pnpm build`

### Task 7: Attribution, the "Loaded by" annotation, and the `loaders` fixture

**Files:** create `packages/rules/src/attribution.ts` (`loaderOf`), `apps/web/src/server/attribution.ts` (server function: org-scoped, reads the first failing run's stored capture, returns the loader for the vendors the finding cites; shape of `findings.ts`/`getEvidence`); modify `packages/rules/src/index.ts` (export; no `RULES_VERSION` change), `apps/web/src/components/finding-detail.tsx` (a "Loaded by" line with the glyph-and-word convention: no colour alone; "Not recorded" when the field is absent), `packages/fixtures/{sites.mjs,page.mjs,README.md}` (`loaders`, a stand-in `gtm.js` served at `/gtm/gtm.js?id=GTM-ZINKO01`, a script on `127.0.0.1:4400`), `docs/vision.md`, `docs/ui.md`
**Interfaces:** `loaderOf(input: RunInput, vendor: Vendor): { kind: "gtm" | "gtag" | "page" | "site-script" | "third-party" | "unknown"; label: string; via: string | null; evidence: EvidenceRef[] }`
**Blocked by:** 6

- [ ] README first. `loaders` pages load Meta four ways and the expected `loaderOf` result: from the HTML (`<script>` in the page): `page`; from an inline snippet: `page`; through the stand-in GTM: `gtm`, container `GTM-ZINKO01`; through the other-host script: `third-party` with that host; `clean`: `site-script` for Meta and TikTok (the fixture's `tags.js`) and `page` for gtag. A capture from before Task 6: `unknown` with "not recorded".
- [ ] Verify by: the CLI prints it (`--initiators` shows the classification beside each vendor); an audit on `loaders` and `meta-before-consent` opens a finding whose detail shows "Loaded by ..." matching the README; an old audit's finding shows "Not recorded"; as a member of another organization the function returns 404 for the audit. UI at 390px and 1440px in both themes, with the grayscale check.
- [ ] `pnpm check && pnpm typecheck && pnpm build`

### Task 8: Sweep, docs and the demo

**Files:** modify `docs/vision.md` (the capture rows: Journeys, Site allow-list, a new "Request initiators" row, "Rules from research" pack 3; remove "unverified" statements this plan settled), `docs/roadmap.md` (items 6 to 8 done with the rules version), `docs/ui.md` (the document evidence wording), `AGENTS.md` (Rules: the reload and follow steps, `site.measured_hosts`, deploy order), `packages/fixtures/README.md` (full tables), this plan (status `implemented`, execution status, surprises)
**Blocked by:** 1 to 7

- [ ] Run the full demo: an audit on `consent-not-persisted` with journey and reload; one on `consent-subdomain` with cross-host; one on `loaders`; report timings and the 171-run measurement; run `zinko capture --scenario all --rules` on every pre-existing fixture and diff against the baselines in the README (any change to an existing expected result is a bug in this plan).
- [ ] Real-site check, read-only, on two public sites the owner names (open question 7): banner re-appearance, one `follow`, initiator of the GTM-loaded tag; record what the heuristics said and what a person saw.
- [ ] `pnpm check && pnpm typecheck && pnpm build`

## Open questions for the product owner

1. **Reload scope.** The reload exists only in journey runs, so `consent.not-persisted-across-navigation` and `purchase-on-reload` need the journey option. Do you want a one-page reload run for audits without a journey? It would add a run per scenario and viewport (the cheapest version is accept and reject, first viewport: at most 2 runs).
2. **Same-site test.** The plan decides "same site" from cookie scope plus a short built-in list of multi-part suffixes (`co.uk` and a few more), no dependency. A public suffix library (`tldts`, about 100 KB) is exact. Accept the small list, or allow the dependency (`AGENTS.md` says only if the task cannot be done without it)?
3. **Discovering measured hosts.** Measured hosts are typed in. The capture could list outbound link hosts from the landing page and the hosts GA4 and Meta saw (`dl`, referrer) so Zinko can suggest them. Worth a follow-up, or is typing three hosts fine?
4. **Reject that does not persist.** `consent.not-persisted-across-navigation` has one severity (warning). A rejection that is forgotten is closer to the opt-out failures in the enforcement actions than an accept that is forgotten. Split into two rules, or raise it to critical for reject?
5. **`*.localhost` in the egress proxy.** The fixtures need subdomains. Resolving `*.localhost` to loopback when `allowPrivate` is set is a dev-only change in `resolveHost`. The alternative is `localtest.me` (public wildcard DNS, an external dependency in the fixtures). Preference?
6. **The order confirmation page.** `purchase-on-reload` reloads the last key page. Should the audit form let the user mark one key page as "order confirmation" (so a journey can end elsewhere and the reload still hits it)? The plan assumes the last page.
7. **Real GTM check.** Attribution through a custom HTML tag inside a real container is the weakest assumption (async stacks can lose the `gtm.js` frame). Which two sites can we use for the read-only check in Task 8?
8. **Run maximum.** 171 instead of 168 with three measured hosts. Acceptable, or trim `pages` to 17 when cross-host is on so the maximum stays 168?
9. **Attribution in the LLM digest.** The digest is minimised; "loaded by GTM" is a fixed label and safe, but it is new text. Add it later with the M5 report, or leave it out of explanations?
10. **CLI scope.** The CLI sends no `allowedHosts` and follows anything. Keep that (`--allow-host` is opt-in for tests), or default to the start URL's host like the app?
11. **Production behaviour.** The capture-time numbers are local. Cloudflare containers remain unverified (decision 0003); the first deployed audit with a reload and a cross-host run should be timed before the defaults ("reload on with journeys") are shipped.

## Not in this plan

- Banner symmetry (first-layer reject), regional defaults from an EEA vantage point and more vendors (roadmap item 9).
- A rule that fails on how a tag was loaded.
- Automatic discovery or crawling of other hosts.
- Form input and logged-in journeys.
- Initiators for out-of-process iframes and workers.

## Task list at a glance

1. Reload, per-document banner and navigation, both engines.
2. `consent.not-persisted-across-navigation` (rules 6).
3. `duplicates.purchase-on-reload` and the audit option (rules 7).
4. Measured hosts and the `follow` step, with the SSRF checks.
5. `consent.lost-across-subdomain` and `clickid.crossdomain-linker-missing` (rules 8).
6. Request initiators in both engines.
7. Attribution, "Loaded by" and the `loaders` fixture.
8. Sweep, docs and the demo.

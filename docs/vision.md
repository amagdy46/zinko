# Zinko vision

Every feature we plan to build, how we will build it, what we take from other products, and what is still open. `docs/product.md` is the v0.1 scope, `docs/architecture.md` the stack, `docs/roadmap.md` the milestones; this file ties them together and is updated whenever a spike or a working feature changes the plan.

Last updated 2026-10-20 (M2 audit pipeline working locally).

## What Zinko is

An open-source (AGPL-3.0) tracking auditor for consultants and agencies. It loads a client's pages in a real browser under each consent choice, records every tracking request, `dataLayer` push, cookie and consent signal, and turns that into findings with evidence and a white-label report.

The bet, from the research below: every competitor either needs an install on the client's site (Trackingplan, Elevar, Avo Inspector), reads configuration instead of behavior (Tracking Auditor, Measuremate, GAfix, Tag Diagnostics), covers only Google tags (Tag Assistant), or is a managed service priced for enterprises (ObservePoint, DataTrue at $16k+/year). Nobody open-source captures what actually fires, across vendors, per consent choice, from the outside.

## Principles

1. **Evidence, not opinions.** Every finding links to the decoded hit, the raw request, a screenshot and a cookie snapshot.
2. **Rules decide, the LLM explains.** Checks are deterministic functions over captured data. The LLM (bring your own key) writes explanations and fix steps, never pass or fail, and every check works without it.
3. **No install on the client's site.** Zinko audits from the outside, so it works before a sale and for one-off audits.
4. **Audits fail partially.** Each page × scenario is its own step; a failed step records a typed error and the report still renders.
5. **Cross-vendor.** GA4, Google Ads, Meta and TikTok first; the decoders are data plus small functions, so more vendors are cheap.
6. **Self-serve and open.** No credits, no seat pricing, the API on every tier. The paid cloud sells hosting, scheduling and alerts, not access to features.

## How a run flows

```
New audit form (apps/web)
  → startAudit: audit + runs (page × scenario × viewport) in one transaction
  → Audit workflow (Cloudflare Workflows, instance id = audit id): start, then per run
    capture-<n> → persist-<n> (or fail-<n>), then finish
      → Browser service → apps/browser container (Scrapling AsyncStealthySession; Playwright fallback)
          init script: dataLayer shim + autoconsent → load page → requests (with POST bodies),
          dataLayer pushes, cookies, CMP state, screenshot
      → packages/decoders: request → Hit
      → store: capture.json and screenshot in R2 (Storage service), then hits and pushes
        derived from the stored capture into Postgres (Drizzle)
      → AuditRoom Durable Object (AuditProgress service) pushes progress to open tabs
  → packages/rules: captures → Finding[] (deterministic)
  → Llm service: explanation and fix steps per finding, cached
  → Findings, Tag matrix, Hit explorer, Report
```

Effect services live in `packages/core`, layers are wired in `apps/web/src/server/layers.ts`. Decoders and rules stay plain TypeScript so the CLI can reuse them without Cloudflare.

## Features

Status: **working** (run and seen working; the row says how), **scaffolded** (generated code exists, not Zinko-specific yet), **planned**, or **proposed** (from the competitor research below, not yet agreed).

### Foundations (M0)

| Feature | How we build it | Status |
|---|---|---|
| Sign up, workspaces, invites, roles | Better Auth with the organization plugin; `/onboarding`, `/app/settings/members`, `/accept-invite/$id` | working for sign-up and creating an organization (the M2 demo did both in a browser); invites and roles scaffolded |
| Infra per stage | `infra/alchemy.run.ts`: Worker, Workflows, Durable Objects, Container, R2, Postgres | scaffolded, never deployed |
| Bring-your-own LLM key | `llm_credential` table, AES-GCM with `LLM_ENCRYPTION_KEY`, `/app/settings/ai` | scaffolded |
| Hit decoder CLI | `packages/decoders` (GA4, Meta, Google Ads, TikTok) behind `zinko decode` in `apps/cli` | working |
| Capture CLI | `zinko capture <url>` in `apps/cli`: posts one `CaptureRequest` per scenario (`all` runs the four) to the engine's `/capture`, validates the answer with `@repo/capture-contract`, decodes every request with `packages/decoders` (keeping request `id`, `documentId`, `startedAt`, `batchIndex`), and prints consent, a hit table with a marker for hits after `completedAt`, cookie names per snapshot and errors. `--json` adds `undecoded` (vendor-host requests that produced no hit, such as `ccm`). Journey flags `--click`/`--goto` keep their typed order, max 5. M1 demo: run against the real engine and fixtures with `--block-vendors`, see below | working |

### Capture (M1)

The M1 demo, run locally on 2026-10-20 with the engine (`ALLOW_PRIVATE_NETWORKS=true pnpm --filter browser start`) and the fixtures (`pnpm --filter @repo/fixtures serve`), each as `zinko capture … --block-vendors`:

- `meta-before-consent`, `--scenario reject`: a Meta `PageView` at 2.4 s, before the reject action at 6.2 s, and no Meta hit after it.
- `ga4-batch`, `--scenario accept`: three GA4 hits (`view_promotion`, `view_item_list`, `select_promotion`) with `batchIndex` 0, 1, 2 from one request.
- `lost-gclid?gclid=TEST`, `--click 'a[href="/lost-gclid/product"]'`: the second document's URL has no `gclid`, and no `_gcl_aw` cookie at `end`.
- `gpc-echo`, `--scenario gpc`: the engine's screenshot of the page shows `Sec-GPC: 1` and `navigator.globalPrivacyControl === true`.

Each row below says which of these, or which other run, showed it working. Not run yet: the container image (building it needs `sudo docker`, which an agent does not run). The bot-protection comparison ran on 2026-10-20 from a residential IP (spike RESULTS.md).

| Feature | How we build it | Status |
|---|---|---|
| Network capture with POST bodies | `apps/browser` serves `POST /capture` and `GET /health`, one capture at a time (429 while busy). For each capture Node starts an egress proxy and a child engine: `scrapling/capture.py` on Scrapling `AsyncStealthySession` (patchright), driving the page with the Playwright API, or `src/engines/playwright.ts` when Scrapling fails to launch or `CAPTURE_ENGINE=playwright` (`engine.fallbackReason` says which). Both write the same NDJSON checkpoints; Node asks for a final flush 6 s before the deadline (60 s plus 15 s per journey step, so at most 135 s), kills every process group the engine started (Chromium runs in its own session, so killing the engine's group alone leaks it), and builds the result from the checkpoints. Request start times come from the browser's own timing. Limits: 60 s plus 15 s per journey step, 2,000 admitted requests (later ones are aborted), 64 KB per body, 1,000 `dataLayer` entries (strings cut at 8 KB, entries at 64 KB), 10 MB of responses (cut at the proxy), 4 MB per checkpoint line and 10 MB for the result; any of them, the time limit included, sets `truncated`. Peak memory: 534 MiB for the whole tree (cgroup peak, small fixture pages) in Task 4; the review measured 708–750 MiB PSS on `clean` under accept and 951 MiB on a page making 2,100 requests, so the container is `standard-1`. Observation windows wait for 3 s with no request starting or ending (10 s cap per window), so a pixel loaded on a timer extends the window instead of being missed. Verified by the M1 demo (all four cases) and, with `CAPTURE_ENGINE=playwright`, by `clean` under accept on the fallback engine. | working locally; the container image has not been run |
| SSRF policy | Playwright routes never see redirect hops, so the policy cannot live in the page route as decision 0002 planned. Every browser connection goes through the egress proxy in the Node server (`--proxy-server`, loopback included): it applies `url-policy.ts`, resolves the name, refuses any private answer and connects to the address it checked, so DNS rebinding between check and connect is closed too. One implementation covers both engines; refused requests are marked `blocked`. Chromium must not get around it: both engines start the full Chromium build with `src/chromium-args.json` (no direct DNS through `--host-resolver-rules`, no QUIC, WebRTC limited to proxied UDP, no background, sync or component-update traffic, one merged `--disable-features`, since Chromium keeps only the last). Chromium still calls `update.googleapis.com` on startup despite those switches, so the proxy always refuses its service hosts. Known limitation: its startup sign-in check to `accounts.google.com` is refused only with `blockVendorRequests` (as a `google.com` host); without it the request goes out (decision 0002, amendment). `ALLOW_PRIVATE_NETWORKS` (default off) turns the private-address check off for local fixtures. Verified: `http://10.255.255.1/` without the opt-in returns 400 `PolicyDenied` (rechecked on 2026-10-20); the redirect and unroutable-address cases were run in Task 4. | working locally |
| Vendor blocking | `blockVendorRequests` is enforced in the egress proxy, below the page: every vendor host in `src/inject/vendors.json` (the list covers every endpoint host the three SDKs name: Google's, `googlesyndication.com`, Meta's `instagram.com/tr` and `conversionsapigateway.com`, TikTok's `tiktokw.us` IPv6 enrichment) is refused on any scheme and any redirect hop. A tunnel hides the path, so SDK files cannot pass on the same host; the engines fetch them through the proxy's `GET /sdk?url=` and fulfill the page request with the file. Page routes still answer collection requests with 204 so they are recorded with their bodies. Verified with an empty page, `clean` under accept, `http://` vendor URLs and redirects to collection URLs: only the start host and the three SDK hosts were contacted in the final runs; an earlier run leaked TikTok's `analytics-ipv6.tiktokw.us/ipv6/enrich_ipv6`, a host the first list missed | working locally |
| Site allow-list | `CaptureRequest.allowedHosts` (canonical hosts, at most 20) keeps top-level navigations on the site: the start URL, every redirect hop and every journey step. Both engines open a CDP session on the page and enable the `Fetch` domain for `Document` requests at the request stage; Chromium pauses each main-frame hop there, redirects included, and an off-site one is failed (`BlockedByClient`) before it is sent. The capture then ends with a `Navigation` error naming the host and no screenshot. A main-frame navigation that sends no request (`about:blank`, `blob:`) is caught when it commits and ends the capture the same way. Popups are refused outright: every request from a page other than the capture's is aborted in the context route, and the popup is closed with a `popup blocked` error. Hosts must already be canonical (`new URL("http://" + host).hostname === host`). Subresources and subframes are not paused (decision 0002, Task 3 amendment). Verified on both engines with `/r?to=http://127.0.0.1:4400/clean/` under `allowedHosts: ["localhost"]` (stopped, and the proxy never contacted `127.0.0.1:4400`), without it (followed), with an off-site journey `goto` (stopped), and on `clean` under accept, whose SDK loads and hit counts match a capture without it | working locally; every M2 capture sets it to the site's host |
| Capture contract | `packages/capture-contract`: Effect Schemas for `POST /capture` (`CaptureRequest` in; `CaptureResult` on 200, `CaptureRejected` on 400). `Browser.capture` in `@repo/core` and `zinko capture` decode with them; the engine writes the shape by hand because its image cannot import workspace packages. All times are ms since capture start. Free-form values (`dataLayer` pushes, consent state) are typed as JSON, which is what crosses the wire. The base64 screenshot crosses the wire; the M2 workflow step stores it through `Storage` and keeps only its key (step results are capped at 1 MiB) | working: the CLI decoded the engine's answers with these schemas in every demo run; the web app's `Browser` layer has not run against a container (only against `BROWSER_URL`). Dev transport: on `alchemy dev` with a `dev` or `dev_<user>` stage, `BROWSER_URL` makes `Browser.capture` post to `${BROWSER_URL}/capture` and the container resource and binding are skipped (local Containers need Docker); deployed stages ignore it. Run on 2026-10-20 through `pnpm dev` and `runBrowser` on `clean` (accept, desktop, vendor requests blocked): engine Scrapling, consent `accepted`, 25 requests |
| `dataLayer` shim | `src/inject/datalayer-shim.js`, shared by both engines: wraps `dataLayer.push` before page scripts and sends each push, normalized to JSON (`Arguments` to arrays, cycles, functions, depth > 10), to an exposed binding as it happens, so pushes right before a navigation are kept. gtag replaces `push` with a function that calls the one it found, so a plain wrapper keeps working; an accessor that re-wraps every replacement recursed forever. It also carries the TCF read and the `visibilitychange`/`pagehide` flush. Verified by the `ga4-batch` demo, where the flush before the end snapshot sends the three-event batch. | working locally |
| Consent scenarios: none, accept, reject | `@duckduckgo/autoconsent` Playwright build: detect, `before-consent` cookies, `optIn`/`optOut`, `after-consent` cookies the moment `autoconsentDone` arrives. It needs the full `rules.json`: the compact rule set has no opt-in steps. Observation windows (network idle up to 5 s, then 3 s) after load, consent and each journey step; before the `end` snapshot and each journey step the page is told it is hidden, which makes gtag send the batch it holds (it otherwise waits about 5 s). Consent observations: Google `consent` commands with their push time, `__tcfapi` at load, after the action and at the end, and the CMP events. Verified by the demo (`reject` on `meta-before-consent`, `accept` on `ga4-batch`) with cookie snapshots at `before-consent`, `after-consent` and `end`. | working locally |
| **GPC scenario** | A fourth scenario that sends `Sec-GPC: 1` and sets `navigator.globalPrivacyControl` (ObservePoint and DataTrue both test it). Verified by the `gpc-echo` demo above. | working locally |
| Journeys | Up to 5 `goto`/`click` steps in the same context; a `document-end` cookie snapshot before each navigation. Verified by the `lost-gclid` demo: two documents and a `document-end` snapshot before the navigation. | working locally |
| Click-ID entry | The engine loads whatever URL it is given, so a landing URL with `gclid`, `fbclid`, `ttclid` or `utm_*` is captured as written. The M1 demo captured `lost-gclid/?gclid=TEST`. Running a page with and without the IDs as separate runs is the New audit form's job in M2 | working: by URL (M1), and as the form's "Simulate an ad click" option (M2), which puts the test IDs on the start URL only |
| Cookies | Cookie jar with values (`name`, `domain`, `path`, `expires`, `secure`, `httpOnly`, `sameSite`) at `before-consent`, `after-consent`, `document-end` and `end`. Verified by the demo (see the snapshots in the `reject` and `lost-gclid` runs) | working locally |
| Screenshots | One PNG per capture, taken after the `end` snapshot and returned base64 in `CaptureResult.screenshot` (`null` when the capture failed before it). Verified by the `gpc-echo` screenshot. The CLI does not print it. In M2 the `capture-<n>` workflow step stores the image through `Storage` at `audits/<audit>/runs/<run>/screenshot.png`, because Workflow step results are capped at 1 MiB; the audit page shows it as a thumbnail through a URL signed for 5 minutes | one per capture, working locally; stored in R2 per run (M2) |
| Google Ads and TikTok decoders | `packages/decoders`, built from recorded fixture traffic. On the wire: Ads conversions are GET `googleadservices.com/pagead/conversion/<id>/` (while ad_storage is denied, the same conversion goes as a POST to `pagead2.googlesyndication.com/pagead/conversion/<id>/` with `gcs=G100`, and the googleadservices one only after consent) and remarketing is POST `google.com/rmkt/collect/<id>/`, both with the click ID as `gclaw`; TikTok sends one event per POST to `/api/v2/pixel` and `CompletePayment` goes out as `Purchase`. Not decoded: `google.com/ccm/collect` and `ad.doubleclick.net/ccm/s/collect` (they duplicate the same events), `/api/v2/pixel/act` (page metadata, no event) and `1p-user-list` (echo of `rmkt`). Ads consent (`gcs`, `npa`) appears on `ccm` and on the conversion requests, but `ccm` also covers events with no conversion, so the M3 consent rules need the raw `ccm` requests as well as decoded hits. M3 must count logical purchases (transaction ID plus label) separately from transport hits, because one purchase can send both the denied (googlesyndication, `npa=1`) and the granted (googleadservices, `npa=0`) conversion. Only GET and POST are decoded, so preflights never become hits. Verified by the demo: `ga4-batch` under accept decoded Google Ads remarketing, TikTok and Meta hits next to GA4; `zinko decode` on a TikTok `Purchase` body prints vendor `tiktok`, event `Purchase`, `batchIndex` 0. | working |
| Fixture sites | `packages/fixtures`: 11 fake shops, each with one known bug, used as capture targets we run and inspect by hand (`pnpm --filter @repo/fixtures serve`, `inspect`). Banner is vanilla-cookieconsent 3.1.0, which autoconsent supports (`cookieconsent3` rule); autoconsent also handles Klaro, which the spike used. Findings: gtag also sends `google.com/rmkt/collect`, `google.com/ccm/collect` and `ad.doubleclick.net/ccm/s/collect`, which the vendor-blocking list must cover, and Consent Mode pings to `pagead2.googlesyndication.com/ccm/collect`, which the plan's host list missed (added in Task 4; they reached Google during its first verify runs); the GA4 cookieless ping (`gcs=G100`) before consent is expected and must not be flagged; with Consent Mode default denied, gtag holds events until the consent update and then sends them batched. Verified by running every demo site above and `inspect`. | working |

### Audit pipeline (M2)

The M2 demo, run locally on 2026-10-20 in a browser (Playwright) against the engine (`BROWSER_URL=http://localhost:8080`, `ALLOW_PRIVATE_NETWORKS=true`), the fixtures and `pnpm dev`, with "Answer tracking requests locally" on. Screenshots of each step are in `mockups/m2-demo/` (untracked).

1. Signed up a new user, then created the organization `Demo Agency`, the client `Fixture Shop Ltd` and the site `http://localhost:4400/`.
2. Started an audit of `/clean/`, `/meta-before-consent/` and `/ga4-batch/` × none/accept/reject × desktop (9 runs). It ran live (tiles going pending, running, complete) and finished `partial` after 120.7 s: one run, `meta-before-consent` under accept, stopped with a `Navigation` timeout (`Page.goto` exceeded 30 s; the cause is not isolated, and the same run passed in the second audit) and kept its one hit. The partial audit is the partial-failure principle working, and it is also a flake to chase.
3. A second audit of the same pages (the form prefilled from the first) finished `complete`, 9 of 9 runs, in 90.7 s.
4. In the Hits explorer (118 timeline items): filtered to `meta-before-consent`, reject, vendor Meta: one `PageView` at 1,316 ms, before the consent update at 4,972 ms, and no Meta hit after it. Opened the `ga4-batch` accept hit `view_item_list`: decoded parameters, ids and consent next to the raw `POST` whose body holds the three batched events.

| Feature | How we build it | Status |
|---|---|---|
| Clients and sites | `client` and `site` tables (`packages/db/src/audit-schema.ts`), every row carrying `org_id`; the server functions in `server/clients.ts` scope by `activeMembership`. A site stores its origin and canonical host, which is its allow-list: a page belongs to it when it is http or https, has no credentials and its host equals the site's or is a subdomain of it. Private hosts are refused when a site is created unless the stage sets `ALLOW_PRIVATE_SITES` (local dev stages only). **Archiving instead of deleting:** archive hides a client or site and is open to owners and admins only; delete works only when nothing under it has audits, because every foreign key from audits upward is `on delete restrict` and evidence is never deleted by accident. Purging evidence is a later feature. | working: the M2 demo created a client and a site for `http://localhost:4400/` in a browser (origin `http://localhost:4400`, host `localhost`); the role and cross-organization 404 checks were Task 4's verify steps |
| New audit form | `/app/sites/$siteId/audits/new`: start URL (the site's address by default), up to 19 key pages, scenarios (none, accept, reject, GPC; the first three checked), viewport, **"Answer tracking requests locally"** (`blockVendorRequests`, **on by default**: hits are recorded as attempted requests and the vendor never receives them, so test traffic stays out of the client's analytics) and "Simulate an ad click" (`clickIds`: the test click IDs and UTMs go **on the start URL only**; journey runs, M3, show whether they survive into later pages). Prefilled from the site's last audit. The server checks every URL with `isOnSite`. The estimate is runs × 12.8 s, rounded up to minutes, which is Task 5's measured seconds per run | working: the M2 demo started two 9-run audits from it in a browser |
| Durable runs | `startAudit` (`server/audits.ts`) inserts the audit and its runs in one transaction and starts the `Audit` workflow (`workflows/Audit.ts`) with the audit id as instance id, so a second start fails instead of duplicating. Steps: `start`; per run `capture-<n>`, then `persist-<n>` or `fail-<n>`; `finish`. `capture` reuses a stored capture (keys on the run, then an object already at `audits/<audit>/runs/<run>/capture.json`), else calls the engine with `allowedHosts: [site.host]` on container instance `<auditId>`, writes the screenshot, then `capture.json` (the result with `screenshot: null`), and returns only keys. `persist` decodes the stored capture and in one transaction deletes and reinserts the run's hits and pushes (natural keys, `created_at` = the run's `finished_at`). A refused request (`PolicyDenied`, `InvalidRequest`) is not retried, nor is a missing run, an undecodable config or stored capture, or a 400 the contract cannot read (`WorkflowStepNonRetryableError`); other engine errors retry 8 times from 15 s; a step that gives up becomes `failure = EngineBusy` (429 or 503 to the end), `EngineFailure` or `PersistFailure`, and the audit goes on. Hits are marked `after_consent_action` when sent at or after `consent.actionAt`. Audit: `complete` when every run is, `failed` when no run has a capture, else `partial`. Each step builds `AppLayer` afresh (`runtime.provide`). Verified in M2 Task 5 on the fixtures: 3 pages × 3 scenarios `complete`, every run's rows equal to its `capture.json` decoded again; off-site redirect → `Navigation`, audit `partial`; refused page → audit `failed`; a forced `persist` failure after commit → identical rows on retry; a forced failure after the R2 write → one engine capture; exhausted `persist` → run `failed`, capture kept; 2,000-request probes (10.4 MB, and 1,999 GA4 hits) complete; four audits at once all finish. Throughput: 115 s for 9 runs alone (12.8 s per run wall, 12.7 s mean capture; the workflow adds ~0.1 s per run); the demo's complete audit took 90.7 s (10.1 s per run) and its partial one 120.7 s with a 30 s timeout in it | working locally; not yet on Cloudflare |
| Live progress | `AuditRoom` Durable Object over WebSocket (one per audit, listen-only, 50 sockets), the page refetches the audit on every signal. `/ws/audits/<id>` checks Origin (403), session (401) and the `member` row plus the audit in that organization (404, so removed members are refused); the room is named by the database lowercase id. Verified in M2 Task 6 | working: the M2 demo watched the run grid update without a reload (a `Live` badge, tiles going pending, running, complete, with thumbnails); the 401, 403 and 404 refusals were Task 6's verify steps |
| Hit explorer | `/app/audits/$auditId/hits`: a timeline of decoded hits and `dataLayer` pushes, 200 per page with a cursor, filterable by run, scenario, source, vendor and event ("Omnibug in the browser"); the vendor and event filters narrow hits only, so `dataLayer` pushes stay in the timeline. Timeline ordering uses `collate "C"` on `request_id`, so it cannot use `hit_run_at_idx` under the `en_US` database collation (about 1 ms at 2k hits); later, give the index or column `collate "C"`. Raw requests are read from `capture.json` per click (27 ms for a 30 KB capture); revisit by storing `method/url/body` per hit when the M3 findings need them | working: in the M2 demo, filtered to Meta on `meta-before-consent` under reject (one `PageView` at 1,316 ms, the consent update at 4,972 ms, no Meta hit after it), and opened the `ga4-batch` accept batch hit (the raw body holds three events: `view_promotion`, `view_item_list`, `select_promotion`); hits sent after the consent action are marked, and answered-locally hits are labelled as attempts |

### Rules and findings (M3)

| Feature | How we build it | Status |
|---|---|---|
| ~20 v0.1 rules | `packages/rules` (`@repo/rules`): plain TypeScript, no Effect, no I/O. `evaluateRun(RunInput)` takes one run (scenario, viewport, page, its `CaptureResult` and decoded hits) and returns one `CheckResult` per rule: `pass`, `fail`, `inconclusive` or `not_applicable`, with a message and `EvidenceRef`s (hit, raw request, cookie, push, document); a failing check always cites evidence. Title, why and fix steps are static per rule; `RULES_VERSION` is stored with results. Consent rules branch on the consent outcome: accept and reject split hits at `actionAt`, none and gpc have no action, a banner that was not found makes them `inconclusive`. `consent.default-after-tag` is `inconclusive` when no default is in `dataLayer` but the first Google hit or `ccm` ping already carries a consent state, since Google Tag Manager's consent templates set the default without a `dataLayer` push. The engine marks a not-found banner as an incomplete run (`CmpNotFound`), so `evaluateRun` still evaluates a run whose only errors are `CmpNotFound` and every other incomplete run is `inconclusive` for every rule. `zinko capture --rules` prints the results per scenario (`--json` adds `checks`). Areas: consent, click IDs, coverage, duplicates, dedup, hygiene (`docs/product.md`) | in progress: the five `consent.*` rules working (M3 Task 1, `zinko capture --rules --block-vendors` on `meta-before-consent`, `tiktok-after-reject`, `consent-default-late`, `clean` (desktop, mobile, `/thank-you`) and `no-cmp` under all four scenarios). The fixture Meta pixel sets no `_fbp`, so `meta-before-consent` does not fail `consent.cookies-without-consent`; `consent-default-late` does (`_ga` before consent) |
| Journey runs | `AuditConfig.journey` (optional, default off, so M2 configs decode; the form's "Also walk through the key pages in one session"). When on and there is at least one key page, `startAudit` adds, after the per-page runs, one run per scenario × viewport with `run.journey = true` and `run.page_url` the start URL (click IDs on it when `clickIds` is on). The workflow's `capture` step sends the first `JOURNEY_STEPS` (5) key pages as `goto` steps in one browser context, under the same `allowedHosts`. The engine allows 60 s + 15 s per step, so 135 s at 5 steps, inside the 4-minute step timeout. The estimate counts a journey run as 1 + steps runs. The grid and the Hits run filter label these runs "Journey from <path>". `RunInput.journey` is the run's flag; the CLI sets it when the capture has a `--goto` step. `clickid.lost-across-navigation` (accept only; Ads gated on `gclid`, Meta on `fbclid`; TikTok deferred) fails when a later document's Ads conversion has no `gclid` (or its Meta `Purchase` has no `fbc`) **and** that document's `document-end` (or `end`) snapshot has no `_gcl_aw` (or `_fbc`) cookie readable on that document's host. **Finding (2026-10-22):** in a one-tab journey, gtag recovers the gclid from the tab's history (`navigation.entries()`; the conversion carries `gclaw` with `gclaw_src=6_4`) even with the Conversion Linker off and no `_gcl_aw` cookie. So `lost-gclid` walked to `/thank-you` **passes**: the conversion carries the gclid. Stubbing `navigation.entries()` makes it go out without one. The rule fails only when the history fallback cannot help, for example a walk onto another origin (`localhost` → `127.0.0.1`, fails with the conversion and the document as evidence). A same-origin fixture that really loses the click ID needs a fixture change (open question) | working in the CLI (`zinko capture --goto … --rules`); the audit path (`startAudit`, the workflow, the migration) type-checks but has not been run, because Postgres was not available |
| Finding card | Severity, why it matters, evidence panel, fix steps (LLM or static template), triage: open, accepted risk, fixed | planned |
| **Three outcomes per check** | Pass, fail, and **inconclusive** (the page or CMP didn't load), plus **"suppressed, with reason"** (for example "no consent, so the Ads hit was correctly not sent"). From Trackingplan and Elevar | proposed |
| **Google's names where we overlap** | Reuse Tag Diagnostics wording and severity (Urgent, Needs attention) for overlapping rules, so findings read the way users already know them | proposed |
| **Click ID survives redirects** | A rule that follows redirects on the landing URL and checks the ID reaches the final page and its cookie (a Tag Diagnostics check) | proposed |
| **Approved vendor list per client** | Each client lists allowed, required and forbidden vendors or domains per consent category; a rule flags anything outside it (ObservePoint Consent Categories, DataTrue policies) | proposed |

### Matrix, overview and LLM (M4)

| Feature | How we build it | Status |
|---|---|---|
| Tag matrix | Vendor and destination ID × page × scenario, which events fired; TanStack Table | planned |
| Overview score | Health score and issue counts by area; worst finding shown in full up front (the free-preview pattern from Tracking Auditor and GAfix) | planned |
| **Consent default vs update per tag** | Per-tag view of the consent state at default and after the update, as Tag Assistant's Consent tab shows it, but for all vendors and all scenarios side by side | proposed |
| LLM explanations | `Llm` service, explanation and fix steps per finding, cached; crawled content only ever goes in as quoted evidence | planned |

### Report (M5)

| Feature | How we build it | Status |
|---|---|---|
| White-label report | Branding table (logo, accent, footer), report route | planned |
| Share link | Secret token, revocable, no login needed (DataTrue's hosted report) | planned |
| PDF | The container prints the report route with `page.pdf()` | planned |
| **Audit register export** | A CSV or sheet of every finding next to the report, for consultants who track fixes in spreadsheets (Tracking Auditor's Sheet export) | proposed |

### Compare and polish (M6, v0.1 release)

| Feature | How we build it | Status |
|---|---|---|
| Re-run and compare | Findings marked new, fixed or unchanged; diff every tag and every field (ObservePoint compares only 3 tags by default) | planned |
| **"What changed" briefing** | A short summary at the top of a re-run's report (DataTrue's Briefing) | proposed |
| **Tag disappeared** | Flag a tag that fired on the last run and is gone now (Elevar's missing-embed alert) | proposed |
| Self-host guide, public demo | `alchemy deploy` to your own Cloudflare account | planned |

### v0.2: configured vs fired, funnels

| Feature | How we build it | Status |
|---|---|---|
| GTM, GA4 Admin, Meta connectors | Read-only API access; GA4 MCP and gtm-mcp-server run as sidecars | planned |
| GTM container diff | Show which container version is live and what changed since the last audit (Trackingplan, RundataAI) | planned |
| LinkedIn decoder | `packages/decoders` | planned |
| Funnel discovery | Stagehand-style agent finds add-to-cart and checkout once, outputs a replayable spec with real selectors; plain Playwright replays it with no LLM; a failed replay step is flagged as drift | planned |
| **Region simulation** | Run from or emulate an EEA vs US visitor so consent defaults per region are checked (Tag Assistant makes you do this by hand) | proposed |

### v0.3: monitoring and the paid cloud

| Feature | How we build it | Status |
|---|---|---|
| Scheduled audits | Cron-triggered `AuditWorkflow` | planned |
| Alerts | Thresholds on rates and counts (not only single events), with a preview of how the alert would have fired on past runs (ObservePoint); email through `Mailer`, Slack and webhooks from day one | planned |
| **Daily client digest** | One red/yellow/green line per client across the agency (Trackingplan's agency digest) | proposed |
| Billing | Polar or Stripe, cloud only | planned |

### v0.4: tracking plans in git

| Feature | How we build it | Status |
|---|---|---|
| Tracking plan as YAML | Events and properties as JSON Schema inside YAML, versioned in the client's repo (Segment Protocols' schema model, without the SaaS database) | planned |
| Plan status per entry | Planned but never seen, seen and valid, seen but violating (Avo Inspector, Amplitude Observe) | planned |
| Plan lint | Check the plan itself for naming and type problems, separately from the site audit (Avo Branch Audit) | planned |
| GitHub Action | Run an audit against a pinned plan version and fail the PR on new findings (Amplitude `ampli status`, Lighthouse CI) | planned |
| Plan-editing MCP | Agents propose plan changes only as a PR against the YAML; a person merges (Avo's MCP can never merge to main) | planned |
| Typed code generation | Generate `dataLayer` and gtag helpers from the plan (Typewriter is unmaintained, a warning against tying codegen to one SDK) | planned |

### Later

Chrome extension, CLI parity with the web app, Shopify or CRM order reconciliation (Elevar's Channel Accuracy treats orders as the source of truth; Zinko would need a connector to do the same).

### Not planned

An ad tracker (RedTrack, Voluum class), product analytics (integrate with PostHog instead), a managed audit service (DataTrue's model), a credit system.

## What we take from other products

Researched 2026-10-20 from first-party product pages, docs, pricing and changelogs. Prices change; check before quoting.

### Closed source

| Product | What it is | Take | Do differently |
|---|---|---|---|
| [ObservePoint](https://www.observepoint.com) | Scheduled site scans and scripted journeys for tags, privacy, accessibility. Priced per page scan per year (amounts not public) | Opted In / Opted Out / GPC scenario naming; Consent Categories (approved and unapproved lists per geo); reusable action sets for consent clicks and login; alert preview on past runs | Diff every tag and field, not 3; webhooks and Slack, not email only |
| [DataTrue](https://datatrue.com) | Mostly a managed service: staff build scans and journeys. Clicks real banners, tests none/accept/opt-out/GPC, policy engine, synthetic PII on forms. $16k–90k/year | Finding card (priority, why, fix, evidence); "what changed" briefing; no-login report link; synthetic PII entered into forms | Self-serve, not a service; deterministic results, no confidence guesses; API on every tier |
| [Trackingplan](https://www.trackingplan.com) | Passive monitoring through an installed tag; learns the plan from traffic; anomaly detection; an audit agent with OK / Needs attention / Inconclusive verdicts. €89–2,000+/month plus €1 credits | The Inconclusive outcome; GTM version history; daily per-client digest; saved journeys | No install on the client's site; explicit rules and plans, not a baseline learned from traffic, because a site that was always broken looks normal to a baseline |
| [Avo](https://avo.app) | Tracking plan with git-like branches and review, codegen, Inspector (schemas only, no values), MCP that writes only to branches. Free, $250/month, Enterprise | Branch-only MCP writes; plan lint; implementation status per plan entry | The plan lives as YAML in git, not in a SaaS database; CI is a first-class path |
| [Segment Protocols](https://www.twilio.com/docs/segment/protocols) | JSON Schema per event, can block or drop non-conforming events, event versions. Paid add-on | JSON Schema inside the YAML plan; versions tied to a release | Observe and report, never block data |
| [Amplitude Data](https://amplitude.com/docs/data) | Plan branches tied to git branches, `ampli status` in CI, Protected Schema | CI check against a pinned plan; "planned but never seen" as its own finding | Cross-vendor, not tied to one analytics product |
| [Google Tag Assistant and Tag Diagnostics](https://support.google.com/tagmanager/answer/14681508) | Free per-session debugger with a Consent tab; Diagnostics flags issues from observed traffic. Google tags only | Diagnostic names and severities; default vs update consent view; click ID through redirects; exportable session file | All vendors, all scenarios side by side, region as a setting; a clean status doesn't prove values are right |
| [Elevar](https://docs.getelevar.com) (now Audiense Online) | Shopify server-side tracking; Channel Accuracy reconciles destinations against orders; threshold alerts. $0–3,000+/month | "Suppressed, with reason" outcome; tag-disappeared alert; alerts on rates | Audit from the outside, any stack, no install |
| [RundataAI](https://rundataai.com) | Closest competitor: DOM scans without login, 19 modules, rescan comparison, GTM diffs, consent sequencing. Free to $149/month plus credits | Container diffs; rescan comparison | Real browser capture per consent scenario and click ID; open source, no credits |
| [Tracking Auditor](https://www.trackingauditor.io) | Reads GTM and 30 days of GA4 through Google sign-in; A–F grades; branded Doc and Sheet. £79 per audit | Free preview pattern (grade plus worst finding); audit register export; config-side checks for a future GTM connector | Captured behavior, not configuration only |
| [GAfix](https://www.gafix.ai), [Measuremate](https://themeasuremate.com) | GA4 audits as a funnel into paid fix services; Measuremate's original domain has lapsed | Health score up front | Say plainly that rules decide and the LLM only explains; no fix-service upsell |

### Open source

Licenses verified from each repository's LICENSE file on 2026-10-20. All five are usable in AGPL-3.0 Zinko.

| Project | License | Take | Conditions |
|---|---|---|---|
| [Omnibug](https://github.com/MisterPhilip/omnibug) | MIT | 69 vendor decoders in `src/providers/*.js` to port; the Hit explorer idea | Keep the MIT notice on ported code. Last push 2025-06-30 |
| [autoconsent](https://github.com/duckduckgo/autoconsent) | MPL-2.0 | Accept and reject on common CMPs; ships `dist/autoconsent.playwright.js` to inject | Use unmodified as a dependency; any edits to its own files must stay MPL |
| [Blacklight collector](https://github.com/the-markup/blacklight-collector) | GPL-3.0 | One inspector per behavior (`src/inspectors/`: cookies, key logging, session recording, third-party trackers; fingerprinting plugins); typed evidence events `{type, url, stack, data}` | Code can be combined into AGPL (GPLv3 §13), copied files stay GPL with their notices. It is Puppeteer/TS, so mostly ideas to port. Its bundled EasyList data has its own license, unchecked |
| [walkerOS](https://github.com/elbwalker/walkerOS) | MIT | `dataLayer` and CMP sources; its MCP package | Keep the notice |
| [Stagehand](https://github.com/browserbase/stagehand) | MIT | `observe`/`act` return real selectors, so a discovered funnel can be replayed without the LLM | Keep the notice |

The rest of the reference list (open-seo, Lighthouse CI, OpenStatus, Typewriter, Documenso, Formbricks, the GA4 and GTM MCP servers) and the avoid list are in `RESEARCH.md` §6.

## Open questions

- **Bot protection:** on the 2026-10-20 test pages Scrapling passed the checks that flag plain Playwright (`HeadlessChrome`, `navigator.webdriver`; BrowserScan "Normal" vs "Robot", CreepJS 33% vs 100% headless), and both fail the SwiftShader WebGL check. Still open: how protected sites treat Cloudflare Container (datacenter) traffic, and real Cloudflare challenges, since nowsecure.nl's forced-interactive Turnstile test key stopped both engines and `fetch()`'s solver alike. Also open: container cold start and cost for 10 pages × 3 scenarios.
- **Audit throughput:** captures run one at a time per audit. Task 5 measured 12.8 s per run locally, so 10 pages × 3 scenarios (30 runs) take about 6.4 minutes against the 5-minute target, before container cold start; the demo's complete audit ran at 10.1 s per run, which is about 5.1 minutes, so the target is missed or met by a hair depending on the pages and the network, and one 30 s navigation timeout (as in the demo's first audit) costs more than that margin. The form's estimate stays at 12.8 s per run. Parallel captures within an audit (several container instances, or several pages per engine) move to a later milestone. Locally every audit shares the one `BROWSER_URL` engine, so concurrent audits queue through 429 retries: four 3-run audits started together finished after 52 s, 2.4, 4.2 and 8.2 minutes, with the engine idle between backoffs. On Cloudflare each running audit has its own instance (`maxInstances` 3), and a fourth waits through 503 retries (up to about an hour) until one sleeps.
- **Admission control for captures:** nothing limits how many audits start at once. Each capture step that meets a busy engine (429) or no free container (503) backs off on its own, 15 s doubling over 8 retries, about 64 minutes per step, and there is no fairness between audits: whichever retry lands when an instance frees up wins, and the engine sits idle between backoffs. A step that runs out records `EngineBusy` (Zinko was busy; re-run), not `EngineFailure`. A counting Durable Object or a Queue in front of the containers would admit audits in order; out of scope for M2.
- **Consent timing of hits (decided in M2 Task 5 review):** gtag sends what it held under Consent Mode within milliseconds of the click, before autoconsent reports completion (`ga4-batch` under accept: action at 10,060 ms, the batch at 10,074 ms, completion at 10,081 ms). So `after_consent_action` is `startedAt >= consent.actionAt`, and the CLI's "after" marker uses the same rule. It is false whenever there was no action (`none`, `gpc`, `not-found`), so M3 rules branch on `consent.outcome` first rather than reading `false` as "before consent".
- **`gcd` decoding:** sources disagree on the letter mapping, so any `gcd` rule stays heuristic until verified.
- **Proposed features above:** which go into v0.1. GPC is in M1 and working; the inconclusive outcome still changes the scope of M3.
- **Region simulation:** emulate (headers, timezone, locale) or actually route through a region; emulation may not trigger server-side geo logic in CMPs.
- **Deploy:** whether the deploy workflow becomes manual-only until Cloudflare secrets exist.

## Gaps in the research

ObservePoint's prices and webhook support; DataTrue's journey syntax and whether it checks Google Consent Mode; Trackingplan's MCP tool list and white-label details (its docs were behind bot protection); RundataAI's scan engine (real browser or static HTML); GAfix's connection method.

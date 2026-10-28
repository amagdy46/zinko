# Zinko roadmap and how we build

## How we work

- **Vertical slices.** Every milestone ends in something you can demo end to end in the web app, never "the backend is done".
- **Rules start from fixtures.** For a new check, first add a fixture page with the bug, then a failing test, then the rule.
- **Use it on real work.** From M3 on, every client audit you do runs through Zinko. Anything it misses becomes a new rule plus a fixture.
- **Issue tracking.** GitHub Issues, with one milestone per row below. Keep PRs small, and use squash merges on `main`.
- **CI on every PR:** typecheck, test (including the fixture pipeline), and build.
- **Decision records** for anything we'd otherwise argue about twice go in `docs/decisions/`.

## Milestones (about 10 weeks part-time)

| # | Milestone | Demo at the end |
|---|---|---|
| M0 | **Foundations:** CI, Vite+ (oxlint, oxfmt), Effect 4 + effect-cf setup, `packages/core` services, `packages/db` (Drizzle, Neon via Hyperdrive), TanStack Start on Workers with better-auth and organizations, `infra/alchemy.run.ts` with dev/PR/prod stages, `alchemy deploy` from CI | Sign up on the deployed Worker, create a workspace, invite a teammate |
| M1 | **Capture (done, except two items below):** the capture engine in `apps/browser` (`POST /capture`: Scrapling `AsyncStealthySession` with a Playwright fallback, egress proxy for SSRF and vendor blocking), `packages/capture-contract`, dataLayer shim, cookies, screenshot, autoconsent scenarios (none, accept, reject), a GPC scenario, short click-through journeys, Google Ads and TikTok decoders, `packages/fixtures`, and `zinko capture`. **Not done:** the container image has not been run (building it needs `sudo docker`), and the bot-protection comparison of Scrapling vs plain Playwright vs patchright (and Browser Rendering) on 5 sites is pending, because the user has to approve the sites | A fixture site captured locally under the consent scenarios with matching hits (done, see `docs/vision.md`); the same inside the container (pending the image run) |
| M2 | **Audit pipeline (done locally, 2026-10-20):** clients and sites CRUD, the New audit form, AuditWorkflow (step per page × scenario), AuditRoom Durable Object over WebSocket, hits in Postgres, artifacts in R2 | Run an audit from the UI, watch it progress, and browse the Hits explorer (done: the M2 demo in `docs/vision.md`) |
| M3 | **Rules and findings (done locally, 2026-10-22):** `packages/rules` with the 19 v0.1 rules, journey runs, check results and findings in Postgres, and the Findings screen with its evidence panel | Audit a real client site and get correct findings with evidence (done on two public sites, with false positives found and noted: see "M3 demo" below) |
| M4 | **Matrix, overview and LLM (done locally, 2026-10-28):** the Overview (score with its arithmetic, worst finding, tags seen), the Tag matrix (events and observed consent state, by scenario or page, paginated), banner detection uncertainty, Hits destination and timing filters, and `packages/llm` (BYOK keys, an organization policy that is off by default, spend-limited cached explanations) | A consultant-ready view of everything that fires where (done: the M4 demo in `docs/vision.md`) |
| M5 | **Report (done locally, 2026-10-28):** branding settings, report page (one-page summary, scope, consent-scenario matrix, findings, an action plan grouped by who fixes it), consultant notes, a revocable share link to a dated snapshot, PDF through print, CSV audit register. Plan: `docs/plans/2026-10-28-m5-report/plan.md` | Send a white-label report to a client (done: the M5 demo in `docs/vision.md`) |
| M6 | **Compare and polish:** re-run with diff (new, fixed, unchanged, regressed, verdict changed, not comparable when rules version or banner detection differ; accepted risks carry over), per-finding re-verify as a narrow re-run, a "what changed" briefing in the Overview and the report, tag-level diff, empty and partial states, docs, self-host guide (after a deploy spike), read-only public demo instance. Plan: `docs/plans/2026-10-28-m6-compare/plan.md` (proposed) | **v0.1 release:** a Show HN post and a "we audited N sites" write-up |

## UI refresh (done locally, 2026-10-24)

Shell with organization switcher and `⌘K` palette, clients and sites with honest aggregates, the new audit form with a live estimate, the audit header with live progress and the runs matrix, the findings screen with triage and a detail sheet, the hits explorer with filters and a consent divider, and refreshed auth and settings, all on one token set and one set of shared components (`docs/ui.md`). Checked in the browser at 390px and 1440px in both themes, plus a grayscale pass (`docs/plans/2026-10-22-ui-refresh/plan.md`, Task 11). Leftovers:

- Not exercised in the browser: a 44-run audit for density, the "Audit failed" and "not evaluated" completion toasts, the mixed-rules-versions alert on Findings, the null `check_result.check_title` fallback, and Open in Hits from every evidence kind (only hits and pushes were followed).
- The runs matrix has no legend; a partial run (half ring) and a running one (spinner) are told apart by the word in the hover card and header, which grayscale keeps but a glance does not.
- The optional sales-page brand alignment (plan Task 12) has not been done.
- Out of scope in the plan and still open: runs filters, re-run with the same settings, screenshot compare, audit cancel and single-run retry, site settings, `j`/`k`/`e` shortcuts and report (M5 and later). The Overview and tag matrix are done in M4.

## Left over from M2

M2 runs end to end locally against an engine started by hand (`BROWSER_URL`). Not done, and not blocking M3:

- **Parallel captures** for the 5-minute target: captures run one at a time per audit, 10.1 to 12.8 s per run, so 10 pages × 3 scenarios take about 5 to 6.4 minutes.
- **Admission control:** done in the M3 leftovers (below).
- **Cloudflare:** the Workflow, Durable Objects, R2 and the container have run only under `pnpm dev`; the container image and a deploy are still untried. Offline preparation is done (2026-10-28, `docs/decisions/0004-first-deploy.md`: stage isolation, a database-name guard, a secret-free image-build workflow); the image build needs the docker group or CI, the deploy needs owner gate Q13.
- **A flaky navigation timeout:** one demo run hit `Page.goto` 30 s on a fixture page and passed on the next audit; the cause is not isolated.

## Left over from M5

- **Real Firefox print preview not run.** Playwright cannot print Firefox to PDF; its print-media layout was checked by screenshot only. Print the public page from Firefox by hand once.
- **Distinct captures at 168 runs unmeasured.** The report build read one shared stored capture, so evidence rows were "not available" for all 19 findings and the cost of up to 19 distinct R2 reads per build is unknown; `getReportDraft` p95 was 383 ms without it.
- **Transient storage failure on publish not exercised end to end.** The refusal ("Some evidence could not be read; try again") is coded but no storage outage was injected.
- **Cloudflare rate-limit rule on `/r/*`** is not written or verified (the binding in `infra/alchemy.run.ts` is still an unverified spike); only the shape check, the uniform 404 and the one-indexed-lookup cost bound abuse.
- **The public HTML is 237 KB for 19 findings** against a 250 KB budget; a longer report will pass it. Compression at the edge is assumed, not measured.
- **The footer is not repeated on every printed page** (a fixed element lands at the top of pages 2 and later in Chromium; a margin box cannot carry author text). It closes the document; the page number is a margin box.
- **A server-rendered PDF** is deferred with its prerequisites in `docs/vision.md`.
- **First publication after a model change reads as a change.** `publication_hash` includes `modelVersion`, so an audit whose last snapshot is an older model version shows "Unpublished changes" once, and the next link publishes a new version.
- **Report summary says "Could not check: n rules" without naming them**; Appendix A names them, the summary could list the first few.
- **Inline links in the action plan are under 32 px** (text links inside wrapping lines, on paper); the app's own targets are 32 px.
- **`/files/` without signature or expiry answers 400, with a wrong signature 403** (the plan expected 403 for both); neither leaks.
- **A detailed report prints entered paths as typed**; nothing detects a name in a path (by design, see the disclosure dialog).
- **Links opened by preview bots count as views.**
- **M4 leftovers still open:** the Overview focus order reaches the audit content before the sidebar navigation; click IDs reach the start URL only.

## Left over from M4

- **No real-provider quality run yet.** Explanations were exercised against an OpenAI-compatible stub only. Run `meta-before-consent` and `consent-default-late` once with a real key and check the text against the digest (plan Task 13).
- **Abandoned requests hold a ledger slot until lease expiry.** A reservation whose caller went away is freed only when its lease (timeout plus 15 s) ends, and counts against the 30 per hour.
- **Token-based spend limits.** The cap is a count of attempts and a 60 s timeout; `Llm.generateText` cannot pass a token limit, so cost per call is unbounded.
- **Banner detection needs a spike.** Uncertainty is read from the audit's own accept and reject runs. Detecting a CMP under none and gpc, or simulating a region, is an engine change; it has not been checked on a real public site without a banner.
- **Finding markers in matrix cells** are deferred (M5/M6).
- **Digest cost on real R2.** 158 failing runs read in 161 ms p50 (192 ms max) locally from one cached file; measure with 158 distinct objects on R2 before relying on it.
- **Click IDs reach the start URL only.** Rules that need them on a key page cannot be tested from a key page; a per-page option or a documented fixture start page would help.
- **Score weights, the 79 cap and the "Minor issues only" band** are provisional (plan open question 1); the score summarises one audit's pages and scenarios, not the site.
- **Retention:** no TTL on `finding_explanation`; the 24 h ledger cleanup runs only when an organization reserves again.
- Still open from M3 and not taken by M4: ads purchase detection, flaky verdict spread, vendor-side `hygiene.tag-errors`, build-before-check.

## M3 demo (2026-10-22)

Five audits of every fixture site (148 runs, desktop, none, accept, reject, gpc, click IDs on, `blockVendorRequests` on) gave exactly the findings the expected result sets in `packages/fixtures/README.md` name, and nothing from `clean`. Two differences, both explained: a journey run walks across fixture sites in one cookie jar, so the consent audit's journey runs also show pixel findings from the buggy pages it walked to; and the `redirect-gclid` journey fails `clickid.lost-across-navigation` as well as `clickid.lost-on-redirect`, one root cause reported twice (fixed in M4 Task 1, below).

Two public sites, one audit each (start page and two key pages, four scenarios, click IDs on, vendor requests answered locally, nothing crawled beyond those pages):

- **Happy Socks** (`/eu/`, `/eu/adults`, one product): no failing finding. The only "could not check" was `consent.default-after-tag` (GTM's consent template sets the default without a `dataLayer` push) and `hygiene.tag-errors`. The accept scenario did not accept: autoconsent reported `accepted` for Cookiebot, but the banner was still on screen at the end and no consent update was sent, so every accept result on this site describes a visitor who has not chosen.
- **Allbirds** (home, `/collections/mens-bestsellers`, one product): from our region the site shows no banner, so under none and gpc the consent rules fail (cookies, Meta and Google hits with no consent state) and under accept and reject they are `inconclusive`. Plausibly true, but the verdict depends on where the visitor is, and the message does not say that no banner was shown. Two false positives came out of the first audit: Meta's pixel retries an event that was answered locally (the same payload apart from `rqm` and `ie[i]`, a form post then a fetch), which failed `duplicates.meta-loaded-twice` and `dedup.meta-eventid-reused` on every run; fixed by collapsing those retries (`packages/rules/src/retransmissions.ts`), and the re-run no longer reports them. One remains: `coverage.purchase-missing-fields` failed once on a product page, because the Google Ads policy treats any conversion with a `value` as a purchase and the denied-state ping carries no `transaction_id` (Google adds its own `GG_` id only to the granted one).

## Left over from M3

- **Accept can silently not accept.** Done: both engines keep verification pending alongside post-action observation for up to 10 s, re-check the known CMP after reload, and require either confirmed popup closure or a Google consent update whose payload matches the choice. Missing evidence becomes `not-applied` with `ConsentNotApplied`; the observation distinguishes an observed failure from `unverified`. Consent-dependent rules remain inconclusive. Local probes on both engines cover dead buttons, contradictory updates, save/reload, slow closure and unknown CMP state; all fixture baselines stayed unchanged. Left: accepting Happy Socks' banner itself still does not work; see "Banners autoconsent cannot operate" in `docs/vision.md`.
- **Ads purchases.** Decide which conversions are purchases from the page (a GA4 or `dataLayer` `purchase` on the same document, or an order id the page sets) rather than from `value` alone.
- **Flaky verdicts on real sites.** `consent.default-after-tag` and the consent rules change between runs of one page when a consent default depends on a geo lookup or on which Google hit goes first (Allbirds). Show the spread in the finding instead of one run's verdict, or capture a page twice.
- **No banner is not no consent.** Done in M4 as banner detection uncertainty (not a region setting): consent findings from none rest on the audit's own accept and reject runs, are flagged per failing run, and the Overview never says every check resolved while any is open. Detecting a banner under none and gpc is in "Left over from M4".
- **`hygiene.tag-errors` cannot see vendor errors** while every audit answers tracking requests locally; it is `inconclusive` on every real site. Only a first-party collector (sGTM) is checked.
- **One cause, two findings.** Done in M4 (`RULES_VERSION` 3): `clickid.lost-across-navigation` skips a vendor whose click ID the redirect already dropped, the test `clickid.lost-on-redirect` fails on, and is `not_applicable` when every click ID was dropped. Audits stored under version 2 keep their old findings.
- **A fresh clone needs a build before `pnpm check`.** `check` type-checks workspace packages from their `dist` and the web app from the generated route tree, so it fails until `pnpm build` (and `pnpm typecheck`, which regenerates the routes) have run once. Make `check` build what it needs, or reorder the "Before you finish" command in `AGENTS.md`.
- **Admission control, again.** Done (2026-10-22, `docs/decisions/0003-capture-admission.md`). With five audits queued, one had run no capture after 50 minutes (I started it again) while the engine sat idle between other audits' backoffs. Now an `AdmissionGate` Durable Object hands the engines to captures first come, first served (each capture joins the tail and releases its grant right after the capture is stored, before persistence; every browser attempt confirms its token, and a 5-minute lease recovers crashed holders), and wakes the next waiter with a workflow event. Short audits can finish before an earlier large one. First verified locally with the earlier per-audit version: one engine, five 3-run fixture audits (none, accept, reject; desktop) started at once. With that gate, all 15 captures ran back to back with 0.1–0.2 s between one ending and the next starting, in the order the audits reached the gate, and the engine answered no 429. All five finished 2 min 12 s after queueing, twice in a row. On `main` the same load finished after 27 s, 1:10, 2:10, 4:22 and 8:11. The engine was idle for about 5 min 50 s in all between backoffs (18 s, 35 s, 95 s and 203 s), and the first audit submitted ran last. Not yet tried with containers on Cloudflare.

## Rules from research (2026-10-28)

From `docs/research/2026-10-28-pain-points.md` and `docs/research/2026-10-28-competitors.md`. Ordered; the first five need no new capture capability and can run beside M5 and M6, each fixture-first per `AGENTS.md`.

1. Done (rules v4): `consent.mode-v2-incomplete`: `gcd` leaves `ad_user_data` or `ad_personalization` unset where Ads signals are present (Google's 2026-06-15 change makes it matter more). Decoder change. The decoders now parse `gcd` per signal; fixture `consent-mode-v1`.
2. Done (rules v4): `debug.preview-or-debug-leak`: `gtm_debug`, `gtm_preview`, `debug_mode` or test transaction ids in production hits. Built for `gtm_preview`, `gtm_auth`, `gtm_debug` on `/gtm.js`, GA4 `_dbg=1` and `debug_mode`; test transaction ids not built. Fixture `debug-leak`.
3. Done (rules v4): `dedup.tiktok-eventid-missing`: the TikTok mirror of the Meta event-ID rule. Fixture `tiktok-no-eventid`; `clean` now sends TikTok event IDs.
4. Done (rules v5, decoders v4): GA4 and Ads hits on first-party paths (Google tag gateway, sGTM) recognised by payload and marked `collector: first-party`, then `duplicates.client-and-server-ga4`. The gateway's real path shape is unconfirmed (see vision). Fixtures `ga4-gateway`, `ga4-client-and-server`.
5. Done (rules v5): `consent.mode-classified` (informational, severity info, never fails): basic or advanced consent mode, which explains modelled conversions. Fixture `consent-mode-basic`; `clean` is the advanced case. Rules v6: a denied Google request followed by a granted one in the same document with no consent action is `inconclusive` (region-based default), found on Allbirds where the verdict flipped between runs; fixture `consent-region-default`.
6. With a reload step: `consent.not-persisted-across-navigation`, `duplicates.purchase-on-reload`. Planned: [capture capabilities plan](plans/2026-10-28-capture-capabilities/plan.md), Tasks 1 to 4.
7. With cross-host journeys: `consent.lost-across-subdomain`, `clickid.crossdomain-linker-missing`. Planned: the same plan, Tasks 5 to 8 (declared measured hosts and a `follow` step).
8. Request initiator (GTM, hardcoded, third-party script) as an annotation that feeds the report's "who fixes it". Planned: the same plan, Tasks 9 and 10.
9. Spikes: banner symmetry (first-layer reject), regional defaults from an EEA vantage point, more vendors (LinkedIn, Microsoft, Pinterest, Reddit, Snap).

Checked on real sites (2026-10-28, Happy Socks and Allbirds, the two M3 sites): none of the five pack 1 and 2 rules failed falsely; the first-party collector was classified right (Happy Socks' own sGTM host); `consent.mode-v2-incomplete` passes there only through the Ads `ccm` pings, not the decoded hits. `consent.mode-classified` called Allbirds "advanced" on one run from a single denied ping that was granted 1.5 s later with no choice (a region-based default) and inconclusive on the next; fixed in rules v6 (inconclusive when consent flips to granted without a choice). Still open: Happy Socks' Cookiebot accept is not applied (as in M3), so its accept rows stay inconclusive; Allbirds lost one scenario per run to `ERR_TUNNEL_CONNECTION_FAILED` through the egress proxy.

## UX rounds

Each round an agent walks the product as a first-time consultant and the issues are fixed in batches. Round 1 (2026-10-28): `docs/qa/2026-10-28-ux-sweep-r1.md`, 9 major, 18 minor, 9 polish, no blocker. Fixed in batches A to D. Round 2 (same day): `docs/qa/2026-10-28-ux-sweep-r2.md`, 33 of the round 1 items fixed or mostly fixed, 16 new (3 major: a 404 key page counted as captured, `https://` forced on localhost, a stale start URL error), fixed in batches E to G. Open for round 3: an incomplete audit with nothing captured still shows a large 100/100 beside "Incomplete"; the preflight checks hostnames, not resolved addresses (a public name pointing at a private IP passes; Workers refuse private IPs when deployed); captures stored before `HttpStatus` existed still show a 404 page as Captured. Design round (same day): `docs/research/2026-10-28-design-review.md`, 23 of 25 items built in batches H to J (type scale and `SectionHeading`, surface depth, exhaustive status map, two-tier score honesty in a shared `ScoreFigure`, Overview summary row and caveats, Clients sparklines, Hits without clipping, shared row language, settings sections); charts over time and a shortcuts sheet are deferred. Also open for round 3: the focus ring is about 1.8:1 on light surfaces (WCAG asks 3:1 for focus indicators); the Clients "Last audit" cell runs to four lines; every Hits column is monospace. Round 3 (same day): `docs/qa/2026-10-28-ux-sweep-r3.md`, a design and accessibility pass with timings; fixed in batches K to M: a solid 2px focus ring with an offset (4.75–6.56:1, the convention in `AGENTS.md` changed with it), document titles on every route, auth errors tied to their fields, labelled landmarks and a live progress line; one definition of "could not check" shared by Overview and Findings, "—" instead of a number when half the runs or fewer were captured (and no green "no failing findings" then), the run sheet without raw error codes, one page container; finding detail fetched once per selection (dev StrictMode doubled it), Hits pages 40% lighter, rows as 32px targets. Left: severity group headings read "Critical4" to a screen reader; the "Reconnecting" label after about 45 s needs checking on a deployed build. Round 4 (same day): `docs/qa/2026-10-28-ux-sweep-r4.md`, the client report judged as a paid deliverable: 15 issues, fixed in batches N and O (a real cover, the agency summary first and the scoring maths only in the appendix, honest check gaps and page counts, "Hide detail, keep in score", a numbered to-do action plan with "Ask for" and "Done when", one-line consent cells, "Show page addresses", report model version 3; the share dialog focuses and announces a new link, named row buttons, expiry dates; member branding read-only, a status chip, a More menu at 390). Left: consultant-typed page names (needs a migration); code in "Ask for" is not set in monospace; the evidence definition list at 390 was not seen with real captures.

## After v0.1

| Version | Scope |
|---|---|
| v0.2 | GTM API, GA4 Admin and Meta connectors (configured vs fired), LinkedIn, agent-driven funnel discovery, regime-aware consent scoring (EU opt-in, US opt-out, GPC), a free public single-URL scan, Slides and Sheets exports |
| v0.3 | Scheduled audits, volume-drop alerts, Slack and email notifications, an agency portfolio view across clients. **The cloud launches with billing (Polar or Stripe).** |
| v0.4 | Tracking plan as YAML, drift detection, GitHub Action, typed code generation |
| Later | Chrome extension, CLI parity, Shopify/CRM reconciliation |

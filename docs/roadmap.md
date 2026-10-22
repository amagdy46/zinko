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
| M4 | **Matrix, overview and LLM:** Tag matrix, Overview score, `packages/llm` (BYOK keys, explanations, fix steps, cached) | A consultant-ready view of everything that fires where |
| M5 | **Report:** branding settings, report page, share link, PDF | Send a white-label report to a client |
| M6 | **Compare and polish:** re-run with diff, empty and partial states, docs, self-host guide, public demo instance | **v0.1 release:** a Show HN post and a "we audited N sites" write-up |

## Left over from M2

M2 runs end to end locally against an engine started by hand (`BROWSER_URL`). Not done, and not blocking M3:

- **Parallel captures** for the 5-minute target: captures run one at a time per audit, 10.1 to 12.8 s per run, so 10 pages × 3 scenarios take about 5 to 6.4 minutes.
- **Admission control:** nothing limits how many audits start at once or orders them when the engine or the containers are busy (`docs/vision.md`, open questions).
- **Cloudflare:** the Workflow, Durable Objects, R2 and the container have run only under `pnpm dev`; the container image and a deploy are still untried.
- **A flaky navigation timeout:** one demo run hit `Page.goto` 30 s on a fixture page and passed on the next audit; the cause is not isolated.

## M3 demo (2026-10-22)

Five audits of every fixture site (148 runs, desktop, none, accept, reject, gpc, click IDs on, `blockVendorRequests` on) gave exactly the findings the expected result sets in `packages/fixtures/README.md` name, and nothing from `clean`. Two differences, both explained: a journey run walks across fixture sites in one cookie jar, so the consent audit's journey runs also show pixel findings from the buggy pages it walked to; and the `redirect-gclid` journey fails `clickid.lost-across-navigation` as well as `clickid.lost-on-redirect`, one root cause reported twice.

Two public sites, one audit each (start page and two key pages, four scenarios, click IDs on, vendor requests answered locally, nothing crawled beyond those pages):

- **Happy Socks** (`/eu/`, `/eu/adults`, one product): no failing finding. The only "could not check" was `consent.default-after-tag` (GTM's consent template sets the default without a `dataLayer` push) and `hygiene.tag-errors`. The accept scenario did not accept: autoconsent reported `accepted` for Cookiebot, but the banner was still on screen at the end and no consent update was sent, so every accept result on this site describes a visitor who has not chosen.
- **Allbirds** (home, `/collections/mens-bestsellers`, one product): from our region the site shows no banner, so under none and gpc the consent rules fail (cookies, Meta and Google hits with no consent state) and under accept and reject they are `inconclusive`. Plausibly true, but the verdict depends on where the visitor is, and the message does not say that no banner was shown. Two false positives came out of the first audit: Meta's pixel retries an event that was answered locally (the same payload apart from `rqm` and `ie[i]`, a form post then a fetch), which failed `duplicates.meta-loaded-twice` and `dedup.meta-eventid-reused` on every run; fixed by collapsing those retries (`packages/rules/src/retransmissions.ts`), and the re-run no longer reports them. One remains: `coverage.purchase-missing-fields` failed once on a product page, because the Google Ads policy treats any conversion with a `value` as a purchase and the denied-state ping carries no `transaction_id` (Google adds its own `GG_` id only to the granted one).

## Left over from M3

- **Accept can silently not accept.** Done: both engines check after the action that it took effect (the found CMP's popup check re-run with stricter visibility for up to 3 s, or a Google consent `update` in `dataLayer`), and report `not-applied` with a `ConsentNotApplied` error otherwise; the consent rules answer `inconclusive` ("the consent choice did not take effect") and the rest of the run is still evaluated. On Happy Socks accept is now `not-applied` (banner still shown 3 s later, no update, `gcs=G100` throughout) and reject is `rejected` (Cookiebot wrote `CookieConsent`). Left: accept itself still does not work there; see "Banners autoconsent cannot operate" in `docs/vision.md`.
- **Ads purchases.** Decide which conversions are purchases from the page (a GA4 or `dataLayer` `purchase` on the same document, or an order id the page sets) rather than from `value` alone.
- **Flaky verdicts on real sites.** `consent.default-after-tag` and the consent rules change between runs of one page when a consent default depends on a geo lookup or on which Google hit goes first (Allbirds). Show the spread in the finding instead of one run's verdict, or capture a page twice.
- **No banner is not no consent.** When the site shows no banner, say so in the consent rules' messages and do not call it a breach without a region setting (open question in `docs/vision.md`).
- **`hygiene.tag-errors` cannot see vendor errors** while every audit answers tracking requests locally; it is `inconclusive` on every real site. Only a first-party collector (sGTM) is checked.
- **One cause, two findings.** `clickid.lost-across-navigation` repeats `clickid.lost-on-redirect` when the redirect dropped the click ID; skip the journey check when the landing URL already lost it.
- **"Could not check" reads like a finding.** Inconclusive findings show the rule's title ("Ad pixel fired after the visitor rejected"), which states the problem as found. Give each rule a neutral question-style label for the "Could not check" group, or lead with the reason.
- **A fresh clone needs a build before `pnpm check`.** `check` type-checks workspace packages from their `dist` and the web app from the generated route tree, so it fails until `pnpm build` (and `pnpm typecheck`, which regenerates the routes) have run once. Make `check` build what it needs, or reorder the "Before you finish" command in `AGENTS.md`.
- **Admission control, again.** With five audits queued, one had run no capture after 50 minutes (I started it again) while the engine sat idle between other audits' backoffs. The M2 item above now blocks demos.

## After v0.1

| Version | Scope |
|---|---|
| v0.2 | GTM API, GA4 Admin and Meta connectors (configured vs fired), LinkedIn, agent-driven funnel discovery |
| v0.3 | Scheduled audits, volume-drop alerts, Slack and email notifications. **The cloud launches with billing (Polar or Stripe).** |
| v0.4 | Tracking plan as YAML, drift detection, GitHub Action, typed code generation |
| Later | Chrome extension, CLI parity, Shopify/CRM reconciliation |

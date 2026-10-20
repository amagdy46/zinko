---
type: plan
status: draft
design: ../../vision.md
---

# M1 Capture Plan

**Goal:** Capture a fixture site under each consent scenario, including a short click-through journey, locally and in the `apps/browser` container, and get decoded GA4, Google Ads, Meta and TikTok hits out of it with enough evidence for the M3 rules.
**Approach:** Confirm Scrapling (the user's choice, see the handoff) can do what capture needs with a short spike, then fix one HTTP contract (`POST /capture`) that the engine implements, so fixtures, decoders and the CLI are built against the contract in parallel. Scrapling stays the primary engine; plain Playwright in the same container covers any capability Scrapling lacks. The trade-off: Python joins a TypeScript repo, contained in `apps/browser` behind the contract.

Design sources: `docs/vision.md` (Capture), `docs/product.md` (v0.1 checks), `docs/architecture.md` (open questions), `docs/handoff/2026-10-18-m1-capture.md` (spike brief). Reviewed by GPT-6.1-Sol on 2026-10-20 in two rounds; its findings are folded in.

## Global constraints

- **No unit or integration tests** (`AGENTS.md`, current phase). Every task is verified by running the real thing and reporting the command and what it printed. Each task's "Verify" lines are its acceptance check.
- `pnpm check && pnpm typecheck && pnpm build` pass with zero errors and zero warnings after every task.
- Effect rules from `AGENTS.md`: tagged errors, `Schema` at boundaries, no `any`, no `try/catch` around Effects, layers provided only at entry points.
- Decoders stay plain TypeScript with no Effect (`docs/architecture.md`, "Where Effect goes").
- `packages/*` never import Workers types.
- Python stays inside `apps/browser` with its own lockfile (`uv`), never at the repo root. The image build context stays `apps/browser`, so the engine does not import workspace packages; TypeScript consumers validate its JSON with the contract schemas.
- Fixture traffic never reaches real vendor endpoints: `blockVendorRequests` (Task 4) answers collection requests locally. Spike and manual fixture runs use the same interception.
- Ask the user before pushing, deploying, adding Cloudflare secrets, adding a dependency not named in this plan, or using stealth browsing on a site they haven't approved.
- `TMPDIR=$HOME/.cache/tmp` (`/tmp` is a small tmpfs). Docker needs `sudo` on this machine: never run it yourself; hand the commands to the user.
- When a task finds something that changes the plan or the vision, update `docs/vision.md` in that task.

## Models

| Model | Used for |
|---|---|
| **Opus** | Open questions and contracts other tasks depend on: the spike (1), the contract (3), the engine (4) |
| **Sonnet** | Well-specified code and docs that need judgment: fixtures (2), decoders (5), CLI (6), docs sync (7) |
| **Haiku** | Not used in M1: no task is purely mechanical |
| **GPT-6.1-Sol** | Review partner: reviews each task's diff before it merges |

## Review focus

1. **Consent orchestration.** autoconsent must detect the CMP, the engine snapshots cookies, then triggers the action and waits for autoconsent to report completion. `autoAction` alone acts immediately and skips the snapshot. Verified in Task 1 against the fixture CMP and in Task 4.
2. **Init-script ordering and gtag pushes.** The shim runs before page scripts, and gtag pushes `Arguments` objects, which must be normalized to arrays. Verified in Task 4 with `consent-default-late`.
3. **POST batching.** GA4 sends several events in one POST body and TikTok sends JSON. Verified in Task 4 and Task 6 with `ga4-batch`, which fires three events in one batch.
4. **Partial results.** A failed navigation still returns what was captured, with the missing artifacts marked absent, never an HTTP 500. Verified in Task 4 with an unreachable URL and a `no-cmp` site.
5. **SSRF.** Policy checks on the start URL, every subresource and every redirect, for both engines; DNS answers checked for private addresses; service workers blocked so no request bypasses interception. `ALLOW_PRIVATE_NETWORKS` defaults off. Verified in Task 4.
6. **Resource limits.** Bounded duration, request count and body size per capture; scenarios isolated in fresh browser contexts; child processes killed on timeout. Verified in Task 4.

### Task 1: Spike: what Scrapling can capture

**Model:** Opus
**Files:** create `spikes/m1-capture/` (throwaway scripts and one page `index.html` with an inline `dataLayer.push`, gtag GA4 sending a three-event POST batch, the Meta pixel, and the CMP Task 2 picks), `spikes/m1-capture/RESULTS.md`, `docs/decisions/0002-capture-engine.md`
**Interfaces:** produces decision 0002: which capabilities Scrapling `StealthySession` covers and which fall back to plain Playwright, and how the two are wired in one container
**Blocked by:** none (pick the CMP together with Task 2, or start with Klaro and confirm later)

- [ ] Script the same capture with Scrapling `StealthySession` (Python, `uv run`) and with plain Playwright (Node): init script before page scripts, every request with its POST body, cookies with values, a screenshot, a 390×844 viewport, the autoconsent bridge (detect, snapshot cookies, `optIn` or `optOut`, wait for completion) and service workers blocked
- [ ] Vendor collection requests are intercepted and answered locally in both scripts
- [ ] Verify: each script prints the first `dataLayer` push, the three events in the `/g/collect` POST body, the cookie names before and after consent, the autoconsent result and the screenshot path; paste that output into `RESULTS.md`
- [ ] Write `RESULTS.md`: one row per capability, columns Scrapling and Playwright, cells `yes`, `no` or `workaround: <how>`; record the Scrapling version from PyPI's release list and the memory a capture uses
- [ ] Write decision 0002 (context, decision, alternatives). If Scrapling cannot do request bodies or init scripts at all, stop and ask the user whether to keep it
- [ ] Commit `RESULTS.md` and the decision; leave the scripts uncommitted

The bot-protection comparison on 5 sites is **not** in this task: the user approves the sites first, and the results are appended to `RESULTS.md` later.

### Task 2: Fixture sites

**Model:** Sonnet
**Files:** create `packages/fixtures/` (`package.json` named `@repo/fixtures`, `server.mjs`, `sites/<name>/…`, `vendor/<cmp>/` with its license, `README.md` listing each site, its pages and its known bug)
**Interfaces:** produces `pnpm --filter @repo/fixtures serve` on `http://localhost:4400`, each site at `/<name>/`
**Blocked by:** none

- [ ] Pick the consent banner: a self-hosted open-source CMP that autoconsent has a rule for (check `autoconsent/rules/` first, for example Klaro). If none is detected, ask before writing a custom autoconsent rule
- [ ] Each site wires GA4 (`G-ZINKO00001`), Meta (`100000000000001`), Google Ads (`AW-100000001`) and TikTok (`ZINKOTT0001`) behind the CMP with Google Consent Mode v2, and has a home page, a `/product` page and a `/thank-you` page firing `purchase` with `transaction_id`, `value` and `currency`
- [ ] Sites: `clean` (correct baseline); `meta-before-consent`; `tiktok-after-reject`; `duplicate-purchase` (gtag in the page plus a second `purchase`); `ga4-batch` (three events sent in one POST); `consent-default-late` (`consent default` after the Google tag); `lost-gclid` (a home-page link to `/product` that drops the query string, and `_gcl_aw` never set); `redirect-gclid` (the landing URL redirects through `/r` and drops `gclid`); `delayed-pixel` (Meta `PageView` 2 s after load, whatever the consent); `gpc-echo` (the server returns the `Sec-GPC` header it received and the page shows `navigator.globalPrivacyControl`); `no-cmp` (pixels, no banner). The server also serves `/r?to=<url>` redirects, used to test the SSRF policy
- [ ] `pnpm --filter @repo/fixtures inspect <site> [accept|reject]`: a small Playwright script that opens the site, answers vendor collection requests locally with `204` (the same list as Task 4), clicks the banner and prints every vendor request with its time
- [ ] Verify: `inspect` on `clean` and `meta-before-consent` under accept and reject prints requests that match the README; paste the output

### Task 3: Capture contract

**Model:** Opus
**Files:** create `packages/capture-contract/` (`@repo/capture-contract`, built to `dist` with `tsconfig.build.json` like `packages/decoders`, depends on `effect`); modify `packages/core/src/browser.ts`, `packages/core/src/index.ts`, `apps/web/src/server/browser.ts`, `apps/web/src/server/run-browser.ts`
**Interfaces:** produces Effect Schemas in `@repo/capture-contract`. All times are ms since capture start (one clock per capture).
- `Scenario = "none" | "accept" | "reject" | "gpc"`
- `JourneyStep = { action: "goto", url } | { action: "click", selector }`, at most 5 steps, run in the same browser context after the start URL loads and after the consent action
- `CaptureRequest = { url, scenario, viewport: "desktop" | "mobile", journey?: JourneyStep[], blockVendorRequests?: boolean }`
- `CapturedDocument = { id, url, redirects: string[], startedAt, title: string | null }`, one per top-level navigation
- `CapturedRequest = { id, documentId, url, method, body: string | null, bodyTruncated: boolean, resourceType, status: number | null, startedAt, blocked: boolean }`
- `Cookie = { name, value, domain, path, expires: number | null, secure, httpOnly, sameSite }`; `CookieSnapshot = { at, documentId, label: "before-consent" | "after-consent" | "document-end" | "end", cookies: Cookie[] }` (`document-end` is taken before each journey navigation)
- `ConsentObservation = { at, source: "tcf" | "google" | "cmp", state: unknown }` (TCF from `__tcfapi`, Google from the consent `dataLayer` commands)
- `CaptureResult = { documents, requests, dataLayer: { at, documentId, value: unknown }[], cookies: CookieSnapshot[], consent: { cmp: string | null, outcome: "accepted" | "rejected" | "none" | "not-found", actionAt: number | null, completedAt: number | null, observations: ConsentObservation[] }, screenshot: string | null /* base64 PNG */, complete: boolean, truncated: boolean, errors: { code: "BotBlocked" | "Timeout" | "CmpNotFound" | "Navigation" | "JourneyStep", message, at }[] }`
- `CaptureRejected = { error: "PolicyDenied" | "InvalidRequest", message }`, returned with HTTP 400, distinct from partial failures
- `@repo/core`: `Browser.capture(request: CaptureRequest): Effect<CaptureResult, BrowserError>` replaces `Browser.run`; `BrowserError` carries `CaptureRejected` when the engine refuses a request
**Blocked by:** 1

- [ ] Define the schemas; the Cloudflare layer posts to `http://container/capture` and decodes with `CaptureResult`; `runBrowser` takes a `CaptureRequest`
- [ ] Note in `browser.ts` that base64 screenshots are for M1 only: M2 stores them through `Storage` inside the workflow step, because Workflow step results are capped at 1 MiB
- [ ] Verify: `pnpm build && pnpm typecheck` pass, and a script printing `Schema.decodeUnknownSync(CaptureResult)` on a hand-written sample result succeeds

### Task 4: Capture engine in `apps/browser`

**Model:** Opus
**Files:** modify `apps/browser/src/server.ts`, `apps/browser/src/url-policy.ts`, `apps/browser/Dockerfile`, `apps/browser/package.json`, `apps/browser/package-lock.json`, `infra/alchemy.run.ts` (container instance type); create `apps/browser/src/inject/datalayer-shim.js`, and per decision 0002 `apps/browser/scrapling/` (`pyproject.toml`, `uv.lock`, `capture.py`)
**Interfaces:** consumes the Task 3 contract; produces `POST /capture` (200 `CaptureResult`, 400 `CaptureRejected`), `GET /health`
**Blocked by:** 1, 3; fixtures from 2 for acceptance

- [ ] Shim: wraps `window.dataLayer.push` before page scripts, records `{ at, documentId, value }`, converts `Arguments` objects to arrays, keeps values structured-clone-safe
- [ ] Scenarios, each in a fresh browser context: `none` takes no banner action; `accept` and `reject` run the autoconsent bridge (detect, snapshot `before-consent` cookies, send `optIn` or `optOut`, wait for completion, snapshot `after-consent`); `gpc` sends `Sec-GPC: 1` and sets `navigator.globalPrivacyControl = true`, no banner action. Then the journey, then the `end` snapshot and the screenshot
- [ ] Observation windows: after the initial load, after consent completes, and after each journey step, wait for network idle (cap 5 s) and then a further 3 s quiet window before moving on, so delayed pixels and beacons land in the right phase
- [ ] Consent observations: poll `__tcfapi` and read Google consent commands from the shim at load, after the action and at the end
- [ ] `blockVendorRequests` answers every request to a vendor host with `204` **except scripts** (`resourceType === "script"`), so SDKs still load and nothing is collected: `google-analytics.com` and its subdomains, `googletagmanager.com`, `googleadservices.com`, `google.com` paths under `/rmkt/`, `/ccm/`, `/pagead/` and `/1p-user-list/`, `doubleclick.net` and its subdomains, `facebook.com`, `connect.facebook.net`, `analytics.tiktok.com`. It answers `OPTIONS` preflights with CORS headers and marks the requests `blocked: true`. This is the rule `packages/fixtures/inspect.mjs` already uses; the fixtures showed gtag also sends `rmkt/collect`, `ccm/collect`, `ad.doubleclick.net/ccm/s/collect`, `1p-user-list` and diagnostic pings, so an endpoint list leaks
- [ ] SSRF: the policy applies to the start URL, every subresource and every redirect in both engines; hostnames are resolved and refused if any address is private (DNS rebinding between this check and Chromium's own lookup remains; record it in `apps/browser/src/url-policy.ts` and rely on container egress limits); service workers are blocked; `ALLOW_PRIVATE_NETWORKS` is read from the environment, defaults to `false` and is never set in the Dockerfile
- [ ] Limits: 60 s per capture, 2,000 requests, 64 KB per request body (then `bodyTruncated`), 1,000 `dataLayer` entries, 10 MB total response; `truncated` set when any limit hits; one capture at a time per container (a second gets HTTP 429); the Python process and browser are killed on timeout
- [ ] Failures become `errors` entries with `complete: false`, and the response is still 200 with what was captured
- [ ] Container: set the instance type in `infra/alchemy.run.ts` to fit the memory measured in the spike (the default `lite` is 256 MiB); the Dockerfile installs the Python dependencies from `uv.lock` and the browser Scrapling needs
- [ ] Verify locally: `ALLOW_PRIVATE_NETWORKS=true pnpm --filter browser start`, then `curl` `/capture` for `fixtures/clean` under all four scenarios; paste request counts, `outcome` and cookie names per snapshot
- [ ] Verify the review-focus cases: `consent-default-late` shows the `consent default` push after the gtag script request; `ga4-batch` shows one `/g/collect` request with three events in its body; `no-cmp` returns `CmpNotFound`, `outcome: "not-found"` and non-empty `requests`; `delayed-pixel` under `reject` records the Meta `PageView` the fixture fires 3 s after the consent choice, timed after `completedAt`; `http://10.255.255.1/` without the opt-in returns 400 `PolicyDenied`; with the opt-in off and a public test host, a redirect to a private address is aborted and recorded as `blocked`; an unroutable public address returns 200 with `complete: false` and `screenshot: null` within 65 s
- [ ] Verify the image: give the user the exact `sudo docker build` and `docker run` commands and the `curl` to try. The task is not accepted until the user pastes the container's output for `fixtures/clean` under `accept`

### Task 5: Google Ads and TikTok decoders

**Model:** Sonnet
**Files:** create `packages/decoders/src/providers/google-ads.ts`, `packages/decoders/src/providers/tiktok.ts`, `packages/decoders/samples/<vendor>-<event>.json` (`{ url, method, body }`); modify `packages/decoders/src/types.ts` (`Vendor` gains `"google-ads" | "tiktok"`; `Hit` gains `batchIndex: number`), `packages/decoders/src/providers/ga4.ts` (sets `batchIndex`), `packages/decoders/src/providers/meta.ts` (`batchIndex: 0`), `packages/decoders/src/index.ts`
**Interfaces:** produces `googleAds: Decoder`, `tiktok: Decoder` in `decoders`; every `Hit` carries `batchIndex` (position within its request)
**Blocked by:** none; samples come from public pages that use these tags (record with DevTools, load-only) and are replaced by fixture recordings once Task 2 lands

- [ ] Google Ads matches `googleadservices.com/pagead/conversion/<id>/`, `google.com/rmkt/collect/<id>/`, `google.com/pagead/1p-conversion/<id>/` and `googleads.g.doubleclick.net/pagead/viewthroughconversion/<id>/` (not `ccm/collect`, which repeats events for Consent Mode); `destinationId` is `AW-<id>`, `event` is `conversion` (with `label` in `params`) or `remarketing`; `gclid` to `ids`, `gcs` to `consent` as in `ga4.ts`
- [ ] TikTok matches `analytics.tiktok.com/api/v2/pixel` (JSON POST body); `destinationId` is the pixel code, `event` the event name, `ttclid` and `_ttp` to `ids`, `consent` `unknown` as in `meta.ts`
- [ ] Verify: `node apps/cli/dist/index.js decode <url> --body <body>` on every sample prints the expected vendor, destination, event and `batchIndex`; paste the output

### Task 6: `zinko capture` command

**Model:** Sonnet
**Files:** modify `apps/cli/src/index.ts`, `apps/cli/package.json` (adds `@repo/capture-contract` as a workspace dependency and `effect` from the catalog)
**Interfaces:** consumes `CaptureRequest`, `CaptureResult` (Task 3) and `decode` (Task 5); produces `zinko capture <url> [--scenario none|accept|reject|gpc|all] [--mobile] [--click <selector>]... [--goto <url>]... [--engine http://localhost:8080] [--block-vendors] [--json]`
**Blocked by:** 3 and 5 to build, so it starts alongside Task 4; 2 and 4 for the demo

- [ ] Posts one `CaptureRequest` per scenario (`all` runs the four), validates with `CaptureResult`, decodes every captured request, keeps each hit's request `id` and `batchIndex`
- [ ] Default output per scenario: the consent outcome and when it happened, then a table of hits with time, document, vendor, destination, event and consent, then cookies per snapshot, then `errors`; `--json` prints hits, cookies, consent and errors as JSON, plus `undecoded`: vendor requests no decoder turned into a hit (such as Google `ccm` pings, the only place Ads consent state appears), kept out of hit counts
- [ ] Update the usage text; `zinko audit` stays as is
- [ ] Verify (the M1 demo), with the engine and fixtures running and `--block-vendors`:
  - `meta-before-consent` with `--scenario reject`: a Meta `PageView` timed before the reject action and no Meta hit after it
  - `ga4-batch` with `--scenario accept`: three GA4 hits sharing one request id with `batchIndex` 0, 1, 2
  - `lost-gclid` with `?gclid=TEST` and `--click a[href="/lost-gclid/product"]`: the second document's URL has no `gclid` and no `_gcl_aw` cookie at `end`
  - `gpc-echo` with `--scenario gpc`: the page reports `Sec-GPC: 1` and `navigator.globalPrivacyControl === true`
  - paste all four outputs

### Task 7: Docs in sync

**Model:** Sonnet
**Files:** modify `docs/architecture.md`, `docs/roadmap.md`, `docs/vision.md`, `README.md`, `docs/handoff/2026-10-18-m1-capture.md`
**Blocked by:** 1–6

- [ ] `architecture.md`: replace the Testing section with a pointer to the current-phase rule in `AGENTS.md`; Biome becomes Vite+ (oxlint, oxfmt); `@effect/sql-pg` and the Effect migrator become Drizzle; `apps/capture` becomes `apps/browser`; `packages/fixtures` and `packages/capture-contract` are present; the browser rows match decision 0002; the open questions the spike answered are closed
- [ ] `vision.md`: Capture rows become **working** where Task 6 showed them working; GPC and journeys move to working; the M2 note on storing screenshots through `Storage`
- [ ] `README.md`: the status line and "Try" section mention `zinko capture`
- [ ] Handoff brief: a line at the top saying this plan supersedes it
- [ ] Verify: `pnpm check` passes

## Execution order

```
wave 1:  1 spike (Opus)   2 fixtures (Sonnet)   5 decoders (Sonnet)
wave 2:  3 contract (Opus)                      after 1
wave 3:  4 engine (Opus)   6 CLI (Sonnet)       after 3 (and 5 for 6)
         4 accepted with 2's fixtures; 6's demo needs 2 and 4
wave 4:  7 docs (Sonnet)                        after 1–6
```

Each task runs in its own worktree and merges to `main` after GPT-6.1-Sol reviews its diff and its verify output is pasted.

## Open decisions for the user

- **GPC scenario in M1.** Included; it is one header and one property. Drop it from `Scenario` if not wanted.
- **Deploy trigger.** `.github/workflows/deploy.yml` fails on every push to `main` until Cloudflare secrets exist; switching it to `workflow_dispatch` stops that. Not changed.
- **Bot-protection sites.** The 5 sites for the comparison in Task 1's follow-up.

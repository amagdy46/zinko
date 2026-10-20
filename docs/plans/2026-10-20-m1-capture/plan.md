---
type: plan
status: draft
design: ../../vision.md
---

# M1 Capture Plan

**Goal:** Capture a fixture site under each consent scenario, locally and in the `apps/browser` container, and get decoded GA4, Google Ads, Meta and TikTok hits out of it.
**Approach:** Settle the engine with a short spike first (Scrapling `StealthySession` vs plain Playwright), then fix one HTTP contract (`POST /capture`) that any engine implements, so fixtures, decoders and the CLI are built against the contract in parallel. The trade-off: Scrapling may pass bot protection better but brings Python into a TypeScript repo; the contract keeps that choice reversible.

Design sources: `docs/vision.md` (Capture section), `docs/architecture.md` (open questions), `docs/handoff/2026-10-18-m1-capture.md` (spike brief).

## Global constraints

- **No unit or integration tests** (`AGENTS.md`, current phase). Every task is verified by running the real thing and reporting the command and what it printed. Each task's "Verify" lines are its acceptance check.
- `pnpm check && pnpm typecheck && pnpm build` pass with zero errors and zero warnings after every task.
- Effect rules from `AGENTS.md`: tagged errors, `Schema` at boundaries, no `any`, no `try/catch` around Effects, layers provided only at entry points.
- Decoders stay plain TypeScript with no Effect (`docs/architecture.md`, "Where Effect goes").
- `packages/*` never import Workers types.
- Python, if the spike picks Scrapling, stays inside `apps/browser` with its own lockfile (`uv`), never at the repo root.
- Fixture traffic must not reach real vendor endpoints: the capture engine records vendor requests and fulfills them locally with an empty `204` when `blockVendorRequests` is set (see Task 3). Real audits leave it off.
- Ask the user before pushing, deploying, adding Cloudflare secrets, adding a dependency not named in this plan, or using stealth browsing on a site they haven't approved.
- `TMPDIR=$HOME/.cache/tmp` (`/tmp` is a small tmpfs). Docker needs `sudo` on this machine: never run it yourself; hand the command to the user.

## Models

| Model | Used for |
|---|---|
| **Opus** | Tasks with open questions and cross-language judgment: the spike (1) and the engine (4) |
| **Sonnet** | Well-specified code against a fixed interface: contract (3), fixtures (2), decoders (5), CLI (6) |
| **Haiku** | Mechanical edits with no design decisions: docs sync (7) |

## Review focus

1. **Init-script ordering.** The `dataLayer` shim must run before any page script, or the first `consent default` push is lost. Verified in Task 1 and again in Task 4 against `fixtures/consent-default-late`.
2. **POST bodies.** GA4 batches several events in one POST body and TikTok sends JSON; a missing body silently drops hits. Verified in Task 4 by decoding the `duplicate-purchase` fixture (expects 2 `purchase` hits).
3. **CMP not detected.** autoconsent only knows real CMPs; a home-made banner yields `CmpNotFound`, not a crash. Verified in Task 2 (fixture CMP detected) and Task 4 (`no-cmp` fixture returns the error code and still returns requests).
4. **SSRF policy vs localhost fixtures.** The container blocks private addresses; local runs need an explicit opt-in that is off in the image. Verified in Task 4.
5. **Partial failure.** A timeout or bot block returns a result with `errors`, not an HTTP 500. Verified in Task 4 with an unreachable URL.

### Task 1: Spike: which engine can capture

**Model:** Opus
**Files:** create `spikes/m1-capture/` (throwaway scripts, one page `index.html` with an inline `dataLayer.push`, gtag GA4 sending a POST batch, and the Meta pixel), `spikes/m1-capture/RESULTS.md`, `docs/decisions/0002-capture-engine.md`
**Interfaces:** produces decision 0002: the engine (`scrapling` or `playwright`) and any capability that needs the other engine as fallback
**Blocked by:** none

- [ ] Script the same capture twice, with Scrapling `StealthySession` (Python, `uv run`) and with plain Playwright (Node): init script before page scripts, every request with its POST body, cookies, a screenshot, a 390×844 mobile viewport, and the autoconsent Playwright build (`@duckduckgo/autoconsent/dist/autoconsent.playwright.js`) injected
- [ ] Verify: each script prints the first `dataLayer` push, the `/g/collect` POST body, the cookie names and the screenshot path; paste that output into `RESULTS.md`
- [ ] Write `RESULTS.md`: one row per capability (init script, POST bodies, cookies, screenshot, viewport, autoconsent), columns Scrapling and Playwright, cells `yes`, `no` or `workaround: <how>`; also record the Scrapling version from PyPI's release list
- [ ] Write decision 0002 (context, decision, alternatives) naming the engine. If neither engine covers a capability, stop and ask the user
- [ ] Commit `RESULTS.md` and the decision; leave the scripts uncommitted

Bot-protection comparison on 5 sites is **not** in this task: it needs the user to approve the sites, and it is appended to `RESULTS.md` later.

### Task 2: Fixture sites

**Model:** Sonnet
**Files:** create `packages/fixtures/` (`package.json` named `@repo/fixtures`, `server.mjs`, `sites/<name>/index.html` and further pages per site, `README.md` listing each site and its known bug)
**Interfaces:** produces `pnpm --filter @repo/fixtures serve` on `http://localhost:4400`, each site at `/<name>/`
**Blocked by:** none

- [ ] Pick the consent banner: a self-hosted open-source CMP that autoconsent has a rule for (check `autoconsent/rules/` first, for example Klaro). Vendor its files into `packages/fixtures/vendor/` with its license. If none is detected, ask before writing a custom autoconsent rule
- [ ] Build the sites, each wiring GA4 (`G-ZINKO00001`), Meta (`100000000000001`), Google Ads (`AW-100000001`) and TikTok (`ZINKOTT0001`) behind the CMP with Google Consent Mode v2: `clean` (correct baseline), `meta-before-consent`, `tiktok-after-reject`, `duplicate-purchase` (gtag in the page plus a second `purchase` push), `consent-default-late` (`consent default` after the Google tag), `lost-gclid` (a link to `/checkout` that drops the query string), `no-cmp` (pixels, no banner)
- [ ] Each site has a home page and a `/thank-you` page firing `purchase` with `transaction_id`, `value` and `currency`
- [ ] Verify: run the server, open `clean` and `meta-before-consent` in a browser, click accept and reject on the banner, and confirm in DevTools that the requests match the README's description

### Task 3: Capture contract

**Model:** Sonnet
**Files:** modify `packages/core/src/browser.ts`, `packages/core/src/index.ts`, `apps/web/src/server/browser.ts`, `apps/web/src/server/run-browser.ts`
**Interfaces:** produces, in `@repo/core`:
- `Scenario = Schema.Literals(["none", "accept", "reject", "gpc"])`
- `CaptureRequest = Schema.Struct({ url, scenario: Scenario, viewport: Schema.Literals(["desktop", "mobile"]), blockVendorRequests: Schema.optional(Schema.Boolean) })`
- `CapturedRequest = { url, method, body: string | null, resourceType, status: number | null, startedAt: number }` (`startedAt` in ms since navigation start)
- `CaptureResult = { finalUrl, title, requests: CapturedRequest[], dataLayer: { at: number, value: unknown }[], cookies: { beforeConsent: Cookie[], afterConsent: Cookie[] }, consent: { cmp: string | null, outcome: "accepted" | "rejected" | "none" | "not-found" }, screenshot: string /* base64 PNG */, errors: { code: "BotBlocked" | "Timeout" | "CmpNotFound" | "Navigation", message: string }[] }` with `Cookie = { name, domain, path, expires: number | null }`
- `Browser.capture(request: CaptureRequest): Effect<CaptureResult, BrowserError>` replacing `Browser.run`
**Blocked by:** 1 (the spike may show a field cannot be filled)

- [ ] Define the schemas and replace `run` with `capture` on the `Browser` service; the Cloudflare layer posts to `http://container/capture` and decodes the response with `CaptureResult`
- [ ] `runBrowser` takes a `CaptureRequest` and returns the `CaptureResult`
- [ ] Verify: `pnpm typecheck` passes across the workspace

### Task 4: Capture engine in `apps/browser`

**Model:** Opus
**Files:** modify `apps/browser/src/server.ts`, `apps/browser/Dockerfile`, `apps/browser/package.json`; create `apps/browser/src/inject/datalayer-shim.js`; if decision 0002 picks Scrapling, create `apps/browser/scrapling/` (`pyproject.toml`, `uv.lock`, `capture.py`) and have `server.ts` call it, or replace the Node server, as the decision says
**Interfaces:** consumes the Task 3 contract; produces `POST /capture` returning `CaptureResult` JSON, `GET /health`
**Blocked by:** 1, 3

- [ ] Shim: wraps `window.dataLayer.push` before page scripts and records `{ at, value }`, structured-clone-safe
- [ ] Per scenario: `none` captures with no banner interaction; `accept` and `reject` run autoconsent with `{ autoAction: "optIn" | "optOut" }`, record cookies before and after; `gpc` sends `Sec-GPC: 1` and defines `navigator.globalPrivacyControl = true`, no banner interaction
- [ ] Wait for network idle after the consent action (cap 10 s), then screenshot
- [ ] `blockVendorRequests` fulfills requests to vendor hosts (`google-analytics.com`, `googletagmanager.com/g/collect`, `googleadservices.com`, `doubleclick.net`, `facebook.com/tr`, `analytics.tiktok.com`) with `204` after recording them
- [ ] Private networks: `ALLOW_PRIVATE_NETWORKS` read from the environment, default `false`, never set in the Dockerfile
- [ ] Failures become entries in `errors` and the response is still `200` with whatever was captured
- [ ] Verify locally: `ALLOW_PRIVATE_NETWORKS=true pnpm --filter browser start`, then `curl` `/capture` for `fixtures/clean` under all four scenarios; paste request counts, the `outcome` and cookie names per scenario
- [ ] Verify the review-focus cases: `consent-default-late` shows the `consent` push after the gtag script request; `no-cmp` returns `CmpNotFound` and a non-empty `requests`; `http://10.255.255.1/` returns `Timeout` or `Navigation` in `errors` within 40 s
- [ ] Verify the image: write the exact `sudo docker build` and `docker run` commands for the user to run, and the `curl` to try against it

### Task 5: Google Ads and TikTok decoders

**Model:** Sonnet
**Files:** create `packages/decoders/src/providers/google-ads.ts`, `packages/decoders/src/providers/tiktok.ts`, `packages/decoders/samples/<vendor>-<event>.json` (`{ url, method, body }` recorded from the fixtures or a real request); modify `packages/decoders/src/types.ts` (`Vendor` gains `"google-ads" | "tiktok"`), `packages/decoders/src/index.ts`
**Interfaces:** produces `googleAds: Decoder`, `tiktok: Decoder`, both in `decoders`
**Blocked by:** none (record samples from Task 2's fixtures once it lands, or from public pages before then)

- [ ] Google Ads matches `googleadservices.com/pagead/conversion/<id>/`, `google.com/pagead/1p-conversion/<id>/` and `googleads.g.doubleclick.net/pagead/viewthroughconversion/<id>/`; `destinationId` is `AW-<id>`, `event` is `conversion` (with `label` in `params`) or `remarketing`; `gclid` and `gcs` go to `ids` and `consent` as in `ga4.ts`
- [ ] TikTok matches `analytics.tiktok.com/api/v2/pixel` (JSON POST body); `destinationId` is the pixel code, `event` the event name, `ttclid` and `_ttp` to `ids`, `consent` `unknown` as in `meta.ts`
- [ ] Verify: `node apps/cli/dist/index.js decode` on every sample prints the expected vendor, destination and event; paste the output

### Task 6: `zinko capture` command

**Model:** Sonnet
**Files:** modify `apps/cli/src/index.ts`, `apps/cli/package.json` (add `@repo/core` and `effect` as workspace/catalog dependencies)
**Interfaces:** consumes `CaptureRequest`, `CaptureResult` (Task 3) and `decode` (Task 5); produces `zinko capture <url> [--scenario none|accept|reject|gpc|all] [--mobile] [--engine http://localhost:8080] [--block-vendors] [--json]`
**Blocked by:** 3 and 5 to build; 2 and 4 for the demo

- [ ] Posts one `CaptureRequest` per scenario (`all` runs the four), validates the response with `CaptureResult`, decodes every captured request
- [ ] Default output: one table per scenario with vendor, destination, event, consent and the time of the hit, then the CMP outcome and any `errors`; `--json` prints the decoded hits and errors as JSON
- [ ] Update the usage text; `zinko audit` stays as is
- [ ] Verify (the M1 demo): with the engine and fixtures running, `zinko capture http://localhost:4400/meta-before-consent/thank-you --scenario all --block-vendors` shows Meta `Purchase` under `none` and none of it under `reject`; `duplicate-purchase` shows two GA4 `purchase` hits under `accept`; paste both outputs

### Task 7: Docs in sync

**Model:** Haiku
**Files:** modify `docs/architecture.md`, `docs/roadmap.md`, `docs/vision.md`, `README.md`, `docs/handoff/2026-10-18-m1-capture.md`
**Blocked by:** 1–6

- [ ] `architecture.md`: replace the Testing section with a pointer to the current-phase rule in `AGENTS.md`; Biome becomes Vite+ (oxlint, oxfmt); `@effect/sql-pg` and the Effect migrator become Drizzle; `apps/capture` becomes `apps/browser`; `packages/fixtures` moves from planned to present; the engine row matches decision 0002
- [ ] `vision.md`: Capture rows become **working** where Task 6 showed them working; GPC moves from proposed to working; record anything the spike changed
- [ ] `README.md`: the status line and "Try" section mention `zinko capture`
- [ ] Handoff brief: add a line at the top saying it is superseded by this plan
- [ ] Verify: `pnpm check` passes (formatting of the Markdown)

## Execution order

```
1 (Opus) ──┬─> 3 (Sonnet) ─> 4 (Opus) ─┐
2 (Sonnet) ┤                            ├─> 6 (Sonnet) ─> 7 (Haiku)
5 (Sonnet) ┴────────────────────────────┘
```

Tasks 1, 2 and 5 run in parallel, each in its own worktree. 3 starts when 1 lands; 4 after 3; 6 needs 3, 4 and 5 for its demo; 7 last.

## Before execution

- The working tree on `main` has uncommitted changes (test removal, `AGENTS.md`, `docs/vision.md`, this plan). Worktrees start from the last commit, so they must be committed first.
- `.github/workflows/deploy.yml` fails on every push to `main` until Cloudflare secrets exist; switching it to `workflow_dispatch` stops that.

# Regression after Task 0 and the gate-review fixes (2026-10-29)

Code under test: branch `vendors/spike` rebased on `main` (`cfb6ce8`), with the narrowed `vendors.json`, the
`content-encoding` pass-through in `apps/browser/src/egress-proxy.ts` and the gunzip in
`apps/browser/scrapling/capture.py` (see below). CLI built from the same tree. Every run: 55 fixtures x
`/` and `/thank-you` x `none`, `accept`, `reject`, `gpc` (`baseline/capture.sh`, `--scenario all --rules --block-vendors`),
a fresh fixtures server per run (so `drift` and `flaky-meta` start in their initial state; nobody POSTs a release),
three engines per run because an engine takes one capture at a time. Compared: engine, page status, consent outcome
and every rule status (the committed files hold nothing else). 440 scenario runs per set.

| Run | Engine / code | Files | Result |
|---|---|---|---|
| committed `baseline/` | Scrapling, code before Task 0 (`72063f4`) | 110 | reference |
| Scrapling, narrowed config, before the Reddit fix | Scrapling, this branch | 110 | 1 difference: `consent-subdomain/thank-you`, `accept`, `dedup.tiktok-eventid-missing` pass -> not_applicable (no TikTok hit in that capture). Three reruns each on the old engine and the new engine gave `pass`; the run had load average 9 (two full runs in parallel). A missed hit under load, not a code effect. |
| Scrapling, final code | Scrapling, this branch | 110 | **0 differences** from the committed baseline (all four scenarios, both pages, engine, page status, consent outcome, 28 rules each). |
| `baseline-playwright/pre-task0/` | Playwright, code at `b896b87` (no Task 0), run from a temporary detached worktree (removed clean afterwards; `apps/browser/node_modules` symlinked) | 110 | 0 differences from the Scrapling baseline apart from the `engine:` line. |
| `baseline-playwright/post-fix/` | Playwright, final code | 110 | 0 differences from `pre-task0/`, after two replaced files (below). |

Playwright, final code, first pass: two initial differences; targeted reruns matched. `consent-cmp-404/home` and `meta-no-eventid/home` had consent outcome `none` in the `accept` scenario (the banner click did not complete) and every rule `inconclusive`. Six targeted reruns (three per site) were identical to `pre-task0/`. Both sets of files are kept: `post-fix-initial/` holds the two original outputs and `post-fix/` holds the rerun in their place. A capture that cannot complete the CMP click degrades to `inconclusive`, which is what the engine is for.

## What the regression found (and fixed)

Reddit's `pixel.js` is served gzip-compressed even when the request says `accept-encoding: identity`. The engines hand SDK
files to the browser through the egress proxy's `/sdk` endpoint, which dropped `content-encoding`, so the browser executed
compressed bytes: `Script error.`, no `rdt.sendEvent`, no Reddit hit. The first Task 0 verification looked only at the status (200)
and a harness that fetched the SDK with the browser's own network stack, so it missed this. Fixes: `content-encoding` is passed on by the
proxy (Playwright engine), and the Scrapling engine gunzips a gzip SDK body itself because Chromium under patchright did not decode a
fulfilled gzip response. After the fix both engines send `GET pixel-config.reddit.com/...` and `POST alb.reddit.com/rp`.
This affects only SDK files that arrive compressed; the Google, Meta and TikTok files do not, and the 0-difference runs above were taken after the fix.

## Interception probes (final code, both engines)

`eng.mjs ... /probe-deps` (page with the vendors' own sites' dependencies and the tracking requests):

| Request | Scrapling | Playwright |
|---|---|---|
| `www.linkedin.com/`, `www.pinterest.com/`, `www.snapchat.com/` (fetch) | 200, `blocked=false` | 200, `blocked=false` |
| `www.reddit.com/` (fetch) | 200, `blocked=false` | 403 from Reddit, `blocked=false` |
| `www.bing.com/maps` (iframe document) | 200, `blocked=false` | 200, `blocked=false` |
| `i.pinimg.com/favicons/pinterest.png` (image) | `blocked=false`, no status | `blocked=false`, no status |
| `px.ads.linkedin.com/collect`, `bat.bing.com/action/0`, `ct.pinterest.com/v3/`, `alb.reddit.com/rp`, `tr.snapchat.com/p` | 204, `blocked=true` | 204, `blocked=true` |

Top-level documents captured with `--block-vendors`: `https://www.bing.com/maps` -> document 200, "Bing Maps - Directions, trip planning ..." (both engines, `r.bing.com` scripts load);
`https://www.linkedin.com/` -> document 200 (Playwright after a 307), "LinkedIn: Log In or Sign Up", `static.licdn.com` assets load.
Under the earlier whole-domain list (`linkedin.com`, `licdn.com`, `bing.com`, `reddit.com`, `pinimg.com`) those requests would have been answered with 204.

`eng.mjs ... /probe` (preflights, redirects, unlisted paths, beacons on the five tracking hosts): every request is `blocked=true` with a local
204; the redirect hops to `px.ads.linkedin.com` and `alb.reddit.com` through the fixtures' `/r?to=` are refused (status null), and the
egress line of both engines is `contacted localhost:4437 localhost:4410; refused ... https://px.ads.linkedin.com https://alb.reddit.com`.
The normal page run contacts only the SDK hosts (`bat.bing.com snap.licdn.com www.redditstatic.com sc-static.net s.pinimg.com`) and the proxy lists `https://tr.snapchat.com` as refused.
`dc.ads.linkedin.com` and `bat.r.msn.com`, never observed, were removed from the list and from the probe.

## Round 2: one decode in the SDK proxy

`apps/browser/src/egress-proxy.ts` now decodes an SDK body once (`decodeSdk`: gzip, brotli, deflate as zlib or raw, at most 8 MB decoded) and serves identity
bytes with `content-length` and no `content-encoding` to both engines; both engines fetch SDK files only through this `/sdk` endpoint, so `capture.py` has no gunzip any more.
A body that cannot be decoded, or an encoding the proxy does not know, is a `502` from the proxy: the page sees a failed script load (`onerror`) and the capture records the request with status 502.
The Python handler catches any exception and the Playwright handler aborts when reading the body fails, so a route is never left pending.

Probe (`spike-evidence/encoding-server.mjs`: a local https server on `127.0.0.1:4450` serving a one-line script under each encoding, a temporary SDK exception and `NODE_EXTRA_CA_CERTS` for its self-signed
certificate, both reverted; a page loads all eight scripts and reports `onload`/`onerror`). Same result on Scrapling and on Playwright:

| Served as | Proxy answer | Page |
|---|---|---|
| identity | 200 | script ran |
| `content-encoding: gzip` | 200 | ran |
| `br` | 200 | ran |
| `deflate` (zlib) | 200 | ran |
| `deflate` (raw stream) | 200 | ran |
| gzip, last 12 bytes cut | 502 | load failed (`onerror`) |
| `br` with garbage bytes | 502 | load failed |
| `compress` (unsupported) | 502 | load failed |

Short regression after the change (Meta, TikTok and GA4 SDK fixtures: `clean`, `meta-before-consent`, `tiktok-after-reject`, `duplicate-purchase`, `pii-in-url`, `lost-gclid`, `delayed-pixel`, `ga4-batch`; both pages, four scenarios, both engines, four captures in parallel):
the second full pass had 0 status differences on either engine (64 scenario runs each; Scrapling against the committed baseline, Playwright against `baseline-playwright/pre-task0/`).
The first pass had three files with differences (Scrapling `meta-before-consent/home`; Playwright `clean/home` and `lost-gclid/thank-you`, `tiktok-after-reject/thank-you` for `gpc`/`reject`) in which no Google hit was captured, so the Google-based rules read not applicable or inconclusive; twelve targeted reruns of those
files, three each, were identical to the references. Like the earlier Playwright pair, those are missed captures under four parallel browsers, not a code effect.

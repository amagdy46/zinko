# M1 spike: what Scrapling can capture

Date: 2026-10-20. Task 1 of `docs/plans/2026-10-20-m1-capture/plan.md`.

## Setup

- **Scrapling 0.5**, released 2026-10-17. Taken from the PyPI release history (`pypi.org/project/scrapling/#history`), where the next-newest release is 0.4.15 (2026-08-23). "0.5" is the real version, not a truncated value from the JSON API. Installed with `uv add 'scrapling[fetchers]'`, which brings patchright 1.64.1 and playwright 1.64.0 (Python). Patchright's Chromium is build 1248 (Chrome for Testing 156), installed with `uv run patchright install chromium` and no sudo. Python 3.13.11.
- **Plain Playwright 1.64.1** (Node 26.12), the same version `apps/browser` pins.
- **CMP: Klaro 0.7.21** (BSD-3-Clause, self-hosted from `vendor/klaro.js`). `@duckduckgo/autoconsent` 16.57.0 handles it with a built-in code rule, `lib/cmps/klaro.ts` (name `Klaro`). That rule lives in the code, not in the `rules/autoconsent/*.json` files. It detects `.klaro > .cookie-notice`, opts in by clicking, and opts out through Klaro's JS API (`EVAL_KLARO_TRY_API_OPT_OUT`), falling back to clicks.
- **Page:** `index.html`, served by `python3 -m http.server 4410 --bind 127.0.0.1`. It has:
  - an inline `dataLayer.push` before anything else;
  - gtag commands (consent default denied, config `G-ZINKO00001`, `view_item`, `add_to_cart`);
  - the Meta pixel base code, gated by Klaro;
  - a Klaro banner whose callbacks send `gtag('consent','update',…)`;
  - a service worker registration.
- **gtag.js and fbevents.js are local stand-ins** (`vendor/gtag-stub.js`, `vendor/fbevents-stub.js`), so the spike never loads a third-party site. The stub sends the three events as one `sendBeacon` POST to `https://www.google-analytics.com/g/collect` (one event per body line, as GA4 batches them). The Meta stub sends an image GET to `https://www.facebook.com/tr/`.
- **Vendor interception:** `context.route` answers the Task 4 collection-endpoint list with `204` and CORS headers. As a second guard, both browsers launch with `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1`, so a missed route fails DNS instead of reaching Google or Meta.
- **Scripts:**
  - `capture_scrapling.py`: `StealthySession` with `init_script`, `additional_args`, `extra_flags`, `page_setup` and `page_action`.
  - `capture-playwright.mjs`: the same capture in plain Playwright.
  - `capture_scrapling_async.py`: `AsyncStealthySession` driving a page from `session.context` directly (no `fetch()`), run against the real fixtures (see the last section).
  - `measure.py`: runs a command and samples the summed PSS and RSS of its whole process tree every 100 ms.

## Results

| Capability                                                                                                  | Scrapling `StealthySession`                                                                                                                                                                                                                                                                                                                                                                                                     | Playwright                                                       |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Init script before page scripts                                                                             | yes (`init_script=<path>`; runs in the main world, and the page's first script saw `window.__zinko`)                                                                                                                                                                                                                                                                                                                            | yes (`context.addInitScript`)                                    |
| `Arguments` from gtag normalized to arrays                                                                  | yes (in the shim)                                                                                                                                                                                                                                                                                                                                                                                                               | yes (in the shim)                                                |
| Every request with its POST body                                                                            | workaround: `page_setup` attaches `context.on("request")` and reads `request.post_data` (patchright Playwright API). Scrapling's own `record_requests` only keeps _finished_ requests, so do not rely on it.                                                                                                                                                                                                                    | yes (`context.on("request")`, `postData()`)                      |
| Three GA4 events in one `/g/collect` POST body (stub)                                                       | yes                                                                                                                                                                                                                                                                                                                                                                                                                             | yes                                                              |
| Three GA4 events in one `/g/collect` POST body (real gtag.js, `fixtures/ga4-batch`)                         | yes (async run)                                                                                                                                                                                                                                                                                                                                                                                                                 | not rerun here; the fixtures' own Playwright `inspect` covers it |
| Real CMP from the fixtures (`cookieconsent3`) detected, action sent, completion received                    | yes (async run, accept and reject)                                                                                                                                                                                                                                                                                                                                                                                              | not rerun here; the CMP is the same code under both engines      |
| Cookies with values before and after consent                                                                | yes (`page.context.cookies()` inside `page_action`)                                                                                                                                                                                                                                                                                                                                                                             | yes (`context.cookies()`)                                        |
| Screenshot                                                                                                  | yes (`page.screenshot` inside `page_action`)                                                                                                                                                                                                                                                                                                                                                                                    | yes                                                              |
| 390×844 viewport                                                                                            | workaround: `additional_args={"viewport":…, "screen":…, "is_mobile":True, "has_touch":True, "device_scale_factor":3}` overrides Scrapling's fixed 1920×1080                                                                                                                                                                                                                                                                     | yes (`newContext` options)                                       |
| Autoconsent bridge (detect, cookie snapshot, `optIn`/`optOut`, wait for `autoconsentDone`), no `autoAction` | workaround: `page.expose_binding` in `page_setup`. Answering autoconsent from _inside_ the binding callback deadlocks the sync API, so messages are queued and answered by a pump loop. With `AsyncStealthySession` the callback answers inline and no queue is needed (fixture runs below). Evaluate with `isolated_context=False`, because patchright defaults to an isolated world and Klaro's opt-out calls `window.klaro`. | yes (`exposeBinding`, answered inline)                           |
| Service workers blocked                                                                                     | workaround: `additional_args={"service_workers": "block"}`. Scrapling hard-codes `"allow"`.                                                                                                                                                                                                                                                                                                                                     | yes (`serviceWorkers: "block"`)                                  |
| Vendor collection requests answered locally with 204                                                        | yes (`context.route`, `route.fulfill(status=204)`; match the collection path whatever the resource type, see the fixture findings)                                                                                                                                                                                                                                                                                              | yes (`context.route`)                                            |
| Fresh browser context per scenario                                                                          | workaround: one `StealthySession` per scenario. The default mode is a single persistent context, so each scenario costs a browser launch.                                                                                                                                                                                                                                                                                       | yes (`browser.newContext()`)                                     |
| Memory per capture, spike page (peak, whole process tree)                                                   | peak PSS 567–573 MiB; peak summed RSS ~1.3 GiB; 12 processes                                                                                                                                                                                                                                                                                                                                                                    | peak PSS 311–313 MiB; peak summed RSS ~610 MiB; 7 processes      |
| Memory per capture, real fixtures (async)                                                                   | peak PSS 605–636 MiB; peak summed RSS ~1.36–1.40 GiB                                                                                                                                                                                                                                                                                                                                                                            | not measured                                                     |

Notes:

- **PSS and summed RSS are different measures, not a range.** PSS splits shared pages between processes and is the better estimate of what the tree costs. Summed RSS counts shared pages once per process and overstates it. Container memory is measured in Task 4.
- With service workers allowed, both engines reported `register: "registered:worker", controller: true` (control runs with `SW=allow`). With them blocked, registration never settles (`"pending"`) and no worker controls the page, so no request can bypass `route`.
- Scrapling's `page_action` only starts after its own `load` and `networkidle` wait, so the autoconsent messages queued during navigation are answered late. The CMP was detected at ~1.2 s (Playwright: ~0.2 s), and the opt-out took ~1 s instead of ~5 ms because of the 100 ms polling pump. For the engine, drive the patchright page directly instead of relying on `fetch()`'s lifecycle (see decision 0002).
- Scrapling's memory is higher because it launches the full Chromium build in new headless mode (`channel="chromium"`) with stealth flags and WebGL, plus Python and the patchright Node driver. Plain Playwright uses `chromium-headless-shell`. These numbers are for a tiny page; real sites will use more.
- A variant run with `WORLD=isolated` (the bridge evaluates in patchright's isolated world) still opted in, because opt-in is click-based. Opt-out through Klaro's API needs the main world, so use `isolated_context=False`.

## Evidence

Commands, run from `spikes/m1-capture/` with the page server up:

```
python3 measure.py node capture-playwright.mjs accept
python3 measure.py .venv/bin/python capture_scrapling.py accept
python3 measure.py node capture-playwright.mjs reject
python3 measure.py .venv/bin/python capture_scrapling.py reject
```

### Playwright, accept

```
autoconsent.detected: {"cmp":"Klaro","at":195}
cookies.before: []
autoconsent.action: {"action":"optIn","actionAt":593,"result":true,"doneAt":600}
vendor.response: 204 POST https://www.google-analytics.com/g/collect?v=2&tid=G-ZINKO00
vendor.response: 204 GET https://www.facebook.com/tr/?id=100000000000001&ev=PageView&
cookies.after: ["klaro=%7B%22google-analytics%22%3Atrue%2C%22meta%22%3Atrue%7D","_ga=GA1.1.812197697.1792496849","_fbp=fb.1.1792496849072.375491544"]
shim.ranBeforePage: true
dataLayer.first: {"at":10,"value":{"event":"page_meta","page_type":"product","sku":"ZK-1"}}
dataLayer.gtagPush: {"at":10,"value":["consent","default",{"ad_storage":"denied","analytics_storage":"denied","ad_user_data":"denied","ad_personalization":"denied","wait_for_update":500}]}
dataLayer.count: 18
viewport: 390x844@3
serviceWorker: {"register":"pending","controller":false}
ga4.request: POST https://www.google-analytics.com/g/collect?v=2&tid=G-ZINKO00001&gtm=45je0&_p=1792496849065...
ga4.body.events: ["en=page_view","en=view_item","en=add_to_cart"]
meta.request: GET https://www.facebook.com/tr/?id=100000000000001&ev=PageView&dl=http%3A%2F%2F127.0.0.1%3A44...
requests.total: 6
requests.withBody: 1
vendor.intercepted: 2
screenshot: /home/pokerface/Documents/Projects/zinko.agent-afa1666eb48b26139/spikes/m1-capture/out/playwright-optIn.png
memory: peak PSS 313 MiB, peak RSS 607 MiB, 7 processes, wall 4.0 s, exit 0
```

### Scrapling, accept

```
autoconsent.detected: {"cmp": "Klaro", "at": 1241, "error": null}
cookies.before: []
autoconsent.action: {"action": "optIn", "actionAt": 1242, "result": true, "doneAt": 1247, "error": null}
vendor.response: 204 POST https://www.google-analytics.com/g/collect?v=2&tid=G-ZINKO00
vendor.response: 204 GET https://www.facebook.com/tr/?id=100000000000001&ev=PageView&
cookies.after: ["klaro=%7B%22google-analytics%22%3Atrue%2C%22meta%22%3Atrue%7D", "_ga=GA1.1.751546583.1792496853", "_fbp=fb.1.1792496853599.4986832700"]
shim.ranBeforePage: true
dataLayer.first: {"at": 18, "value": {"event": "page_meta", "page_type": "product", "sku": "ZK-1"}}
dataLayer.gtagPush: {"at": 18, "value": ["consent", "default", {"ad_storage": "denied", "analytics_storage": "denied", "ad_user_data": "denied", "ad_personalization": "denied", "wait_for_update": 500}]}
dataLayer.count: 16
viewport: 390x844@3
serviceWorker: {"register": "pending", "controller": false}
ga4.request: POST https://www.google-analytics.com/g/collect?v=2&tid=G-ZINKO00001&gtm=45je0&_p=1792496853593...
ga4.body.events: ["en=page_view", "en=view_item", "en=add_to_cart"]
meta.request: GET https://www.facebook.com/tr/?id=100000000000001&ev=PageView&dl=http%3A%2F%2F127.0.0.1%3A44...
requests.total: 6
requests.withBody: 1
vendor.intercepted: 2
screenshot: /home/pokerface/Documents/Projects/zinko.agent-afa1666eb48b26139/spikes/m1-capture/out/scrapling-optIn.png
[2026-10-20 14:47:36] INFO: Fetched (200) <GET http://127.0.0.1:4410/index.html> (referer: None)
memory: peak PSS 573 MiB, peak RSS 1310 MiB, 12 processes, wall 4.6 s, exit 0
```

### Playwright, reject

```
autoconsent.detected: {"cmp":"Klaro","at":184}
cookies.before: []
autoconsent.action: {"action":"optOut","actionAt":592,"result":true,"doneAt":596}
cookies.after: ["klaro=%7B%22google-analytics%22%3Afalse%2C%22meta%22%3Afalse%7D"]
shim.ranBeforePage: true
dataLayer.first: {"at":9,"value":{"event":"page_meta","page_type":"product","sku":"ZK-1"}}
dataLayer.gtagPush: {"at":9,"value":["consent","default",{"ad_storage":"denied","analytics_storage":"denied","ad_user_data":"denied","ad_personalization":"denied","wait_for_update":500}]}
dataLayer.count: 16
viewport: 390x844@3
serviceWorker: {"register":"pending","controller":false}
requests.total: 3
requests.withBody: 0
vendor.intercepted: 0
screenshot: /home/pokerface/Documents/Projects/zinko.agent-afa1666eb48b26139/spikes/m1-capture/out/playwright-optOut.png
memory: peak PSS 311 MiB, peak RSS 613 MiB, 7 processes, wall 4.1 s, exit 0
```

### Scrapling, reject

```
autoconsent.detected: {"cmp": "Klaro", "at": 1385, "error": null}
cookies.before: []
autoconsent.action: {"action": "optOut", "actionAt": 1387, "result": true, "doneAt": 2390, "error": null}
cookies.after: ["klaro=%7B%22google-analytics%22%3Afalse%2C%22meta%22%3Afalse%7D"]
shim.ranBeforePage: true
dataLayer.first: {"at": 15, "value": {"event": "page_meta", "page_type": "product", "sku": "ZK-1"}}
dataLayer.gtagPush: {"at": 15, "value": ["consent", "default", {"ad_storage": "denied", "analytics_storage": "denied", "ad_user_data": "denied", "ad_personalization": "denied", "wait_for_update": 500}]}
dataLayer.count: 18
viewport: 390x844@3
serviceWorker: {"register": "pending", "controller": false}
requests.total: 3
requests.withBody: 0
vendor.intercepted: 0
screenshot: /home/pokerface/Documents/Projects/zinko.agent-afa1666eb48b26139/spikes/m1-capture/out/scrapling-optOut.png
[2026-10-20 14:47:46] INFO: Fetched (200) <GET http://127.0.0.1:4410/index.html> (referer: None)
memory: peak PSS 567 MiB, peak RSS 1304 MiB, 12 processes, wall 5.8 s, exit 0
```

### Service worker control runs (`SW=allow`, reject)

```
playwright: serviceWorker: {"register":"registered:worker","controller":true}
scrapling:  serviceWorker: {"register": "registered:worker", "controller": true}
```

Both screenshots are 1170×2532 PNGs (390×844 at 3×), with the banner gone after the action.

## Against the real fixtures (`packages/fixtures`, async Scrapling)

These runs use `pnpm --filter @repo/fixtures serve` (`http://localhost:4400`) after the fixtures and decoders were merged, and `capture_scrapling_async.py`:

- `AsyncStealthySession` with the same `init_script` and `additional_args`;
- the page opened from `session.context`;
- the autoconsent binding answered inline;
- `isolated_context=False` throughout.

The fixtures load the real SDKs (gtag.js, fbevents.js, the TikTok pixel) from their CDNs, so the host-resolver guard is off for these runs. Every request matching a collection path is answered `204` **whatever its resource type**. Any other non-script request to a vendor host (`google.com/rmkt/collect`, `google.com/ccm/collect`, `ad.doubleclick.net/ccm/s/collect`) is also answered locally and marked `stray`.

Findings:

- **Real gtag sends script-typed requests to a collection path.** `googleads.g.doubleclick.net/pagead/viewthroughconversion/…` was requested as `script` (three times on `ga4-batch`) as well as `image`. A rule that lets every script through leaks these to Google. Block collection paths regardless of resource type, and exempt only SDK script URLs.
- **GA4 batches on a timer of about 5 s.** On `ga4-batch`, the first `/g/collect` (`page_view` in the URL, empty body) left at ~1.7 s, right after consent. The three-event POST left ~5 s later, at 6.7 s. With the plan's 3 s quiet window it was missed: a first run with the 3 s wait saw only the `page_view` request. Network idle does not help, because nothing is in flight while gtag waits. Task 4 needs a longer post-consent window for GA4 (at least 6 s) or a flush trigger such as `visibilitychange` or `pagehide` before the end.
- **The `after-consent` snapshot belongs at completion.** Taken right after `autoconsentDone`, it showed `cc_cookie, _ga, _ga_ZINKO00001, _gcl_au`. `_ttp` appeared only later, at the `end` snapshot, after the TikTok pixel loaded.
- cookieconsent3 was detected at ~0.6–0.7 s; `autoconsentDone` arrived 17–65 ms after the action.

```
=== ga4-batch accept   (END_WAIT=6000; image, ping and stray lines trimmed)
autoconsent.detected: {"cmp": "cookieconsent3", "at": 638, "error": null}
cookies.before: []
cookies.after-consent: ["cc_cookie", "_ga", "_ga_ZINKO00001", "_gcl_au"]
autoconsent.action: {"action": "optIn", "actionAt": 1684, "result": true, "doneAt": 1723, "error": null}
cookies.end: ["cc_cookie", "_ga", "_ga_ZINKO00001", "_gcl_au", "_ttp"]
dataLayer.first: {"at": 69, "value": ["consent", "default", {"ad_storage": "denied", "analytics_storage": "denied", "ad_user_data": "denied", "ad_personalization": "denied", "wait_for_update": 500}]}
viewport: 390x844@3
ga4.request: {"at": 1717, "method": "POST", "type": "fetch", "bodyEvents": [], "urlEvent": "page_view"}
ga4.request: {"at": 6696, "method": "POST", "type": "fetch", "bodyEvents": ["view_promotion", "view_item_list", "select_promotion"], "urlEvent": null}
vendor.answered204: fetch  listed https://www.google-analytics.com/g/collect?v=2&tid=G-ZINKO00001&gtm=45je6ag1z8d_G-ZINKO00001za208xf1
vendor.answered204: script listed https://googleads.g.doubleclick.net/pagead/viewthroughconversion/100000001/?random=1792497572135&cv=
vendor.answered204: script listed https://googleads.g.doubleclick.net/pagead/viewthroughconversion/100000001/?random=1792497572136&cv=
vendor.answered204: script listed https://googleads.g.doubleclick.net/pagead/viewthroughconversion/100000001/?random=1792497572137&cv=
vendor.answered204: fetch  listed https://www.google-analytics.com/g/collect?v=2&tid=G-ZINKO00001&gtm=45je6ag1za200xf1&_p=179249757103
requests.total: 33
memory: peak PSS 606 MiB, peak RSS 1370 MiB, 12 processes, wall 9.4 s, exit 0

=== clean accept   (vendor lines trimmed)
autoconsent.detected: {"cmp": "cookieconsent3", "at": 731, "error": null}
cookies.after-consent: ["cc_cookie", "_ga_ZINKO00001", "_ga", "_gcl_au"]
autoconsent.action: {"action": "optIn", "actionAt": 1146, "result": true, "doneAt": 1173, "error": null}
cookies.end: ["cc_cookie", "_ga_ZINKO00001", "_ga", "_gcl_au", "_ttp"]
memory: peak PSS 636 MiB, peak RSS 1400 MiB, 12 processes, wall 8.7 s, exit 0

=== clean reject
autoconsent.detected: {"cmp": "cookieconsent3", "at": 689, "error": null}
cookies.before: []
cookies.after-consent: ["cc_cookie"]
autoconsent.action: {"action": "optOut", "actionAt": 1146, "result": true, "doneAt": 1163, "error": null}
cookies.end: ["cc_cookie"]
ga4.request: {"at": 1162, "method": "POST", "type": "fetch", "bodyEvents": [], "urlEvent": "page_view"}
vendor.answered204: fetch  listed https://www.google-analytics.com/g/collect?v=2&tid=G-ZINKO00001&gtm=45je6ag1z8d_G-ZINKO00001za208xf1
requests.total: 9
memory: peak PSS 605 MiB, peak RSS 1360 MiB, 12 processes, wall 8.3 s, exit 0
```

GPT-6.1-Sol's independent rerun of the spike page measured Scrapling at 577–586 MiB PSS and Playwright at 310–326 MiB PSS.

Note for the fixtures README: autoconsent 16.57.0 does have a generic Klaro rule, but as code (`lib/cmps/klaro.ts`), not as a JSON file. The Klaro runs above use it. The fixtures' choice of cookieconsent3 is still fine.

## Not covered here

- The bot-protection comparison on 5 user-approved sites: see "Bot-detection comparison (2026-10-20)" below.
- patchright on its own: Scrapling already drives Chromium through patchright, so the Scrapling column is the patchright result.

## Bot-detection comparison (2026-10-20)

**Question.** Are Scrapling and plain Playwright equally visible to bot detection when each runs the way the engine runs it?

**Setup.** The real engine ran from `apps/browser` (`node --experimental-strip-types src/server.ts`), without `ALLOW_PRIVATE_NETWORKS`: once on Scrapling 0.5 (patchright 1.64.1) and once with `CAPTURE_ENGINE=playwright` (Playwright 1.64.1, Chromium 156.0.8078.4). Both used the same headless full Chromium build, the shared `chromium-args.json` switches, the egress proxy and the capture flow, on the same machine. Each page got one `POST /capture` with `scenario: "none"`, `viewport: "desktop"` and `blockVendorRequests: false`. Nothing was retried. The verdicts come from the returned screenshot, which covers the 1366×768 viewport only, so rows below the fold were not seen.

**This ran from a residential IP, not a Cloudflare Container datacenter IP.** How protected sites treat container traffic is still an open question.

| Page                               | Scrapling (engine)                                                                                                                                                                                                                                                      | Playwright (engine)                                                                                                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bot.sannysoft.com                  | **1 red row:** WebGL Renderer (`SwiftShader driver`). User Agent is `Chrome/156`, WebDriver is `missing (passed)` and Permissions is `granted`. `complete`, no errors, title "Antibot", 22 requests.                                                                    | **3 red rows:** User Agent (`HeadlessChrome/156`), WebDriver `present (failed)`, WebGL Renderer (SwiftShader). Permissions is `prompt`. `complete`, no errors, title "Antibot", 22 requests. |
| CreepJS                            | **33% headless**, 50% like-headless, 0% stealth. The lies panel was below the fold. `complete`, no errors, title "CreepJS", 5 requests.                                                                                                                                 | **100% headless** (flagged red), 56% like-headless, 0% stealth. The lies panel was below the fold. `complete`, no errors, title "CreepJS", 5 requests.                                       |
| BrowserScan bot detection          | **"Normal"**: Webdriver, User-Agent, CDP and Navigator all pass. `complete`, no errors, 64 requests.                                                                                                                                                                    | **"Robot"**: Webdriver and User-Agent fail; CDP and Navigator pass. `complete`, no errors, 63 requests.                                                                                      |
| nowsecure.nl                       | **Not passed.** The page document loaded with a 200 and its Turnstile widget made its first calls. The screenshot then timed out (`EngineFailure`, `Page.screenshot: Timeout 5000ms exceeded`), so `complete: false`, with no image. Title "nowsecure.nl", 12 requests. | **Not passed.** The screenshot shows the page with an unticked "Verify you are human" Turnstile box. `complete`, no errors, title "nowsecure.nl", 12 requests.                               |
| fingerprintjs.github.io/BotD/main/ | **Not measured:** GitHub Pages 404, "Site not found". `complete`, 1 request.                                                                                                                                                                                            | **Not measured:** the same 404. `complete`, 1 request.                                                                                                                                       |

**What it shows.**

- **Scrapling is less visible to fingerprint checks.** On the three pages that gave a verdict, plain Playwright gave itself away through `HeadlessChrome` in the user agent and `navigator.webdriver`. Scrapling passed both checks.
- **Both engines fail the WebGL check.** Each renders WebGL on SwiftShader, which sannysoft flags.
- **nowsecure.nl did not tell the engines apart.** It no longer serves a Cloudflare interstitial. It is nodriver's demo page, with a Turnstile widget using sitekey `3x00000000000000000000FF`, Cloudflare's test key that always forces an interactive challenge. No browser passes it without a click, and the capture does not click.
- **BotD was not measured.** Its URL now returns 404, and no substitute was loaded.

**Second pass: Scrapling `fetch()` with its solver, on nowsecure.nl.** This used a standalone `StealthySession(headless=True, google_search=False, network_idle=True, solve_cloudflare=True).fetch("https://nowsecure.nl/")` with Scrapling's defaults: no egress proxy and no shared switches. The spike's own script pins DNS to 127.0.0.1, so it could not load the page. Scrapling logged `The turnstile version discovered is "embedded"` and returned a 200 after **134 s**. The Turnstile frames had moved to `auto_timeout`, and the screenshot still shows the unticked box. **The solver did not pass this test-key widget either.** For this page, giving up the solver costs nothing, but a forced-interactive test key says little about real Cloudflare challenges.

# 0002: Capture engine, Scrapling first with Playwright alongside

Date: 2026-10-20 · Status: accepted

## Context

M1 needs a browser capture that:
- runs an init script (the `dataLayer` shim) before page scripts;
- records every request with its POST body (GA4 batches several events in one POST);
- reads cookies with values before and after the consent action;
- drives `@duckduckgo/autoconsent` step by step: detect, snapshot cookies, `optIn` or `optOut`, wait for completion;
- emulates a 390×844 mobile viewport;
- blocks service workers;
- answers vendor collection requests locally;
- takes a screenshot.

The user chose Scrapling as the engine (handoff `docs/handoff/2026-10-18-m1-capture.md`), with plain Playwright in the same container as the fallback. The open question was whether Scrapling `StealthySession` can do all of this. The spike in `spikes/m1-capture/` (RESULTS.md there) ran the capture two ways:
- with Scrapling 0.5 and Playwright 1.64.1 against a local page with Klaro, a gtag stand-in and the Meta pixel;
- with `AsyncStealthySession` against the real fixtures (`packages/fixtures`: real gtag.js, cookieconsent3).

GPT-6.1-Sol reran it independently.

Findings:

- **Scrapling drives Chromium through patchright.** Scrapling 0.5 uses patchright, a patched Playwright, and exposes the context as `session.context`. Its own options cover the init script (`init_script`); context options can be overridden with `additional_args`. The rest is the Playwright API:
  - request bodies (`context.on("request")` and `post_data`);
  - cookies;
  - screenshots;
  - `context.route` for 204 vendor answers;
  - `expose_binding` for the autoconsent bridge.
- **Every capability works under Scrapling. Some need a workaround:**
  - viewport and service-worker blocking through `additional_args`, because Scrapling hard-codes 1920×1080 and `service_workers: "allow"`;
  - evaluation with `isolated_context=False`, because patchright defaults to an isolated world;
  - request bodies from our own `request` listener, because `record_requests` keeps only finished requests;
  - a fresh context per scenario by starting a new session, because `StealthySession` uses one persistent context.
- **The sync API deadlocks when autoconsent is answered inside the binding callback.** `AsyncStealthySession` answers inline, and it completed Klaro and the real cookieconsent3 fixture.
- **Real gtag produced the three-event POST on `ga4-batch`.** It arrived about 5 s after the first hit, because GA4 flushes its batch on a timer.
- **Real gtag requests `/pagead/viewthroughconversion/…` as a script,** not only as an image.
- **Memory.** Peak PSS per capture:
  - Scrapling: about 570–590 MiB on the spike page and 605–636 MiB on the fixtures;
  - plain Playwright: about 310–326 MiB on the spike page.

  Peak summed RSS is about 1.3–1.4 GiB for Scrapling and about 610 MiB for Playwright. PSS and summed RSS are different measures: PSS shares out common pages, while summed RSS counts them once per process.

## Decision

- **Scrapling is the primary engine** for every capability in the M1 contract. Nothing has to fall back to Playwright for capability reasons.
- **Use Scrapling as the stealth browser launcher, not as a fetcher.** `capture.py` is built on `AsyncStealthySession`, which removes the queue workaround. It starts one session per scenario and passes:
  - `init_script` (the shim);
  - `additional_args` (viewport, `is_mobile`, `has_touch`, `device_scale_factor`, `service_workers: "block"`, `Sec-GPC` headers for `gpc`);
  - `google_search=False`.

  It then drives a page opened from `session.context` with the Playwright API: routes, request and response listeners, the autoconsent binding, the observation windows, the journey, cookies and the screenshot. Every `evaluate` that touches page globals or answers autoconsent runs with `isolated_context=False`.
- **Stealth is kept partly, and it measurably helps.** Driving the page directly keeps Scrapling's launch flags, fingerprint options and patchright's patches. It loses `fetch()`'s Cloudflare solver (`solve_cloudflare`), which only runs inside `fetch()`. In the comparison of 2026-10-20 (spike RESULTS.md), plain Playwright was flagged on sannysoft, CreepJS (100% headless) and BrowserScan ("Robot") through `HeadlessChrome` and `navigator.webdriver`, while Scrapling passed those checks (BrowserScan "Normal", CreepJS 33% headless). Neither engine, nor `fetch()` with the solver, passed nowsecure.nl's forced-interactive Turnstile, and the run was from a residential IP, so behaviour on real Cloudflare challenges from container IPs is still unknown.
- **Wiring in one container:** the Node server in `apps/browser` keeps `POST /capture`, `GET /health`, the request-level URL policy, the limits and the one-capture-at-a-time lock. For each capture it spawns `uv run capture.py` as a child process in its own process group, with the `CaptureRequest` on stdin.
  - **Partial results by checkpoint.** The child writes NDJSON checkpoints to stdout as each phase completes: documents, requests, cookie snapshots, consent, screenshot. Diagnostics go to stderr only.
  - **Shutdown.** Before the hard deadline, Node sends a cooperative finalize signal so the child can flush what it has. At the deadline it kills the whole process group, descendants included. Node assembles a partial `CaptureResult` from the checkpoints it received, marks missing artifacts absent and adds an `errors` entry, and still answers 200.
  - **Python layout.** Python code stays in `apps/browser/scrapling/` with its own `uv.lock`.
- **SSRF is enforced inside the child.** Node checks the start URL, but it cannot see the Python browser's traffic. So `capture.py` routes every request (top-level, subresources and each redirect hop) through a handler that applies the same policy as `url-policy.ts`: it resolves DNS and refuses private, loopback, link-local and metadata addresses. `ALLOW_PRIVATE_NETWORKS` is passed in from Node, defaults to false and is never set in the image. Container egress limits are the backstop for DNS rebinding between the check and Chromium's own lookup. Task 4 must exercise the policy on both engines.
- **Vendor blocking matches collection paths whatever the resource type.** Only SDK script URLs are exempt, because gtag requests `/pagead/viewthroughconversion/…` as a script.
- **Cookie snapshots:** `after-consent` is taken the moment autoconsent reports completion, not after the network-idle and quiet windows. Later cookies belong to `end` or `document-end`.
- **Observation window for GA4:** the post-consent and post-step windows must outlast GA4's batch timer (about 5 s), or the engine must trigger a flush (`visibilitychange`/`pagehide`) before the `end` snapshot. Task 4 settles which.
- **Plain Playwright stays in the image.** It is the comparison baseline and an operational fallback, selected per request by the server, if Scrapling or patchright breaks on an upgrade or fails to launch. It shares the page-side files: the shim, the vendor-pattern list and the autoconsent bridge. Which engine produced a result is recorded with it.
- **Container size:** `lite` (256 MiB) is ruled out. Task 4 measures container memory on the real fixtures and picks between `basic` (1 GiB) and `standard-1` (4 GiB).

## Alternatives considered

- **Plain Playwright only.** It needs less memory (~310 MiB PSS), has a simpler bridge and needs no Python. Rejected as the primary engine because the user wants Scrapling's stealth on bot-protected sites, and the 2026-10-20 comparison showed plain Playwright exposing `HeadlessChrome` and `navigator.webdriver` where Scrapling does not.
- **patchright directly from Node.** It gets most of the stealth without Python. Not chosen because the user picked Scrapling, and Scrapling adds fingerprint and launch-flag work and a Cloudflare solver on top of patchright. Worth revisiting if the Python boundary costs more than expected, especially since the direct-page approach does not use the solver.
- **Scrapling `fetch()` with `record_requests`.** It is less code and keeps the Cloudflare solver, but it drops unfinished and failed requests, imposes its own wait lifecycle, and gives no cookie snapshot at the consent boundary.
- **One final JSON on stdout, then kill.** It is simpler, but a timeout loses everything captured so far, which breaks the partial-results requirement.
- **Scrapling over CDP (`cdp_url`) to a browser that Playwright launches.** Contexts per scenario would come cheaper, but the CDP path skips Scrapling's launch flags, which carry most of the stealth.

## Consequences

- Python joins the repo, contained in `apps/browser/scrapling/` behind the `POST /capture` contract (Task 3). TypeScript consumers validate its JSON with the contract schemas, and Node validates each checkpoint line.
- The URL policy exists twice, in TypeScript and in Python, and both must be kept in step.
- Each scenario launches a browser (about 1 s). Four scenarios run one after another per page.
- Scrapling and patchright upgrades must be pinned and re-checked against the fixtures, because the engine depends on patchright behaving like Playwright (`isolated_context` defaults, binding behaviour).

## Amendment (Task 4, 2026-10-20)

- **SSRF moved from the child to an egress proxy in the Node server.** Playwright's `route` is not called for redirect hops (checked under patchright: a top-level `302` to a blocked URL was followed without the handler seeing it), so a route-level policy in `capture.py` cannot refuse redirects. Both engines launch Chromium with `--proxy-server` pointing at a per-capture proxy in Node, which applies `url-policy.ts`, resolves the name, refuses private answers and connects to the address it checked. The policy now exists once, in TypeScript, and DNS rebinding between check and connect is closed for proxied traffic.
- **Process cleanup tracks the tree, not one group.** patchright and Playwright start Chromium in its own session, so killing the engine's process group leaves the browser running. Node samples the engine's descendants from `/proc` and kills every process group it saw; the image runs `tini` as PID 1 to reap them.
- **The engine is called directly** (`scrapling/.venv/bin/python -I capture.py`), not through `uv run`, so the finalize signal reaches Python and `uv` is not needed at runtime.
- **Vendor blocking also moved to the proxy (review of Task 4).** Page routes miss redirect hops and Chromium's own traffic, so `blockVendorRequests` is enforced where every connection passes: the proxy refuses vendor hosts on any scheme, and SDK files reach the page through the proxy's `/sdk` fetch. Both engines launch the full Chromium build with one shared switch list (`src/chromium-args.json`) that keeps all traffic on the proxy, and the proxy refuses Chromium's update and sign-in hosts, which it contacts even with background networking off.
- **Known limitation: Chromium's sign-in check.** On startup Chromium calls `accounts.google.com/ListAccounts` (with `Origin: https://www.google.com`). No switch or feature tried stops it (`--allow-browser-signin=false`, `--disable-signin-promo`, `AccountConsistency`, `UnoDesktop`, `DiceWebSigninInterceptionFeature`). With `blockVendorRequests` the proxy refuses it as a `google.com` host; without it the request goes out. `accounts.google.com` and `www.google.com` stay off the always-refused list because pages load from them (sign-in buttons, reCAPTCHA). The startup preconnect to `https://www.google.com/` is stopped by disabling `PreconnectToSearch`.

## Amendment (M2 Task 3, 2026-10-20): site allow-list

- **Enforced with the CDP `Fetch` domain, before the hop loads.** `CaptureRequest.allowedHosts` keeps top-level navigations on the site. Page routes miss redirect hops, and the egress proxy sees connections, not whether a request is a document. A probe on both engines settled the mechanism. Each engine opens a CDP session on its page (`newCDPSession`) and enables `Fetch` with one pattern, `resourceType: "Document"` at `requestStage: "Request"`. Chromium pauses every document request there, each redirect hop included (it carries `redirectedRequestId`), alongside the context route's own `Fetch` interception.
  - A main-frame request (`frameId` equal to the main frame's) whose host is off the site is failed with `BlockedByClient` before it is sent.
  - Every other paused request is continued.
  - Subresources are not paused, and subframe documents are continued.
- **Probe results** (Playwright 1.64.1 and Scrapling 0.5 with patchright 1.64.1, both with a `**/*` context route active, start URL `http://localhost:4400/r?to=http://127.0.0.1:4400/clean/`, allowed host `localhost`). Both engines behaved the same way:
  - The `/r` request paused and was continued.
  - The `127.0.0.1` hop paused with `redirectedRequestId=interception-job-1.0` and was failed.
  - `goto` threw `net::ERR_BLOCKED_BY_CLIENT` and the page showed Chromium's error page.
  - A following `clean` navigation still loaded `www.googletagmanager.com/gtag/js` (200) on both engines.
  - Option (b), `request` events with `redirectedFrom`, was not needed, and the load-then-stop fallback was not used.
- **What the capture records.** The first refused navigation emits a `Navigation` error, `<url>: <host> is not one of the allowed hosts`, and the capture stops: no consent step, no further journey steps, and no screenshot of the error page. Playwright reports a refused redirect as a failure of the request that redirected. That request keeps `status: null`, and the document keeps that request's URL with no redirects. The proxy never contacts the refused host.
- **Navigations that send no request** (a link to `about:blank` or to a `blob:` document) never reach `Fetch`. Each engine also checks every main-frame `framenavigated` after the first navigation, and treats a URL that is not http(s) like an off-site host. Chromium's own `chrome-error:` page is skipped, because the failed navigation behind it reports its own error.
- **Popups are blocked, not guarded (review of Task 3).** The `Fetch` guard lives on the original page's CDP session, so a popup slipped past it: `window.open("about:blank")`, then sending the popup to `127.0.0.1`, loaded an off-site page on both engines. Guarding each new target would need browser-level `Target.setAutoAttach` with `waitForDebuggerOnStart`. Playwright's and patchright's `CDPSession` cannot address the flattened child sessions that requires, and Scrapling's persistent context has no `Browser` for a browser-level session. So with `allowedHosts`, the context route aborts every request whose frame belongs to a page other than ours, and the route runs before the request is sent. Playwright's context routes see a popup's first request. The engine then closes the popup and records one `Navigation` error, `popup blocked: the page opened <url>`. The capture of the main page goes on. With the close delayed by 3 s, both engines logged `popup request refused: http://127.0.0.1:4400/clean/`, and the proxy contacted only the start host.
- **Allowed hosts must already be canonical.** Both schemas accept a host only when `new URL("http://" + host).hostname` gives it back unchanged and it has no trailing dot, so `[:::]`, `127.1`, `[0:0:0:0:0:0:0:1]`, `LocalHost` and `localhost:4400` are refused with 400 `InvalidRequest`.

## Amendment (M3 leftover, 2026-10-22): the consent action is verified

- **autoconsent's result is not trusted.** `optInResult`/`optOutResult` only say the rule's steps ran. autoconsent's Cookiebot opt-in clicks two fixed ids and returns `true` whatever it clicked, so on Happy Socks it reported success with the banner still on screen, no consent update and `gcs=G100` on every hit.
- **Both engines verify the choice before reporting it.** After `autoconsentDone` (or its timeout), the engine polls the shim's `__zinko.bannerShown()` (`src/inject/datalayer-shim.js`) in the CMP's frame every 0.5 s, for up to 3 s, until the banner is gone. It re-runs the found CMP's own `detectPopup`. autoconsent counts any laid-out element as visible, and vanilla-cookieconsent hides its banner with `visibility`/opacity, so during the check the instance's `elementVisible` also requires `checkVisibility({ opacityProperty, visibilityProperty })` and a box on screen. A frame that was detached counts as closed.
  - The engine also looks for a Google consent `update` in `dataLayer` at or after `actionAt`.
  - The outcome is `accepted`/`rejected` if the banner closed or the update came. Otherwise it is `not-applied` with a `ConsentNotApplied` error. Both checks go into the `cmp` observation (`bannerShown`, `consentUpdate`).
  - Cookie changes are not used as a signal. Pages set first-party cookies at any time, so a changed cookie would pass a choice that never took effect.
- **Reaching the instance.** The Playwright bundle keeps its `AutoConsent` instance in a local. Each engine renames it when injecting the bundle: it replaces `const consent = new AutoConsent(` with `const consent = window.__zinkoAutoconsent = new AutoConsent(`. If an autoconsent upgrade removes that text, the engine refuses to start the capture instead of silently skipping the check. The files on disk stay unmodified.
- **A new outcome, not `not-found`.** `not-found` means there was no banner to act on, and the rules say so ("the banner was not found"). Here the banner was found, `cmp` is known and the action ran (`actionAt` is set), so reusing `not-found` would misstate what happened, both in the rule messages and for anyone reading the capture. `not-applied` keeps `actionAt` and `completedAt` as the record of the attempt.
  - The consent rules treat it like `not-found`: `inconclusive`, "the consent choice did not take effect".
  - `evaluateRun` still evaluates a run whose only errors are `CmpNotFound`/`ConsentNotApplied`.
  - The stored `after_consent_action` is false for every hit, because no consent was given.
- **Checked** on the fixtures, with no change to their results on `clean`, `meta-before-consent` or `no-cmp` (`cookieconsent3`: `bannerShown: false`, `consentUpdate: true` on both engines). On two throwaway stub pages, under accept and reject on both engines, the result was `not-applied` with `bannerShown: true`: a Cookiebot global with no working button, and cookieconsent3 markup whose buttons do nothing. Happy Socks gave `not-applied` under accept and `rejected` under reject (captured while the check was still a separate script; the same code then moved into the shim and the fixture and stub runs were repeated).

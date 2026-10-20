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
- **Stealth is kept partly, and its benefit is provisional.** Driving the page directly keeps Scrapling's launch flags, fingerprint options and patchright's patches. It loses `fetch()`'s Cloudflare solver (`solve_cloudflare`), which only runs inside `fetch()`. The bot-protection benefit over plain Playwright is provisional until the comparison on the 5 user-approved sites; that result can change this decision.
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

- **Plain Playwright only.** It needs less memory (~310 MiB PSS), has a simpler bridge and needs no Python. Rejected as the primary engine because the user wants Scrapling's stealth on bot-protected sites. That benefit is unproven until the approved-sites comparison.
- **patchright directly from Node.** It gets most of the stealth without Python. Not chosen because the user picked Scrapling, and Scrapling adds fingerprint and launch-flag work and a Cloudflare solver on top of patchright. Worth revisiting if the Python boundary costs more than expected, especially since the direct-page approach does not use the solver.
- **Scrapling `fetch()` with `record_requests`.** It is less code and keeps the Cloudflare solver, but it drops unfinished and failed requests, imposes its own wait lifecycle, and gives no cookie snapshot at the consent boundary.
- **One final JSON on stdout, then kill.** It is simpler, but a timeout loses everything captured so far, which breaks the partial-results requirement.
- **Scrapling over CDP (`cdp_url`) to a browser that Playwright launches.** Contexts per scenario would come cheaper, but the CDP path skips Scrapling's launch flags, which carry most of the stealth.

## Consequences

- Python joins the repo, contained in `apps/browser/scrapling/` behind the `POST /capture` contract (Task 3). TypeScript consumers validate its JSON with the contract schemas, and Node validates each checkpoint line.
- The URL policy exists twice, in TypeScript and in Python, and both must be kept in step.
- Each scenario launches a browser (about 1 s). Four scenarios run one after another per page.
- Scrapling and patchright upgrades must be pinned and re-checked against the fixtures, because the engine depends on patchright behaving like Playwright (`isolated_context` defaults, binding behaviour).

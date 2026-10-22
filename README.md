<p align="center">
  <img src="https://raw.githubusercontent.com/ovriq/zinko/main/.github/assets/logo.svg" width="96" height="96" alt="Zinko logo: a gecko's foot whose five toe pads are recorded hits, with one ringed in violet as the hit being inspected">
</p>

<h1 align="center">Zinko</h1>

<p align="center">
  Open-source tracking auditor for GA4, Google Ads, Meta Pixel and consent mode.<br>
  It finds what's broken, shows the request that proves it, and explains the fix.
</p>

<p align="center">
  <a href="https://github.com/ovriq/zinko/blob/main/LICENSE"><img src="https://img.shields.io/github/license/ovriq/zinko" alt="AGPL-3.0 license"></a>
</p>

**Status: early development.** Capture works locally: `zinko capture` loads a page in a real browser under a consent choice and lists every GA4, Google Ads, Meta and TikTok hit it sends, and `zinko decode` turns a single request into readable JSON. The web app also runs audits locally: add a client and a site, audit its pages under each consent choice, watch the run grid fill in, browse every decoded hit and `dataLayer` push in the Hits explorer, and read the findings: 19 deterministic checks, each with the request, cookie or `dataLayer` push that proves it, and a triage status you set. The capture engine has not been run in its container image yet, and nothing has been deployed to Cloudflare. The overview, the explanations and fix steps from a model, and reports are next ([roadmap](https://github.com/ovriq/zinko/blob/main/docs/roadmap.md)). Zinko is written in TypeScript; the web app runs on Cloudflare Workers.

Licensed AGPL-3.0. If you modify Zinko and let people use it over a network, you must offer those users the source of your version.

## Try the decoder

Needs Node 24.11+ or 26+ (not 25) and pnpm.

```sh
git clone https://github.com/ovriq/zinko.git && cd zinko
pnpm install && pnpm build
node apps/cli/dist/index.js decode 'https://region1.google-analytics.com/g/collect?v=2&tid=G-ABC123&en=purchase&gcs=G100&epn.value=49.9'
```

```json
[
  {
    "vendor": "ga4",
    "destinationId": "G-ABC123",
    "event": "purchase",
    "params": { "value": 49.9 },
    "ids": {},
    "consent": { "adStorage": "denied", "analyticsStorage": "denied", "raw": "G100" },
    "host": "region1.google-analytics.com",
    "url": "https://region1.google-analytics.com/g/collect?v=2&tid=G-ABC123&en=purchase&gcs=G100&epn.value=49.9"
  }
]
```

Meta Pixel (`facebook.com/tr`), Google Ads and TikTok requests decode the same way. For a POST hit, pass its body with `--body '<raw-body>'`. The CLI `audit` command is not built; audits run in the web app.

### Run an audit locally

The web app runs audits against a capture engine you start by hand, on the fixture sites or any site you may audit. Setup (database, secrets, engine, `pnpm dev`) and the click-through are in [CONTRIBUTING.md](https://github.com/ovriq/zinko/blob/main/CONTRIBUTING.md#run-an-audit-locally).

### Capture a page

`zinko capture` loads a page in the capture engine under a consent choice and lists every tracking hit it sent: when, on which document, and whether it fired after the consent action. The engine is a Node server in `apps/browser` that drives Chromium through a Python child process (Scrapling), so it also needs Python 3.12+ and [uv](https://docs.astral.sh/uv/). Set that up once:

```sh
(cd apps/browser/scrapling && uv sync --frozen && .venv/bin/patchright install chromium)
```

Start the engine and the fixture sites (small fake shops, each with one known tracking bug) in two terminals. `ALLOW_PRIVATE_NETWORKS=true` lets the engine load `localhost`; use it for local fixtures only, because the engine refuses private and local addresses by default.

```sh
ALLOW_PRIVATE_NETWORKS=true pnpm --filter browser start     # engine on http://localhost:8080
pnpm --filter @repo/fixtures serve                          # fixtures on http://localhost:4400
```

To run the web app against that engine, set `BROWSER_URL=http://localhost:8080` in `.env` ([CONTRIBUTING.md](https://github.com/ovriq/zinko/blob/main/CONTRIBUTING.md#running-the-web-app-locally)).

Then capture a fixture. `meta-before-consent` fires a Meta `PageView` before the visitor chooses, so it fires even when they reject:

```sh
node apps/cli/dist/index.js capture http://localhost:4400/meta-before-consent/ --scenario reject --block-vendors
```

```text
== http://localhost:4400/meta-before-consent/  [reject]
engine: scrapling 0.5 (patchright 1.64.1)
consent: rejected, cmp cookieconsent3, action at 6211ms, completed at 6217ms

hits (3); "after" = sent after consent completed; 1 vendor request(s) not decoded
  time    document                  vendor  destination      event            consent                note
  ------  ------------------------  ------  ---------------  ---------------  ---------------------  -----
  2421ms  #0 /meta-before-consent/  meta    100000000000001  PageView         ad:unknown an:unknown
  3166ms  #0 /meta-before-consent/  ga4     G-ZINKO00001     page_view        ad:denied an:denied
  9415ms  #0 /meta-before-consent/  ga4     G-ZINKO00001     user_engagement  ad:denied an:denied    after
```

The Meta hit lands at 2.4 s, before the reject action at 6.2 s. The output goes on to list cookies per snapshot and errors. `--block-vendors` answers collection requests locally, so no hit reaches Google, Meta or TikTok; the SDK files themselves (gtag.js, fbevents.js, the TikTok pixel) are still downloaded from the vendors. Against a real site, drop it and leave `ALLOW_PRIVATE_NETWORKS` unset; load only sites you are allowed to test.

`--scenario` is `none`, `accept`, `reject`, `gpc` or `all` (the four in turn). `--click <selector>` and `--goto <url>` add journey steps in the order given, up to 5. `--mobile` uses a phone viewport. `--engine <url>` points at another engine. `--json` prints one object per scenario, including `undecoded`: vendor requests no decoder turned into a hit. `--rules` also runs the 19 checks on each capture and prints one line per rule (`pass`, `fail`, `inconclusive` or `not_applicable`, its message and how many pieces of evidence it cites); it is the same code the web app runs.

## Why Zinko

A client says their conversions don't match. Today that usually means an afternoon in Tag Assistant and Omnibug, going through the site once per consent choice, then assembling the evidence into a report by hand. Commercial products such as ObservePoint and Trackingplan automate parts of this as closed-source subscriptions.

Zinko is being built to do that audit in one run, in the open. The design:

- **Evidence, not opinions.** Zinko loads your pages in a real browser and records every tracking request, `dataLayer` push, cookie and consent signal. Each finding links to the decoded hit, the raw request and a screenshot.
- **Deterministic checks.** Rules are plain functions over the captured data, each checked against a fixture page. An LLM can explain a finding and write fix steps, but it never decides pass or fail, and every check works without one.
- **Every consent path.** Each page runs with no banner interaction, after "accept all" and after "reject all", with and without click IDs such as `gclid` and `fbclid` in the landing URL.
- **Made for consultants and agencies.** Client workspaces, a tag matrix of what fires where, re-runs that mark findings new or fixed, and a white-label report.

![Zinko audit overview: a tracking health score of 62/100, issue counts by area, changes since the last audit, and top issues such as purchases counted twice in GA4. This is a design mockup, not a working screen.](https://raw.githubusercontent.com/ovriq/zinko/main/.github/assets/overview-mockup.png)

_Design mockup of the planned audit overview. The data is sample data, and this screen is not built yet._

Use something else if you need ongoing monitoring of production traffic today, or vendors beyond GA4, Google Ads, Meta and TikTok.

## What Zinko checks

| Area       | What it catches                                                                                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consent    | Ad or analytics cookies set before consent; non-Google pixels firing before consent or after "reject all"; Google hits before consent without a denied consent state (`gcs`); `consent default` arriving after the Google tag |
| Click IDs  | `gclid`, `fbclid` and `ttclid` lost across navigation; `_gcl_aw`, `_fbc` and `_ttp` cookies missing after consent                                                                                                             |
| Coverage   | `purchase` without `transaction_id`, `value` or `currency`; key pages with no `page_view`                                                                                                                                     |
| Duplicates | The same event fired twice for one action; several GA4 IDs on one page; Meta Pixel initialized twice                                                                                                                          |
| Dedup      | Meta browser `eventID` missing or reused, so Conversions API events can't be deduplicated                                                                                                                                     |
| Hygiene    | Email addresses or phone numbers in URLs and parameters; tags failing with 4xx or 5xx; hits sent from staging hosts                                                                                                           |

These 19 checks are built and run on every audit. Each is a plain function over one run's capture, proven on a fixture site with a known bug. A run that did not load, or a consent check on a page whose banner was not found, is reported as `inconclusive` with the reason, never as clean. The full v0.1 scope, and what comes after it (GTM and GA4 configuration checks, scheduled audits, tracking plans in git), is in [docs/product.md](https://github.com/ovriq/zinko/blob/main/docs/product.md).

## Repository layout

```
apps/cli            zinko CLI (decode and capture, with --rules; audit is planned)
apps/web            TanStack Start web app on Cloudflare Workers: clients, sites, audits, live progress, Hits explorer, Findings
apps/browser        capture engine: Node server, egress proxy, Scrapling (Python) in a container image
packages/decoders   GA4, Google Ads, Meta Pixel and TikTok decoders -> a normalized Hit
packages/rules      the 19 checks: one run's capture and hits -> pass, fail, inconclusive or not applicable, with evidence
packages/capture-contract  Effect Schemas for the engine's POST /capture
packages/fixtures   fake shops, each with one known tracking bug
packages/core       Effect service interfaces
packages/db         Postgres schema and migrations (Drizzle)
infra/              Cloudflare resources, declared with Alchemy
```

The stack is Effect 4 and TanStack Start on Cloudflare Workers, Postgres through Hyperdrive, and Better Auth, scaffolded with [efforge](https://github.com/amagdy46/efforge).

## Contributing

Issues and pull requests are welcome. Setup, checks and where things live: [CONTRIBUTING.md](https://github.com/ovriq/zinko/blob/main/CONTRIBUTING.md).

## License

[AGPL-3.0](https://github.com/ovriq/zinko/blob/main/LICENSE). Built by [Ovriq](https://github.com/ovriq).

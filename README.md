<p align="center">
  <img src="https://raw.githubusercontent.com/ovriq/zinko/main/.github/assets/logo.svg" width="96" height="96" alt="Zinko logo: a white Z drawn as a trace, with a ring on the diagonal marking one inspected hit">
</p>

<h1 align="center">Zinko</h1>

<p align="center">
  Open-source tracking auditor for GA4, Google Ads, Meta Pixel and consent mode.<br>
  It finds what's broken, shows the request that proves it, and explains the fix.
</p>

<p align="center">
  <a href="https://github.com/ovriq/zinko/blob/main/LICENSE"><img src="https://img.shields.io/github/license/ovriq/zinko" alt="AGPL-3.0 license"></a>
</p>

**Status: early development.** Only the hit decoder works today: `zinko decode` turns a GA4 or Meta Pixel request into readable JSON. The audit pipeline, the rules and the web app below are being built ([roadmap](https://github.com/ovriq/zinko/blob/main/docs/roadmap.md)). Licensed AGPL-3.0: you can self-host and modify it, but a modified version you run as a service must publish its source.

![Zinko audit overview: a tracking health score of 62/100, issue counts by area, changes since the last audit, and top issues such as purchases counted twice in GA4. This is a design mockup, not a working screen.](https://raw.githubusercontent.com/ovriq/zinko/main/.github/assets/overview-mockup.png)

_Design mockup of the planned audit overview. The data is sample data, and this screen is not built yet._

## Why Zinko

A client says their conversions don't match. Today that means an afternoon in Tag Assistant and Omnibug, clicking through the site once per consent choice and copying hits into a spreadsheet. Paid tools such as ObservePoint and Trackingplan automate it, but they are closed source and billed monthly.

Zinko is being built to do that audit in one run, in the open. The design:

- **Evidence, not opinions.** Zinko loads your pages in a real browser and records every tracking request, `dataLayer` push, cookie and consent signal. Each finding links to the decoded hit, the raw request and a screenshot.
- **Deterministic checks.** Rules are plain functions over the captured data, each with a fixture page and a test. An LLM can explain a finding and write fix steps, but it never decides pass or fail, and every check works without one.
- **Every consent path.** Each page runs with no banner interaction, after "accept all" and after "reject all", with and without click IDs such as `gclid` and `fbclid` in the landing URL.
- **Made for consultants and agencies.** Client workspaces, a tag matrix of what fires where, re-runs that mark findings new or fixed, and a white-label report.

Use something else if you need ongoing monitoring of production traffic today, or vendors beyond GA4, Google Ads, Meta and TikTok.

## Try the decoder

Needs Node 24.11+ and pnpm.

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

Meta Pixel requests (`facebook.com/tr`) decode the same way. For a POST hit, pass its body with `--body '<raw-body>'`. `zinko audit` is a placeholder until the capture pipeline lands.

## Planned checks (v0.1)

| Area       | What it catches                                                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Consent    | Ad or analytics cookies set before consent; pixels firing before consent or after "reject all"; `consent default` arriving after the Google tag |
| Click IDs  | `gclid`, `fbclid` and `ttclid` lost across navigation; `_gcl_aw`, `_fbc` and `_ttp` cookies missing after consent                               |
| Coverage   | `purchase` without `transaction_id`, `value` or `currency`; key pages with no `page_view`                                                       |
| Duplicates | The same event fired twice for one action; several GA4 IDs on one page; Meta Pixel initialized twice                                            |
| Dedup      | Meta browser `eventID` missing or reused, so Conversions API events can't be deduplicated                                                       |
| Hygiene    | Email addresses or phone numbers in URLs and parameters; tags failing with 4xx or 5xx; hits sent from staging hosts                             |

The full v0.1 scope, and what comes after it (GTM and GA4 configuration checks, scheduled audits, tracking plans in git), is in [docs/product.md](https://github.com/ovriq/zinko/blob/main/docs/product.md).

## Repository layout

```
apps/cli            zinko CLI (decode works; audit is planned)
apps/web            TanStack Start web app on Cloudflare Workers (scaffold so far)
apps/browser        Playwright container where captures will run
packages/decoders   GA4 and Meta Pixel decoders -> a normalized Hit
packages/core       Effect service interfaces
packages/db         Postgres schema and migrations (Drizzle)
infra/              Cloudflare resources, declared with Alchemy
```

The stack is Effect 4 and TanStack Start on Cloudflare Workers, Postgres through Hyperdrive, and Better Auth, scaffolded with [efforge](https://github.com/amagdy46/efforge).

## Contributing

Issues and pull requests are welcome.

```sh
pnpm install
pnpm build                 # the CLI imports the built decoders package
pnpm check && pnpm typecheck && pnpm test
```

- [AGENTS.md](https://github.com/ovriq/zinko/blob/main/AGENTS.md): code layout and rules, for people and coding agents.
- [infra/README.md](https://github.com/ovriq/zinko/blob/main/infra/README.md): running the web app locally (`pnpm dev`) and deploying it.
- [docs/architecture.md](https://github.com/ovriq/zinko/blob/main/docs/architecture.md) and [docs/decisions/](https://github.com/ovriq/zinko/tree/main/docs/decisions): how the pieces fit and why.
- A new check starts with a fixture page that has the bug, then a failing test, then the rule.

## License

[AGPL-3.0](https://github.com/ovriq/zinko/blob/main/LICENSE). Built by [Ovriq](https://github.com/ovriq).

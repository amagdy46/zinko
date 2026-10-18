# Spoorline research and decisions

Compiled 2026-10-18 from agent-assisted research. Most pricing figures come from third-party aggregators, and most data-quality statistics come from vendors that sell audits. Treat them as indicative, not as facts to quote.

## 1. Decision summary

- **Product:** an open-source AI tracking auditor first. The paid product is ongoing "tracking uptime" monitoring. Consent scanning is a module and doubles as the free lead magnet.
- **Not building (yet):** a RedTrack-style ad tracker or PostHog-style product analytics. Each is its own funded market, and they sell to different buyers.
- **License:** AGPL-3.0 for the core. SDKs, the snippet and the plan format may later be MIT. Use a CLA so a commercial license can be offered later, and keep the license fixed after that.
- **Business model:** productized audits ($1–5k) delivered with the tool from day one. Then a hosted cloud at about $49 / $199 / $499 per month with metered LLM usage. Then agency plans with multiple client workspaces and white-label reports.
- **Name:** Spoorline, from _spoor_, the trail an animal leaves. Published under the Ovriq org. "OpenTrack" was dropped because the name is taken by `opentrack/opentrack`.

## 2. Demand evidence

- Visionary Marketing (2026) audited 240 GA4 properties. Only 41% rated their setup accurate, 63% were missing a key conversion, and the median gap between GA4 and backend data was 14.7%.
- Privado (June 2026) found Consent Mode misconfigured on 48% of 250 top sites. 28% of EU sites defaulted to "granted".
- Google Ads now disables conversion tracking for accounts with non-compliant consent setups.
- **What buyers pay:**

| Buyer / product        | Price           |
| ---------------------- | --------------- |
| Fiverr / Upwork audits | $50–650 one-off |
| Specialists            | $80–150/h       |
| Monitoring retainers   | €150–400/mo     |
| Trackingplan           | €89–2,000/mo    |
| Avo                    | ~$250/mo        |
| ObservePoint           | $599/mo and up  |
| Elevar                 | $200–1,250/mo   |

## 3. Competitive landscape

| Segment             | Players                                                                                                                            | Open-source gap                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Ad trackers         | RedTrack, Voluum, Binom, Keitaro, ClickMagick, Hyros, Triple Whale, Northbeam                                                      | No Voluum-class open-source tracker exists. It is also hard and sells on SLAs.                                                      |
| Tracking QA / plans | Trackingplan (has an audit agent), Avo (has an MCP server), Segment Protocols, Amplitude Data, RudderStack, ObservePoint, DataTrue | **No credible open-source equivalent. This is Spoorline's opening.**                                                                |
| AI audits           | GAfix, RundataAI, Measuremate, Tracking Auditor; the GA4 MCP server plus Claude works for free                                     | Single-vendor "chat with GA4" tools are commoditized. The open space is runtime evidence across vendors plus regression monitoring. |

## 4. Architecture

```
CLI / Web / GitHub Action → API (Hono) → jobs (pg-boss) → worker (Playwright)
  capture: network requests, dataLayer shim (addInitScript), cookies, CMP (__tcfapi)
  → decoders → normalized Hit → deterministic rules → Findings (Postgres)
  → LLM layer: explain, fix steps, funnel explorer (writes replayable scenarios)
  connectors: GTM API (versions:live), GA4 Admin/Data, Meta Graph — read-only
```

- The rules engine is the core. Rules are pure functions `(captures, config) → Finding`, and the LLM never decides pass or fail.
- Runs use a matrix: consent {none, accept, reject} × viewport × entry with or without click IDs.
- The agent works in two phases. In discovery, the LLM explores and outputs a funnel spec with selectors and postconditions. In replay, plain Playwright runs that spec with no LLM. When a replay step fails, the LLM tries to repair it and the change is flagged as drift.
- Open item: Google's `gcd` letter decoding conflicts between sources, so the `gcd` rule is heuristic until verified. `gcs` = `G1` + ad_storage + analytics_storage.

## 5. Roadmap

| Phase          | Scope                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1 (weeks 1–6)  | Audit CLI: capture, GA4/Meta/Google Ads/TikTok decoders, consent matrix, about 25 rules, HTML/Markdown report, LLM explanations |
| 2 (weeks 7–8)  | GTM configured-vs-fired diff, GA4 Admin checks, LLM funnel explorer                                                             |
| 3 (weeks 9–14) | YAML tracking plan → JSON Schema, plan generated from audits, GitHub Action                                                     |
| 4              | Cloud: web UI, scheduled re-audits, volume-anomaly alerts, Slack, reconciliation against Shopify or CRM orders                  |
| Later / never  | Ad tracker as a separate service. Integrate with PostHog instead of rebuilding it.                                              |

## 6. Projects to learn from

| Project                                                                                                                                | License            | Take                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [every-app/open-seo](https://github.com/every-app/open-seo)                                                                            | MIT                | Crawl worker split from the app; a fixed error-code list; partial results; decision records in `docs/maintainers/specs/`; MCP tools and skills for agents |
| [Omnibug](https://github.com/MisterPhilip/omnibug)                                                                                     | MIT                | About 70 vendor decoders to port (keep the MIT notice)                                                                                                    |
| [walkerOS](https://github.com/elbwalker/walkerOS)                                                                                      | MIT                | dataLayer and CMP sources; MCP package                                                                                                                    |
| [DuckDuckGo autoconsent](https://github.com/duckduckgo/autoconsent)                                                                    | MPL-2.0            | Rule-based cookie-banner accept/reject, with a Playwright build                                                                                           |
| [Stagehand](https://github.com/browserbase/stagehand)                                                                                  | MIT                | `observe`/`act` return real selectors, so a found funnel can be replayed                                                                                  |
| [Blacklight](https://github.com/the-markup/blacklight-collector)                                                                       | GPL-3.0 (verify)   | Per-behavior inspectors; evidence bundles                                                                                                                 |
| [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci)                                                                         | Apache-2.0         | Collect-then-assert CI pattern                                                                                                                            |
| [OpenStatus](https://github.com/openstatusHQ/openstatus)                                                                               | AGPL-3.0           | Monitoring architecture and private-location runners                                                                                                      |
| [Typewriter](https://github.com/segmentio/typewriter)                                                                                  | MIT                | Code generation from a tracking plan                                                                                                                      |
| [Documenso](https://github.com/documenso/documenso), [Formbricks](https://github.com/formbricks/formbricks)                            | AGPL plus `ee/`    | Open-core directory split and CLA                                                                                                                         |
| [GA4 MCP](https://github.com/googleanalytics/google-analytics-mcp), [gtm-mcp-server](https://github.com/paolobietolini/gtm-mcp-server) | Apache-2.0 / BSD-3 | Run as sidecars with read-only scopes                                                                                                                     |

**Avoid:**

| Avoid                                              | Reason                               |
| -------------------------------------------------- | ------------------------------------ |
| Tracker Radar, Disconnect, Ghostery TrackerDB data | CC BY-NC-SA, non-commercial          |
| Snowplow Micro / Inspector, RudderStack            | Not OSI open source                  |
| pipeboard meta-ads-mcp                             | BUSL                                 |
| Inngest                                            | SSPL-style license                   |
| Claude Agent SDK                                   | Proprietary, Claude-only             |
| Lightpanda, Skyvern                                | AGPL; use only as separate processes |

## 7. Stack

| Layer                  | Choice                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| Language / monorepo    | TypeScript, pnpm workspaces, Turborepo                                                    |
| Browser                | Playwright with real Chromium                                                             |
| Consent                | autoconsent; LLM only as a fallback                                                       |
| Agent                  | Vercel AI SDK (provider-agnostic, Ollama), MCP TS SDK pinned to 1.x, Stagehand            |
| Evals / tracing        | Promptfoo against fixture sites with known bugs; Langfuse, self-hosted                    |
| API                    | Hono (public / ingest) and tRPC (dashboard)                                               |
| Database               | Postgres (Prisma or Drizzle); ClickHouse later for event volume                           |
| Jobs                   | pg-boss for the MVP, with no Redis; BullMQ if outgrown                                    |
| Dashboard              | Next.js App Router or TanStack Start                                                      |
| Auth / billing / email | better-auth with organizations; Stripe or Polar; react-email                              |
| Monitoring             | Postgres results partitioned by day; median/MAD anomaly baseline; Slack webhooks and SMTP |
| Self-host              | Docker Compose: app, worker (Chromium), Postgres                                          |
| Tests                  | Vitest, Playwright e2e, testcontainers                                                    |

## 8. Risks

- **Scope creep.** The plan is one wedge first.
- **Platform churn.** GA4, GTM, Meta and Consent Mode change often. Keep vendor matchers in versioned data.
- **GTM write access** carries liability. Stay read-only by default and have a human publish changes.
- **Prompt injection from crawled pages.** Allow-list navigation and keep credentials out of the agent's reach.
- **Self-hosters rarely pay.** Typical open-source-to-paid conversion is 0.5–3%. Plan to live on consulting for 18–24 months.

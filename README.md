# Spoorline

**Open-source AI tracking auditor.** Spoorline finds what's broken in your marketing tracking: GA4, Google Tag Manager, Meta Pixel / Conversions API, consent mode, and click-ID persistence. It explains each problem and how to fix it.

> *Spoor* (n.): the trail an animal leaves. Spoorline reads the trail your tracking leaves and shows you where it breaks.

Status: **early development.** Only hit decoding works today.

## What it will do

- Crawl your key pages and funnels with a real browser, under accept / reject / no-consent scenarios
- Capture every tracking request, `dataLayer` push, cookie and consent signal
- Run deterministic checks: duplicate purchases, missing `transaction_id`/`value`/`currency`, tags firing before consent, lost `gclid`/`fbclid`, Meta `event_id` dedup, PII in URLs
- Compare what fired against your GTM container and GA4 configuration
- Use an LLM (cloud or local) to explain findings and write fix steps; the checks themselves never depend on the model
- Validate against a tracking plan in git, and fail CI when tracking breaks

## Try it

```sh
pnpm install && pnpm build
node apps/cli/dist/index.js decode 'https://region1.google-analytics.com/g/collect?v=2&tid=G-ABC123&en=purchase&gcs=G100&epn.value=49.9'
```

## Repository layout

```
apps/cli            spoorline CLI
packages/decoders   GA4 / Meta Pixel hit decoders → normalized Hit model
```

Planned: `packages/capture` (Playwright capture), `packages/rules`, `packages/llm`, `packages/plan`, `apps/worker`, `apps/api`, `apps/web`.

See [RESEARCH.md](./RESEARCH.md) for market research, architecture and stack decisions.

## License

[AGPL-3.0](./LICENSE). Built by [Ovriq](https://github.com/ovriq).

# Zinko roadmap and how we build

## How we work

- **Vertical slices.** Every milestone ends in something you can demo end to end in the web app, never "the backend is done".
- **Rules start from fixtures.** For a new check, first add a fixture page with the bug, then a failing test, then the rule.
- **Use it on real work.** From M3 on, every client audit you do runs through Zinko. Anything it misses becomes a new rule plus a fixture.
- **Issue tracking.** GitHub Issues, with one milestone per row below. Keep PRs small, and use squash merges on `main`.
- **CI on every PR:** typecheck, test (including the fixture pipeline), and build.
- **Decision records** for anything we'd otherwise argue about twice go in `docs/decisions/`.

## Milestones (about 10 weeks part-time)

| # | Milestone | Demo at the end |
|---|---|---|
| M0 | **Foundations:** CI, Vite+ (oxlint, oxfmt), Effect 4 + effect-cf setup, `packages/core` services, `packages/db` (Drizzle, Neon via Hyperdrive), TanStack Start on Workers with better-auth and organizations, `infra/alchemy.run.ts` with dev/PR/prod stages, `alchemy deploy` from CI | Sign up on the deployed Worker, create a workspace, invite a teammate |
| M1 | **Capture (done, except two items below):** the capture engine in `apps/browser` (`POST /capture`: Scrapling `AsyncStealthySession` with a Playwright fallback, egress proxy for SSRF and vendor blocking), `packages/capture-contract`, dataLayer shim, cookies, screenshot, autoconsent scenarios (none, accept, reject), a GPC scenario, short click-through journeys, Google Ads and TikTok decoders, `packages/fixtures`, and `zinko capture`. **Not done:** the container image has not been run (building it needs `sudo docker`), and the bot-protection comparison of Scrapling vs plain Playwright vs patchright (and Browser Rendering) on 5 sites is pending, because the user has to approve the sites | A fixture site captured locally under the consent scenarios with matching hits (done, see `docs/vision.md`); the same inside the container (pending the image run) |
| M2 | **Audit pipeline:** clients and sites CRUD, the New audit form, AuditWorkflow (step per page × scenario), AuditRoom Durable Object over WebSocket, hits in Postgres, artifacts in R2 | Run an audit from the UI, watch it progress, and browse the Hits explorer |
| M3 | **Rules and findings:** `packages/rules` with the ~20 v0.1 rules and the Findings screen with its evidence panel | Audit a real client site and get correct findings with evidence |
| M4 | **Matrix, overview and LLM:** Tag matrix, Overview score, `packages/llm` (BYOK keys, explanations, fix steps, cached) | A consultant-ready view of everything that fires where |
| M5 | **Report:** branding settings, report page, share link, PDF | Send a white-label report to a client |
| M6 | **Compare and polish:** re-run with diff, empty and partial states, docs, self-host guide, public demo instance | **v0.1 release:** a Show HN post and a "we audited N sites" write-up |

## After v0.1

| Version | Scope |
|---|---|
| v0.2 | GTM API, GA4 Admin and Meta connectors (configured vs fired), LinkedIn, agent-driven funnel discovery |
| v0.3 | Scheduled audits, volume-drop alerts, Slack and email notifications. **The cloud launches with billing (Polar or Stripe).** |
| v0.4 | Tracking plan as YAML, drift detection, GitHub Action, typed code generation |
| Later | Chrome extension, CLI parity, Shopify/CRM reconciliation |

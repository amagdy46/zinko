# Contributing to Zinko

Needs Node 24.11+ or 26+ (not 25) and pnpm.

```sh
pnpm install
pnpm build                 # the CLI imports the built decoders package
pnpm check && pnpm typecheck
```

Run both checks before opening a pull request; zero errors and zero warnings is the bar.

The capture engine in `apps/browser` also needs Python 3.12+ and [uv](https://docs.astral.sh/uv/): the Scrapling engine lives in `apps/browser/scrapling` with its own `uv.lock`. Set it up once, plus Playwright's Chromium for the fixtures' `inspect` script and the engine's Playwright fallback:

```sh
(cd apps/browser/scrapling && uv sync --frozen && .venv/bin/patchright install chromium)
pnpm --filter @repo/fixtures exec playwright install chromium
```

To run the engine against the local fixtures, start it with `ALLOW_PRIVATE_NETWORKS=true pnpm --filter browser start`. That setting is for local fixture runs only: never set it in the image or in production.

- [AGENTS.md](./AGENTS.md): code layout and rules, for people and coding agents.
- [infra/README.md](./infra/README.md): running the web app locally (`pnpm dev`) and deploying it.
- [docs/architecture.md](./docs/architecture.md) and [docs/decisions/](./docs/decisions/): how the pieces fit and why.
- [docs/roadmap.md](./docs/roadmap.md): milestones and how we build.

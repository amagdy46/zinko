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

## Running the web app locally

`pnpm dev` (`alchemy dev`, stage `dev_$USER`) runs the Worker in workerd with local Postgres, R2 and Durable Objects. It does not need Docker or a Cloudflare login. Alchemy's local Containers do need Docker, so the app talks to a capture engine you start by hand instead.

```sh
cp .env.example .env
# fill the secrets, each with: openssl rand -base64 32
#   BETTER_AUTH_SECRET, LLM_ENCRYPTION_KEY, STORAGE_SIGNING_SECRET
docker compose up -d && pnpm db:migrate           # Postgres on :5432
pnpm build                                        # once: the Worker imports the built workspace packages
ALLOW_PRIVATE_NETWORKS=true PORT=8080 pnpm --filter browser start   # engine on :8080
pnpm --filter @repo/fixtures serve                # fixture sites on :4400
pnpm dev                                          # app on http://localhost:1337
```

- `.env` is gitignored. Its values are local-only: never reuse them for a deployed stage. Rotating `LLM_ENCRYPTION_KEY` makes saved model keys unreadable.
- `BROWSER_URL=http://localhost:8080` makes `Browser.capture` post to `${BROWSER_URL}/capture` and skips the container resource and binding. It works on `dev` stages only; any other stage ignores it and uses the container. Every container instance name (`capture`'s `instance` option) maps to that one engine.
- `ALLOW_PRIVATE_NETWORKS=true` lets the engine load `localhost` and private addresses. It is for local fixture runs only: never set it in the image or in production.
- `BETTER_AUTH_URL` can stay empty; Better Auth then uses the request's origin, so any port works.
- `MAIL_TRANSPORT=console` prints emails (invitations) to the `pnpm dev` log.

## Run an audit locally

With everything above running (Postgres, the engine with `ALLOW_PRIVATE_NETWORKS=true`, the fixtures, `pnpm dev`; the engine, the fixtures and the dev server each need their own terminal), open http://localhost:1337:

1. Sign up, then create an organization.
2. Clients: create a client, then a site with the address `http://localhost:4400/` (private addresses are accepted on local dev stages only).
3. On the site, choose New audit. Start URL `http://localhost:4400/clean/`, key pages `http://localhost:4400/meta-before-consent/` and `http://localhost:4400/ga4-batch/`, scenarios none, accept and reject, desktop. Leave "Answer tracking requests locally" on, so fixture traffic never reaches Google, Meta or TikTok.
4. Start the audit and watch the run grid fill in. Nine runs take about 1.5 to 2 minutes.
5. Open the Hits tab. Filter the run to `/meta-before-consent/` under reject and the vendor to Meta: the `PageView` fires before the consent update, and nothing follows it. Open the `ga4-batch` accept hit to see one request carrying three events.

- [AGENTS.md](./AGENTS.md): code layout and rules, for people and coding agents.
- [infra/README.md](./infra/README.md): running the web app locally (`pnpm dev`) and deploying it.
- [docs/architecture.md](./docs/architecture.md) and [docs/decisions/](./docs/decisions/): how the pieces fit and why.
- [docs/roadmap.md](./docs/roadmap.md): milestones and how we build.

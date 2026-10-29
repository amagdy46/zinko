# Self-hosting Zinko

> **Not yet run end to end.** This guide is written from the code (`infra/alchemy.run.ts`, `.github/workflows/deploy.yml`, `docs/decisions/0004-first-deploy.md`) and from the offline preparation of the first deploy. Nobody has followed it verbatim on a Cloudflare account yet: the capture container image has not been built or started, and no deploy has run. Treat every step as untested, and expect to fix this page the first time it runs. The local path in [CONTRIBUTING.md](../CONTRIBUTING.md#running-the-web-app-locally) is the one that is known to work.

Zinko is a Cloudflare Worker (the web app, the audit workflow, two Durable Objects), an R2 bucket (captures, screenshots, report logos), a Postgres database reached through Hyperdrive, and a container image that runs the capture engine (Node, Python and Chromium). The container uses Cloudflare's `durable_object` scheduling policy (some accounts, ours included, cannot create the `default` one): the `BrowserContainer` Durable Object starts the image itself with the `standard-1` instance size, waits for `/health`, proxies requests to port 8080 and stops the container after 2 idle minutes. There is no `maxInstances`; the AdmissionGate caps concurrency at `BROWSER_ENGINES` (3) through the instance names `engine-0` to `engine-2`. Alchemy declares all of it in `infra/alchemy.run.ts`; there is no `wrangler.jsonc`.

## What you need

- A Cloudflare account on a plan that includes Containers, Workers, Workflows, Durable Objects, R2 and Hyperdrive, an API token for it (`CLOUDFLARE_API_TOKEN`) and the account id (`CLOUDFLARE_ACCOUNT_ID`).
- A Postgres database **named after the stage** (for `--stage prod`, a database whose name contains `prod`, such as `zinko_prod`). `alchemy.run.ts` refuses to plan when the name does not contain the stage, so a trial can never write to another stage's data. Neon works: give Hyperdrive the **direct** connection string (the host without `-pooler`), because Hyperdrive pools connections itself.
- Docker (or the `image-build` workflow) to build the capture image from `apps/browser`; Alchemy builds and pushes it during the deploy.
- A domain enabled for Cloudflare Email Sending if you want invitation emails (`wrangler email sending enable <domain>`), and `MAIL_FROM` set to an address on it.
- Node 24.11+ or 26+ (not 25) and pnpm on the machine that deploys.

## Secrets and settings

| Name                     | What it is                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `DATABASE_URL`           | Postgres connection string of this stage's database                                             |
| `BETTER_AUTH_SECRET`     | signs sessions: `openssl rand -base64 32`                                                       |
| `BETTER_AUTH_URL`        | the public origin of the app; leave empty and Better Auth uses each request's origin            |
| `LLM_ENCRYPTION_KEY`     | encrypts the model keys organizations save: `openssl rand -base64 32`. Rotating it makes saved keys unreadable |
| `STORAGE_SIGNING_SECRET` | signs download URLs, at least 32 characters: `openssl rand -base64 32`                          |
| `MAIL_FROM`              | the sender address on a domain enabled for sending                                              |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | the account the stage is created in                                               |

Never set `ALLOW_PRIVATE_NETWORKS` or `BROWSER_URL` for a deployed stage: the engine must refuse private and local addresses, and a deployed Worker ignores `BROWSER_URL` by design.

## Deploy from your machine

1. Create the stage's database and migrate it with an explicit URL (`pnpm db:migrate` reads `.env` too, but an exported variable wins, so set it explicitly for a deployed stage):

   ```sh
   export DATABASE_URL='postgres://USER:PASSWORD@HOST/zinko_prod?sslmode=require'
   pnpm install && pnpm build && pnpm db:migrate
   ```

   `pnpm db:migrate` applies the migrations and then the idempotent backfill of default clients and the "Group sites by client" setting (organizations that already have any client, archived ones included, keep today's Clients UX); a re-run is harmless and never overrides a manager's choice. Run it in a quiet window and deploy straight after. On a stage with active users, drain writes first (no client or site creation between migrate and deploy): a client the old app creates in between leaves grouping off until a manager turns it on, and the old app can list the hidden default clients during that window.

2. Export the other settings from the table, then deploy:

   ```sh
   pnpm run deploy --stage prod
   ```

   Use `pnpm run deploy`: plain `pnpm deploy` is pnpm's own workspace command. The first run builds the image, creates the resources and prints the Worker's URL. Alchemy keeps its state in `.alchemy/` on your machine; CI keeps it in a Cloudflare-hosted store.

3. Open the URL, sign up (the first user creates the organization), add a client and a site with a public address you may audit, and start an audit.

## Deploy from GitHub

`.github/workflows/deploy.yml` is manual (`workflow_dispatch`) and takes a required `stage` and a `destroy` checkbox. Create a GitHub environment named after the stage, put the secrets above (plus `ALCHEMY_PASSWORD`) in it, and run the workflow. It installs, builds, migrates the stage's database (`pnpm db:migrate` with the stage's `DATABASE_URL`) and only then deploys, in that order; a destroy skips build and migrate. The stage `prod` is refused unless its environment has a required-reviewers rule, which the workflow reads with the repository secret `ENVIRONMENT_READ_TOKEN`. `image-build.yml` (manual, no secrets) builds the capture image and starts it under 4 GiB and half a vCPU, to check the image on its own.

## What to check after the first deploy

These have never been measured on Cloudflare; write the numbers down and fix this page:

- Sign-in works and a 12-run audit of a page you own finishes; live progress reconnects when the tab sleeps.
- Three audits started together share the three capture engines (`BROWSER_ENGINES`, the admission gate) and all finish.
- A screenshot link opens (signed R2 URL), an invitation email arrives.
- A public report link (`/r/<token>`) loads without signing in; `curl --compressed` shows its size; the rate limit on `/r/*` is a Cloudflare rule you create yourself (the Worker does not enforce it).
- How long a 30-run audit (10 pages, 3 scenarios) takes: locally it is 5 to 6 minutes.

## Take it down

`pnpm run destroy --stage prod` removes every resource of the stage, the R2 bucket included only on stages other than `prod`. Drop the database yourself.

## If Containers do not work for you

The engine is one HTTP service (`POST /capture`). Running the image on any Docker host with a public address and pointing the Worker at it is a design, not an implemented option: see "Fallback commands" in [decisions/0004-first-deploy.md](decisions/0004-first-deploy.md). The local-only path always works.

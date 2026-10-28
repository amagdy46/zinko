# infra

`alchemy.run.ts` declares everything that runs on Cloudflare with [Alchemy v2](https://v2.alchemy.run)
("Infrastructure as Effects"). There is no `wrangler.jsonc`: the Worker entry is
`apps/web/src/server.ts` and every binding is an entry of the `env` object in `alchemy.run.ts`.

| Command                           | What it does                                                                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                        | `alchemy dev`: runs the Vite dev server and workerd locally with the bindings declared here, on stage `dev_$USER`. State stays in `.alchemy/`. |
| `pnpm run deploy --stage <name>`  | `alchemy deploy`: builds `apps/web` and deploys it to Cloudflare. Without `--stage` it uses `$ALCHEMY_STAGE`, then `live_$USER`.               |
| `pnpm run destroy --stage <name>` | `alchemy destroy`: removes every resource of that stage.                                                                                       |

Use `pnpm run deploy`: plain `pnpm deploy` is pnpm's own workspace command. The step-by-step guide, with its list of what is untested, is [docs/self-hosting.md](../docs/self-hosting.md).

Copy `.env.example` to `.env` for local values (setup in [CONTRIBUTING.md](../CONTRIBUTING.md#running-the-web-app-locally); `BROWSER_URL` replaces the container on `dev` stages only). Deploying needs `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` (and `DATABASE_URL` for Postgres) in the environment.

## CI

`.github/workflows/deploy.yml` is manual (`workflow_dispatch`) and takes a required `stage` (no default) and a `destroy` checkbox. It runs in the GitHub environment of the same name, so each stage has its own secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ALCHEMY_PASSWORD`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `STORAGE_SIGNING_SECRET`, `LLM_ENCRYPTION_KEY`, `MAIL_FROM`. Stage `prod` is refused unless its environment has a required-reviewers rule (read with the repository secret `ENVIRONMENT_READ_TOKEN`). CI keeps Alchemy state in a Cloudflare-hosted store that the first deploy creates.

Each stage needs its own Postgres database whose name contains the stage (`zinko_spike_m6` for `spike-m6`): `alchemy.run.ts` fails at plan time with `StageDatabaseMismatch` otherwise, and the workflow checks it earlier. Run `pnpm db:migrate` against that database with an explicit `DATABASE_URL` before the first deploy. Previews per PR are not wired; see `docs/decisions/0004-first-deploy.md`.

`.github/workflows/image-build.yml` (manual, no secrets) builds `apps/browser` and starts it under 4 GiB and 0.5 vCPU.

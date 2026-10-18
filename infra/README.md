# infra

`alchemy.run.ts` declares everything that runs on Cloudflare with [Alchemy v2](https://v2.alchemy.run)
("Infrastructure as Effects"). There is no `wrangler.jsonc`: the Worker entry is
`apps/web/src/server.ts` and every binding is an entry of the `env` object in `alchemy.run.ts`.

| Command                           | What it does                                                                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                        | `alchemy dev`: runs the Vite dev server and workerd locally with the bindings declared here, on stage `dev_$USER`. State stays in `.alchemy/`. |
| `pnpm run deploy --stage <name>`  | `alchemy deploy`: builds `apps/web` and deploys it to Cloudflare. Without `--stage` it uses `$ALCHEMY_STAGE`, then `live_$USER`.               |
| `pnpm run destroy --stage <name>` | `alchemy destroy`: removes every resource of that stage.                                                                                       |

Use `pnpm run deploy`: plain `pnpm deploy` is pnpm's own workspace command.

Copy `.env.example` to `.env` for local values. Deploying needs `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` (and `DATABASE_URL` for Postgres) in the environment.

## CI

`.github/workflows/deploy.yml` deploys stage `prod` on every push to `main`, a stage `pr-<number>`
for each pull request, and destroys the PR stage when the PR closes. Add these repository secrets:
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ALCHEMY_PASSWORD`, `DATABASE_URL` (and
`STORAGE_SIGNING_SECRET` with the storage extra, `BETTER_AUTH_SECRET` with auth; the auth add-on adds that one to the workflow itself). CI keeps Alchemy state in a Cloudflare-hosted
store that the first deploy creates.

Previews share one Postgres database (`DATABASE_URL`); run `pnpm db:migrate` against it before the
first deploy. Per-PR database branches need a database provider such as Neon.

# 0004: First deploy, Part A (offline preparation)

Date: 2026-10-28 · Status: Part A done, Part B waits for owner gate Q13

Part A of M6 Task 1. Nothing here touched Cloudflare with a real credential: no `alchemy deploy`, no resource, no login, no push. Part B (the real deploy on a scratch stage `spike-m6`) is written in `docs/plans/2026-10-28-m6-compare/plan.md` and stays blocked until the owner answers Q13 in writing.

## What was proven offline

| Item | Command | Result |
| --- | --- | --- |
| Docker as the normal user | `docker ps` | `permission denied ... /var/run/docker.sock`. The socket is `root:docker` and the user is not in the `docker` group. No podman or buildah is installed. `sudo` was not used. |
| Image build | not run here | Replaced by `.github/workflows/image-build.yml` (`workflow_dispatch`, no secrets, no registry, uploads nothing). It builds `apps/browser`, prints build seconds and image size, then starts the image with `--memory 4g --cpus 0.5` and polls `/health`. **Not triggered.** Image size, build time, Chromium under the `standard-1` limits and memory peak are still unmeasured. |
| Alchemy dry run | `alchemy --help`, `alchemy deploy --help`, `alchemy plan --help` | 2.0.0-beta.83 has `plan` (preview changes) and `deploy --dry-run`. Both run provider diffs against the Cloudflare API, so they need a valid token. |
| Plan with a placeholder token and an empty `HOME` | `alchemy plan infra/alchemy.run.ts --stage spike-m6 --no-input` with `CLOUDFLARE_API_TOKEN=placeholder` | The stack module imports and evaluates, then planning fails with `Unauthorized: Authentication failed` in the R2 bucket and container providers' first read. So the resource graph needs a real token; it was not obtained. Do not run it against a real profile before Q13. |
| Stage guard, wrong database | same plan command, `DATABASE_URL=.../app`, stage `spike-m6` | `StageDatabaseMismatch: Stage "spike-m6" would use database "app" ...`, planning fails in 0.6 s, before any API call |
| Stage guard, prod against a spike database | `DATABASE_URL=.../zinko_spike_m6`, stage `prod` | `StageDatabaseMismatch` as above |
| Workflow shell snippets | the stage-name `case` and the database `case`, run in bash | `spike-m6` accepted; `Prod`, `-x`, empty rejected. `spike-m6`/`zinko_spike_m6` passes; `prod`/`app` refused; `prod`/`zinko_prod` passes. Both YAML files parse. |

## Resource list (from `infra/alchemy.run.ts`, since a graph needs credentials)

One stack `zinko`, one stage per deploy. Resources: `Hyperdrive` (Postgres origin from `DATABASE_URL`, query caching off); `Audit` Workflow; `AuditRoom` and `AdmissionGate` Durable Objects; `Browser` Container (class `BrowserContainer`, context `apps/browser`, instance type `standard-1` = 4 GiB and 1/2 vCPU, `maxInstances` 3, bound with `BROWSER_ENGINES=3`); `Storage` R2 bucket (`forceDestroy` on every stage except `prod`); `Email` send-email binding; `web` (`Website.Vite`, Worker entry `apps/web/src/server.ts` plus static assets). Secrets passed as bindings: `BETTER_AUTH_SECRET`, `LLM_ENCRYPTION_KEY`, `STORAGE_SIGNING_SECRET`; plain: `BETTER_AUTH_URL`, `MAIL_FROM`, `MAIL_TRANSPORT`. State is Cloudflare-hosted in CI (`CI=true`), a `.alchemy/` folder otherwise. The `/r/*` rate-limit binding mentioned in the roadmap is **not declared in this file**: Part B must write the rule, not verify one.

## Stage isolation (implemented, not applied)

- `deploy.yml` is `workflow_dispatch` only with a **required `stage` input and no default**, plus a `destroy` checkbox. The job runs in the GitHub **environment named after the stage**, so every secret (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `STORAGE_SIGNING_SECRET`, `LLM_ENCRYPTION_KEY`, `MAIL_FROM`, `ALCHEMY_PASSWORD`) is per stage and `spike-m6` and `prod` never share one. Repository-level secrets are no longer read.
- The stage must be lowercase letters, digits and dashes. `prod` additionally requires the `prod` environment to have a required-reviewers rule, read through `gh api` with the `ENVIRONMENT_READ_TOKEN` secret (a token that can read environments); without that token the step fails, so prod fails closed.
- The database name must contain the stage, checked twice: in the workflow before install, and in `infra/alchemy.run.ts` at plan time (`StageDatabaseMismatch`, case- and punctuation-insensitive, skipped on local `dev` stages). A spike therefore cannot be pointed at `app` or at the production database.
- **A PR stage** is no longer automatic. The old push and PR triggers shared one `DATABASE_URL` among all previews and deployed `prod` on every push to `main`. To bring previews back, derive `pr-<number>` from the event and give each its own database (Neon branch) and a `pr-<number>` environment; the guard then enforces the naming.

## Fallback commands

(a) **Engine alone on any Docker host**, if Containers prove unusable (decision Q10, design only, not implemented): `docker run --rm -p 8080:8080 zinko-engine` on a host with a public address, `BROWSER_URL=https://engine.example` for the Worker, and a shared-secret header the engine would check (`ENGINE_TOKEN`). Today `BROWSER_URL` is honoured on `dev` stages only and the engine has no authentication, so this needs both changes plus egress rules before it exists. Locally the same image is `docker run --rm --network host -e ALLOW_PRIVATE_NETWORKS=true -p 8080:8080 zinko-engine` for fixtures on the host (needs docker group membership, untried).

(b) **Local-only release** if Part B is refused or fails: the README quick start, `docker compose up -d`, `pnpm db:migrate`, `pnpm --filter @repo/fixtures serve`, `ALLOW_PRIVATE_NETWORKS=true PORT=8080 pnpm --filter browser start`, `BROWSER_URL=http://localhost:8080 pnpm dev`. Every feature through M5 has been verified this way.

(c) **Neon with Hyperdrive:** give Hyperdrive the **direct** connection string (host without `-pooler`), because Hyperdrive pools connections itself and a PgBouncer in front breaks session state and doubles the pooling. Use the pooled string for anything else that opens many short connections (scripts, migrations over a serverless runner). This is Neon and Cloudflare's published guidance, not tested here. Each stage's database is a separate Neon database or branch named after the stage.

## Still untested, needs Q13 or the docker group

- Whether the image builds, its size and build time, Chromium starting under 4 GiB / 0.5 vCPU, peak memory and time per capture in the container (the decision for the instance type).
- The resource graph and a real `plan`; the first deploy; container cold start; three audits on real containers; R2 signed URLs; email; the `/r/*` rate-limit rule; the compressed size of the report HTML; the 30-run audit time; destroying the stage.
- That `ENVIRONMENT_READ_TOKEN` can read environment protection rules, and that the environments exist.

To unblock the image measurements without Q13: add the user to the `docker` group, or run `image-build.yml` once from the Actions tab.

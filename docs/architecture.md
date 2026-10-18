# Spoorline architecture and stack

## Shape

```
┌──────────────── apps/web (TanStack Start) ────────────────┐
│ UI routes · server functions · /share/:token · /api/* (later) │
└──────────────┬───────────────────────────────▲────────────┘
               │ enqueue audit (pg-boss)        │ progress + results (SSE from Postgres)
               ▼                                │
┌──────────────── apps/worker (Node + Chromium) ─────────────┐
│ for each page × scenario:                                   │
│   capture (Playwright) → decoders → Hit[]                   │
│ rules(captures) → Finding[]                                 │
│ llm.explain(findings) (optional, BYOK)                      │
└──────────────┬──────────────────────────────────────────────┘
               ▼
         Postgres 17 — app data, queue (pg-boss), runs, hits (jsonb), findings
         Object storage — screenshots, HAR (local disk, or S3-compatible such as R2 or MinIO)
```

There are two processes and one database. ClickHouse, Redis and Kafka are left out until volume requires them.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript, Node 22+ | One language from crawler to UI |
| Monorepo | pnpm workspaces + Turborepo | Already set up |
| Web | **TanStack Start** (React 19, Vite) + TanStack Router / Query / Table | Your choice; open-seo uses the same base |
| UI kit | Tailwind v4 + shadcn/ui (Radix) + lucide icons | Owned components, accessible, fast to build |
| Charts (v0.3) | Recharts or visx | Volume trends for monitoring |
| DB / ORM | Postgres + **Drizzle** | SQL-shaped, light migrations, open-seo pattern; a good way to learn SQL |
| Auth | **better-auth** + organization plugin | Workspaces, invites, roles out of the box |
| Jobs | **pg-boss** | Queue in Postgres; nothing extra to run |
| Live progress | Worker writes `run_events` rows → web streams via SSE | No websockets or Redis needed |
| Browser | **Playwright** + real Chromium in the worker image | Fidelity; tracking code behaves like it does for real users |
| Consent clicking | **@duckduckgo/autoconsent** (MPL-2.0) | Deterministic accept/reject for common CMPs |
| LLM | **Vercel AI SDK**, bring your own key: Anthropic, OpenAI, OpenRouter, Ollama | Keys stored encrypted per workspace; audits work without a key |
| Validation | Zod | Shared between server functions, rules config and the LLM output schema |
| PDF | The worker prints the report route with Playwright `page.pdf()` | Reuses the browser already running in the worker |
| Email (invites) | react-email + nodemailer (SMTP) | Self-hosters bring their own SMTP |
| Tests | Vitest (units), fixture sites (rules), Playwright Test (web e2e) | See "Testing" below |
| Lint / format | Biome | One fast tool |
| CI | GitHub Actions: typecheck, test, build, docker build | |
| Deploy | Docker Compose: `web`, `worker`, `postgres` | Self-host and our own cloud use the same artifact; host the cloud on a VPS (Hetzner + Coolify), since serverless can't run Chromium well |

## Packages

```
apps/
  web/          TanStack Start app (UI, server fns, share pages)
  worker/       pg-boss consumer: runs audits, renders PDFs
  cli/          thin CLI over capture+rules (kept, low priority)
packages/
  decoders/     request → Hit (exists)
  capture/      Playwright session: network, dataLayer shim, cookies, CMP state, screenshots
  rules/        rule registry; Rule = (RunCapture) => Finding[]
  llm/          provider factory, prompts, Zod output schemas
  db/           Drizzle schema, migrations, queries
  fixtures/     static test sites with known tracking bugs
  ui/           shared shadcn components (only if web + report diverge)
docker/         Dockerfiles, compose.yml
docs/           product, architecture, ui, roadmap, decisions/
```

## Data model (v0.1)

```
organization ─< member >─ user              (better-auth)
organization ─< client ─< site ─< audit ─< run (page × scenario × viewport)
                                     │         ├─< hit        (decoded, jsonb params)
                                     │         ├─< datalayer_push
                                     │         └─ artifacts (screenshot, har keys)
                                     ├─< finding (rule_id, severity, evidence refs, status, llm_explanation)
                                     └─ report_share (token, revoked_at)
organization ─ llm_credential (provider, encrypted key, model)
organization ─ branding (logo, accent, report footer)
```

Hits are stored as rows with `jsonb` params. That's fine up to millions of rows; ClickHouse comes in only for continuous monitoring ingestion.

## Key design rules

1. **Findings are deterministic.** Each rule is a pure function with fixture tests. The LLM explains findings and suggests fixes but never decides pass or fail, and its output is cached per finding.
2. **Every finding cites evidence:** hit IDs, the request URL, a screenshot, and a cookie snapshot.
3. **Vendor matchers are data plus small decoders,** so endpoint changes are one-line fixes.
4. **Crawled pages are untrusted.** Their content goes to the LLM only as quoted evidence. The agent gets no credentials, and navigation is restricted to an allow-list of the site's domains.
5. **Read-only by default** toward GTM, GA4 and Meta when connectors arrive in v0.2.
6. **Audits fail partially, not completely.** If one page or scenario breaks, the report still renders, with a closed set of error codes (`bot_blocked`, `timeout`, `cmp_not_found`, …), as open-seo does.

## Testing

- **Decoders and rules:** Vitest with recorded real requests.
- **Fixture sites** (`packages/fixtures`): small static pages, each with one known bug, for example a pixel firing before consent, a duplicate purchase, or a lost gclid. They are served locally in CI, and the full capture-plus-rules pipeline must produce exactly the expected findings. This is the main safety net.
- **Web:** Playwright Test covering sign up → add site → run audit against a fixture → see findings → open the share link.
- **LLM:** later, Promptfoo evals over fixture findings, run with a cheap model.

## Decisions log

Record each significant decision in `docs/decisions/NNNN-title.md` with context, decision, and alternatives considered.

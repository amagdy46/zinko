# Agent guide

Rules for AI agents (and humans) working in this repo. Read this before changing code.

## Layout

- `packages/core`: service interfaces (`Context.Service` tags), tagged errors, schemas. No runtime wiring.
- `packages/rules` (`@repo/rules`) judges a run; `packages/llm` (`@repo/llm`) is the pure digest, prompt and answer parser behind AI explanations. Both are built to `dist` and have no runtime wiring.
- `apps/web/src/server/layers.ts`: the single place layers are composed into `AppLayer`.
- `apps/web/src/server/runtime.ts`: runs an Effect against `AppLayer`; server functions go through it.
- `apps/web/src/server.ts`: the Worker entry. Durable Object and Workflow classes are exported from here.
- `apps/web/src/server/routes.ts`: Worker-level routes (`workerRoutes`) tried before TanStack Start.
- `apps/web/src/routes`: TanStack Router file routes. `routeTree.gen.ts` is generated (and gitignored); never edit it.
- `apps/web/src/components/ui`: shadcn components.
- `efforge.jsonc`: the stack choices. `efforge add` reads it; leave it alone.

## Effect

- Model capabilities as services in `packages/core` and implement them as layers; wire layers in `layers.ts`.
- Failures are tagged errors (`Data.TaggedError`) in the error channel, handled with `Effect.catchTag`.
- Validate data at boundaries (requests, env, storage, third-party responses) with `Schema`.
- Reach Cloudflare bindings (R2, D1, KV, Durable Objects, ...) only through `effect-cf`.
- Never wrap an Effect in `try/catch`, and never use `async`/`await` inside `Effect.gen`; use `yield*`.
- Provide layers at entry points only (`runtime.ts`, scripts), not inside library code.
- No `any`. Use `unknown` and narrow it with `Schema` or a type guard.
- Keep `E` types specific; `unknown` or `any` in an error channel is a lint error.

## UI

- Use the existing shadcn components in `components/ui` before writing new ones.
- Style with Tailwind classes and the theme tokens (`bg-background`, `text-muted-foreground`, ...), not hard-coded colors.
- No inline `style` props and no CSS-in-JS.
- Do not add a dependency unless the task cannot be done without it.
- Reuse the shared pieces before writing new ones: `PageHeader` (every page's top: breadcrumb, title, meta, actions), `EmptyState`, `StatusGlyph` plus `StatusBadge`, `SeverityBadge` and `CheckStatusBadge` (a glyph and a word, never colour alone), `lib/format.ts` (`relativeTime`, `duration`, `count`) and the evidence primitives in `components/evidence.tsx`. Use the vocabulary in `docs/ui.md` (Could not check, never "inconclusive"; Not evaluated, never clean).
- Touch targets are at least 32px (`h-8`, `size-8`) and every interactive element, including a focusable `tabpanel` or scroll area, keeps a visible `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background` (a solid 2px ring with a 2px gap in the page colour, so it shows on a primary button too). Where an ancestor clips overflow (a scrolling tab bar, table cells, rows, popovers) use `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset` instead. Do not leave `outline-none` without a ring, and give an active or selected state a shape (underline, rule, fill) that is not a ring.
- A controlled `Dialog` or `Sheet` that opens from something other than its own trigger (a table row, a menu item, a URL search param) restores focus itself: keep a ref to the opener and focus it in `onCloseAutoFocus` after `preventDefault()` (see `ConfirmDialog`, `run-sheet.tsx`, `finding-detail.tsx`).
- Check UI changes at 390px and 1440px in both themes, using the real theme menu (account menu, Theme), with no horizontal page scroll (tables scroll inside their container) and a grayscale look at anything that relies on status or severity.

## Style

- Match the surrounding code: naming, file layout, error handling.
- No comments that restate the code. Comment only the non-obvious why.
- No placeholder code, TODOs or stubs; finish what you start or leave it out.
- No speculative abstractions: do not add options, layers or helpers nobody uses yet.
- No unused exports, imports or variables.
- No `console.log`; use `Effect.log`. `console.warn` and `console.error` are allowed.
- No defensive checks for cases the types already rule out.
- Do not disable lint rules to get a check passing. Fix the code. Generated files are already ignored.

## Commands

| Command                    | Use                                                               |
| -------------------------- | ----------------------------------------------------------------- |
| `pnpm dev`                 | Dev server                                                        |
| `pnpm check`               | Format check, lint (incl. Effect diagnostics), types              |
| `pnpm format`              | Apply formatting (oxfmt via Vite+)                                |
| `pnpm lint`                | Lint only                                                         |
| `pnpm typecheck`           | Regenerate the route tree, then type-check every workspace        |
| `pnpm --filter web routes` | Regenerate `routeTree.gen.ts` after adding or moving a route file |
| `pnpm build`               | Build every workspace                                             |

Lint and format are configured in the root `vite.config.ts`. The Effect rules need the
patched install that `pnpm install` performs (`prepare` script); re-run it if they go quiet.
`routeTree.gen.ts` is not committed: `pnpm install` generates it (`postinstall` in `apps/web`),
`pnpm dev` and `pnpm build` keep it current, and `pnpm typecheck` regenerates it first, so a fresh
clone works after `pnpm install`. Run `pnpm --filter web routes` after adding a route file if
your editor reports a stale route tree. These scripts run the ESM entry of `@tanstack/router-cli`
instead of the `tsr` bin: the bin loads router-core's CommonJS build, which prints a circular-dependency
warning (https://github.com/TanStack/router/issues/8585). Go back to `tsr generate` once that is fixed.

## Current phase: prove it works, write the vision

This overrides the test-first guidance in `docs/roadmap.md`, `CONTRIBUTING.md` and the handoff briefs until it is removed.

- Do not write unit or integration tests yet, and do not use test-driven development. What we build is still settling, and tests would lock in shapes that will change.
- Verify by running the real thing: the CLI, the dev server, a capture against a fixture page, the page in a browser. Report the command you ran and what you saw. "It type-checks" is not "it works".
- There is no test runner: the old tests and Vitest were removed. Do not add them back.
- Keep `docs/vision.md` current: every feature we plan to build and how we will build it (packages, services, data flow, the open questions). Update it whenever a spike or a working feature changes the plan.

## Before you finish

Run `pnpm check && pnpm typecheck && pnpm build` and fix everything it reports.
Zero errors and zero warnings are the bar.

<!-- efforge:section:database -->

## Database (Postgres, Drizzle)

- Tables live in `packages/db/src/auth-schema.ts` (Better Auth), `ai-schema.ts` (`llm_credential`), `explain-schema.ts` (`ai_policy`, `explain_usage`, `finding_explanation`), `audit-schema.ts` (`client`, `site`, `audit`, `run`, `hit`, `datalayer_push`) and `rules-schema.ts` (`check_result`, `finding`, `finding_triage`); queries go through the `Database` service from `@repo/core`.
- Every audit table carries `org_id`; filter by `activeMembership(session).organizationId` and reach runs, hits, pushes, check results, findings and triage only through their audit, checked against the organization. An id from another organization is a 404, never a 403.
- Foreign keys from audits upward are `on delete restrict`: clients and sites with audits are archived (`archived_at`), never deleted; deleting is allowed only without audits.
- `hit` and `datalayer_push` have natural primary keys, `(run_id, request_id, batch_index)` and `(run_id, seq)`, and no `id`. Persisting a run deletes and reinserts its rows in one transaction with `created_at` taken from the run's `finished_at`, so a retry reproduces identical rows. Keep it that way: no `defaultNow()` or random ids in derived rows.
- `check_result` (`(run_id, rule_id)`) is derived the same way: `persist-<n>` writes it in the hits' transaction, `fail-<n>` deletes it. `finish` recomputes `finding` (`(audit_id, rule_id)`) from the check results in one transaction. Each check result stores its rule's area, severity, title, check title (nullable on rows from before it existed), why and fix, and `finish` copies them onto the finding from those rows, never from the live `@repo/rules` registry, so old audits keep their wording and a removed rule's failures still show; do not join findings back to `@repo/rules` for display.
- Triage lives in `finding_triage` (`(audit_id, rule_id)`, no foreign key to `finding`) and is written only by `setTriage`. Accepting a risk requires a `reason`. Never delete or rewrite it from the workflow: recomputing findings must keep it.
- Change the schema, then run `pnpm --filter @repo/db db:generate` to write a migration to `packages/db/drizzle/`, then `pnpm db:migrate`.
- Never edit files under `packages/db/drizzle/` by hand; they are generated.
- Start the local database with `docker compose up -d`.

<!-- efforge:section:auth -->

## Auth (Better Auth)

- Server: `apps/web/src/server/auth.ts` builds the Better Auth instance (`makeAuth`); `auth-live.ts` provides it and the `Auth` service from `@repo/core`. Read the session in Effect code through `Auth.currentSession`, never from cookies directly.
- `/api/auth/*` is served by `auth-route.ts` (a `workerRoutes` entry). Client: `authClient` in `apps/web/src/lib/auth-client.ts`.
- Route guard: `routes/app.tsx` redirects signed-out visitors to `/sign-in?redirect=...`; build redirects with `safeRedirect`, never from raw input.

<!-- efforge:section:auth-schema -->

- Auth tables are in `packages/db/src/auth-schema.ts` (Drizzle); after changing Better Auth plugins regenerate the schema and generate a new migration in `packages/db/drizzle/`, never edit applied ones.

<!-- efforge:section:auth-secret -->

- `BETTER_AUTH_SECRET` signs sessions: Alchemy passes it to the Worker from `.env` locally and from the deploy workflow secret in CI. Never log or return it. `BETTER_AUTH_URL` is the public origin; when unset Better Auth infers it from the request.

<!-- efforge:section:organizations -->

## Organizations

- The `organization()` plugin is enabled: members, roles (`owner`, `admin`, `member`) and invitations live in the `organization`, `member` and `invitation` tables.
- The session carries `activeOrganizationId`; new users are sent to `/onboarding` to create their first organization. Scope data by `activeMembership(session)` from `apps/web/src/server/org-access.ts`, not by `session.activeOrganizationId` alone: a removed member's session keeps the stale id, and `activeMembership` checks the `member` table (it fails with `NotAMember`; answer 404).
- Member management is at `/app/settings/members`; invitations are accepted at `/accept-invite/$id` (the invite link is shown to the inviter, and with the `email` extra it is also emailed).
- Check roles on the server before changing another member's data; the UI hides controls but does not enforce permissions.

<!-- efforge:section:ai -->

## AI (Effect AI, bring your own key)

- Use the `Llm` service from `@repo/core`: `Llm.forOrganization(orgId)` (for an `orgId` you already validated with `membership`) resolves provider, model, endpoint and key once and returns an `LlmModel` (`identity`, non-secret, and `generateText(prompt)`, cut off after `EXPLAIN_ATTEMPT_TIMEOUT_MS`). Keep and use that one model for the whole request; never call `forOrganization` twice or read the session again between choosing evidence and generating. Do not call a provider SDK from app code. `apps/web/src/server/llm-provider.ts` holds `makeLlmLayer({ provider, apiKey, model, baseUrl })`, which builds the Effect `LanguageModel` (`effect/ai`) for `anthropic`, `openai`, `openrouter` or `ollama` (OpenAI-compatible, set a base URL). `@effect/ai` 0.37 is Effect 3: do not add it.
- Each organization saves its own key at `/app/settings/ai`, stored in the `llm_credential` table (`packages/db`), encrypted with AES-GCM (WebCrypto) using `LLM_ENCRYPTION_KEY` (32 random bytes, base64: `openssl rand -base64 32`; the app refuses to start without a valid one). Rotating that key makes saved keys unreadable, so organizations must enter theirs again.
- The key never goes back to the browser (only its last four characters, to owners and admins). Only owners and admins can set, clear or test it; keep that check on the server.
- Each organization has an AI policy (`ai_policy`, `apps/web/src/server/ai-policy-data.ts`, read through `aiPolicyOf`; the server functions are in `ai-policy.ts`): `explanationsEnabled` and `includePagePaths`, both **off** when the row is missing (`AI_POLICY_DEFAULTS` is the one definition; do not copy the defaults). Only owners and admins change it (`saveAiPolicy`, checked on the server from `membership().role`; members get an error, not just a hidden control). Anything that sends findings to a provider must read the policy for the organization it already validated, after the membership and audit checks, and must not run while explanations are off. Gate any server function that spends model tokens with `requireSession` and `membership`.
- Explanations (`apps/web/src/server/explain.ts`, `explain-ledger.ts`): any member may `explainFinding`, only an owner or admin may regenerate (server-checked). Order: membership, audit and failing finding in the organization (404), role, policy gate, digest, cache, then the model. Every provider attempt, retries and regenerations included, is first reserved in `explain_usage` (the spend ledger: one row per attempt, ids and an outcome, no content) in a short transaction under `pg_advisory_xact_lock(hashtext(orgId))`: the cache is re-checked under the lock, another live generation of the same input answers `in-flight`, 30 attempts in the sliding hour answer `limit`. The lock is never held during the provider call. A result is published (`finding_explanation`) in a second locked transaction only if the attempt still owns a live lease (timeout plus 15 s) and nothing later reserved the same input; otherwise it is discarded and the attempt marked `superseded`. Ledger rows older than 24 hours are deleted opportunistically by the next reservation of the same organization (there is no job). Timeouts are the tagged `LlmTimeout`. An explanation is requested by an explicit click only. The stored digest is minimised, not free of personal data, and no API key is stored. Cached text survives key removal (`findCached` ignores the configuration and returns the row's own provider and model) and is hidden, and refused by the server, while explanations are off.
- Never log, return or store the API key in the clear.

<!-- efforge:section:realtime -->

## Rules

- Rules live in `packages/rules` (`@repo/rules`), one file per rule under `src/rules/<area>/`, registered in the `rules` array in `src/index.ts`. The ids and the table of what each fails on are in `docs/plans/2026-10-20-m3-rules-and-findings/plan.md`.
- A rule is a pure function of one run (`evaluate(input: RunInput): CheckResult`): no Effect, no I/O, no clock, no random. It returns `pass`, `fail`, `inconclusive` or `not_applicable` with a message that names the reason. The rule's title, why-it-matters, fix steps and `owner` (`consent-platform`, `tag-manager` or `developer`: who usually fixes it) are static values, stored on `check_result` and copied onto `finding` by `finish` from the newest rules version's rows, like the other wording; the LLM (M4) explains findings, it never decides.
- Every `fail` cites at least one `EvidenceRef` (hit, request, cookie, push, document) that `getEvidence` can resolve for that run. Messages never repeat a value that may be personal data (an email, a phone number).
- Branch on `input.capture.consent.outcome` first: `accepted` and `rejected` split hits at `actionAt`; `none` and `not-found` have no action (`gpc` is a scenario, `input.scenario`, whose outcome is `none`). A rule that cannot tell returns `inconclusive` with the reason, never a guess; a rule that does not apply returns `not_applicable`.
- Decoders (`@ovriq/zinko-decoders`) say what a request is; rules say whether it is a problem. If a rule needs a fact the decoders drop, extend the decoder, not the rule.
- `evaluateRun` is the only entry point. The `persist` workflow step and `zinko capture --rules` both call it on the stored capture, so a run is judged the same in the app and the CLI. Raise `RULES_VERSION` when a rule is added or removed or a verdict can change for the same run.
- To add a rule: (1) add a fixture site in `packages/fixtures/sites.mjs` with the bug, and write its expected result set (rule × scenario × status) in `packages/fixtures/README.md` before the rule exists; (2) write the rule and register it; (3) prove it with `zinko capture <fixture-url> --scenario all --rules --block-vendors` (add `--mobile`, and `--goto` for a journey rule): the output must match the README for the new fixture, and `clean` must stay at its baseline. Paste the command and the result in the PR. No unit tests.
- Findings and check results are derived rows (`check_result`, `finding`): `persist-<n>` writes a run's check results with its hits, `finish` rewrites the audit's findings from them. Triage (`finding_triage`) is stored apart and never rewritten. Do not give a derived row a random id or `defaultNow()`.

## Realtime

- The realtime extra's generated public room (`Room`, `Realtime`, `useRoom`, `/ws/rooms/*`) was replaced by the audit room; `efforge.jsonc` still lists the old files, leave it alone.
- Live audit progress goes through one Durable Object per audit, `AuditRoom` (`apps/web/src/realtime/AuditRoom.ts`, exported from `apps/web/src/server.ts`, bound as `AUDIT_ROOM`, named by audit id). Sockets hibernate, at most 50 per room, and client messages are ignored: browsers only listen.
- Server code publishes with `AuditProgress.publish(auditId, event)` from `@repo/core` (`audit.ts`; `AuditEvent` is a `Schema`). Do not call the namespace directly.
- `/ws/audits/<auditId>` (`server/audit-room-route.ts`) validates the id, checks the `Origin` is the app's own (403), resolves the session with `Auth.sessionFromHeaders` (401), then checks with `activeMembership` that the audit is in an organization the user belongs to (404) before touching the Durable Object. Keep that order; never add a route to a room without an auth check.
- In the UI use `useAuditRoom(auditId, onSignal, enabled)` (no socket while `enabled` is false, so a finished audit costs nothing) (`apps/web/src/lib/use-audit-room.ts`). Every signal (`refresh` on open and every 4 minutes, `run`, `audit`) means "refetch the audit". It validates messages with `Schema` and reconnects with backoff.

<!-- efforge:section:storage -->

## Capture admission

- Audits take turns on the capture engines through one `AdmissionGate` Durable Object (`apps/web/src/browser/AdmissionGate.ts`, exported from `apps/web/src/server.ts`, bound as `ADMISSION_GATE`, named `engines`), reached only through the `CaptureAdmission` service from `@repo/core` (`admit`, `confirm`, `release`; `apps/web/src/server/admission.ts`). Decision: `docs/decisions/0003-capture-admission.md`.
- Capture on the engine `admit` handed out (`Browser.capture(.., { instance: engine })`), never on an instance named after the audit. `Browser.engines` lists the engines: `local` for `BROWSER_URL`, `engine-0`..`engine-<n-1>` for the containers, where `BROWSER_ENGINES` must equal the container's `maxInstances` (both come from one constant in `infra/alchemy.run.ts`).
- First come, first served per capture: every capture joins the tail and releases its grant after capture storage, before persistence. Grants carry tokens; every actual browser attempt must `confirm` its token immediately before capture (90 s to claim, then a 5-minute lease). Admission is keyed by audit and capture turn (`admit(auditId, turn)`): the same turn gets the same grant, a new turn drops the audit's stale grant and joins the tail, so a failed release never lets a capture keep its slot. A lost grant queues again under a new durable step name, never by replaying cached admission. Release only the matching token. Waiters sleep in `waitForEvent` (`ENGINE_FREE_EVENT`) and re-ask every minute; promotions wake them through `Jobs.sendEvent`.

## Storage

- Use the `Storage` service from `@repo/core` (put, head, get, delete, signedUrl, verify); do not touch the R2 binding directly. `head` returns an object's metadata without its body, `Option.none` when absent: use it to ask whether a key exists (the audit workflow reuses a stored `capture.json` this way) instead of `get`.
- The implementation is `apps/web/src/server/storage.ts` on the `STORAGE` R2 binding; downloads are served by the Worker route in `storage-route.ts`.
- Signed URLs are HMAC-signed with the `STORAGE_SIGNING_SECRET` secret (at least 32 characters; the app fails to start without it). Never log or return it.
- Storage keys are opaque: generate them on the server, never from raw user input. Files are served as attachments with `nosniff`, inline only for raster images.

<!-- efforge:section:email -->

## Email

- Send mail through the `Mailer` service from `@repo/core` (`send({ to, subject, text, html? })`); do not use the `EMAIL` binding directly. Always send a `text` body.
- `apps/web/src/server/mailer.ts` picks the transport from `MAIL_TRANSPORT`: `console` (set in `.dev.vars`) prints the message to the dev server log, anything else sends through Cloudflare Email Service with the `EMAIL` `send_email` binding. `MAIL_FROM` must be an address on a domain enabled for sending: `wrangler email sending enable <domain>`.
- Transactional mail only (invitations, receipts, password resets); use a dedicated platform for marketing or bulk sends.

<!-- efforge:section:email-invitations -->

### Invitation emails

- `organization({ sendInvitationEmail })` in `auth.ts` calls `invitation-email.ts`, which emails the `/accept-invite/<id>` link through the `Mailer`. A failed send is logged and does not fail the invitation; the link is still shown to the inviter.

<!-- efforge:agents -->

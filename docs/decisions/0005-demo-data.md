# 0005: Demo data and the mutation gate

Date: 2026-10-28 · Status: in progress (Task 15 built: the registry and the inventory; Tasks 16 to 18 add the seed, the demo runtime and the deployment, the last two behind owner gate Q7)

## Context

A hosted demo (if the owner approves it, gate Q7) must be read-only for the demo organization, and the app must keep it that way when someone adds a server function later. Before Task 15 there was no list of the state-changing entry points: `read()` and `respond()` share a path, `ai-settings.ts` and `run-browser.ts` called `runtime.runPromise` directly, and Better Auth and the Worker routes sit outside the server-function path.

## Decision (Task 15, independent of the demo)

- Every server function is classified in `ENTRY_POINTS` (`apps/web/src/server/entry-points.ts`) as `read` (GET, `read(...)`) or `mutation` (POST, `mutation(...)`); `mutation` is `respond` plus the future demo refusal.
- Every Worker route declares `<name>Meta` (path, methods, access) next to it; `read` routes have a method guard.
- `RUNTIME_ALLOWED` lists the only files that may run an Effect directly.
- `scripts/check-entry-points.mjs` enforces all three in `pnpm check`. It uses the TypeScript 7 compiler API (`typescript/unstable/sync`: `ts.createSourceFile` no longer exists in the installed `typescript@7.0.2`); it opens the `apps/web` project and reads syntax trees only, never the type checker, and imports no application module.

## Inventory (before the migration, from `rg`)

Server functions (46): 22 GET, 24 POST. All GET functions are `read`. Every POST is a `mutation`: AI policy and AI key save, clear and test; explain; branding save, logo upload and removal; clients and sites create, archive, delete, address; start audit; triage; report edit and finding edit; publish and delete snapshot; share create and revoke; `runBrowser`. Notes:

| Site | Finding | Result |
|---|---|---|
| `ai-settings.ts` | four direct `runtime.runPromise` calls, three of them writes | now `mutation(...)` / `read(...)`; the `{ ok, message }` result shape is kept |
| `run-browser.ts` | direct `runtime.runPromise` on the capture engine | `mutation(...)`; the function has no caller in the UI |
| `report-share.ts` `listShares` | a GET that used `respond` | now `read(...)`; the share dialog takes the list directly |
| `session.ts` `getAppState` | a GET that also calls `setActiveOrganization` (a session write, repairs a stale active organization) | registered `read`: it only repairs the caller's own session; the demo's Better Auth allowlist keeps set-active-organization |
| `require-session.ts`, `session.ts` | read the session through the runtime | in `RUNTIME_ALLOWED` |
| `auth-live.ts` | `Effect.runPromiseWith` and two dynamic `import()`s (import cycle with `report-publish-data`) | in `RUNTIME_ALLOWED`; literal dynamic imports allowed only there |
| `invitation-email.ts` | its own `ManagedRuntime` (import cycle with `runtime`) | in `RUNTIME_ALLOWED` |

Worker routes (5): `/api/auth/*` (Better Auth, all methods, `mutation`), `/ws/audits/*` (WebSocket upgrade, `read`, GET; it had no method restriction and now answers 405 to anything but GET), `/files/*`, `/r/*` and `/api/audits/*/register.csv` (`read`, GET).

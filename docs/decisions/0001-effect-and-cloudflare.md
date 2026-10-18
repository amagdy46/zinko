# 0001: Effect 4 on Cloudflare

Date: 2026-10-18 · Status: accepted

## Context

Ovriq's house stack is Effect and Cloudflare. Zinko's first plan used Node, pg-boss and Docker Compose on a VPS. Zinko needs a real browser that behaves like a visitor's, which is the one part that doesn't fit Workers directly.

## Decision

- Effect 4 (`effect@4.0.x`, stable since 4.0.0) for all I/O code; Effect Schema instead of Zod; `@effect/ai` for BYOK LLMs.
- Cloudflare: TanStack Start on Workers, Workflows for audit orchestration, a Durable Object per audit for live progress, R2 for artifacts, Hyperdrive to Postgres (Neon).
- Audits run Playwright + Chromium in a **Cloudflare Container**, not Browser Rendering, because Browser Rendering always identifies itself as a bot and can't pass bot protection.
- Infra as code with **Alchemy v2** (Effect-based): one `infra/alchemy.run.ts` declares the Worker (`Cloudflare.Website.Vite`), Workflow, Durable Object, Container, R2, Hyperdrive and Neon. Per-PR stages give preview environments.
- Pure code (decoders, rules) stays plain TypeScript; Cloudflare types stay in `apps/web`.

## Alternatives considered

- **Node + pg-boss + Docker on a VPS:** simplest self-host, but off the house stack.
- **wrangler.jsonc + Terraform/manual Neon:** works, but splits infra across two tools and isn't Effect.
- **D1 instead of Postgres:** cheaper and simpler on Cloudflare, but locks self-hosters in.
- **Browser Rendering for capture:** no image to maintain, but bot-labelled traffic gives wrong results on protected sites.

## Consequences

- Self-hosting in v0.1 means "your own Cloudflare account". A Node target is possible later because the core has no Cloudflare imports.
- Containers require Workers Paid.
- Alchemy 2 is still published as beta (`2.0.0-beta.83` on the `latest` tag); pin the exact version.
- Container egress behaviour on bot-protected sites must be checked in M1.

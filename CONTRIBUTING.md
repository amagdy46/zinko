# Contributing to Zinko

Needs Node 24.11+ or 26+ (not 25) and pnpm.

```sh
pnpm install
pnpm build                 # the CLI imports the built decoders package
pnpm check && pnpm typecheck
```

Run both checks before opening a pull request; zero errors and zero warnings is the bar.

- [AGENTS.md](./AGENTS.md): code layout and rules, for people and coding agents.
- [infra/README.md](./infra/README.md): running the web app locally (`pnpm dev`) and deploying it.
- [docs/architecture.md](./docs/architecture.md) and [docs/decisions/](./docs/decisions/): how the pieces fit and why.
- [docs/roadmap.md](./docs/roadmap.md): milestones and how we build.

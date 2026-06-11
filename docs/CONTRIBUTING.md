# Contributing

QQueue is in early development. Contributions should focus on clean foundations, small changes, and clear behavior.

## Getting Started

```sh
cp .env.example .env
pnpm install
docker compose up -d
pnpm db:generate
pnpm dev
```

## Development Guidelines

- Keep changes scoped to the feature or bug being addressed.
- Add types and Zod schemas for shared contracts.
- Keep API route, controller, and service responsibilities separate.
- Avoid implementing analytics, visual editors, or managed-cloud concerns before the core sending path is ready.
- Prefer provider abstractions over hardcoded vendor behavior.
- Keep managed-cloud code under `apps/cloud/`; core apps and packages must not
  depend on `@qqueue/cloud`.
- Add `Signed-off-by` to commits with `git commit -s` so the CLA check passes.

## Checks

Run these before opening a pull request:

```sh
pnpm typecheck
pnpm lint
pnpm build
pnpm cloud:boundary
pnpm license:audit
```

## Documentation

Update docs when changing architecture, public APIs, queue behavior, provider behavior, or local development steps.

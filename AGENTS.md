# QQueue Repo Context

QQueue is a TypeScript monorepo for a self-hosted email platform. It is intentionally early-stage: keep changes scaffold-friendly, avoid overbuilding, and leave TODOs where product behavior is not ready yet.

## Project Shape

- Root workspace: pnpm workspaces and Turborepo.
- Package manager: pnpm.
- Runtime: Node.js.
- Main scripts live in `package.json`:
  - `pnpm dev`
  - `pnpm build`
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm format`
  - `pnpm db:generate`
  - `pnpm db:migrate`

## Apps

- `apps/api`: Express API.
  - Entry point: `apps/api/src/index.ts`
  - App setup: `apps/api/src/app.ts`
  - Environment config: `apps/api/src/config/env.ts`
  - Prisma client: `apps/api/src/lib/prisma.ts`
  - Health route: `GET /health` in `apps/api/src/routes/health.ts`
  - API v1 router: `apps/api/src/routes/v1.ts`
  - Feature modules live in `apps/api/src/modules/*`
  - Prisma schema: `apps/api/prisma/schema.prisma`

- `apps/web`: Vite React dashboard.
  - Entry point: `apps/web/src/main.tsx`
  - Routes: `apps/web/src/routes/AppRoutes.tsx`
  - Dashboard shell: `apps/web/src/layouts/DashboardLayout.tsx`
  - Pages: `apps/web/src/pages/*`
  - Tailwind config: `apps/web/tailwind.config.ts`

- `apps/worker`: BullMQ workers.
  - Entry point: `apps/worker/src/index.ts`
  - Redis/BullMQ config: `apps/worker/src/config/*`
  - Queues: `apps/worker/src/queues/*`
  - Workers: `apps/worker/src/workers/*`

## Packages

- `packages/shared`: shared domain types and Zod schemas.
  - Main export: `packages/shared/src/index.ts`

- `packages/email-engine`: email provider abstraction.
  - Provider interface: `packages/email-engine/src/types/index.ts`
  - SMTP provider: `packages/email-engine/src/providers/smtp-provider.ts`
  - Future provider placeholders: `packages/email-engine/src/providers/future-providers.ts`

- `packages/sdk`: placeholder TypeScript SDK.
  - Client scaffold: `packages/sdk/src/index.ts`

## Related Repositories

- `../qqueue-landing-page`: sibling repository for the QQueue marketing/landing page.
  - It is not part of this pnpm workspace.
  - Check this repo when tasks mention the landing page, marketing site, public homepage, product copy, or visual changes outside the dashboard app.

## Docs

- `README.md`: product overview and local setup.
- `docs/ROADMAP.md`: phased roadmap with checkboxes.
- `docs/ARCHITECTURE.md`: system architecture and queue flow.
- `docs/DECISIONS.md`: initial architecture decisions.
- `docs/CONTRIBUTING.md`: contributor setup and expectations.

## Local Development

Use these commands from the `qqueue/` directory:

```sh
cp .env.example .env
pnpm install
docker compose up -d
pnpm db:generate
pnpm dev
```

Default URLs:

- API: `http://localhost:4000`
- Health: `http://localhost:4000/health`
- Web: `http://localhost:5173`

## Implementation Notes

- Keep API route, controller, and service responsibilities separate.
- Do not implement full auth, analytics, billing, or a drag-and-drop editor yet.
- Prefer shared types/Zod schemas in `packages/shared` for cross-app contracts.
- Add provider-specific sending logic behind the `EmailProvider` interface.
- Keep worker behavior queue-focused; long-running sending and campaign fan-out belong in `apps/worker`.
- PostgreSQL is the source of truth. Redis is for queues.
- Mailcow-compatible SMTP should start through the generic SMTP provider path.

## Verification

Before handing off meaningful code changes, run:

```sh
pnpm typecheck
pnpm lint
pnpm build
```

# CLAUDE.md

QQueue is a self-hosted **email operations platform** for developers and small
teams — a TypeScript monorepo (pnpm workspaces + Turborepo) currently at a
**feature-complete self-hosted beta**. See `docs/STATUS.md` for the live state
and `docs/ROADMAP.md` for the phased plan.

## The one invariant to preserve

Campaign, transactional, and manual sends are **three entry points into one
delivery pipeline**, not three products:

```
EmailJob → BullMQ → @qqueue/email-engine → SMTP → EmailEvent
```

When adding a send path, route it through this pipeline (set `EmailJob.origin`
to `CAMPAIGN | TRANSACTIONAL | MANUAL` and `createdByUserId` where relevant). Do
**not** introduce a parallel delivery path. The `manual-email` module is the
reference example: it resolves recipients then delegates to
`transactionalEmailService.send`.

## Licensing boundary (important)

This is **open core in one repo**. Everything outside `apps/cloud/` is
**AGPL-3.0** (`LICENSE`). `apps/cloud/` is **proprietary** under its own
commercial license. The boundary is enforced in CI:

- AGPL core packages must **never** depend on `@qqueue/cloud`.
- Keep multi-tenant/billing/usage-metering code on the `apps/cloud` side; keep
  reusable primitives (auth, queue, sending) in the AGPL core.
- `pnpm cloud:boundary` checks this; see `docs/CLOUD_BOUNDARY.md`.

## Project Shape

- Package manager: pnpm (`pnpm@9.15.0`). Runtime: Node.js.
- Root scripts (`package.json`): `pnpm dev`, `build`, `lint`, `typecheck`,
  `test`, `format`, `db:generate`, `db:migrate`, `test:smoke:docker`,
  `coverage`, `cloud:boundary`, `license:audit`.

## Apps

- `apps/api` — Express API. Route/controller/service separation per module under
  `apps/api/src/modules/*` (auth, organizations, smtp-connections, contacts,
  contact-lists, templates, campaigns, transactional-email, manual-email,
  email-drafts, attachments, api-keys, webhooks, tracking, unsubscribe,
  suppressions, segments, domain-throttles, deliverability, queue-operations,
  dashboard, inbox). Entry `src/index.ts`; app `src/app.ts`; env `src/config/env.ts`;
  Prisma client `src/lib/prisma.ts`; v1 router `src/routes/v1.ts`; health
  `src/routes/health.ts`. Prisma schema split under `prisma/schema/*.prisma`
  (`core.prisma` AGPL, `cloud.prisma`), migrations in `prisma/schema/migrations`.
- `apps/web` — Vite + React + Tailwind dashboard. Entry `src/main.tsx`; routes
  `src/routes/AppRoutes.tsx`; shell `src/layouts/DashboardLayout.tsx`; pages
  `src/pages/*`; session in `src/lib/session*.ts(x)`.
- `apps/worker` — BullMQ workers. Entry `src/index.ts`; queues `src/queues/*`;
  workers `src/workers/*` (campaign-processing, email-sending, webhook-delivery,
  inbox-sync); startup recovery re-enqueues queued/scheduled work.
- `apps/cloud` — **proprietary** managed-cloud boundary (billing, usage-limits,
  workspaces). Scaffold only; no production cloud behavior yet.

## Packages

- `packages/shared` — domain types + Zod schemas; **also consumed by the browser
  (`apps/web`)**, so keep it free of `node:*`-only code (no `node:crypto`, no
  filesystem). Cron/timezone helpers (`isValidCron`, `nextCronRun`) live here.
- `packages/email-engine` — provider abstraction (`EmailProvider`), Nodemailer
  SMTP provider, MJML email-safe render layer, tracking URL/token helpers,
  bounce classification, placeholder providers (Mailcow/SES/Resend/Brevo/Postmark).
- `packages/storage` — S3-compatible object-storage client (AWS S3 v3 SDK; works
  against MinIO) for attachment blobs; metadata stays in Postgres.
- `packages/sdk` — MIT-licensed TypeScript SDK (currently wraps the transactional
  send endpoint only).

## Related Repositories

- `../qqueue-landing-page` — sibling marketing/landing-page repo, **not** part of
  this workspace. Check it for landing page / marketing / public homepage work.

## Local Development

```sh
cp .env.example .env
pnpm install
docker compose up -d        # postgres, redis, minio
pnpm db:generate
pnpm dev
```

Default URLs: API `http://localhost:4000` (health `/health`), Web
`http://localhost:5173`.

## Conventions & guardrails

- Keep route/controller/service responsibilities separate.
- Prefer shared types/Zod schemas in `packages/shared` for cross-app contracts.
- Add provider-specific sending behind the `EmailProvider` interface.
- PostgreSQL is the source of truth; Redis is for queues only.
- Mailcow-compatible SMTP goes through the generic SMTP provider path.
- Long-running sending and campaign fan-out belong in `apps/worker`.
- Prisma migrations are committed and additive; verify against a throwaway
  Postgres and confirm `prisma migrate diff` reports no drift.

## Docs

`README.md`, `docs/STATUS.md` (live state), `docs/ROADMAP.md`,
`docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (the *why* behind design choices),
`docs/CLOUD_BOUNDARY.md`, `docs/DEPLOY.md`, `docs/MAILCOW_SETUP.md`,
`docs/CONTRIBUTING.md`, and the phase plans (`docs/PHASE_*_PLAN.md`).

## Verification

Before handing off meaningful changes, run:

```sh
pnpm typecheck
pnpm lint
pnpm build
pnpm test
```

For changes touching the send pipeline or migrations, also run
`pnpm test:smoke:docker`. For dependency or cloud-boundary changes, run
`pnpm license:audit` and `pnpm cloud:boundary`.

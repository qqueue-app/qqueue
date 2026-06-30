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

Every send also resolves *who it sends as* via `apps/api/src/lib/sender.ts`:
`resolveSender` picks a sender identity → explicit SMTP connection → org default,
and `dkimSignOptionsFor` decides whether to sign DKIM. Set
`EmailJob.senderIdentityId` and let these helpers derive the From header and DKIM
options — don't re-derive them per send path.

## Licensing boundary (important)

This is **open core in one repo**. Everything outside `apps/cloud/` is
**AGPL-3.0** (`LICENSE`). `apps/cloud/` is **proprietary** under its own
commercial license. The boundary is enforced in CI:

- AGPL core packages must **never** depend on `@qqueue/cloud`.
- Keep multi-tenant/billing/usage-metering code on the `apps/cloud` side; keep
  reusable primitives (auth, queue, sending) in the AGPL core.
- `pnpm cloud:boundary` checks this; see `docs/CLOUD_BOUNDARY.md`.

## What's built (feature surface)

Check this before building something — most of the platform already exists.
`docs/STATUS.md` is the authoritative, detailed inventory.

- **Sending** — campaigns (drafts, send-now, one-shot schedule, cron
  recurrence, pause/resume, A/B subject testing with delayed winner decision,
  per-variant analytics); transactional API/SDK/SMTP sends with `Idempotency-Key`
  support; manual sends via **Email Studio** (multi-`To`/CC/BCC, contact + list
  pickers, template apply, Tiptap editor, MJML preview, drafts, attachments,
  schedule-for-later, per-recipient delivery status). UI send surfaces pick a
  **sender identity** rather than free-typing a From address.
- **Sender identity** — **sending domains** decouple the visible From-domain from
  the single authenticating SMTP credential, with `EXTERNAL` vs `MANAGED` DKIM
  modes; managed mode generates an RSA-2048 keypair, signs DKIM in-process,
  surfaces the DNS records to publish, and a verification worker moves the domain
  `PENDING → VERIFIED/FAILED`. **Sender identities** are concrete From
  (name+email) records under a domain, bound to the SMTP account that transports
  them; one can be the org default.
- **Audience** — contacts (tags, status, CSV import/export, activity timeline);
  contact lists (explicit `ContactListMember` join with `source`); dynamic
  **segments** (rule tree resolved at send time; preview + materialize to a
  list); org-wide **suppressions** + RFC 8058 List-Unsubscribe; bounce-driven
  auto-suppression (soft/hard thresholds).
- **Deliverability** — per-domain throttling (worker-side Redis fixed window);
  deliverability dashboard (rates, per-domain breakdown, reputation alerts);
  open/click tracking via HMAC-signed tokens.
- **Templates** — metadata (description/category/tags), declared variables with
  sample/default values + `{{variable}}` substitution, starter templates, and a
  dedicated `TemplateEditor` page (Tiptap editor in `apps/web/src/components/editor/*`).
- **Inbox** — IMAP reply sync, conversation grouping, reply-from-QQueue (no
  ticketing/assignment). Mounts by default; the old `INBOX_ENABLED` flag is gone.
- **Ops** — outbound signed webhooks (+ delivery history/retry); inbound ESP
  webhook normalization; queue operations dashboard (OWNER/ADMIN only); Redis
  rate limiting; password reset (delivered via the org's SMTP connection).

Not built: org invitations / member-management UI, billing/usage metering
(cloud), email verification/MFA, and SDK coverage beyond `sendEmail`.

## Project Shape

- Package manager: pnpm (`pnpm@9.15.0`). Runtime: Node.js.
- Root scripts (`package.json`): `pnpm dev`, `build`, `lint`, `typecheck`,
  `test`, `format`, `db:generate`, `db:migrate`, `test:smoke:docker`,
  `coverage`, `cloud:boundary`, `license:audit`.

## Apps

- `apps/api` — Express API. Route/controller/service separation per module under
  `apps/api/src/modules/*` (auth, organizations, smtp-connections,
  sending-domains, sender-identities, contacts, contact-lists, templates,
  campaigns, transactional-email, manual-email, email-drafts, attachments,
  api-keys, webhooks, tracking, unsubscribe, suppressions, segments,
  domain-throttles, deliverability, queue-operations, dashboard, inbox). Entry
  `src/index.ts`; app `src/app.ts`; env `src/config/env.ts`;
  Prisma client `src/lib/prisma.ts`; v1 router `src/routes/v1.ts`; health
  `src/routes/health.ts`. Prisma schema split under `prisma/schema/*.prisma`:
  `core.prisma` (AGPL — all product models: `Organization`, `SMTPConnection`,
  `SendingDomain`/`SenderIdentity` (+ `DkimMode`/`DkimStatus` enums),
  `Contact`/`ContactList`/`ContactListMember`, `Suppression`/`SuppressionPolicy`,
  `DomainThrottle`, `Template`, `Campaign`/`CampaignVariant`/`CampaignRun`,
  `Segment`, `EmailJob`/`EmailEvent`/`EmailDraft`/`EmailAttachment`,
  `InboxAccount`/`InboundMessage`, `ApiKey`, `WebhookEndpoint`/`WebhookDelivery`)
  and `cloud.prisma` (proprietary — `Subscription`/`Seat`/`UsageCounter`).
  Migrations in `prisma/schema/migrations`.
  - **Naming:** the UI calls SMTP connections "**sending accounts**", but the
    code keeps `smtp-connections` (module, `/smtp-connections` route, and the
    `SMTPConnection` model) — don't rename the backend to match the label.
- `apps/web` — Vite + React + Tailwind dashboard. Entry `src/main.tsx`; routes
  `src/routes/AppRoutes.tsx`; shell `src/layouts/DashboardLayout.tsx`; pages
  `src/pages/*` (`Dashboard`, `EmailStudio`, `Campaigns`/`CampaignAnalytics`,
  `Contacts`, `ContactLists`, `Templates`/`TemplateEditor`, `Segments`,
  `Suppressions`, `Deliverability`, `Inbox`, `SMTPConnections`,
  `SendingDomains`, `QueueOperations`, `Settings`, public `Legal`/`Login`);
  Tiptap editor primitives in `src/components/editor/*` (`RichTextEditor`,
  `TemplatePreview`, `VariablesPanel`, CTA `button-extension`, `starters`,
  `variables` extract/apply); session in `src/lib/session*.ts(x)`.
- `apps/worker` — BullMQ workers. Entry `src/index.ts`; queues `src/queues/*`;
  workers `src/workers/*` (campaign-processing, email-sending, webhook-delivery,
  inbox-sync, dkim-verification); startup recovery re-enqueues queued/scheduled
  work and schedules the daily managed-DKIM DNS recheck.
- `apps/cloud` — **proprietary** managed-cloud boundary (billing, usage-limits,
  workspaces). Scaffold only; no production cloud behavior yet.

## Packages

- `packages/shared` — domain types + Zod schemas; **also consumed by the browser
  (`apps/web`)**, so keep it free of `node:*`-only code (no `node:crypto`, no
  filesystem). Cron/timezone helpers (`isValidCron`, `nextCronRun`) and the pure
  DKIM helpers (`shouldSignManagedDkim`, DNS-record builders/parsers like
  `dkimDnsHost`/`dkimTxtValue`/`buildSendingDomainDnsRecords`) live here — actual
  RSA keygen stays server-side in `apps/api/src/lib/dkim.ts`.
- `packages/email-engine` — provider abstraction (`EmailProvider`), Nodemailer
  SMTP provider (per-message DKIM signing via the `dkim` send option), MJML
  email-safe render layer, tracking URL/token helpers, bounce classification,
  placeholder providers (Mailcow/SES/Resend/Brevo/Postmark).
- `packages/storage` — S3-compatible object-storage client (AWS S3 v3 SDK; works
  against MinIO) for attachment blobs; metadata stays in Postgres.
- `packages/sdk` — MIT-licensed TypeScript SDK (currently wraps the transactional
  send endpoint only; `sendEmail` accepts `senderIdentityId` or `smtpConnectionId`).

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

## Configuration

Env is validated in `apps/api/src/config/env.ts` (Zod). Notable knobs beyond the
standard `DATABASE_URL`/`REDIS_*`/`APP_URL`/`*_ORIGIN`:

- **Secrets** — `ENCRYPTION_KEY` (SMTP creds at rest), `TRACKING_SECRET` (signed
  open/click tokens), `WEBHOOK_SECRET` (signed outbound webhooks),
  `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`.
- **Object storage** (attachments) — `S3_ENDPOINT`/`S3_REGION`/`S3_BUCKET`/
  `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` (MinIO locally), `ATTACHMENT_MAX_BYTES`.
- **Deliverability tuning** — `SOFT_BOUNCE_THRESHOLD`/`SOFT_BOUNCE_WINDOW_DAYS`
  (auto-suppression), `DEFAULT_DOMAIN_MAX_PER_MINUTE` (per-domain throttle default).

## Conventions & guardrails

- Keep route/controller/service responsibilities separate.
- Prefer shared types/Zod schemas in `packages/shared` for cross-app contracts.
- Add provider-specific sending behind the `EmailProvider` interface.
- PostgreSQL is the source of truth; Redis is for queues only.
- Mailcow-compatible SMTP goes through the generic SMTP provider path.
- Long-running sending and campaign fan-out belong in `apps/worker`.
- Suppression enforcement is part of the pipeline, not optional: campaign
  fan-out excludes suppressed recipients and the send worker re-checks before
  delivery. New send paths must respect suppressions — don't route around them.
- Transactional sends dedupe on the `Idempotency-Key` header; preserve that for
  any externally-retried send surface.
- Resolve the From identity through `resolveSender` and DKIM through
  `dkimSignOptionsFor` (`apps/api/src/lib/sender.ts`); don't hand-build From
  headers or DKIM options in a new send path. QQueue only signs DKIM for
  `MANAGED`, `VERIFIED` sending domains — leave `EXTERNAL` domains to the upstream
  relay.
- Prisma migrations are committed and additive; verify against a throwaway
  Postgres and confirm `prisma migrate diff` reports no drift.

## Docs

- **Orientation:** `README.md`, `docs/STATUS.md` (live state),
  `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (the *why*
  behind design choices), and the phase plans (`docs/PHASE_*_PLAN.md`).
- **Operate / deploy:** `docs/DEPLOY.md`, `docs/MAILCOW_SETUP.md`,
  `docs/SMTP_PROVIDER_GUIDE.md`, `docs/TROUBLESHOOTING.md`, `docs/FAQ.md`.
- **Onboarding / usage:** `docs/QUICKSTART.md`, `docs/FIRST_USER_EXPERIENCE.md`,
  `docs/FIRST_EMAIL.md`, `docs/FIRST_CAMPAIGN.md`, `docs/TRANSACTIONAL_API.md`.
- **Boundary / legal:** `docs/CLOUD_BOUNDARY.md`, `docs/LICENSING.md`,
  `docs/DEPENDENCY_LICENSES.md`, `docs/CONTRIBUTING.md`, `docs/legal/*`.

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

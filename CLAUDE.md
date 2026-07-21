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

Every send resolves *who it sends as* from the SMTP connection: an explicit
`smtpConnectionId` on the request, else the org's default connection (see
`transactionalEmailService.send`). Don't hand-build From headers per send path.
(Sending Domains / Sender Identities / managed DKIM were removed from core in
`bcb3475` — don't resurrect them without a fresh decision.)

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
  support; manual sends via **Email Studio** (multi-`To`/CC/BCC always visible
  with autocomplete over contacts + past recipients, contact + list pickers,
  template apply, Tiptap editor, MJML preview, drafts, attachments,
  schedule-for-later, per-recipient delivery status). UI send surfaces pick a
  **sending account** (SMTP connection) rather than free-typing a From address,
  and the From picker names the account a send resolves to instead of just
  saying "default".
- **Drafts + Outbox** — `/drafts` lists composer drafts and deep-links back into
  the composer (`/email-studio?draft=<id>`); `/outbox` shows every `EmailJob`
  still `PENDING`/`QUEUED`/`PROCESSING` for the org (any origin) with its
  sending account, and cancels the ones SMTP hasn't seen yet. Cancel sets
  `EmailJob.status = CANCELLED` and removes the delayed BullMQ job; the send
  worker already skips `CANCELLED` rows, so losing that race is safe. This is
  the everyone-facing view — `/queue-operations` stays the admin BullMQ inspector.
- **First-run onboarding** — `pnpm setup` CLI (plain-language guided `.env`
  creation: secret generation, infra reachability checks, migrations); a
  one-time `/setup` web wizard gated on zero users (admin account → verified
  sending account → registration policy → optional test email), resumable via
  `setupCompletedAt`; DB-backed `InstanceSetting` key-value store with env
  fallback (`apps/api/src/lib/instance-settings.ts`); registration gating
  (`allowPublicRegistration`, default closed after setup, bootstrap exception
  while zero users exist); `User.isInstanceAdmin` + Settings "Instance" card
  (registration toggle, env health view).
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
  Editor links/buttons/variables are collected in in-app dialogs (no browser
  `prompt`); images can be uploaded from the device (stored as `ImageAsset`,
  embedded by public URL) or linked; CTA buttons carry their own
  colour/size/corner styling, sit inline beside text, and are editable in place.
  - **`CtaButton` is an inline atom, not a block.** A block node can only ever
    occupy its own line, so it could never sit beside text. Placement is
    therefore the *paragraph's* `text-align` (owned by the TextAlign
    extension), not a button attribute — the dialog's alignment control writes
    to the line, and only when the user changes it.
  - Three traps live in that extension, all with regression tests:
    its parse rule needs a high **rule** `priority` to beat Link (extension
    priority would also reorder the schema and make this content-less atom the
    default block type, breaking lists and Enter); `font-weight` must stay off
    the anchor and on the inner label span, or Bold parses it back as a mark
    and wraps the button in `<strong>` on every reopen; and colours are
    hex-validated before reaching an inline `style`.
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
  `test`, `format`, `setup` (guided first-run config), `db:generate`,
  `db:migrate`, `test:smoke:docker`, `coverage`, `cloud:boundary`,
  `license:audit`.

## Apps

- `apps/api` — Express API. Route/controller/service separation per module under
  `apps/api/src/modules/*` (auth, setup, instance-settings, organizations,
  smtp-connections, contacts, contact-lists, templates,
  campaigns, transactional-email, manual-email, email-drafts, outbox, attachments,
  images, api-keys, webhooks, tracking, unsubscribe, suppressions, segments,
  domain-throttles, deliverability, queue-operations, dashboard, inbox). Entry
  `src/index.ts`; app `src/app.ts`; env `src/config/env.ts`;
  Prisma client `src/lib/prisma.ts`; v1 router `src/routes/v1.ts`; health
  `src/routes/health.ts`. Prisma schema split under `prisma/schema/*.prisma`:
  `core.prisma` (AGPL — all product models: `Organization`, `SMTPConnection`,
  `User` (with `isInstanceAdmin`), `InstanceSetting` (key-value instance config),
  `Contact`/`ContactList`/`ContactListMember`, `Suppression`/`SuppressionPolicy`,
  `DomainThrottle`, `Template`, `Campaign`/`CampaignVariant`/`CampaignRun`,
  `Segment`, `EmailJob`/`EmailEvent`/`EmailDraft`/`EmailAttachment`/`ImageAsset`,
  `InboxAccount`/`InboundMessage`, `ApiKey`, `WebhookEndpoint`/`WebhookDelivery`)
  and `cloud.prisma` (proprietary — `Subscription`/`Seat`/`UsageCounter`).
  Migrations in `prisma/schema/migrations`.
  - **Naming:** the UI calls SMTP connections "**sending accounts**", but the
    code keeps `smtp-connections` (module, `/smtp-connections` route, and the
    `SMTPConnection` model) — don't rename the backend to match the label.
- `apps/web` — Vite + React + Tailwind dashboard. Entry `src/main.tsx`; routes
  `src/routes/AppRoutes.tsx`; shell `src/layouts/DashboardLayout.tsx`; pages
  `src/pages/*` (`Dashboard`, `EmailStudio`, `Drafts`, `Outbox`,
  `Campaigns`/`CampaignAnalytics`,
  `Contacts`, `ContactLists`, `Templates`/`TemplateEditor`, `Segments`,
  `Suppressions`, `Deliverability`, `Inbox`, `SMTPConnections`,
  `QueueOperations`, `Settings`, chrome-free `Setup` wizard, public
  `Legal`/`Login`); first-run gate `src/components/SetupGate.tsx` (memoized
  status fetch in `src/lib/setup-status.ts`);
  Tiptap editor primitives in `src/components/editor/*` (`RichTextEditor`,
  `TemplatePreview`, `VariablesPanel`, CTA `button-extension`, `starters`,
  `variables` extract/apply); session in `src/lib/session*.ts(x)`.
- `apps/worker` — BullMQ workers. Entry `src/index.ts`; queues `src/queues/*`;
  workers `src/workers/*` (campaign-processing, email-sending, webhook-delivery,
  inbox-sync); startup recovery re-enqueues queued/scheduled work.
- `apps/cloud` — **proprietary** managed-cloud boundary (billing, usage-limits,
  workspaces). Scaffold only; no production cloud behavior yet.

## Packages

- `packages/shared` — domain types + Zod schemas; **also consumed by the browser
  (`apps/web`)**, so keep it free of `node:*`-only code (no `node:crypto`, no
  filesystem). Cron/timezone helpers (`isValidCron`, `nextCronRun`) and the
  instance-settings contracts (`INSTANCE_SETTING_KEYS`, `setupCompleteSchema`,
  `instanceSettingsUpdateSchema`, `SetupStatus`) live here.
- `packages/email-engine` — provider abstraction (`EmailProvider`), Nodemailer
  SMTP provider (per-message DKIM signing via the `dkim` send option), MJML
  email-safe render layer, tracking URL/token helpers, bounce classification,
  placeholder providers (Mailcow/SES/Resend/Brevo/Postmark).
- `packages/storage` — S3-compatible object-storage client (AWS S3 v3 SDK; works
  against MinIO) for attachment blobs; metadata stays in Postgres.
- `packages/sdk` — MIT-licensed TypeScript SDK (currently wraps the transactional
  send endpoint only; `sendEmail` accepts an optional `smtpConnectionId`).

## Related Repositories

- `../qqueue-landing-page` — sibling marketing/landing-page repo, **not** part of
  this workspace. Check it for landing page / marketing / public homepage work.

## Local Development

```sh
pnpm install
pnpm setup     # guided: .env + secrets + docker compose up + migrations
pnpm dev
```

`pnpm setup` (`scripts/setup.ts`, Node builtins only) is idempotent — it never
overwrites configured values. Manual route: `cp .env.example .env`,
`docker compose up -d`, `pnpm db:generate`, `pnpm db:migrate`. Default URLs:
API `http://localhost:4000` (health `/health`), Web `http://localhost:5173`.
A fresh install routes the web app into the `/setup` wizard (zero users).

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
- **Attachments and images are not interchangeable.** `EmailAttachment` is
  private (auth-scoped download) and travels inside the message.
  `ImageAsset` (`modules/images`) backs images embedded in email HTML, so
  `GET /api/v1/images/:publicId` is deliberately **public and unauthenticated** —
  a recipient's mail client has no session. That endpoint is why uploads are
  restricted to sniffed raster types (no SVG: it would be stored XSS on our own
  origin) and addressed by a random `publicId` rather than the row id. Don't
  relax either without a fresh decision, and don't route attachments through it.
- Instance-scope runtime settings go through
  `apps/api/src/lib/instance-settings.ts` (DB rows with env/default fallback,
  short TTL cache) — don't read the `InstanceSetting` table directly. Endpoints
  that change instance behavior require `User.isInstanceAdmin`
  (`middleware/require-instance-admin.ts`), which is distinct from org OWNER.
- Registration has a bootstrap exception: while zero users exist it is always
  allowed (the first user becomes instance admin and registration locks until
  the wizard records the admin's choice). Preserve this when touching
  `authService.register`.
- Prisma migrations are committed and additive; verify against a throwaway
  Postgres and confirm `prisma migrate diff` reports no drift.

## Docs

- **Orientation:** `README.md`, `docs/STATUS.md` (live state),
  `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, and `docs/DECISIONS.md` (the *why*
  behind design choices).
- **Operate / deploy:** `docs/DEPLOY.md`, `docs/ENVIRONMENT_VARIABLES.md`,
  `docs/MANAGED_INFRASTRUCTURE.md`, `docs/MAILCOW_SETUP.md`,
  `docs/SMTP_PROVIDER_GUIDE.md`, `docs/TROUBLESHOOTING.md`, `docs/FAQ.md`.
- **Onboarding / usage:** `docs/QUICKSTART.md`, `docs/FIRST_USER_EXPERIENCE.md`,
  `docs/FIRST_EMAIL.md`, `docs/FIRST_CAMPAIGN.md`, `docs/TRANSACTIONAL_API.md`.
  Setup docs are authored here and copied to `../qqueue-landing-page`
  (`src/content/docs/<slug>.md` + a `docsNav` entry) — keep both in sync when
  editing them.
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

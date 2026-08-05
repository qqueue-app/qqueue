# QQueue Codebase Audit

> Generated 2026-08-05 by static analysis of the repository. No code was changed.
> Paths are repo-relative. Env vars are listed by NAME only — no secret values appear in this document.

---

## 1. Stack & Structure

### 1.1 Runtime & language

- **Node.js**: no `engines` field or `.nvmrc` anywhere. Docker images use `node:22-alpine` (`apps/api/Dockerfile`, `apps/worker/Dockerfile`, `apps/web/Dockerfile`); CI pins Node **20** (`.github/workflows/*.yml`); `README.md:76` documents "Node.js 20+". This is a minor inconsistency (CI on 20, containers on 22).
- **TypeScript** `^5.7.2` in every package; strict mode; `target: ES2022`, `moduleResolution: Bundler` (`tsconfig.base.json`). All packages are ESM (`"type": "module"`).
- **Package manager**: `pnpm@9.15.0` (root `packageManager` field; pinned in CI; `corepack enable` in Dockerfiles). Workspaces: `apps/*`, `packages/*` (`pnpm-workspace.yaml`).
- **Build orchestration**: Turborepo `^2.3.3` (`turbo.json`). Builds are plain `tsc` (web: `tsc -b && vite build`); dev is `tsx watch`. No bundler for the backends, no Jest, no tsup — Vitest `^2.1.8` everywhere.
- **Lint/format**: ESLint 9 flat config + typescript-eslint `^8.18.1` + Prettier `^3.4.2` (`eslint.config.mjs`, `.prettierrc`).

### 1.2 Workspace packages (4 apps + 4 packages)

| Package | License | Purpose | Key deps (exact ranges) |
|---|---|---|---|
| `apps/api` (`@qqueue/api`) | AGPL-3.0-only | Express 5 REST API; 28 feature modules under `apps/api/src/modules/`; owns the Prisma schema | `express ^5.2.1`, `@prisma/client ^6.1.0`, `bullmq ^5.34.5`, `ioredis ^5.10.1`, `zod ^3.24.1`, `cron-parser ^5.5.0`, `imapflow ^1.4.1`, `multer ^2.0.1`, `csv-parse ^7.0.0`, `csv-stringify ^6.8.0`, `cors ^2.8.5`, `dotenv ^16.4.7` |
| `apps/worker` (`@qqueue/worker`) | AGPL-3.0-only | BullMQ workers: campaign-processing, email-sending, recurring-send, webhook-delivery, inbox-sync (`apps/worker/src/workers/`) | `bullmq ^5.34.5`, `@prisma/client ^6.1.0`, `ioredis ^5.10.1`, `imapflow ^1.4.1`, `mailparser ^3.9.10`, `cron-parser ^5.5.0` |
| `apps/web` (`@qqueue/web`) | AGPL-3.0-only | React 18 + Vite 6 + Tailwind 3 dashboard SPA (dev port 5173) | `react ^18.3.1`, `react-router-dom ^7.1.1`, Radix UI primitives, Tiptap 3 (`@tiptap/core 3.26.0` pinned + extensions), `tailwindcss ^3.4.17`, `vite ^6.0.5`, `sonner ^2.0.7`, `cronstrue ^3.14.0`, `lucide-react ^1.17.0` |
| `apps/cloud` (`@qqueue/cloud`) | **UNLICENSED (proprietary)** | Managed-cloud boundary scaffold (billing, usage-limits, workspaces); Express on port 4100; no production behavior yet | `express ^5.2.1`, `@prisma/client ^6.1.0`, `zod ^3.24.1` |
| `packages/email-engine` | AGPL-3.0-only | MJML render, Nodemailer SMTP provider, bounce classification, tracking, unsubscribe | `nodemailer ^6.9.16`, `mjml ^5.3.0`, `cheerio ^1.2.0` |
| `packages/storage` | AGPL-3.0-only | S3-compatible object storage (attachments); works against MinIO | `@aws-sdk/client-s3 ^3.717.0` (only runtime dep) |
| `packages/shared` | AGPL-3.0-only | Shared types, Zod schemas, cron/timezone helpers; browser-safe (no `node:*`) | `zod ^3.24.1`, `cron-parser ^5.5.0` |
| `packages/sdk` (`qqueue-sdk` v0.1.2) | **MIT, published to npm** | TypeScript SDK for the transactional send endpoint; **zero runtime dependencies**; published with provenance via CI | — |

Notable: the API has **no JWT or bcrypt library** — tokens are hand-rolled HMAC-SHA256 via `node:crypto` in `apps/api/src/lib/tokens.ts` (detailed in §3).

### 1.3 Root scripts (`package.json`)

| Script | What it does |
|---|---|
| `dev` / `build` / `lint` / `typecheck` / `test` / `test:coverage` | Turbo fan-out to each package (`tsx watch` / `tsc` / `eslint src` / `tsc --noEmit` / `vitest run`) |
| `setup` | `tsx scripts/setup.ts` — guided first-run: generates `.env` secrets, checks Postgres/Redis/MinIO reachability, runs migrations. Idempotent; flags `--yes`, `--mode=local\|production`, `--domain=`, `--skip-infra`, `--skip-migrate` |
| `db:generate` / `db:migrate` | Prisma generate / `migrate dev` via `@qqueue/api` |
| `test:smoke:docker` | Spins up `docker-compose.smoke.yml` (Postgres on 55432, Redis on 56379), runs `scripts/docker-smoke.ts`: migrations → in-process **fake SMTP server** (`node:net`) → real Express app + email-sending worker → register → setup → create SMTP connection → send → poll until `EmailJob.status = SENT`; always tears down |
| `coverage` / `coverage:badges` | Coverage run + `scripts/generate-coverage-badges.mjs` writes committed SVGs in `badges/` |
| `cloud:boundary` | `scripts/check-cloud-boundary.mjs` — asserts no core package depends on `@qqueue/cloud` |
| `license:audit` | `scripts/check-dependency-licenses.mjs` — allowlist of permissive licenses, blocks GPL/LGPL/AGPL deps; one reviewed exception (`slick@1.12.2`) |
| `format` | `prettier --write .` |

Coverage thresholds enforced per package: 85/85/85/85 (lines/functions/branches/statements) for api, worker, cloud, email-engine, sdk, shared, storage; web is slightly lower (functions 75, branches 80) with jsdom environment.

### 1.4 Docker & deployment

- **`docker-compose.yml`** — dev infra only (no app containers): `postgres:16-alpine` (5432), `redis:7-alpine` (6379), `minio/minio:latest` (S3 API on host 9100, console 9101). Dev credentials are hardcoded non-secrets.
- **`docker-compose.smoke.yml`** — ephemeral Postgres/Redis for the smoke test, with healthchecks.
- **`docker-compose.prod.yml`** — full production stack: `caddy` (serves the web SPA + reverse-proxies `/api/*` and `/health` to `api:4000`, auto-HTTPS), `api`, `worker`, one-shot `migrate` container (`prisma migrate deploy`), plus private Postgres/Redis/MinIO (no host ports). Startup ordering: migrate waits on Postgres; api/worker wait on migrate completion + Redis/MinIO health.
- **`docker-compose.nginx.yml`** — overlay to run Caddy plain-HTTP on `127.0.0.1:${QQUEUE_UPSTREAM_PORT:-8080}` behind an existing Nginx.
- **`docs/DEPLOY.md`** — single-VPS Compose deployment guide (≥2 GB RAM, domain + A record, ports 80/443); managed-infra variants (Neon/Upstash/R2) via `PROD_*` overrides per `docs/MANAGED_INFRASTRUCTURE.md`.

### 1.5 Environment variables (names only)

Validated with Zod at import time (`envSchema.parse(process.env)` — missing required vars crash on boot). Loading: dotenv reads repo-root `.env` then a local `.env`, never overriding already-set values.

**`apps/api/src/config/env.ts`** — required: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`, `TRACKING_SECRET`. Optional (with code defaults): `NODE_ENV`, `API_PORT` (4000), `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_TLS`, `WEB_ORIGIN` (CORS), `APP_URL` (tracking-link base), `PUBLIC_APP_URL` (dashboard links, e.g. password reset), `WEBHOOK_SECRET` (inbound ESP webhooks; unset ⇒ endpoint rejects all), `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `ATTACHMENT_MAX_BYTES` (10 MB), `SOFT_BOUNCE_THRESHOLD` (3), `SOFT_BOUNCE_WINDOW_DAYS` (30), `DEFAULT_DOMAIN_MAX_PER_MINUTE` (60).

**`apps/worker/src/config/env.ts`** — required: `DATABASE_URL`, `ENCRYPTION_KEY`, `TRACKING_SECRET`. Optional: Redis vars, `APP_URL`, S3 vars, bounce/throttle vars (must match the API's values), plus worker-only `INBOX_SYNC_INTERVAL_SECONDS` (120), `INBOX_SYNC_MAX_MESSAGES` (50), `INBOUND_ATTACHMENT_MAX_BYTES` (25 MB — **absent from `.env.example`**).

**`apps/cloud/src/config/env.ts`** — `NODE_ENV`, `CLOUD_PORT` (4100), `WEB_ORIGIN`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (Stripe vars accepted but not yet wired).

**`apps/web`** — no env validation file. Single var: `VITE_API_URL` (`apps/web/src/lib/api.ts:6-7`; defaults to same-origin in prod builds, `http://localhost:4000` in dev). Not documented in `.env.example` or `docs/ENVIRONMENT_VARIABLES.md`.

**Deploy-only vars** (compose/`.env.example`, not parsed by app schemas): `DOMAIN`, `CADDY_SITE_ADDRESS`, `QQUEUE_UPSTREAM_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `PROD_DATABASE_URL`, `PROD_REDIS_HOST`, `PROD_REDIS_PORT`, `PROD_S3_ENDPOINT`, `MINIO_ROOT_PASSWORD`.

### 1.6 CI (`.github/workflows/`)

- **`coverage.yml`** — push/PR to main: install → prisma generate → `pnpm test:coverage` → regenerate and commit `badges/` SVGs (push only).
- **`phase7-guardrails.yml`** — push/PR to main: `cloud:boundary`, `license:audit`, and a PR-only `Signed-off-by` commit check (DCO).
- **`publish-sdk.yml`** — on `qqueue-sdk-v*` tags: verifies tag matches `packages/sdk/package.json` version, tests/typechecks/builds, `npm publish --provenance`.

**CI gaps**: no workflow runs `pnpm lint`, `pnpm typecheck`, `pnpm build`, or `pnpm test:smoke:docker` — those are local-only.

---

## 2. Data Layer

### 2.1 Engines & configuration

- **PostgreSQL** (compose uses `postgres:16-alpine`) via **Prisma** — declared `^6.1.0`, installed 6.19.3. Multi-file schema folder: `apps/api/prisma/schema/` with `core.prisma` (816 lines, AGPL) + `cloud.prisma` (71 lines, commercial license header). One datasource, one generated client, one migration pipeline — the cloud/core split is **licensing-only**, not physical.
- Three bare `new PrismaClient()` instantiations (no logging, no `$extends`, no middleware, no pool tuning): `apps/api/src/lib/prisma.ts`, `apps/worker/src/lib/prisma.ts`, `apps/cloud/src/lib/prisma.ts`.
- **Redis** (`redis:7-alpine`) via ioredis `^5.10.1` + BullMQ `^5.34.5`. Connection options are **duplicated** between `apps/api/src/config/redis.ts` and `apps/worker/src/config/redis.ts` (must be kept in sync manually).
- **Object storage**: MinIO/S3 via `packages/storage/src/storage.ts` (`StorageClient` wrapping `@aws-sdk/client-s3`: `ensureBucket`, `putObject`, `getObject`, `deleteObject`). Key namespaces: outbound attachments `org/<orgId>/<uuid>-<filename>`, inline images `org/<orgId>/images/...`, inbound attachments `inbound/<orgId>/...`. Blobs are opaque; all metadata stays in Postgres. `ensureBucket()` runs once at API boot (`apps/api/src/index.ts:10`).

### 2.2 Enums (15 in core, 1 in cloud)

`UserRole` (OWNER/ADMIN/MEMBER) · `InviteStatus` (PENDING/ACCEPTED/REVOKED) · `ContactStatus` (ACTIVE/UNSUBSCRIBED/BOUNCED) · `RecurringSendStatus` (ACTIVE/PAUSED) · `MembershipSource` (MANUAL/CSV_IMPORT/SEGMENT) · `SuppressionReason` (BOUNCE/COMPLAINT/UNSUBSCRIBE/MANUAL) · `BounceType` (HARD/SOFT/BLOCK — **dead schema**: created in Postgres but referenced by no model field; runtime bounce type is a TS union) · `CampaignStatus` (DRAFT/SCHEDULED/SENDING/PAUSED/SENT/CANCELLED) · `EmailJobStatus` (PENDING/QUEUED/PROCESSING/SENT/FAILED/CANCELLED/SUPPRESSED) · `EmailOrigin` (CAMPAIGN/TRANSACTIONAL/MANUAL) · `AbWinnerMetric` (OPEN/CLICK) · `AbTestStatus` (TESTING/DECIDED/SENT) · `EmailEventType` (QUEUED/SENT/DELIVERED/OPENED/CLICKED/BOUNCED/COMPLAINED/FAILED) · `InboxAccountStatus` (ACTIVE/DISABLED) · cloud: `SubscriptionStatus` (TRIALING/ACTIVE/PAST_DUE/CANCELED/INCOMPLETE).

### 2.3 Model inventory — core.prisma (31 models)

All ids are `cuid()` strings unless noted; `?` = nullable; nearly everything cascades from `Organization`.

- **`User`** (line 127) — `email @unique`, `name?`, `passwordHash?`, `isInstanceAdmin` (default false), timestamps. Relations: `members[]`, `apiKeys[]`, `passwordResetTokens[]`, `invitesSent[]`.
- **`InstanceSetting`** (147) — `key @id` (the key *is* the PK), `value Json`, `updatedAt`. Sparse rows: absent key = use env/default.
- **`PasswordResetToken`** (153) — `userId` (Cascade), `tokenHash @unique` (sha256), `expiresAt`, `usedAt?`. Indexes on `userId`, `expiresAt`.
- **`Organization`** (166) — `name`, timestamps; the tenant root with ~25 back-reference collections, including two into cloud.prisma (`subscription?`, `usageCounters[]`).
- **`OrganizationMember`** (200) — `organizationId` + `userId` (`@@unique` pair), `role UserRole @default(MEMBER)`.
- **`OrganizationInvite`** (216) — `email`, `role`, `tokenHash @unique`, `status InviteStatus`, `invitedByUserId`, `expiresAt`, `acceptedAt?`. Indexes: org, email, expiresAt.
- **`SMTPConnection`** (236) — `name`, `host`, `port`, `secure` (default true), `usernameEncrypted`, `passwordEncrypted`, `fromEmail`, `fromName?`, `isDefault` (default false). **No `@@index([organizationId])`.**
- **`RecurringSend`** (269) — `name`, `subject`, `html?`, `text?`, `to[]`/`cc[]`/`bcc[]`, `contactIds[]`/`listIds[]` (resolved fresh per occurrence), `replyTo?`, `smtpConnectionId` (**plain string, no FK relation**), `templateId?` (same), `variables Json?`, `cronExpression`, `timezone` (default "UTC"), `status`, `nextRunAt?`, `lastRunAt?`, `createdByUserId?`. Index `[status, nextRunAt]`.
- **`RecurringSendRun`** (309) — `@@unique([recurringSendId, occurrenceKey])` (idempotency), `emailJobId?` (no FK).
- **`Contact`** (321) — `email`, `firstName?`, `lastName?`, `status ContactStatus`, `tags[]`, `metadata Json?`. `@@unique([organizationId, email])`.
- **`ContactList`** (342) — `name`, `description?`; members via explicit join.
- **`ContactListMember`** (359) — `@@unique([contactListId, contactId])`, `addedAt`, `source MembershipSource`.
- **`Suppression`** (378) — `email`, `reason SuppressionReason`, `source?`. `@@unique([organizationId, email])`.
- **`SuppressionPolicy`** (396) — 1:1 with org (`organizationId @unique`), `softBounceThreshold` (default 3), `softBounceWindowDays` (default 30). Row optional; env fallback.
- **`DomainThrottle`** (412) — `domain` (default `""` = org-wide default row), `maxPerMinute`. `@@unique([organizationId, domain])`.
- **`Template`** (425) — `name`, `description?`, `category?`, `tags[]`, `subject`, `html` (required, compiled), `mjml?` (source), `text?`, `variables Json?` (`[{name,label,defaultValue,required}]`), `previewData Json?`. No versioning (deliberate per `docs/DECISIONS.md`).
- **`Campaign`** (459) — `templateId?`/`contactListId?`/`segmentId?` (exactly-one-audience enforced in API code, not schema; all three **SetNull**), `name`, `status CampaignStatus`, `scheduledAt?`, `cronExpression?`, `timezone?`, `lastRunAt?`, `nextRunAt?`, A/B fields (`abTestEnabled`, `abTestPercent?`, `abWinnerMetric?`, `abTestWindowMin?`, `abTestStatus?`). **No `@@index` declared.**
- **`CampaignVariant`** (495) — `label`, `subject` (only subject varies), `isWinner` (default false).
- **`Segment`** (510) — `rules Json` (rule tree, re-resolved on every use), `name`, `description?`.
- **`CampaignRun`** (524) — `@@unique([campaignId, occurrenceKey])`, `status` (**plain String**, default "SENDING"), `startedAt`, `completedAt?`.
- **`EmailJob`** (537) — the pipeline row: `smtpConnectionId?`/`templateId?`/`campaignId?`/`campaignRunId?` (all SetNull), `toEmail` (single string — **comma-joined for multi-recipient manual sends**), `cc[]`/`bcc[]`, `replyTo?`, `subject`, `html?`, `text?`, `variables Json?`, `origin EmailOrigin` (default TRANSACTIONAL), `createdByUserId?` (no FK), `variantId?` (no FK), `status EmailJobStatus` (default PENDING), `messageId?`, `inReplyTo?`, `references[]`, `idempotencyKey?`, `scheduledAt?`, `sentAt?`. `@@unique([organizationId, idempotencyKey])`; indexes on `messageId`, `[organizationId, origin]`, `[organizationId, createdAt]`.
- **`EmailDraft`** (597) — composer state: `createdByUserId` (required, no FK), `smtpConnectionId?`/`templateId?` (no FK), `subject` (default ""), `html?`/`text?`, `to[]`/`cc[]`/`bcc[]`, `contactIds[]`/`listIds[]`, `replyTo?`, `variables Json?`. Index `[organizationId, createdByUserId]`.
- **`EmailAttachment`** (627) — `emailJobId?`/`emailDraftId?` (both **SetNull** — deleting a draft/job orphans the row, intentional), `filename`, `contentType`, `size`, `storageKey`, `createdByUserId?`.
- **`ImageAsset`** (652) — `publicId @unique` (random, non-enumerable, used in public URLs), `filename`, `contentType`, `size`, `storageKey`, `createdByUserId?`.
- **`EmailEvent`** (667) — `emailJobId` (Cascade), `type EmailEventType`, `metadata Json?` (bounceType lives *inside* metadata, not a column), `occurredAt` (default now). **No `@@index` declared — this is the highest-volume table** and analytics query it org-scoped.
- **`InboxAccount`** (681) — IMAP account: `email`, `host`, `port`, `secure`, `usernameEncrypted`/`passwordEncrypted`, `mailbox` (default "INBOX"), `status`, `lastSyncedAt?`, `lastSeenUid?`. `@@unique([organizationId, email])`.
- **`InboundMessage`** (708) — `inboxAccountId` (Cascade), `emailJobId?` (SetNull — reply anchoring), `messageId`, `inReplyTo?`, `references[]`, `fromEmail`, `fromName?`, `to[]`/`cc[]`, `subject`, `text?`/`html?`, `receivedAt`, `readAt?`, `imapUid?`. `@@unique([inboxAccountId, messageId])`; four indexes.
- **`InboundAttachment`** (748) — `inboundMessageId` (**Cascade**, unlike outbound's SetNull), `filename`, `contentType`, `size`, `storageKey`, `contentId?`, `isInline`.
- **`ApiKey`** (766) — `userId?` (SetNull), `name`, `keyHash @unique` (sha256), `lastUsedAt?`, `revokedAt?`. **No org index.**
- **`WebhookEndpoint`** (779) — `name`, `url`, `events[]`, `secretEncrypted`, `enabled` (default true), `deletedAt?` (soft delete). No indexes.
- **`WebhookDelivery`** (794) — `endpointId`, `emailEventId`, `eventName`, `payload Json`, `status` (**plain String**, default "PENDING"), `attempts`, `responseStatus?`, `error?`, `nextAttemptAt?`, `deliveredAt?`. Indexes incl. `[status, nextAttemptAt]`.

### 2.4 Models — cloud.prisma (3, proprietary, scaffold-level)

- **`Subscription`** — 1:1 with Organization (`organizationId @unique`), `planKey` (references an in-code plan catalog, not a table), `status`, `providerCustomerId? @unique`, `providerSubscriptionId? @unique`, period fields, `cancelAtPeriodEnd`.
- **`Seat`** — `subscriptionId` + `userId` (`@@unique`); `userId` is a **plain string, deliberately not an FK** to core `User` (documented decoupling).
- **`UsageCounter`** — `@@unique([organizationId, periodKey, resource])`; `resource` ∈ emails/contacts/apiCalls/seats; `used Int`.

### 2.5 Migrations

- **32 migrations** in `apps/api/prisma/schema/migrations/` (`migration_lock.toml` → postgresql), named `<timestamp>_<phase_label>` (mostly hand-rounded timestamps). Notable churn: `phase_f_sending_domains` + `phase_f_sender_identity_links` were **reverted** by `20260701000000_drop_sending_domains_and_identities`; inbox ticketing was added then removed (`remove_inbox_ticketing`, `simplify_inbox`).
- Run paths: dev `pnpm db:migrate` (`migrate dev`); production via a one-shot `migrate` compose service running `prisma migrate deploy`; smoke test and `pnpm setup` also run deploy/dev respectively.
- **No drift check in CI** — no `migrate diff`/`migrate status` anywhere automated; drift verification is a documented manual practice (`docs/TROUBLESHOOTING.md:126-133`, `docs/BETA_CHECKLIST.md:30`). No seed script.

### 2.6 Non-Prisma data access

- **Raw SQL**: exactly one production call — `` prisma.$queryRaw`SELECT 1` `` in `apps/api/src/modules/instance-settings/service.ts:12` (health probe). No `$executeRaw`/unsafe variants anywhere.
- **Redis outside BullMQ** (Redis is a *correctness* dependency, not just queuing — no in-process fallback):
  - API rate limiter (`apps/api/src/middleware/rate-limit.ts`): fixed-window `INCR`+`EXPIRE` on `rate-limit:<prefix>:<identity>`. Configured: `auth` 20/15min, `auth-refresh` 60/15min, `setup-status` 60/60s, `transactional-send` 120/60s (keyed by bearer token), `invite-accept` 30/15min. **Bypassed entirely when `NODE_ENV === "test"`.**
  - Worker per-domain send throttle (`apps/worker/src/lib/throttle.ts`): `throttle:<orgId>:<domain>:<minuteBucket>` fixed window on a dedicated ioredis client.
  - Health `redis.ping()` raced against a 2s timeout (instance-settings env-status).
- **In-process caches**: instance-settings (10s TTL, per-process — a second API instance can serve stale values), and recipient-suggestion cache in `manual-email/service.ts:140-200` (60s TTL Map, max 100 orgs, documented as deliberately per-process).

### 2.7 InstanceSetting store (`apps/api/src/lib/instance-settings.ts`)

Two keys (canonical names in `packages/shared/src/index.ts:424-427`): `allowPublicRegistration` (default `true` when row absent) and `setupCompletedAt` (default `null`). Read path: 10s module-level cache → single `findMany` over known keys → per-key type guard with `console.warn` + default on malformed JSON (never throws). Write path: per-key `upsert`, accepts a `Prisma.TransactionClient` for atomic writes (used by first-user registration), then invalidates the cache.

## 3. Auth & Identity

### 3.1 Headline correction: users do NOT log in with SMTP credentials

There are two completely separate credential systems:

| | Human login | SMTP sending |
|---|---|---|
| Credential | `User.email` + `User.passwordHash` (scrypt, one-way) | `SMTPConnection.usernameEncrypted`/`passwordEncrypted` (AES-256-GCM, reversible) |
| Purpose | Authenticate to the web app / API | Authenticate QQueue → an external mail server |
| Scope | Per user, instance-wide | Per organization |

The only overlap: password-reset and invitation emails are *delivered through* the org's SMTP connection (`sendPasswordResetEmail`, `sendInviteEmail`) — that's delivery, not authentication.

### 3.2 Login flow

- Routes (`apps/api/src/modules/auth/routes.ts`, mounted publicly before `requireAuth`): `POST /auth/register`, `/login`, `/refresh`, `/password-reset/request`, `/password-reset/confirm` — IP-rate-limited (20/15min; refresh 60/15min).
- `authService.login` (`apps/api/src/modules/auth/service.ts`): unique email lookup → `verifyPassword` → generic 401 on failure (though a missing user short-circuits before the scrypt call — a timing side-channel). Returns user + org memberships + token pair.
- **Password hashing** (`apps/api/src/lib/crypto.ts`): Node built-in `crypto.scrypt` — **no bcrypt/argon2 anywhere**. Stored as `scrypt:<salt>:<hexkey>`, Node's default cost params (N=16384, r=8, p=1), `timingSafeEqual` compare. Password rule is just `min(8)`.
- **Tokens** (`apps/api/src/lib/tokens.ts`): **hand-rolled JWTs — no JWT library**. HMAC-SHA256, header hardcoded `{alg:"HS256"}`, payload `{sub, email, type, exp}` (no `iat`/`jti`/`iss`). Access token **15 min** (`JWT_ACCESS_SECRET`), refresh **30 days** (`JWT_REFRESH_SECRET`). `verifyToken` never reads `alg` from the header, so alg-confusion isn't exploitable; compares with a length-guarded `timingSafeEqual`.
- **Refresh tokens are stateless and non-revocable** — no refresh-token table, no rotation, no logout endpoint server-side, no `jti` denylist. A leaked refresh token is valid for its full 30 days; password reset does not invalidate it.
- **Web session**: stored in `window.localStorage` under `"qqueue.session"` (`apps/web/src/lib/session.ts` + `session-context.tsx`). **No cookies anywhere** (verified by grep) — everything is `Authorization: Bearer`, so CSRF is structurally not applicable. Silent refresh: `apps/web/src/lib/api.ts` intercepts 401, refreshes once, retries once, else clears session and hard-redirects to `/login`. There is **no client-side route guard** — unauthenticated users render dashboard shells until the first API call 401s (the API is the enforcement point).

### 3.3 Registration & bootstrap

`authService.register` (service.ts:87-140), one transaction: hash password → **zero-users bootstrap** (`user.count() === 0` skips gating; first user gets `isInstanceAdmin: true`) → otherwise `allowPublicRegistration` check (403 if closed) → create user + org (creator = OWNER) → if first user, immediately set `allowPublicRegistration: false` until the setup wizard records a choice → auto-sign-in with tokens. Setup wizard: `GET /setup/status` public (rate-limited); `POST /setup/complete` requires JWT + `isInstanceAdmin` (checked in service).

### 3.4 Password reset

`PasswordResetToken` model (`core.prisma:153`): 32-byte base64url token, stored sha256-hashed, 1-hour TTL, single-use (`usedAt`). Delivery finds *any* SMTP connection across the user's orgs (default-first) and is `.catch()`-swallowed so SMTP failure can't leak account existence. Reset URL uses `PUBLIC_APP_URL`. **Caveat: outside `NODE_ENV === "production"` the raw reset token is echoed in the API response** (`auth/service.ts:216`) — correct for dev, dangerous if prod is misconfigured. Reset does not invalidate outstanding refresh tokens.

### 3.5 API keys

- Format `qq_live_` + 32 random bytes base64url; stored as **unsalted sha256** in `ApiKey.keyHash` (fine for 256-bit random keys); raw key returned exactly once at creation.
- **Org-scoped only — no per-key scopes, permissions, or expiry**; revocation via `revokedAt` flag.
- Accepted on exactly **one endpoint**: `POST /api/v1/transactional-email/send`, via `requireTransactionalAuth` (`apps/api/src/middleware/require-transactional-auth.ts`) — prefix `qq_live_` ⇒ API-key path (org comes from the key; body `organizationId` ignored), otherwise JWT path (requires body `organizationId` + `assertOrgAccess`). All other routes including key management are JWT-only.
- Asymmetry: `GET /api-keys` needs only membership (any MEMBER can enumerate key metadata); create/revoke require OWNER/ADMIN via service-level `assertOrgRole`.

### 3.6 SMTP connection credentials

- `SMTPConnection` (core.prisma:236): encrypted with **AES-256-GCM** (`apps/api/src/lib/crypto.ts`, decrypt-only mirror in `apps/worker/src/lib/crypto.ts`); fresh 12-byte IV per encryption, stored `iv.authTag.ciphertext` base64url.
- Key derivation is a **plain SHA-256 of `ENCRYPTION_KEY`** — no KDF, no salt, no key versioning; rotating the key permanently bricks stored credentials (documented in `docs/DEPLOY.md`, `docs/SMTP_PROVIDER_GUIDE.md`). `ENCRYPTION_KEY` and JWT secrets are validated only as `min(1)` — no entropy floor.
- Credentials never leave the API: `smtpConnectionSelect` omits the encrypted columns on every read path. SMTP verification (`transporter.verify()`, 15s timeout) is **mandatory on create and update**.
- Same scheme reused for `InboxAccount` (IMAP) credentials and `WebhookEndpoint.secretEncrypted`.
- **Gap**: SMTP connection create/update/delete require only org *membership*, not OWNER/ADMIN — any MEMBER can add, alter, or delete sending credentials.

### 3.7 Roles, permissions & multi-tenancy

- Two axes: per-org `UserRole` (OWNER/ADMIN/MEMBER on `OrganizationMember`) and instance-wide `User.isInstanceAdmin` (first registered user; **no API exists to grant it later**).
- Primitives: `apps/api/src/lib/org-access.ts` (`getMembership`, `assertOrgAccess`, `assertOrgRole`) — the stated "single source of truth for the org boundary". Middleware: `requireAuth`, `requireOrgMembership` (org id from query/body, pins `req.organizationId` + `req.orgRole`), `requireOrgRole(...)`, `requireInstanceAdmin` (fresh DB lookup each call, so revocation is immediate), `requireTransactionalAuth`.
- Org-role guardrails in `organizations/service.ts`: ADMIN can't touch an OWNER, only OWNER grants OWNER, `assertNotLastOwner` prevents orphaning; org delete is OWNER-only.
- Tenancy on `/:id` routes is a **per-query convention**: `where: { id, organization: { members: { some: { userId } } } }` (used consistently across ~10 services; misses yield 404). **There is no Prisma middleware / global tenant filter** — a new service method that forgets the filter would silently leak. API-key requests physically can't cross orgs (org comes from the key).

### 3.8 Confirmed absent

Email verification, MFA/TOTP/WebAuthn, OAuth/SSO/SAML, server-side logout/session revocation, account lockout (beyond flat IP limits — which are fully disabled when `NODE_ENV === "test"` and IP-keyed with **no `trust proxy` set**, so behind Caddy/nginx `req.ip` may collapse to the proxy address), password history, audit logging. The cloud app (`apps/cloud/src/routes/v1.ts`) explicitly has **no auth at all** — skeleton routes returning 501. **Present despite CLAUDE.md saying otherwise: org invitations are fully implemented** (`apps/api/src/modules/invitations/`, `OrganizationInvite` model, 7-day sha256 tokens, accept flow that bypasses closed registration as "the sanctioned exception", UI at `/accept-invite`).

## 4. Sending Pipeline

### 4.1 The key structural fact: two physical send sites

| Site | Where SMTP is spoken | Used by |
|---|---|---|
| **Inline (API process)** | `transactionalEmailService.send` → `provider.send()` (`apps/api/src/modules/transactional-email/service.ts:324`) | TRANSACTIONAL + MANUAL sends with no `scheduledAt` |
| **Queued (worker)** | `apps/worker/src/workers/email-sending.worker.ts` | Campaign fan-out, scheduled sends, recurring sends, startup recovery |

The inline path **bypasses** the per-domain throttle, the send-time suppression re-check, BullMQ retries/backoff, the CANCELLED skip, List-Unsubscribe headers, and bounce classification (see §6.5). Plus two paths entirely outside the pipeline: password-reset and invitation emails call `provider.send()` directly with no EmailJob at all.

### 4.2 Ordered call chains

**MANUAL (Email Studio, immediate):**
`apps/web/src/pages/EmailStudio.tsx` → `api.sendManualEmail` → `POST /api/v1/manual-email/send` → `requireOrgMembership` → `manualEmailController.send` → `manualEmailService.send` (`apps/api/src/modules/manual-email/service.ts`): `resolveRecipients` (dedupe; CC minus To; BCC minus To+CC) → `renderBody` → `renderHtmlAsEmailSafe` (MJML wrap unless full HTML document) → delegates to `transactionalEmailService.send` with `origin: "MANUAL"` and **`to: recipients.to.join(", ")`** (one EmailJob per send, comma-joined recipients). No idempotency key on this path.

**TRANSACTIONAL (public API):**
`sendRateLimit` (120/60s) → `requireTransactionalAuth` → controller (Zod parse + `Idempotency-Key` header, max 255 chars) → `transactionalEmailService.send`:
1. Idempotency pre-check on `organizationId_idempotencyKey` → early return; race recovered via Prisma `P2002` catch (`createEmailJob` re-reads and returns `{replayed: true}`).
2. Resolve SMTP connection (explicit id, else `isDefault`) → 404 `missing_smtp_connection`.
3. Optional template resolution → `renderVariables` (`{{key}}` substitution).
4. `parseScheduledAt` (must be future) → suppression check (§6).
5. **Scheduled**: EmailJob `QUEUED` + QUEUED event → `emailSendingQueue.add("send-email", {emailJobId}, { delay, jobId: "email-<id>", attempts: 3, backoff: exponential 30s })`.
6. **Inline**: EmailJob `PROCESSING` → attachments loaded → `injectTracking` → `SMTPProvider.send` → on success `SENT` + SENT event (but **`result.rejected` is ignored** — a fully rejected recipient still records SENT); on throw `FAILED` + 502 `smtp_failure`.

**CAMPAIGN:**
`campaignService.sendNow | schedule | setRecurrence` (`apps/api/src/modules/campaigns/service.ts`) → `enqueueCampaign` (jobId `campaign-<id>-<occurrenceKey>`) or BullMQ **job scheduler** `campaign-recurring-<id>` for cron → worker `campaign-processing.worker.ts` (concurrency 2): load campaign+template+variants+ACTIVE list members → skip CANCELLED/PAUSED → `campaignRun.upsert` on `(campaignId, occurrenceKey)` (idempotency unit; retry path re-enqueues only QUEUED jobs) → requires an `isDefault` SMTP connection → resolve recipients (segment via `compileSegmentRules` live query, or list snapshot) → bulk suppression filter → per-contact `EmailJob` rows created in a transaction (`createMany`) → `emailSendingQueue.addBulk` (jobId `email-<id>`, attempts 3, exp backoff 30s).

**RECURRING MANUAL (fourth entry point):** `recurring-sends` module → `recurringSendQueue.upsertJobScheduler` → `recurring-send.worker.ts` (occurrence-key dedupe via `RecurringSendRun`) → creates EmailJob `origin: "MANUAL"`, `QUEUED` → same email-sending queue.

### 4.3 EmailJob lifecycle

`EmailJobStatus` = `PENDING | QUEUED | PROCESSING | SENT | FAILED | CANCELLED | SUPPRESSED` (7 values, `core.prisma:79`). Initial status by creator: suppressed branch → SUPPRESSED (no event, no queue); scheduled → QUEUED (+event); inline → PROCESSING; campaign fan-out → QUEUED (**no EmailEvent written at fan-out**); A/B remainder → PENDING (promoted to QUEUED at winner decision); recurring → QUEUED (+event).

Queues (`apps/worker/src/queues/*` — **byte-duplicated** in `apps/api/src/queues/*`, kept in sync by hand): `email-sending`, `campaign-processing`, `recurring-send`, `webhook-delivery`, `inbox-sync`. No queue-level `defaultJobOptions`; attempts/backoff set per-add. Deterministic job ids (`email-<id>`, `campaign-<id>-<key>`, …) are the dedupe/cancel handles.

### 4.4 The send worker (`email-sending.worker.ts`, concurrency 5)

Processor order: (1) load job + smtpConnection + campaign status → (2) **CANCELLED skip** (silent return) → (3) paused-campaign hold: `job.moveToDelayed(+30s)` + `DelayedError` (no attempt consumed) → (4) suppression re-check → SUPPRESSED, return → (5) **per-domain throttle** `reserveDomainSlot`; denied → `moveToDelayed(+retryInMs)` + `DelayedError` → (6) status PROCESSING → (7) build `SMTPProvider` with decrypted creds → (8) `injectTracking` → (9) load attachments from S3 → (10) List-Unsubscribe headers **iff origin === CAMPAIGN** → (11) send.

Outcomes: rejected recipients → `classifyBounce` → FAILED + BOUNCED event + maybe auto-suppress (returns normally — no BullMQ retry for a bounce); success → SENT + event; throw → back to QUEUED (or FAILED on the final of 3 attempts), **a FAILED EmailEvent is written on every attempt** (a 3-attempt failure = 3 FAILED events, inflating event-based analytics), rethrow for backoff. `settleRunIfComplete` (`apps/worker/src/lib/campaign-run.ts`) closes campaign runs and re-arms cron `nextRunAt`.

### 4.5 Transport (`packages/email-engine/src/providers/smtp-provider.ts`)

- `EmailProvider` interface: `send(payload) → { messageId, accepted[], rejected[], provider, rejectionResponse? }` + optional `verify()`.
- `SMTPProvider` wraps `nodemailer.createTransport({host, port, secure, auth})`. **No pooling** (`pool`/`maxConnections`/`maxMessages` appear nowhere in the repo) and **no transport caching** — a fresh transport per job in the worker and per request inline. Every email opens a new SMTP connection.
- **DKIM is not implemented.** No `dkim` option exists in `SMTPProviderOptions` and no call site passes one. `docs/ARCHITECTURE.md` still describes `apps/api/src/lib/dkim.ts` and `dkimSignOptionsFor` — **those don't exist on `main`** (removed with sending-domains in migration `20260701000000`); the docs (and CLAUDE.md's "per-message DKIM signing" claim) are stale.
- Stub providers (`future-providers.ts`): Mailcow/SES/Resend/Brevo/Postmark all throw "not implemented yet".
- MJML layer (`render/mjml.ts`): `renderMjml` (never throws, fallback + errors), `wrapHtmlInMjml` (opt-in branding), `renderHtmlAsEmailSafe`. Called only by manual-email and recurring-send — **campaign templates are not MJML-rendered** (raw `template.html`).

### 4.6 Scheduling, recurrence, recovery

- Cron helpers in `packages/shared`: `isValidCron`, `nextCronRun(expr, tz)` (cron-parser; tz default UTC), Zod schemas.
- One-shot scheduled campaign = delayed BullMQ job; recurring = BullMQ job schedulers (`upsertJobScheduler`), with `nextRunAt` on the row as display state only.
- **Startup recovery** (`apps/worker/src/index.ts:recoverQueuedWork`): re-enqueues scheduled campaigns (same occurrenceKey → no duplicates), re-upserts cron schedulers (campaigns + recurring sends), re-enqueues `EmailJob` rows in `QUEUED` (preserving future `scheduledAt` as delay), and PENDING/FAILED webhook deliveries. **Gaps that follow from the filters**: jobs stuck in `PROCESSING` at crash time are not recovered, and no pending A/B `decide` job is re-armed at startup (only a re-run of the parent campaign job re-arms it).

### 4.7 Rate limiting / throttling

- Per-recipient-domain throttle (`apps/worker/src/lib/throttle.ts`): fixed 60s window, Redis key `throttle:{orgId}:{domain}:{minuteBucket}`, `INCR` then `PEXPIRE` on first hit. Cap resolution: exact `DomainThrottle` row → org-default row (`domain: ""`) → `DEFAULT_DOMAIN_MAX_PER_MINUTE` (60). Denied jobs re-delay to the next window without consuming an attempt. Not atomic across the two commands, and a denied attempt still inflates the bucket. `recipientDomain` uses `lastIndexOf("@")` — a multi-recipient manual send is throttled against the **last** recipient's domain only.
- No throttle on the inline API path; the API-side `transactional-send` rate limit (120 req/60s) is request-level, unrelated to recipient domains.

### 4.8 Outbox cancel

`outboxService.cancel` (`apps/api/src/modules/outbox/service.ts`): only `PENDING`/`QUEUED` cancellable (409 otherwise) → set `status: CANCELLED` in Postgres **first** → best-effort `emailSendingQueue.remove("email-<id>")` (swallowed if locked). Worker re-reads status at step 1, so the DB is the source of truth. **Residual race**: cancel's status read and the worker's `PROCESSING` write aren't serialized — no compare-and-set on either side, so a narrowly-timed cancel can be overwritten by a later `SENT` update.

## 5. Campaigns

### 5.1 Lifecycle & API (`apps/api/src/modules/campaigns/`)

`CampaignStatus`: DRAFT → SCHEDULED/SENDING → SENT (or PAUSED/CANCELLED). Endpoint semantics: `update` and `configureAbTest` are DRAFT-only; `delete` is DRAFT/CANCELLED-only; `sendNow` enqueues `occurrenceKey = manual-<ts>`; `schedule` enqueues a delayed job (`scheduled-<ISO>`); `setRecurrence` registers a BullMQ job scheduler `campaign-recurring-<id>`; `pause`/`resume` manage the scheduler and status. `CampaignRun` (`@@unique([campaignId, occurrenceKey])`) is the idempotency unit; `settleRunIfComplete` closes runs and re-arms cron `nextRunAt`. There is **no cancel endpoint** — only the worker's failure path sets CANCELLED.

Notable gaps (factual, verified):
- **Segment-targeted campaigns cannot be started.** `sendNow` (service.ts:248), `schedule` (:269) and `setRecurrence` (:312) all require `campaign.templateId && campaign.contactListId` — a campaign targeting a `segmentId` fails with "Campaign requires a template and contact list", even though the worker fully supports segment resolution. No test covers the segment case.
- `duplicate()` copies only `templateId` + `contactListId` — it **silently drops `segmentId`, variants, and all A/B config**.
- `CampaignRun.status` is an untyped `String` (every other status is an enum).

### 5.2 A/B testing

- Config: 2–5 subject-only variants (body always comes from the template), `percent` 1–50, metric OPEN|CLICK, window ≤ 7 days (`abTestConfigSchema`, `packages/shared/src/index.ts:1156`).
- Fan-out (`campaign-processing.worker.ts:267-305`): test slice assigned round-robin, created QUEUED with `variantId`; remainder created PENDING. `decide-ab-test` job scheduled with stable jobId at `windowMin` delay.
- Winner decision (`decideAbTest`, :334): counts **raw EmailEvent rows** (not unique-per-recipient), run-scoped, ties break to lowest label; held PENDING jobs are then promoted **one at a time in a loop** (no transaction/batching) with the winner's subject re-rendered per job.
- Inconsistencies: per-variant analytics use *unique* opens and are **not scoped by campaign/run** (aggregate across all runs of a recurring campaign), while the winner decision uses *total* events and *is* run-scoped — two different definitions of "opens". `abTestStatus` is never reset on cron re-fire (second run sees `SENT`; the decision-rescheduling recovery branch only triggers on `TESTING`).
- **There is no web UI for A/B**: `apps/web/src/lib/api.ts:1197` exposes `configureAbTest` but no page calls it, and `CampaignAnalytics.tsx` never renders `variantBreakdown`.

### 5.3 Recipient resolution

- List path: `ContactListMember` join pre-filtered to ACTIVE contacts. Segment path: `compileSegmentRules(segment.rules)` → Prisma where, resolved live at each fire.
- Rule tree (`packages/shared/src/index.ts:507-620`): AND/OR groups (max 20 children, depth ≤ 5) over `tags` (ANY/ALL/NONE), `status`, `emailDomain`, `createdAt` before/after. **The Segments UI builds only a flat one-combinator list and omits `createdAt`** — nesting exists only at the API level. A separate legacy tag-only segment path (`apps/api/src/modules/contacts/segment.ts`) powers contact previews and `contactListService.createFromSegment` (static snapshot with `source: "SEGMENT"`).
- Suppression exclusion at fan-out is an exact-string Set filter (case differences between `Contact.email` and `Suppression.email` would slip through). No explicit dedup pass — uniqueness is implicit (one list *or* one segment per campaign; `Contact` unique per org+email).

### 5.4 Personalization / merge fields

- Canonical: `packages/shared/src/index.ts` — `VARIABLE_TOKEN` regex, `extractVariables`, `applyVariables` (unknown → empty string), `resolveVariableData` (defaults then overrides). **The same regex/logic is duplicated in 4 places**: shared (canonical), `apps/web/src/components/editor/variables.ts` (documented mirror), a local `renderVariables()` in `transactional-email/service.ts:18`, and again in `campaign-processing.worker.ts:13` / `recurring-send.worker.ts:9`.
- Campaign substitution happens at **fan-out time** (rendered HTML stored on each EmailJob); the send worker only injects tracking.
- Per-contact variables are exactly three: `email`, `firstName`, `lastName` (`contactVariables()`, worker line 27). `Contact.metadata` and `tags` are **not** available as merge fields.
- **Template variable defaults are not applied on campaign sends** — the worker never calls `resolveVariableData`, so `{{company}}` renders empty for campaign recipients even with a default set, while preview and test-send *do* apply defaults. Preview therefore doesn't match campaign output for any variable beyond the three contact fields.

### 5.5 Templates

- `Template` model: metadata + `subject`/`html` (compiled)/`mjml?` (source)/`text?`, declared `variables` + `previewData`. No versioning (deliberate).
- `templateService`: list/get/create/update/delete/clone/preview (applies defaults, no tracking injection)/testSend (routes through `transactionalEmailService.send`, `origin: MANUAL`).
- **Starter templates are defined twice**: `STARTER_TEMPLATES` in `packages/shared` (exported but **unused server-side** — no starter endpoint exists) and the actually-used copy in `apps/web/src/components/editor/starters.ts` (documented mirror).
- MJML: compiled only on the manual-email and recurring-send paths. **Campaign fan-out uses `template.html` raw**; the `Template.mjml` column is stored and cloned but never compiled by any server path.
- The Tiptap editor subsystem (`apps/web/src/components/editor/*`) is described in CLAUDE.md and §8.6 — partition/raw-block architecture with a shared extension list that is load-bearing.

### 5.6 Contacts

- `Contact`: `@@unique([organizationId, email])`, `status` transitions — UNSUBSCRIBED set by the unsubscribe service, BOUNCED by the send worker (only when auto-suppression triggers); imports never touch status (documented suppression-integrity rule).
- CSV import (`apps/api/src/modules/contacts/service.ts`): header normalization, per-row validation with 1-based line numbers, in-file case-insensitive duplicate collapse, dry-run `previewImport` (duplicates capped at 500, new-sample at 20), resolutions MERGE/REPLACE/KEEP/SKIP, memberships via one `createMany({skipDuplicates})`. **Contacts themselves are written one row at a time in an await loop** (lines 538–580) — no batching or transaction; a large import is O(n) round-trips and partially applied on failure.
- Export via `csv-stringify` (email, firstName, lastName, status, tags, createdAt). Bulk delete leaves suppressions intact (deliberate).
- Activity timeline (`contactService.activity`): correlates `EmailJob` by org + `toEmail` (no contact FK; CC/BCC not matched); **loads all matching EmailJob ids into memory** before paging events.

### 5.7 Campaign analytics (`campaignService.analytics`, service.ts:369)

Totals from EmailJob statuses + EmailEvent groupBys; rates (open/click on unique counts ÷ sent, bounce ÷ recipients); per-URL link breakdown (**loads every CLICKED event's metadata with no limit**); `variantBreakdown` (N+1 — three queries per variant, unscoped by run); recent 15 events. Rendered by `apps/web/src/pages/CampaignAnalytics.tsx` (which skips `variantBreakdown`). The dashboard summary and deliverability modules are org-wide and separate.

## 6. Bounce & Compliance

### 6.1 Bounce detection (two real surfaces, one gap)

**A. Synchronous SMTP rejection in the send worker** — `apps/worker/src/workers/email-sending.worker.ts` (~lines 132–195, inside the BullMQ processor in `startEmailSendingWorker`). `SMTPProvider.send()` (`packages/email-engine/src/providers/smtp-provider.ts`) surfaces Nodemailer's `info.rejected` plus a `rejectionResponse` string. When `result.rejected.length > 0` the worker calls `classifyBounce({ message: result.rejectionResponse })`, writes an `EmailEvent { type: "BOUNCED", metadata: { bounceType, reason, ... } }`, sets `EmailJob.status = "FAILED"`, then runs `shouldSuppressBounce(...)`.

**B. Inbound ESP webhook** — `trackingService.recordWebhookEvent()` in `apps/api/src/modules/tracking/service.ts` (note: inbound ESP handling lives in **modules/tracking**, not modules/webhooks — see 6.6).

**C. IMAP inbox sync: no bounce handling at all.** `apps/worker/src/lib/inbox-sync.ts` has zero bounce/suppression logic — DSN/bounce messages landing in a synced inbox are stored as ordinary `InboundMessage` rows and never classified.

### 6.2 Classification — `packages/email-engine/src/bounce.ts`

`classifyBounce({ code?, message? })` returns `"HARD" | "SOFT" | "BLOCK"`. Precedence: BLOCK phrase patterns → SOFT phrases → HARD phrases → SMTP status code (4xx = SOFT, 5xx = HARD) → **unknown defaults to HARD** (deliberate, documented in the file header). Ordering quirks: `"blocked - too many connections"` classifies as BLOCK (permanent) even though it's transient, and a 5xx "mailbox full" is SOFT.

### 6.3 Auto-suppression thresholds

`SuppressionPolicy` (`core.prisma:396`): per-org `softBounceThreshold` (default 3) and `softBounceWindowDays` (default 30); when no row exists, env defaults `SOFT_BOUNCE_THRESHOLD` / `SOFT_BOUNCE_WINDOW_DAYS` apply. `shouldSuppressBounce`: HARD and BLOCK suppress immediately; SOFT counts `BOUNCED` events in the window via a Prisma JSON path filter on `metadata.bounceType` joined through `emailJob.toEmail`.

The logic is **duplicated verbatim** in two places (a documented decision so the worker doesn't import from the API app): `apps/api/src/modules/suppressions/service.ts` (`suppressionService.shouldSuppressBounce`) and `apps/worker/src/lib/suppression.ts` — plus independently declared env defaults in both `config/env.ts` files. Any semantic change must be made twice.

Caveat: because manual/recurring sends store `toEmail` as a **comma-joined multi-recipient string** (see 6.5), the soft-bounce counter never matches those jobs.

### 6.4 Suppression system

- **Model** (`core.prisma:378`): `Suppression { id, organizationId, email, reason (BOUNCE | COMPLAINT | UNSUBSCRIBE | MANUAL), source?, createdAt }`, unique on `(organizationId, email)`. Org-wide by design (covers non-contact recipients); no instance-global list, no row expiry.
- **API** (`apps/api/src/modules/suppressions/`): `GET /`, `POST /` (manual add, idempotent upsert), `GET /policy`, `PUT /policy` (OWNER/ADMIN via `requireOrgRole`), `DELETE /:id`. Asymmetry: **`DELETE /:id` requires only org membership** while editing the policy requires OWNER/ADMIN — any member can un-suppress an address.
- **Enforcement points**:
  | Point | Location | Mechanism |
  |---|---|---|
  | Campaign fan-out | `apps/worker/src/workers/campaign-processing.worker.ts:217-233` | Bulk `suppression.findMany({ email: { in } })`, Set-filter of active contacts |
  | Send worker re-check | `apps/worker/src/workers/email-sending.worker.ts:60-67` | `isSuppressed(orgId, toEmail)` → status `SUPPRESSED`, skip send |
  | Transactional/manual API | `apps/api/src/modules/transactional-email/service.ts:184` | `isSuppressed(orgId, input.to)` → EmailJob created with `status: "SUPPRESSED"` |

### 6.5 Chokepoint analysis (for pre-send suppression enforcement)

**There is no single chokepoint — there are two managed send paths plus two unmanaged ones:**

1. **Queued path (BullMQ)** — campaign fan-out, `recurring-send.worker`, and scheduled transactional sends all converge on the **`email-sending.worker.ts` processor**. This path has suppression pre-check, domain throttle, tracking injection, List-Unsubscribe (campaigns only), bounce classification, auto-suppression, and outbound webhooks.
2. **Inline path (API process)** — `transactionalEmailService.send` *without* `scheduledAt` calls `provider.send()` directly at `apps/api/src/modules/transactional-email/service.ts:324`. It has the suppression pre-check and tracking injection but **no domain throttle, no List-Unsubscribe, and no bounce handling**: the success branch (lines 342–361) writes `SENT` without inspecting `result.rejected`, so an SMTP recipient rejection on this path produces no BOUNCED event and no suppression — the job is marked SENT. This is the largest asymmetry between the paths.
3. **System mail entirely outside the pipeline** (no EmailJob, no suppression, no tracking): password reset (`apps/api/src/modules/auth/service.ts:75`) and org invitations (`apps/api/src/modules/invitations/service.ts:64`) call `provider.send()` directly.

Specific findings:
- Transactional sends **do** check suppressions (service.ts:184, before both branches).
- Manual sends inherit the check via delegation, **but pass `to: recipients.to.join(", ")`** — `isSuppressed(orgId, "a@x.com, b@y.com")` is an exact-match lookup that can never hit a Suppression row when there is more than one recipient. `RecurringSend` runs do the same join (`apps/worker/src/workers/recurring-send.worker.ts:170`).
- **`cc`/`bcc` are never suppression-checked on any path.**
- If a per-recipient check is to be inserted in exactly one place per path, the chokepoints are: (a) the `startEmailSendingWorker` processor body in `apps/worker/src/workers/email-sending.worker.ts` (before ~line 72), and (b) `transactionalEmailService.send` in `apps/api/src/modules/transactional-email/service.ts` (before ~line 320). Both need per-recipient expansion of `to`/`cc`/`bcc` to be correct.

### 6.6 Unsubscribe & List-Unsubscribe

- **Token machinery** — `packages/email-engine/src/unsubscribe.ts`: HMAC-SHA256 base64url tokens (`signUnsubscribeToken` / `verifyUnsubscribeToken`, timing-safe compare), `buildUnsubscribeUrl`, and `buildListUnsubscribeHeaders` → `List-Unsubscribe: <url>` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (URL only, no `mailto:`, documented as intentional). Tokens have **no expiry and no nonce**, and are signed with `TRACKING_SECRET` — the same key as tracking tokens (no key separation).
- **Public endpoints** — `apps/api/src/modules/unsubscribe/routes.ts`: `GET /unsubscribe` (HTML confirmation page — but the unsubscribe happens as a **side effect of the GET**, so mail-client link prefetchers can silently unsubscribe recipients) and `POST /unsubscribe` (RFC 8058 one-click; ignores the request body rather than requiring `List-Unsubscribe=One-Click`). Both mounted before `requireAuth` in `apps/api/src/routes/v1.ts:51`, no rate limiting. Service adds a Suppression (`reason: UNSUBSCRIBE`) and sets matching contacts to `UNSUBSCRIBED`.
- **Headers are attached in exactly one place** — `apps/worker/src/workers/email-sending.worker.ts:107-115`, and **only when `origin === "CAMPAIGN"`**. Consequences: transactional sends get none (defensible); **manual and recurring sends get none** — a recurring newsletter blast (`recurring-send.worker.ts` hardcodes `origin: "MANUAL"`) ships without List-Unsubscribe; inline (non-scheduled) transactional/manual sends never reach this code at all.

### 6.7 Open/click tracking

- `packages/email-engine/src/tracking.ts`: HMAC-signed tokens (`TRACKING_SECRET`), `injectTracking(html)` via cheerio — rewrites `a[href^="http(s)://"]` to signed click URLs and appends a 1×1 pixel. Injection call sites: worker (`email-sending.worker.ts:97`), inline transactional (`transactional-email/service.ts:333`), and manual-email preview only (`manual-email/service.ts:264`).
- Public endpoints (`apps/api/src/modules/tracking/routes.ts`): `GET /track/open/:token` (always returns the pixel, even on invalid token; errors swallowed), `GET /track/click/:token` (400 unless target matches `^https?://`; open-redirect protection is the signature).
- `recordOpen` writes `OPENED` plus a one-time synthetic `DELIVERED` if none exists; `recordClick` writes `CLICKED` with the URL. **No dedup or bot filtering** — every pixel load (including scanner prefetch) is a distinct OPENED row.

### 6.8 Inbound ESP webhooks

- Endpoint: `POST /api/v1/webhooks/email-events` (public; in `modules/tracking`, whereas `modules/webhooks` is the *outbound* system).
- Auth: plaintext `x-webhook-secret` header compared with `!==` against the instance-wide `WEBHOOK_SECRET` — **not per-provider signature verification, not per-org, not constant-time**. The `messageId` correlation lookup is **not org-scoped**, so one shared secret can record bounce/complaint events (and force suppressions) for any organization on the instance.
- Payload is QQueue's own normalized shape (`{ type: DELIVERED|BOUNCED|COMPLAINED, messageId?, emailJobId?, email?, reason?, bounceType? }`). **There is no provider-specific adapter layer** — no SES/Postmark/Mailgun/SendGrid/Resend/Brevo parser exists; normalization is the caller's responsibility. The provider classes in `packages/email-engine/src/providers/future-providers.ts` (Mailcow/SES/Resend/Brevo/Postmark) are stubs that throw "not implemented".
- On BOUNCED with neither `bounceType` nor `reason` supplied, classification falls to the unknown branch → HARD → immediate permanent suppression. Complaints set the contact's status to `BOUNCED` (no distinct complaint status) and always suppress.

## 7. API & UI

### 7.1 Mounting model

`apps/api/src/app.ts` mounts `healthRouter` at root and `v1Router` at `/api/v1`. Inside `apps/api/src/routes/v1.ts` **ordering is load-bearing**: auth, setup, tracking, unsubscribe, public invitations, public images, and transactional-email mount **before** `v1Router.use(requireAuth)` (line 67); everything after requires a JWT. Moving a router across that line silently flips it public↔authenticated.

### 7.2 Route table

Auth legend: **public** · **JWT** (`requireAuth`) · **+org** (`requireOrgMembership`) · **+O/A** (`requireOrgRole("OWNER","ADMIN")`) · **svc** (service-level membership/role scoping on `/:id` routes) · **inst-admin** · **key/JWT** (`requireTransactionalAuth`).

| Method & path | Purpose | Auth |
|---|---|---|
| GET `/health` | Liveness (not under `/api/v1`) | public |
| POST `/api/v1/auth/register` `/login` `/password-reset/request` `/password-reset/confirm` | Account flows | public, 20/15min |
| POST `/api/v1/auth/refresh` | Token refresh | public, 60/15min |
| GET `/api/v1/setup/status` | First-run probe | public, 60/60s |
| POST `/api/v1/setup/complete` | Finish wizard | JWT + inst-admin (in service) |
| GET `/api/v1/track/open/:token`, `/track/click/:token` | Open pixel / click redirect | public (signed token), **no rate limit** |
| POST `/api/v1/webhooks/email-events` | Inbound ESP events | `x-webhook-secret` header |
| GET/POST `/api/v1/unsubscribe` | Unsubscribe landing / RFC 8058 one-click | public (signed token), **no rate limit** |
| GET `/api/v1/invitations/lookup`, POST `/api/v1/invitations/accept` | Invite preview/accept | public, 30/15min |
| GET `/api/v1/images/:publicId` | Email-embedded image for mail clients | public (unguessable id), **no rate limit** |
| POST `/api/v1/transactional-email/send` | Public send API (SDK target) | key/JWT, 120/60s |
| GET `/api/v1/dashboard/summary` | Counts + checklist + recent activity | JWT +org |
| `/api/v1/api-keys` (GET, POST, POST `/:id/revoke`) | API key management | JWT +org (create/revoke O/A in service) |
| `/api/v1/organizations` (GET, POST, GET/PUT/DELETE `/:id`, GET/PATCH/DELETE `/:id/members[/:userId]`) | Org + member management (last-owner guardrails; delete OWNER-only) | JWT / svc |
| `/api/v1/invitations` (GET, POST, DELETE `/:id`) | Invite management | JWT +O/A |
| `/api/v1/instance-settings` (GET, PATCH, GET `/env-status`) | Registration policy + env health | inst-admin |
| `/api/v1/queue-operations` (GET, POST `/:queueName/jobs/:jobId/retry`) | BullMQ inspector/retry | JWT +O/A |
| `/api/v1/smtp-connections` (full CRUD) | Sending accounts | JWT +org / svc (**no O/A gate — see §3.6**) |
| `/api/v1/contacts` (CRUD + `/import`, `/import/preview`, `/export`, `/bulk-delete`, `/segment/preview`, `/:id/activity`) | Contacts | JWT +org / svc |
| `/api/v1/contact-lists` (CRUD + `/from-segment`) | Lists | JWT +org / svc |
| `/api/v1/segments` (CRUD + `/preview`) | Rule-tree segments | JWT +org / svc |
| `/api/v1/suppressions` (GET, POST, DELETE `/:id`, GET/PUT `/policy`) | Never-send registry + policy | JWT +org; policy PUT +O/A; **DELETE membership-only** |
| `/api/v1/domain-throttles` (GET, PUT, DELETE `/:id`) | Per-domain caps | reads +org, writes +O/A |
| `/api/v1/deliverability` (`/overview`, `/domains`, `/alerts`) | Deliverability dashboards | JWT +O/A |
| `/api/v1/templates` (CRUD + `/preview`, `/:id/clone`, `/:id/test`) | Templates | JWT +org / svc |
| `/api/v1/campaigns` (CRUD + `/:id/analytics`, `/ab-test`, `/duplicate`, `/send`, `/schedule`, `/recurrence`, `/pause`, `/resume`) | Campaigns | JWT +org / svc |
| `/api/v1/manual-email` (`/send`, `/preview`, `/recipient-suggestions`, `/:emailJobId/status`) | Email Studio | JWT +org |
| `/api/v1/email-drafts` (CRUD) | Composer drafts | JWT +org / svc (by user) |
| `/api/v1/outbox` (GET, POST `/:id/cancel`) | Undelivered mail + cancel | JWT +org |
| `/api/v1/recurring-sends` (CRUD + `/pause`, `/resume`) | Cron composer sends | JWT +org / svc |
| `/api/v1/attachments` (POST, GET/DELETE `/:id`) | Private attachments (multer, `ATTACHMENT_MAX_BYTES`) | JWT +org / svc |
| POST `/api/v1/images` | Editor image upload → public URL | JWT +org |
| `/api/v1/webhook-endpoints` (CRUD + `/:id/deliveries`, `/deliveries/:deliveryId/retry`) | Outbound webhooks | JWT +org (writes O/A in service) |
| `/api/v1/inbox` (accounts CRUD, messages list/store/read/reply, attachment download) | IMAP inbox | JWT +org (account CRUD +O/A) |

### 7.3 Middleware stack (`app.ts`)

`cors` → `express.json()` (**default 100 kb limit — never raised**) → `requestLogger` (console one-liner) → routes → `errorHandler`. CORS: `env.WEB_ORIGIN ?? false` in production (CORS off if unset); enumerated `localhost:5173-5179` in dev; no credentials, no wildcard. Rate limiting is per-route Redis fixed-window (see §2.6), **bypassed under `NODE_ENV === "test"`**. Error handler maps `HttpError`/`ZodError`/Prisma P2025/P2002 → structured `{error: {code, message, issues?}}`; everything else `console.error` + 500. **No helmet, no compression, no `trust proxy`** (so IP-keyed rate limits behind Caddy/nginx may key on the proxy address).

### 7.4 Frontend (`apps/web`)

- Vite 6 + React 18 + Tailwind 3, shadcn-style Radix components, Tiptap 3.26 editor, `react-router-dom` 7. All pages `React.lazy` behind Suspense, whole tree wrapped in `<SetupGate>` (redirects to `/setup` when `needsSetup`, exempting legal pages).
- Chrome-free public routes: `/setup`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/accept-invite`, `/terms`, `/privacy`, `/licensing`, `/trademark`. Dashboard routes (in `DashboardLayout`): `/`, `/email-studio`, `/drafts`, `/outbox`, `/inbox`, `/smtp-connections`, `/contacts`, `/suppressions`, `/templates[/new|/:id/edit]`, `/campaigns[/lists|/segments|/:id/analytics]`, `/deliverability`, `/queue-operations`, `/settings`; `/send-email` is a legacy redirect. **No 404/catch-all route; no client-side auth guard** (server 401s are the enforcement point).
- API layer: hand-rolled fetch wrapper in `apps/web/src/lib/api.ts` (~1,730 lines, ~100 methods + the whole domain-type surface). **No axios/react-query/SWR/Redux/Zustand** — per-page `useState`/`useEffect`. 401 → refresh once → retry once → clear session + hard redirect. Base URL: `VITE_API_URL` ?? same-origin (prod) / `localhost:4000` (dev).
- Session: React context over localStorage (`qqueue.session`). Role-based nav filtering (`Background jobs` hidden for non-admins) is cosmetic — server enforces.
- Colocated Vitest tests next to almost every component/page.

### 7.5 SDK (`packages/sdk`)

79 lines, one class, one method: `QQueueClient.sendEmail(payload)` → `POST {base}/transactional-email/send` with the API key as Bearer. Types: `PublicSendEmailInput` (to, smtpConnectionId?, templateId?, subject?, html?, text?, variables?, scheduledAt?), `QQueueError`. Zero runtime deps. No other API coverage.

### 7.6 Outbound webhooks

- Endpoints managed at `/api/v1/webhook-endpoints`; secret `whsec_<32B base64url>` generated at create, stored AES-encrypted, **shown once, no rotate/reveal endpoint**. Soft delete.
- Event catalog: `email.queued|sent|delivered|opened|clicked|bounced|complained|failed` (derived from `EmailEventType`).
- Fan-out: `enqueueForEmailEvent` freezes the payload into a `WebhookDelivery` row → BullMQ `webhook-delivery` queue (attempts 5, exp backoff 30s) → worker (concurrency 5) signs `HMAC-SHA256(secret, "<unix-ts>.<body>")`, sends with `QQueue-Signature: v1=<hex>` + event/delivery/timestamp headers. Non-2xx/network → FAILED + rethrow for retry. History = newest 25 deliveries; manual retry resets to PENDING (409 if already delivered).

## 8. Quality & Risks

### 8.1 Test coverage

- **Vitest only** (v2.1.8), `@vitest/coverage-v8`. **144 test files, ~1,513 test cases**: api 70, web 50, worker 10, cloud 5, email-engine 6, sdk/shared/storage 1 each. Committed badges (`badges/coverage-summary.json`, updated 2026-08-05): **backend 94.36%, web 90.14%**; thresholds enforced at 85% everywhere (web slightly lower with a written justification).
- **Unit-dominant**: Prisma is mocked everywhere (`apps/api/src/test/prisma-mock.ts`); only 3 files use supertest, still against mocked Prisma; BullMQ queues are globally stubbed (`apps/api/src/test/setup.ts`) — **no test exercises real queue semantics** (jobIds, delays, schedulers). No test touches a real database.
- **Docker smoke test** (`scripts/docker-smoke.ts`, standalone tsx): real Postgres/Redis + fake in-process SMTP server; drives register → registration-locked assertion → setup → SMTP connection → scheduled transactional send → poll to SENT. Does **not** cover campaigns, attachments, tracking, unsubscribe, webhooks, inbox, or bounces.
- Untested security-relevant files (no sibling test): `middleware/require-transactional-auth.ts` (API-key auth for the public send endpoint), `middleware/require-org-role.ts`, `apps/worker/src/lib/suppression.ts`.
- **CI gap**: no workflow runs lint, typecheck, build, or the smoke test — coverage + two guardrail scripts + SDK publish only.

### 8.2 Error handling

- Hand-rolled `HttpError` (no `http-errors` package), single terminal handler in `apps/api/src/middleware/error-handler.ts` (duplicated in trimmed form in `apps/cloud`). `apps/api/src/lib/prisma-error.ts` deliberately shape-matches instead of `instanceof` — its 15-line comment documents a real shipped bug (ESM/CJS dual copies of Prisma's error class made P2002/P2025 degrade to 500s while tests passed). **This trap will reappear if anyone "simplifies" back to `instanceof`** — and the idempotency replay path depends on it (regression = duplicate sends).
- Worker: `DelayedError` for holds (no attempt consumed), final-attempt accounting, rethrow for backoff — solid.
- **No `unhandledRejection`/`uncaughtException`/`SIGTERM`/`SIGINT` handlers anywhere** (grep-verified, zero matches). The worker uses top-level `await` at boot with no catch; container restarts kill workers mid-send with no `worker.close()` — in-flight jobs are recovered only by BullMQ stall timeout, and **`EmailJob` rows can be stranded in `PROCESSING`** (startup recovery does not pick those up, §4.6). The web app has **no React error boundary** — a render throw blanks the dashboard.

### 8.3 Logging

**No logging library** — 20 `console.*` call sites total. Request logging is one unstructured line (`METHOD url status ms`). No request IDs, no user/org context, no levels, no redaction — and `req.originalUrl` is logged **verbatim including query strings**, so signed tracking/unsubscribe tokens (which encode recipient identity) land in plaintext logs. No way to correlate an API request with the worker job it spawned.

### 8.4 Hardcoded values & TODOs

- **Exactly one TODO in the whole tree** (`packages/email-engine/src/providers/future-providers.ts:10`). Unfinished work is expressed as `NotImplementedError`/README prose rather than markers, so grep-based triage under-reports.
- Notable named-but-not-configurable constants: **worker concurrency** (email-sending 5, webhook-delivery 5, campaign-processing 2, recurring-send 2 — throughput is not tunable without a rebuild), retry policy repeated literally ~6×, `OUTBOX_LIMIT=100`, `VERIFY_TIMEOUT_MS=15s`, `PASSWORD_RESET_TTL=1h`, `INVITE_TTL=7d`, `DOMAIN_SCAN_CAP=5000`, instance-settings cache 10s, segment depth 5, partition `MAX_PASSES=60`.
- No tracked secrets (`.env` gitignored; smoke script uses public throwaway values).

### 8.5 Dead code / half-finished features

- **Provider stubs**: five exported provider classes (Mailcow/SES/Resend/Brevo/Postmark) that all throw — public API surface promising five providers and delivering zero; only `SMTPProvider` is real.
- **DKIM**: removed with sending-domains (migration `20260701000000`) but still described in `docs/ARCHITECTURE.md` and CLAUDE.md — the referenced `apps/api/src/lib/dkim.ts` does not exist.
- **`apps/cloud`**: honest, documented scaffold — real plan catalog + usage-limit math, but workspaces service is 13 lines, Stripe paths return 501, and **there is no auth/tenant middleware at all** (stated in `src/routes/v1.ts:8-10`).
- **A/B testing has no UI** (§5.2); segment campaigns can't be started (§5.1); `BounceType` enum is dead schema (§2.2); `STARTER_TEMPLATES` in shared is unused server-side (§5.5).
- **No feature flags anywhere** — no kill-switch for a misbehaving subsystem.

### 8.6 Refactoring risks (implicit contracts)

1. **Duplicated crypto across the api/worker process boundary** — `apps/api/src/lib/crypto.ts` and `apps/worker/src/lib/crypto.ts` are byte-identical for decryption; the ciphertext format (`iv.tag.ct` base64url AES-256-GCM) is an **undeclared wire contract**. Changing one side breaks the other at send time, not build time. Same duplication pattern: queue definitions (`apps/api/src/queues/*` ↔ `apps/worker/src/queues/*`), redis config, suppression logic, env schemas (5 "must match" vars with independent defaults), `HttpError`/error handler (api ↔ cloud), variable-substitution regex (×4).
2. **No `ENCRYPTION_KEY` rotation path** — no key ID/version in the ciphertext envelope, no re-encryption tooling; rotation means every tenant re-enters every SMTP/IMAP credential. Cheapest to fix *before* more data exists.
3. **Editor extension list is load-bearing and order-sensitive** (`apps/web/src/components/editor/editor-extensions.ts`): the partitioner round-trips through this exact schema; StarterKit must stay first. A reorder/alphabetize pass breaks Enter/lists or freezes content. Well-documented in-code; do not "simplify".
4. **CANCELLED re-check in workers looks redundant but is the race guard** (`email-sending.worker.ts:42`, mirrored in campaign-processing and webhook-delivery) — exactly the kind of line a cleanup pass deletes.
5. **Recovery job-ID templates are duplicated strings** — `recoverQueuedWork()` reconstructs `email-<id>`/`campaign-<id>-scheduled-<iso>`/`webhook-<id>` as literals that must match the API's enqueue templates or restarts create **duplicate sends**. Not shared constants.
6. **Mount-order-defined public surface** (§7.1) plus three unauthenticated, un-rate-limited public routers (tracking, unsubscribe, public images — the last relying solely on ID unguessability).
7. **Idempotency keys**: transactional-only, no TTL (unbounded table growth), replay depends on the prisma-error shape-matching. Manual and campaign sends have no idempotency protection (campaigns have occurrence-key run dedup instead).
8. **Cloud schema inside the AGPL app**: `cloud.prisma` shares one migration history — every self-hosted install runs `Subscription`/`Seat`/`UsageCounter` tables it can't use; splitting later is a hard migration. The boundary check inspects only package.json deps and file existence — **a relative source import from cloud would pass CI**.
9. **No global tenant filter** — org scoping is per-query discipline (§3.7).

### 8.7 Docs freshness

`docs/STATUS.md` is broadly accurate on feature inventory but its **verification block is 8 weeks stale**: "verified 2026-06-11, 62 test files / 536 tests" vs today's 144 files / ~1,513 tests, and it asserts lint/typecheck/build/smoke passed — commands CI never runs. Drift checks referenced are dated before 12 later migrations. `docs/ARCHITECTURE.md` still documents removed DKIM machinery. `.env.example` and `docs/ENVIRONMENT_VARIABLES.md` are missing `INBOUND_ATTACHMENT_MAX_BYTES` (operationally meaningful), `CLOUD_PORT`, `STRIPE_*`, `VITE_API_URL`. No doc touched during the last 8 days of editor work.

---

## 10-second summary

- **Disciplined, feature-complete self-hosted beta**: TypeScript/pnpm/Turborepo monorepo (Express 5 + Prisma/Postgres + BullMQ/Redis + React/Vite), 144 test files at ~90-94% enforced coverage, one TODO in the whole tree, clean tenancy conventions — but CI runs only coverage + license guardrails (no lint/typecheck/build/smoke), and observability is bare `console.*` with no shutdown handlers.
- **Auth is email+password (scrypt) with hand-rolled HMAC JWTs — not SMTP credentials**; SMTP creds are a separate per-org AES-256-GCM store with no key-rotation path. Refresh tokens are 30-day, stateless, non-revocable; invitations exist, email verification/MFA don't.
- **The delivery pipeline has two divergent send sites**: the BullMQ worker path (throttle, suppression re-check, bounce classification, retries, List-Unsubscribe) and an inline API path that bypasses *all* of those — an SMTP rejection there is recorded as SENT. Multi-recipient manual sends comma-join `to`, silently defeating suppression checks; cc/bcc are never checked.
- **Compliance is real but campaign-only**: org-wide suppressions, RFC 8058 one-click unsubscribe, soft-bounce auto-suppression — yet List-Unsubscribe headers attach only to `origin === "CAMPAIGN"` in the worker; recurring "newsletter" sends (origin MANUAL) ship without them, and the inbound ESP webhook is one instance-wide plaintext secret with a cross-tenant messageId lookup.
- **Known half-built edges to plan around**: segment-targeted campaigns can't be started via the API, A/B testing has no UI, DKIM was removed (docs still claim it), five provider classes are throwing stubs, no Nodemailer pooling (new SMTP connection per email), and the cloud app is an auth-less scaffold sharing the AGPL migration history.

# QQueue Project Status

## Summary

QQueue is a feature-complete self-hosted beta candidate undergoing launch
preparation. The repository contains an implemented TypeScript monorepo with an
Express API, React dashboard, BullMQ worker processes, Prisma/PostgreSQL data
model, Redis queues, SMTP sending, tracking, transactional API keys, outbound
webhooks, an MIT-licensed SDK package, tests, deployment files, and open-core
licensing guardrails.

Following the Beta Polish + Launch Prep Sprint, QQueue now includes:

- Authentication
- Organizations
- SMTP connections
- Contacts
- Contact lists
- Templates
- Campaigns
- Transactional API
- API keys
- Tracking
- Webhooks
- Queue workers
- Queue operations dashboard
- Password reset
- Rate limiting
- SDK
- Mailcow documentation
- Docker smoke tests
- Licensing and legal structure

With the core product surfaces implemented and the launch-prep gaps closed, the
focus is shifting away from feature development toward:

- documentation
- onboarding
- launch preparation
- real-world testing
- user feedback

The remaining open items are primarily commercial/cloud features, multi-user
organization management, and qualified legal review — none of which block an
early self-hosted beta.

## Beta Readiness Assessment

**Status:** Feature-Complete Self-Hosted Beta Candidate

**Completed:**

- Authentication
- Organizations
- SMTP Connections
- Contacts
- Contact Lists
- Templates
- Campaigns
- Transactional API
- API Keys
- Tracking
- Webhooks
- Queue Workers
- Queue Operations Dashboard
- Password Reset
- Rate Limiting
- SDK
- Mailcow Documentation
- Docker Smoke Tests
- Licensing and Legal Structure

**Assessment:** The platform is suitable for early self-hosted beta users and
real-world validation. All core self-hosted flows are implemented, the full
verification suite (including a Docker-backed end-to-end smoke test) passes, and
operational and abuse-control gaps from the original audit have been closed.

## Repository Structure

- `apps/api`: Express API. It owns HTTP routing, auth/session tokens, password
  reset, organization access checks, Prisma access, product modules,
  transactional sends, tracking endpoints, inbound ESP webhook normalization,
  queue operations endpoints, Redis-backed rate limiting, and queue enqueueing.
- `apps/web`: Vite React dashboard. It includes login/register, password reset,
  dashboard, one-off send, SMTP connections, contacts, contact lists, templates,
  campaigns, campaign analytics, queue operations, settings/API keys/webhooks,
  and legal pages.
- `apps/worker`: BullMQ workers. It processes campaign fan-out jobs, email
  sending jobs, outbound webhook delivery jobs, and startup recovery for queued
  work.
- `apps/cloud`: proprietary managed-cloud boundary scaffold. It currently
  contains package metadata, README, and a commercial license draft, but no
  production cloud behavior.
- `packages/shared`: shared TypeScript domain types and Zod schemas for auth,
  organizations, contacts, lists, templates, campaigns, transactional sends, API
  keys, webhooks, SMTP connections, cron validation, and timezones.
- `packages/email-engine`: email provider abstraction, Nodemailer-backed SMTP
  provider, tracking URL/token helpers, and explicit placeholder provider
  classes for Mailcow/SES/Resend/Brevo/Postmark.
- `packages/sdk`: MIT-licensed TypeScript SDK package. It currently wraps the
  public transactional email send endpoint.
- `apps/api/prisma`: PostgreSQL schema and migrations for users,
  organizations, SMTP connections, contacts, contact lists, templates,
  campaigns, campaign runs, email jobs, email events, API keys, webhook
  endpoints, webhook deliveries, and password reset tokens.
- `scripts`: coverage badge generation, dependency license audit, cloud
  boundary guardrail checks, and the Docker-backed smoke test (`docker-smoke.ts`).
- `.github/workflows`: coverage, Phase 7 guardrails, and SDK publish workflows.
- Deployment files: `docker-compose.yml` for local Postgres/Redis,
  `docker-compose.prod.yml` for Caddy/API/worker/Postgres/Redis/migrations,
  `docker-compose.smoke.yml` for the throwaway smoke-test stack, app Dockerfiles,
  and `Caddyfile`.

## Completed So Far

### Project Setup

- [x] pnpm workspace and Turborepo root.
- [x] TypeScript base config plus per-package configs.
- [x] ESLint and Prettier configuration.
- [x] Local Docker Compose for PostgreSQL and Redis.
- [x] Root scripts for dev, build, lint, typecheck, test, coverage, Prisma,
  license audit, cloud boundary checks, and Docker smoke test.
- [x] `.env.example` with local and production-oriented settings.

### Licensing and Legal

- [x] Root AGPL-3.0 core license.
- [x] Proprietary `apps/cloud` commercial license draft.
- [x] MIT SDK license and package metadata.
- [x] `NOTICE.md` and `TRADEMARK.md`.
- [x] Licensing overview docs.
- [x] Draft cloud Terms of Service and Privacy Policy under `docs/legal`.
- [x] Signed-off-by/CLA guardrail workflow for pull requests.
- [~] Legal posture documented but marked as needing qualified legal review.
- [ ] Lawyer review for commercial license, CLA, Terms, Privacy Policy, and
  dependency license output.

### Core Platform

- [x] Express app setup with CORS, JSON body parsing, request logging, health
  route, v1 router, and error handling.
- [x] Module structure with route/controller/service separation.
- [x] Prisma client integration.
- [x] PostgreSQL schema and migrations.
- [x] Organization membership helper and role checks.
- [x] Redis-backed rate limiting on auth and public sending paths.

### Auth

- [x] Register creates a user and first organization.
- [x] Login returns user organizations and auth tokens.
- [x] Refresh token endpoint exists.
- [x] Password hashing and JWT token helpers are tested.
- [x] Auth middleware protects dashboard routes.
- [x] Password reset flow (request, token, confirm).
- [x] Password reset email delivery (sent via the organization's SMTP
  connection).
- [x] Password reset token invalidation.
- [~] Still lacks email verification, MFA, and session/device management.

### Security

- [x] Redis-backed rate limiting covering:
  - register
  - login
  - refresh token
  - password reset requests
  - transactional send endpoint
- [x] Encrypted SMTP credentials at rest.
- [x] HMAC-signed tracking tokens and signed outbound webhook deliveries.

### Operations

- [x] Queue operations dashboard (web page).
- [x] Queue summaries (queued, processing, failed counts).
- [x] Failed job visibility with attempt counts and failure reasons.
- [x] Retry failed jobs.
- [x] Queue monitoring API.
- [x] Queue operations access restricted to OWNER/ADMIN roles.

### Documentation

- [x] Mailcow setup guide (`docs/MAILCOW_SETUP.md`).
- [x] Quickstart guide (`docs/QUICKSTART.md`).
- [x] Troubleshooting guide (`docs/TROUBLESHOOTING.md`).
- [x] Beta checklist (`docs/BETA_CHECKLIST.md`).
- [x] Demo script (`docs/DEMO_SCRIPT.md`).
- [x] Architecture, roadmap, deployment, decisions, cloud boundary,
  transactional API, licensing, dependency license, contributing, and SDK docs.

### Organizations

- [x] Organization model and membership model exist.
- [x] Organization CRUD routes/services exist.
- [x] Access and role helpers exist.
- [~] Organization members beyond initial owner are modeled but no invitation or
  member-management UI/workflow exists yet.

### SMTP Connections

- [x] SMTP connection CRUD exists.
- [x] Credentials are encrypted before storage.
- [x] Create/update verifies SMTP connectivity with Nodemailer.
- [x] Default SMTP connection selection is implemented.
- [x] Dashboard page exists.
- [x] Dedicated Mailcow setup documentation.

### Contacts, Templates, and Campaigns

- [x] Contacts CRUD exists.
- [x] Contact lists CRUD and contact membership exist.
- [x] Templates CRUD exists.
- [x] Campaign drafts, duplicate, delete, send now, one-shot schedule,
  recurrence, pause, resume, and analytics exist.
- [x] Dashboard pages exist for contacts, contact lists, templates, campaigns,
  and analytics.
- [~] Template variables are simple string replacement.

### Queues and Workers

- [x] Redis/BullMQ queue definitions exist for email sending, campaign
  processing, and webhook delivery.
- [x] API enqueues sends/campaigns/webhook deliveries.
- [x] Worker sends email through SMTP and records events.
- [x] Campaign worker expands active contacts into queued email jobs.
- [x] Webhook worker delivers signed outbound webhooks.
- [x] Worker startup recovers queued email jobs, scheduled campaigns,
  recurring campaigns, and pending/failed webhook deliveries.
- [x] Queue operations dashboard and API for queue summaries, failed jobs, and
  retries.

### Transactional API

- [x] API key model, creation, listing, revocation, hashing, and auth exist.
- [x] Public transactional send endpoint accepts API keys.
- [x] Dashboard JWT flow can also use transactional send with organization ID.
- [x] Direct content and template-based sends exist.
- [x] Delayed sends with `scheduledAt` exist.
- [x] Stable `{ id, status }` response and machine-readable error codes exist.
- [x] Transactional API docs and SDK examples exist.
- [x] Redis-backed rate limiting on the send endpoint.
- [~] Idempotency keys and usage tracking are not yet implemented.

### Tracking and Webhooks

- [x] Open tracking pixel and click redirect endpoints exist.
- [x] HMAC-signed tracking tokens exist.
- [x] Tracking injection rewrites absolute links and appends a pixel.
- [x] Inbound normalized ESP webhook endpoint exists for delivered, bounced,
  and complained events.
- [x] Outbound webhook endpoints, signed deliveries, delivery history, and
  manual retry exist.
- [~] Provider-specific inbound webhook adapters are not implemented; docs
  describe mapping provider payloads through a relay/function.

### SDK

- [x] `qqueue-sdk` package exists with MIT license.
- [x] `QQueueClient.sendEmail` wraps the transactional send endpoint.
- [x] SDK error class exposes HTTP status and optional error code.
- [x] README, changelog, release checklist, npm publish workflow, and package
  tarball are present.
- [~] SDK scope is narrow: no clients for templates, contacts, campaigns,
  webhooks, or API keys.

### Admin / Dashboard

- [x] Dashboard shell and session context exist.
- [x] Operational pages exist for the main self-hosted flows.
- [x] Queue operations page for OWNER/ADMIN members.
- [x] Settings page includes organization creation, API keys, and webhook
  endpoint/delivery management.
- [~] Admin capabilities are product-level but not full hosted-operations admin:
  no billing dashboard, tenant ops dashboard, deliverability admin, or abuse
  review tools.

### Cloud / Proprietary Setup

- [x] `apps/cloud` fenced package exists.
- [x] Cloud README and license boundary docs exist.
- [x] Script prevents core packages from depending on `@qqueue/cloud`.
- [x] CI runs cloud boundary checks.
- [ ] Billing, usage metering, hosted onboarding, managed sending
  infrastructure, cloud admin dashboards, and tenant operations are not started.

### Tests

- [x] Vitest configs exist for API, web, worker, shared, email-engine, and SDK.
- [x] API service/middleware/lib/app tests exist.
- [x] Worker lib/worker tests exist.
- [x] Web component/page/lib/route tests exist.
- [x] Shared, email-engine, and SDK tests exist.
- [x] Queues are stubbed in API tests, eliminating Redis noise from the suite.
- [x] Docker-backed integration smoke test (`pnpm test:smoke:docker`).
- [x] End-to-end smoke test: register → SMTP → transactional send → worker
  processing.
- [x] Coverage thresholds are documented in the README.

### CI / Scripts

- [x] Coverage workflow runs install, Prisma generate, coverage tests, badge
  generation, and badge commit on `main`.
- [x] Phase 7 guardrail workflow runs cloud boundary, dependency license audit,
  and Signed-off-by checks.
- [x] SDK publish workflow verifies tag/version alignment and runs SDK checks
  before npm publish.
- [x] Coverage badge generation script exists.
- [x] Dependency license audit script exists.
- [x] Cloud boundary script exists.
- [x] Docker smoke-test script (`scripts/docker-smoke.ts`) exists.

## Current Capabilities

End-to-end, the app can currently support a self-hosted operator who:

1. Starts PostgreSQL and Redis locally or runs the production Docker Compose
   stack behind Caddy.
2. Registers a user and creates the first organization.
3. Logs into the React dashboard.
4. Recovers an account through the password reset flow.
5. Creates and verifies an SMTP connection.
6. Creates contacts, contact lists, and templates.
7. Sends a one-off transactional email from the dashboard or API key.
8. Creates campaigns, sends now, schedules one-shot campaigns, configures
   recurring campaigns, pauses/resumes campaigns, and views campaign analytics.
9. Records queued, sent, delivered, opened, clicked, bounced, complained, and
   failed events where the matching flow emits them.
10. Monitors queues, inspects failed jobs, and retries them from the queue
    operations dashboard (OWNER/ADMIN only).
11. Creates outbound webhook endpoints, receives signed webhook deliveries,
    views recent attempts, and manually retries failed deliveries.
12. Uses the SDK to call the transactional send API.

## Known Gaps

### Product

- [ ] Organization invitation flow
- [ ] Member management UI
- [ ] Usage metrics dashboard
- [ ] Transactional send idempotency keys
- [ ] Provider-specific inbound webhook adapters
- [ ] Expanded SDK functionality beyond `sendEmail`

### UX

- [ ] Hide Queue Operations navigation for non-admin members
- [ ] Improve password reset experience when no SMTP connection exists

### Cloud / Commercial

- [ ] Billing
- [ ] Plans and subscriptions
- [ ] Usage quotas
- [ ] Hosted onboarding
- [ ] Managed infrastructure
- [ ] Deliverability tooling
- [ ] Cloud admin dashboards

### Legal

- [ ] Lawyer review of commercial license
- [ ] Lawyer review of Terms of Service
- [ ] Lawyer review of Privacy Policy
- [ ] Review dependency license audit output

## Public Beta Checklist

- [x] Mailcow guide.
- [x] Password reset.
- [x] Rate limiting for auth and public transactional send endpoints.
- [x] Queue operations dashboard for failed/queued/retry state.
- [x] Docker-backed integration smoke test (API + Postgres + Redis + worker).
- [x] Legal docs draft (Terms, Privacy Policy, licenses, trademark notice).
- [x] Verification suite passing (`lint`, `typecheck`, `build`, `test`,
  `test:smoke:docker`, `license:audit`, `cloud:boundary`).
- [ ] Verify production Docker Compose from a clean checkout on a fresh host.
- [ ] Review legal docs, CLA, commercial license, trademark notice, and
  dependency license output with qualified counsel before commercial use.

## Recommended Next Sprint

1. Create landing page at qqueue.app.
2. Record demo video using `docs/DEMO_SCRIPT.md`.
3. Open-source public release preparation.
4. Gather first beta users.
5. Add organization invitations.
6. Add member management.
7. Add usage metrics dashboard.
8. Expand SDK functionality.
9. Improve onboarding UX.
10. Collect feedback from real installations.

## Verification

Verified with the following commands on 2026-06-11:

- [x] `pnpm lint` passed.
- [x] `pnpm typecheck` passed.
- [x] `pnpm build` passed.
- [x] `pnpm test` passed: 62 test files and 536 tests passed across API, web,
  worker, shared, email-engine, and SDK packages.
- [x] `pnpm test:smoke:docker` passed: a throwaway Postgres + Redis stack ran
  the full register → SMTP connection → transactional send → worker processing
  flow and confirmed the job reached `SENT`.
- [x] `pnpm license:audit` passed. The audit reported reviewed license tokens
  including MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, MPL-2.0, CC-BY-4.0,
  BlueOak-1.0.0, MIT-0, and Python-2.0.
- [x] `pnpm cloud:boundary` passed.

Notes:

- Password reset emails are now delivered through the organization's SMTP
  connection (preferring the default connection) rather than a separate system
  mailer.
- Queue operations are restricted to OWNER/ADMIN roles via `requireOrgRole`.
- Redis noise in the API test suite has been eliminated through global queue
  stubbing in `apps/api/src/test/setup.ts`.
- No production credentials or destructive commands were used.

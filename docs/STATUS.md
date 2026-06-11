# QQueue Project Status

## Summary

QQueue is no longer just a scaffold. The repository contains an implemented
TypeScript monorepo with an Express API, React dashboard, BullMQ worker
processes, Prisma/PostgreSQL data model, Redis queues, SMTP sending, tracking,
transactional API keys, outbound webhooks, an MIT-licensed SDK package, tests,
deployment files, and open-core licensing guardrails.

The current product is best described as an early self-hosted beta candidate:
the main Phase 0-6 surfaces exist, but they still need hardening, documentation
cleanup, operational visibility, abuse controls, and legal/commercial review
before a serious public beta or hosted cloud launch.

## Repository Structure

- `apps/api`: Express API. It owns HTTP routing, auth/session tokens,
  organization access checks, Prisma access, product modules, transactional
  sends, tracking endpoints, inbound ESP webhook normalization, and queue
  enqueueing.
- `apps/web`: Vite React dashboard. It includes login/register, dashboard,
  one-off send, SMTP connections, contacts, contact lists, templates, campaigns,
  campaign analytics, settings/API keys/webhooks, and legal pages.
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
  endpoints, and webhook deliveries.
- `scripts`: coverage badge generation, dependency license audit, and cloud
  boundary guardrail checks.
- `.github/workflows`: coverage, Phase 7 guardrails, and SDK publish workflows.
- Deployment files: `docker-compose.yml` for local Postgres/Redis,
  `docker-compose.prod.yml` for Caddy/API/worker/Postgres/Redis/migrations,
  app Dockerfiles, and `Caddyfile`.

## Completed So Far

### Project Setup

- [x] pnpm workspace and Turborepo root.
- [x] TypeScript base config plus per-package configs.
- [x] ESLint and Prettier configuration.
- [x] Local Docker Compose for PostgreSQL and Redis.
- [x] Root scripts for dev, build, lint, typecheck, test, coverage, Prisma,
  license audit, and cloud boundary checks.
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
- [~] API hardening is partial: no global rate limiting, abuse controls,
  password reset, invite flow, email verification, or session revocation was
  found.

### Cloud / Proprietary Setup

- [x] `apps/cloud` fenced package exists.
- [x] Cloud README and license boundary docs exist.
- [x] Script prevents core packages from depending on `@qqueue/cloud`.
- [x] CI runs cloud boundary checks.
- [ ] Billing, usage metering, hosted onboarding, managed sending
  infrastructure, cloud admin dashboards, and tenant operations are not started.

### SDK

- [x] `qqueue-sdk` package exists with MIT license.
- [x] `QQueueClient.sendEmail` wraps the transactional send endpoint.
- [x] SDK error class exposes HTTP status and optional error code.
- [x] README, changelog, release checklist, npm publish workflow, and package
  tarball are present.
- [~] SDK scope is narrow: no clients for templates, contacts, campaigns,
  webhooks, or API keys.

### Docs

- [x] Architecture, roadmap, deployment, decisions, cloud boundary,
  transactional API, licensing, dependency license, contributing, README, and
  SDK docs exist.
- [x] Deployment guide covers VPS Docker Compose, Caddy, migrations, secrets,
  tracking, and bounce webhook shape.
- [~] Root README has a stale status sentence that still calls the repo an
  initial scaffold/placeholder.
- [~] Mailcow-specific setup guidance is limited to generic SMTP compatibility;
  a dedicated Mailcow guide was not found.

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

### Auth

- [x] Register creates a user and first organization.
- [x] Login returns user organizations and auth tokens.
- [x] Refresh token endpoint exists.
- [x] Password hashing and JWT token helpers are tested.
- [x] Auth middleware protects dashboard routes.
- [~] Auth is basic and lacks email verification, password reset, invitation
  workflow, MFA, session/device management, and rate limiting.

### Organizations

- [x] Organization model and membership model exist.
- [x] Organization CRUD routes/services exist.
- [x] Access and role helpers exist.
- [~] Organization members beyond initial owner are modeled but no invitation or
  member-management UI/workflow was found.

### SMTP Connections

- [x] SMTP connection CRUD exists.
- [x] Credentials are encrypted before storage.
- [x] Create/update verifies SMTP connectivity with Nodemailer.
- [x] Default SMTP connection selection is implemented.
- [x] Dashboard page exists.
- [~] Provider-specific Mailcow setup/docs are not complete beyond generic SMTP.

### Contacts, Templates, and Campaigns

- [x] Contacts CRUD exists.
- [x] Contact lists CRUD and contact membership exist.
- [x] Templates CRUD exists.
- [x] Campaign drafts, duplicate, delete, send now, one-shot schedule,
  recurrence, pause, resume, and analytics exist.
- [x] Dashboard pages exist for contacts, contact lists, templates, campaigns,
  and analytics.
- [~] Template variables are simple string replacement.
- [~] No drag-and-drop or rich campaign builder beyond the current rich text
  editor/editor UI was verified.

### Queues and Workers

- [x] Redis/BullMQ queue definitions exist for email sending, campaign
  processing, and webhook delivery.
- [x] API enqueues sends/campaigns/webhook deliveries.
- [x] Worker sends email through SMTP and records events.
- [x] Campaign worker expands active contacts into queued email jobs.
- [x] Webhook worker delivers signed outbound webhooks.
- [x] Worker startup recovers queued email jobs, scheduled campaigns,
  recurring campaigns, and pending/failed webhook deliveries.
- [~] Queue/admin visibility is limited to existing app data surfaces; no
  dedicated queue monitor, retry dashboard for email jobs, or dead-letter UI was
  found.

### Transactional API

- [x] API key model, creation, listing, revocation, hashing, and auth exist.
- [x] Public transactional send endpoint accepts API keys.
- [x] Dashboard JWT flow can also use transactional send with organization ID.
- [x] Direct content and template-based sends exist.
- [x] Delayed sends with `scheduledAt` exist.
- [x] Stable `{ id, status }` response and machine-readable error codes exist.
- [x] Transactional API docs and SDK examples exist.
- [~] Abuse/rate limiting, quotas, idempotency keys, and usage tracking were
  not found.

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

### Admin / Dashboard

- [x] Dashboard shell and session context exist.
- [x] Operational pages exist for the main self-hosted flows.
- [x] Settings page includes organization creation, API keys, and webhook
  endpoint/delivery management.
- [~] Admin capabilities are product-level but not full hosted-operations admin:
  no billing dashboard, tenant ops dashboard, deliverability admin, or abuse
  review tools.

### Billing / Cloud Features

- [x] Cloud boundary scaffold and planning docs exist.
- [ ] Billing provider integration is not started.
- [ ] Plans, subscriptions, seats, invoices, and payment webhooks are not
  started.
- [ ] Usage limits and quota enforcement are not started.
- [ ] Hosted onboarding, managed sending infrastructure, and cloud operational
  controls are not started.

### Tests

- [x] Vitest configs exist for API, web, worker, shared, email-engine, and SDK.
- [x] API service/middleware/lib/app tests exist.
- [x] Worker lib/worker tests exist.
- [x] Web component/page/lib/route tests exist.
- [x] Shared, email-engine, and SDK tests exist.
- [x] Coverage thresholds are documented in the README.
- [~] Tests appear mostly unit/component/service focused; full Docker-backed
  integration or end-to-end browser tests were not found.

## Current Capabilities

End-to-end, the app can currently support a self-hosted operator who:

1. Starts PostgreSQL and Redis locally or runs the production Docker Compose
   stack behind Caddy.
2. Registers a user and creates the first organization.
3. Logs into the React dashboard.
4. Creates and verifies an SMTP connection.
5. Creates contacts, contact lists, and templates.
6. Sends a one-off transactional email from the dashboard or API key.
7. Creates campaigns, sends now, schedules one-shot campaigns, configures
   recurring campaigns, pauses/resumes campaigns, and views campaign analytics.
8. Records queued, sent, delivered, opened, clicked, bounced, complained, and
   failed events where the matching flow emits them.
9. Creates outbound webhook endpoints, receives signed webhook deliveries, views
   recent attempts, and manually retries failed deliveries.
10. Uses the SDK to call the transactional send API.

## Known Gaps

- Root README status text is outdated relative to the implemented codebase.
- No dedicated Mailcow setup guide was found.
- No production abuse/rate limiting or quota enforcement was found.
- No billing, usage metering, subscriptions, hosted onboarding, or cloud admin
  implementation was found.
- No email verification, password reset, invite/member-management flow, MFA, or
  session revocation was found.
- No dedicated queue operations UI for email-job retries, failed jobs, or
  dead-letter handling was found.
- No provider-specific API integrations were implemented beyond SMTP.
- No provider-specific inbound webhook adapters were implemented.
- No DKIM/SPF/domain verification automation was found.
- No Docker-backed integration suite or browser E2E suite was found.
- Legal/commercial docs are drafts and explicitly need qualified review.
- Dependency license output still needs human/legal review before release.

## Public Beta Checklist

- [ ] Update stale root README status text.
- [ ] Run and keep green: `pnpm lint`, `pnpm typecheck`, `pnpm build`,
  `pnpm test`, `pnpm license:audit`, and `pnpm cloud:boundary`.
- [ ] Add a dedicated Mailcow self-hosting/SMTP setup guide.
- [ ] Add basic API/server rate limiting for auth, transactional sends,
  tracking, and webhook endpoints.
- [ ] Add usage/event counters needed for self-hosted visibility and future
  quotas.
- [ ] Add a basic queue/email-job operations view for failed/queued/retry state.
- [ ] Add user/account recovery basics: password reset at minimum.
- [ ] Add invitation or member-management flow if multi-user organizations are
  expected in beta.
- [ ] Add a small Docker-backed integration smoke test for API + Postgres +
  Redis + worker.
- [ ] Verify production Docker Compose from a clean checkout.
- [ ] Review legal docs, CLA, commercial license, trademark notice, and
  dependency license output with qualified counsel before commercial use.

## Remaining Work

### Must Have Before Public Beta

- Update stale README status language.
- Add Mailcow setup documentation with recommended SMTP settings and common
  failure modes.
- Add basic rate limiting/abuse protection for auth and public sending paths.
- Add queue/email-job retry visibility for operators.
- Add a minimal password reset flow or document that beta accounts are
  operator-managed.
- Add integration smoke tests that exercise API, database, Redis queues, and
  worker processing together.
- Re-run and publish verification results for lint, typecheck, build, tests,
  license audit, and cloud boundary checks.
- Manually validate production Docker Compose on a fresh environment.

### Should Have Soon After Beta

- Add organization invitation and member management.
- Add usage tracking and basic monthly send/contact/API-key metrics.
- Add idempotency keys for transactional sends.
- Add webhook replay protection guidance and helper utilities beyond docs.
- Add provider-specific inbound webhook adapters for common providers.
- Expand SDK beyond `sendEmail` only if product users need automation for
  templates, contacts, campaigns, or webhooks.
- Add better campaign/template personalization and validation.
- Add browser E2E coverage for core dashboard flows.

### Later / Future Commercial Features

- Billing provider integration.
- Plans, subscriptions, seats, invoices, and lifecycle webhooks.
- Usage limits and quota enforcement policies.
- Hosted onboarding and managed sending infrastructure.
- Domain verification automation for hosted service users.
- Deliverability, reputation, warmup, abuse, and cloud operations tooling.
- Cloud admin dashboards and tenant-level operational controls.
- Enterprise legal docs: DPA, subprocessors, cookie policy, SLA, and enterprise
  terms.

## Recommended Next Sprint

1. Update root README status text to match the current implementation.
2. Run the full verification suite and fix any failures.
3. Write `docs/MAILCOW_SETUP.md` or equivalent SMTP/Mailcow guide.
4. Add basic rate limiting for auth and public transactional send endpoints.
5. Add a queue/email-job operations page or dashboard panel for failed/queued
   email jobs and retry state.
6. Add a Docker-backed smoke test for register -> SMTP connection mock path or
   queue/worker processing.
7. Add password reset or explicitly scope it out for first beta with an
   operator-managed workaround.
8. Add simple usage counters/reporting for sends, API-key sends, failures, and
   webhooks.
9. Review tenant scoping in API/worker services before any hosted beta work.
10. Prepare legal/dependency-license review materials.

## Verification

Audit document created from static repository inspection and verified with the
following commands on 2026-06-11:

- [x] `pnpm lint` passed.
- [x] `pnpm typecheck` passed.
- [x] `pnpm build` passed.
- [x] `pnpm test` passed: 59 test files and 509 tests passed across API, web,
  worker, shared, email-engine, and SDK packages.
- [x] `pnpm license:audit` passed. The audit reported reviewed license tokens
  including MIT, Apache-2.0, BSD, ISC, MPL-2.0, CC-BY-4.0, BlueOak-1.0.0,
  MIT-0, and Python-2.0.
- [x] `pnpm cloud:boundary` passed.

Notes:

- The web test run emitted non-failing React/jsdom warnings, including
  `act(...)` warnings in `Settings.test.tsx`, missing dialog description
  warnings, and expected provider-hook error output in session/theme tests.
- No production credentials or destructive commands were used.

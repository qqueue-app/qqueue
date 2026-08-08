# QQueue Project Status

## Summary

QQueue is a feature-complete self-hosted beta candidate undergoing launch
preparation. The repository contains an implemented TypeScript monorepo with an
Express API, React dashboard, BullMQ worker processes, Prisma/PostgreSQL data
model, Redis queues, SMTP sending, invitations and send-as grants, Mailcow
mailbox provisioning, tracking, transactional API keys, outbound webhooks, an
MIT-licensed SDK package, tests, deployment files, and open-core licensing
guardrails.

Following the Beta Polish + Launch Prep Sprint, QQueue now includes:

- Authentication
- Organizations
- SMTP connections
- Sender identities and sending domains (EXTERNAL/MANAGED DKIM)
- Contacts (with tags + created date in the UI)
- Contact lists (with descriptions and membership management)
- Templates (with preview and MJML-aware source)
- Email Studio (manual composer, preview, drafts, manual send)
- Drafts page and Outbox (queued/scheduled sends, with cancel)
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

## Dashboard rebuild (2026-08-07)

The dashboard was rebuilt to read as an **email client** rather than an admin
console, for a team who use Gmail, Outlook, or Zoho Mail and have no interest in
learning a new vocabulary. What changed:

- **The app opens on the Inbox.** The stats page still exists at `/insights`
  (`/dashboard` redirects there) but you go to it deliberately.
- **It installs as an app.** A web manifest and a Workbox service worker
  (`apps/web/src/sw.ts`, `injectManifest`) give an installable, offline-opening
  PWA with a home-screen icon and shortcuts.
- **Web Push for new mail.** `PushSubscription` + `modules/push` on the API,
  `lib/push.ts` in the worker, fired from inbox sync on a genuinely new,
  non-DSN, unseen message. Off unless VAPID keys are configured. Deep-links
  through `/inbox?message=<id>`.
- **The sidebar is unchanged.** A tooltipped rail and a mobile bottom tab bar
  were built and then reverted on 2026-08-07 — the existing sidebar (grouped
  sections, collapsible Settings, mobile drawer) was preferred. It keeps its
  original markup plus an unread badge on Inbox. Its "Home" entry now points at
  `/insights`, since `/` is the inbox.
- **Every icon action has a tooltip, structurally.** `IconButton` requires a
  `label` prop and renders it as both the tooltip and the `aria-label`, so an
  unlabelled icon-only control cannot be written.
- **One data grid everywhere.** `components/ui/data-grid.tsx` (TanStack Table)
  gives sorting, search, column visibility, selection with bulk actions, and
  pagination — plus a card layout on phones, rendered as a real branch rather
  than a CSS-hidden duplicate. Adopted by Contacts, Lists, Smart lists,
  Templates (list view), Campaigns, Drafts, Outbox, Suppressions, Sending
  accounts, Background jobs, and Mailboxes.
- **Mailboxes rebuilt** around three questions — what mailboxes exist, who can
  send as them, which domains each admin may use — with the access question
  answered by a people × mailboxes permission grid (`PermissionMatrix`) instead
  of a per-mailbox grant form.
- **Server state moved to TanStack Query** (`lib/query-client.ts`,
  `lib/use-api.ts`). Query keys carry the organization id, so switching orgs
  swaps caches; a first load that fails toasts once, and background refetch
  failures stay quiet.

Compose and Campaigns were deliberately **not** merged — see
`docs/DECISIONS.md`.

## Product Direction

QQueue is positioned as an **email operations platform** (not a Gmail/Outlook/
Zoho clone) built around four capabilities that share one delivery pipeline:

1. **Campaign emails** — bulk marketing/communication. *Implemented.*
2. **Transactional emails** — API/SDK/SMTP application-triggered sends.
   *Implemented.*
3. **Manual email sending** — a user-facing composer for individual/small-batch
   sends. *Implemented as **Email Studio*** (`apps/web/src/pages/EmailStudio.tsx`):
   multiple `To` recipients, always-visible `CC`/`BCC` with autocomplete over
   contacts and previously-mailed addresses, contact and contact-list pickers,
   template apply, a Tiptap editor with a **raw HTML source view**, MJML-backed
   preview rendered by the API (same wrap + tracking injection as the send),
   drafts (`EmailDraft`:
   auto-save/resume/delete/send, with a dedicated `/drafts` page that deep-links
   back into the composer), schedule-for-later, **attachments**
   (S3/MinIO object storage), and **per-recipient delivery status** after a
   send. The From picker names the account a send will actually use rather than
   saying "default". Sends run through the shared pipeline with
   `origin = MANUAL`.
4. **Inbox module** — IMAP reply sync, conversation view, and reply-from-QQueue.
   *Implemented as a focused email-operations workflow, not a full mailbox or
   ticketing product.*
5. **Outbox** (`apps/web/src/pages/Outbox.tsx`, `outbox` API module) — every
   `EmailJob` still `PENDING`/`QUEUED`/`PROCESSING` for the org, whatever its
   origin, with the sending account it will use and a cancel action for anything
   not yet handed to SMTP. Cancelling flips the row to `CANCELLED` and removes
   the delayed BullMQ job; the send worker independently skips `CANCELLED` jobs,
   so a race with an in-flight worker is safe. This is the product-level view of
   the queue — `/queue-operations` remains the admin-only BullMQ inspector.

Campaign, transactional, and manual sends are three entry points into a single
pipeline (`EmailJob` → BullMQ → email-engine → SMTP → `EmailEvent`), not three
separate products. See `docs/DECISIONS.md` and the "Email Operations Platform"
section of `docs/ROADMAP.md` for the phased plan and the Phase-A pipeline
refactor that precedes the larger UI work.

## Beta Readiness Assessment

**Status:** Feature-Complete Self-Hosted Beta Candidate

**Completed:**

- Authentication
- Organizations
- Invitations and Member Management
- SMTP Connections
- Send-As Grants
- Mailcow Mailbox Provisioning
- Contacts
- Contact Lists
- Templates
- Campaigns
- Recurring Sends
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
  invitations and member management, send-as grant enforcement, Mailcow
  mailbox provisioning, transactional sends, the `manual-email`
  module (Email Studio send + preview +
  per-recipient delivery status + recipient autocomplete, cached per org for
  60s over an `(organizationId, createdAt)` index), `email-drafts`
  module (composer drafts), `outbox` module (queued/scheduled sends + cancel), and
  `attachments` module (upload/download/delete to object storage), `images`
  module (editor image uploads; the read endpoint is public and unauthenticated
  because recipients' mail clients load embedded images without a session),
  tracking
  endpoints, inbound ESP webhook normalization, queue operations endpoints,
  Redis-backed rate limiting, and queue enqueueing. The `manual-email` module
  reuses `transactionalEmailService.send` rather than introducing a parallel
  path.
- `apps/web`: Vite React dashboard. It includes login/register, password reset,
  dashboard, Compose (Email Studio), drafts, outbox, inbox, contacts, lists, smart lists
  (segments), templates, campaigns, campaign analytics, sending accounts (SMTP
  connections), sending domains, sending health (deliverability), blocked
  addresses (suppressions), background jobs (queue operations),
  settings/API keys/webhooks, and public legal pages.
- `apps/worker`: BullMQ workers. It processes campaign fan-out jobs, email
  sending jobs, outbound webhook delivery jobs, inbox sync jobs, managed-DKIM
  domain verification jobs (with a daily recheck), and startup recovery for
  queued work.
- `apps/cloud`: proprietary managed-cloud boundary scaffold. It currently
  contains package metadata, README, and a commercial license draft, but no
  production cloud behavior.
- `packages/shared`: shared TypeScript domain types and Zod schemas for auth,
  organizations, contacts, lists, templates, campaigns, transactional sends, API
  keys, webhooks, SMTP connections, invitations, recurring sends, Mailcow
  provisioning, instance settings, cron validation, and timezones. Browser-safe
  by contract — no `node:*` code.
- `packages/crypto`: Node-only secret primitives shared by the API and worker
  (`createSecretCipher` for SMTP credentials at rest, `hashPassword`/
  `verifyPassword`). Deliberately separate from `packages/shared`, which must
  stay browser-safe.
- `packages/email-engine`: email provider abstraction, Nodemailer-backed SMTP
  provider (with per-message DKIM signing), tracking URL/token helpers, the MJML
  email-safe render layer, and explicit placeholder provider classes for
  Mailcow/SES/Resend/Brevo/Postmark.
- `packages/storage`: shared S3-compatible object-storage client (AWS S3 v3
  SDK; works against MinIO) used by the API and worker for attachment blobs.
- `packages/sdk`: MIT-licensed TypeScript SDK package. It currently wraps the
  public transactional email send endpoint.
- `apps/api/prisma`: PostgreSQL schema and migrations for users,
  organizations, organization members and invitations, SMTP connections,
  send-as grants (`SmtpConnectionGrant`) and Mailcow domain grants
  (`MailDomainGrant`), contacts (with `tags`), contact lists,
  explicit contact-list membership (`ContactListMember`), templates (with MJML
  source), campaigns, campaign runs, recurring sends and their runs, email jobs
  (with `origin` and threading metadata:
  `messageId`/`inReplyTo`/`references`), email events, API keys,
  webhook endpoints, webhook deliveries, email drafts (Email Studio composer
  state), email attachments (metadata for blobs in object storage), image assets
  (publicly-served images embedded in email HTML), inbox accounts and inbound
  messages, and refresh/password-reset tokens.
- `scripts`: coverage badge generation, dependency license audit, cloud
  boundary guardrail checks, and the Docker-backed smoke test (`docker-smoke.ts`).
- `.github/workflows`: coverage, Phase 7 guardrails, and SDK publish workflows.
- Deployment files: `docker-compose.yml` for local Postgres/Redis/MinIO,
  `docker-compose.prod.yml` for Caddy/API/worker/Postgres/Redis/MinIO/migrations,
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
- [x] Invitations (`OrganizationInvite`): an OWNER/ADMIN invites by email and
  role; the raw token exists only in the emailed accept link (sha256 hash
  persisted, same shape as `PasswordResetToken`), valid 7 days, revocable.
  Public `/accept-invite` page creates the account and membership in one step.
- [x] Invitations are the sanctioned exception to closed public registration —
  an OWNER/ADMIN deliberately vouches for the invitee.
- [x] Member management (list, role change, remove) under
  `/organizations/:id/members`, surfaced by the Settings `TeamCard`.

### SMTP Connections

- [x] SMTP connection CRUD exists.
- [x] Credentials are encrypted before storage.
- [x] Create/update verifies SMTP connectivity with Nodemailer.
- [x] Default SMTP connection selection is implemented.
- [x] Dashboard page exists.
- [x] Dedicated Mailcow setup documentation.

> **Removed:** Sending Domains, Sender Identities and managed DKIM were part of
> the product until `bcb3475` and are gone from core. Every send now resolves
> *who it sends as* from the SMTP connection — an explicit `smtpConnectionId`
> on the request, else the org's default. Don't resurrect them without a fresh
> decision.

### Send-As Grants

- [x] `SmtpConnectionGrant` + `apps/api/src/lib/send-as.ts`: OWNER/ADMIN may
  send from any org connection; a MEMBER only from ones they hold a grant for.
- [x] Enforced once, at creation time, on every send surface (transactional,
  manual, drafts, recurring sends, campaign start). Jobs are created after the
  check, so the worker deliberately does not re-verify.
- [x] Sends with no acting user (API-key sends, SYSTEM mail) pass
  `userId: null` and are not gated — an API key is an org-scoped credential.
- [x] Migration `20260806210000_backfill_smtp_connection_grants` grants existing
  MEMBERs the connections their org already had, so upgrading an instance does
  not silently revoke their ability to send.

### Mailcow Mailbox Provisioning

- [x] `/mailboxes` page + `modules/mailcow`: one flow creates the Mailcow
  mailbox, an app password held only by QQueue, the `SMTPConnection`, a
  sync-enabled `InboxAccount`, and optionally a send-as grant.
- [x] The `InboxAccount` is mandatory — it is what gives that identity DSN
  bounce visibility.
- [x] Post-provision SMTP verification retries briefly (Mailcow needs a moment
  to activate a fresh app password); rollback is reserved for "we couldn't
  record what we created", never "the handshake didn't work yet".
- [x] `MailDomainGrant` scopes which domains an admin may provision on —
  default deny, validated against Mailcow's active domains, stored lowercase.
  Grant management is OWNER-only.
- [x] Members never touch SMTP credentials or the Mailcow UI; they read mail
  with the mailbox password in their own client.
- [x] The `/mailboxes` list is the mail server's inventory merged with QQueue's
  sending accounts, tagged `MANAGED` / `SERVER_ONLY` / `EXTERNAL` — a mailbox
  created in the Mailcow UI is visible rather than silently absent.
- [x] Per-mailbox actions: reset password, adopt (connect an existing mailbox,
  the back half of provisioning with no rollback — a mailbox QQueue did not
  create is not QQueue's to delete), pause/resume delivery, and delete.
- [x] Every action re-checks domain access *and* that the mailbox exists on the
  server, so an address cannot be acted on just because it can be spelled.
- [x] Deleting removes the mailbox and its `SMTPConnection` but only *disables*
  the `InboxAccount` — `InboundMessage` cascades from it, so deleting would
  destroy mail already synced out of a mailbox that no longer exists.
- [x] Resetting a password never disturbs sending: QQueue holds a separate app
  password, so the connection and inbox sync are untouched.

### Contacts, Templates, and Campaigns

- [x] Contacts CRUD exists, with tags and created date surfaced in the UI.
- [x] Contact lists CRUD, descriptions, and contact membership exist.
- [x] Templates CRUD exists, with an in-app preview.
- [x] Both authoring surfaces (Email Studio, Template Editor) toggle between the
  rich text editor and a **raw HTML source view**. Source mode writes straight to
  the body HTML and never mounts Tiptap, so pasted markup the ProseMirror schema
  has no node for survives instead of being silently dropped; switching back
  warns and names the tags that would be lost. A complete HTML document (one with
  `<html>`/`<body>`) locks to source mode and is sent verbatim —
  `renderHtmlAsEmailSafe` detects it and skips the MJML wrap, which would
  otherwise nest a second document inside its own.
- [x] Contact CSV import is dry-run first (`POST /contacts/import/preview`):
  the review step shows how many rows are new, which collide with existing
  contacts, and the before/after for each collision. Duplicates resolve as
  merge / replace / keep / skip — a bulk default plus per-row overrides and
  inline field edits — instead of the previous silent merge. Rows repeating one
  address within a file collapse into a single contact, so the summary counts
  people rather than lines.
- [x] Editor link/button/variable dialogs are in-app (no browser `prompt`), and
  images can be uploaded from the device or linked by URL. Uploads are stored as
  `ImageAsset` blobs in object storage and embedded via a public URL, since
  recipients' mail clients fetch images with no session; uploads are limited to
  content-sniffed PNG/JPEG/GIF/WebP (SVG rejected) and addressed by a random
  `publicId`.
- [x] CTA buttons are inline, so they can sit beside text on the same line, and
  support background and text colour, size, and corner style, with alignment
  (left/centre/right) applied to the line they sit on. They can be re-edited in
  place. Styling is stored as `data-qq-*` attributes beside the inline styles so
  it survives a save/load cycle; buttons saved before this keep rendering as the
  original centred green.
- [x] Email Studio manual composer: multiple `To`, `CC`/`BCC`, contact and
  contact-list pickers, template apply, MJML-backed preview, drafts,
  attachments (object storage), per-recipient delivery status, and manual send
  through the shared pipeline (`origin = MANUAL`, `createdByUserId` set).
- [x] Campaign drafts, duplicate, delete, send now, one-shot schedule,
  recurrence, pause, resume, and analytics exist.
- [x] Dashboard pages exist for Email Studio, contacts, contact lists,
  templates, campaigns, and analytics.
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
- [x] Idempotency keys (`Idempotency-Key` header) prevent duplicate sends on
  retry; usage tracking is not yet implemented.

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
6. Invites teammates by email, sets their role, and grants a member the
   sending accounts they may send as.
7. Creates contacts, contact lists, and templates.
8. Sends a transactional email from Compose (Email Studio), the API, or the SDK.
9. Creates campaigns, sends now, schedules one-shot campaigns, configures
   recurring campaigns, pauses/resumes campaigns, and views campaign analytics.
10. Records queued, sent, delivered, opened, clicked, bounced, complained, and
    failed events where the matching flow emits them.
11. Monitors queues, inspects failed jobs, and retries them from the queue
    operations dashboard (OWNER/ADMIN only).
12. Creates outbound webhook endpoints, receives signed webhook deliveries,
    views recent attempts, and manually retries failed deliveries.
13. Uses the SDK to call the transactional send API.

## Known Gaps

### Product

- [x] Organization invitation flow
- [x] Member management UI
- [ ] Usage metrics dashboard
- [x] Transactional send idempotency keys
- [ ] Provider-specific inbound webhook adapters
- [ ] Expanded SDK functionality beyond `sendEmail`

### Email Operations Platform (see ROADMAP Phase A+)

- [x] Phase A: send-pipeline refactor (`origin`, `cc`/`bcc`/`replyTo`,
  attachments, MJML rendering utility)
- [x] Phase A.5: foundation domains — `Contact.tags`,
  `ContactList.description`, explicit `ContactListMember` join, `Template.mjml`,
  and `EmailJob` threading metadata (`inReplyTo`/`references`). Backend only; no
  UI. Template versioning evaluated and deferred (see `docs/DECISIONS.md`).
- [x] Manual composer / Email Studio: multiple `To`, `CC`/`BCC`, contact and
  list pickers, template apply, preview, drafts, manual send, **attachments**
  (S3/MinIO object storage), and **per-recipient delivery status**.
- [x] Attachment object storage (Phase A sub-task): `EmailAttachment` metadata
  table + shared `@qqueue/storage` (S3/MinIO) package + bundled MinIO in both
  Docker Compose stacks; blobs streamed to SMTP by the send pipeline.
- [x] MJML wired into the manual composer send + preview path (campaign default
  send path still sends stored HTML as-is).
- [x] Phase C: contacts & lists — CSV import/export (membership `source`),
  per-contact activity timeline, org-wide suppression registry + RFC 8058
  List-Unsubscribe, and basic tag-driven segmentation (preview + materialize to
  a list).
- [x] Phase D: advanced campaign features — all
  shipped: bounce-driven auto-suppression (soft/hard threshold), per-domain
  throttling (worker-side Redis fixed window), dynamic segmentation (`Segment`
  rule tree resolved at send time), A/B subject testing (test fraction +
  delayed winner decision), and deliverability tooling (rates, per-domain
  breakdown, reputation alerts) with Segments and Deliverability web pages.
- [x] IMAP inbox module — inbound message storage anchored to `EmailJob`
  threading metadata, conversation grouping in the dashboard, reply from
  QQueue, and a simplified inbox UI without ticketing.
- [~] Richer team collaboration on conversations remains out of scope for the
  core inbox.
- [–] Phase F (sending domains & sender identities, managed DKIM) shipped on
  2026-06-30 and was **removed from core in `bcb3475`**. Every send now resolves
  who it sends as from the SMTP connection. Kept here only so the history is
  legible; see the removal note under "Send-As Grants" above.

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
5. Make bounce accounting observable (ROADMAP "Phase 2c") — a setup-time check
   that DSN parsing is reachable, plus a backfill for DSNs that predate the
   inbox account. Until then a bounce count of zero is indistinguishable from
   perfect delivery.
6. Add usage metrics dashboard.
7. Expand SDK functionality.
8. Improve onboarding UX.
9. Collect feedback from real installations.

## Verification

Entries below are **dated records of the run at that time**, newest first — not
a claim about the suite as it stands today. For the current state, run the gates
yourself (`pnpm typecheck`, `lint`, `build`, `test`, plus `test:smoke:docker`
for send-pipeline or migration changes).

### Dashboard rebuild (2026-08-07)

- `pnpm test` — **156 test files, 1,828 tests**, all passing: api 76/889,
  web 52/574, worker 13/133, shared 1/118, email-engine 6/62, cloud 5/26,
  crypto 1/11, storage 1/8, sdk 1/7.
  New coverage: the API `pushService` (half-configured VAPID pairs, endpoint
  upsert and ownership reassignment, user-scoped unsubscribe) and the worker's
  push sender (disabled without keys, per-org and per-user delivery, 410 →
  delete the dead subscription, 5xx → keep it).
- `pnpm typecheck`, `pnpm lint`, `pnpm build` — green across every task. The
  web build emits the service worker and precaches 82 entries.
- `pnpm test:smoke:docker` — passing with the new migration applied
  (register → SMTP → transactional send → worker reached `SENT`).
- `pnpm cloud:boundary` and `pnpm license:audit` — passing. The audit is clean
  with the added dependencies (TanStack Query/Table, Radix tooltip/popover/tabs,
  `vite-plugin-pwa` + Workbox, `web-push`).
- Migration `20260807000000_add_push_subscriptions` verified against a throwaway
  PostgreSQL 16: all migrations apply in order (additive `PushSubscription`
  table only) and `prisma migrate diff` reports no drift.

Three bugs were found and fixed while rebuilding, each of which would have
shipped:

- `useQueries` returns a new array each render, so the Mailboxes memo chain
  never stabilised and the grid re-rendered in a loop. Fixed with `combine`.
- The new-mailbox dialog mounts before the domain list loads, so its domain
  never initialised and the submit button stayed disabled.
- With exactly one mailbox there was no filter to select it with, which made
  its status and Disconnect control unreachable.

### Previous suite (2026-08-06)

- `pnpm test` — **154 test files, 1,815 tests**, all passing:
  api 75/881, web 52/575, worker 12/127, shared 1/118, email-engine 6/62,
  cloud 5/26, crypto 1/11, storage 1/8, sdk 1/7.
- `pnpm typecheck`, `pnpm lint`, `pnpm build` — green across 13 tasks.
- `pnpm test:smoke:docker` — passing (Postgres + Redis + API + worker,
  all migrations applied, one job reaching `SENT`).

### Phase F sending domains & sender identities (2026-06-30) — since REMOVED

> This feature was removed from core in `bcb3475`. The entry below is the
> original verification record, kept for history only. Nothing it describes
> still exists.

- [x] Added the `SendingDomain` and `SenderIdentity` models with the `DkimMode`
  (`EXTERNAL`/`MANAGED`) and `DkimStatus` (`PENDING`/`VERIFIED`/`FAILED`/`NA`)
  enums, and a `senderIdentityId` link on `EmailJob` and `Campaign`.
- [x] Managed mode generates an RSA-2048 keypair (selector `qqueue`), stores the
  private key encrypted, signs DKIM in-process, and surfaces the DNS records; the
  `dkim-verification` worker moves managed domains `PENDING → VERIFIED/FAILED`
  on demand and on a daily recheck.
- [x] Send-time From/DKIM resolution is centralized in `resolveSender` /
  `dkimSignOptionsFor` and re-applied in the send worker, with unit tests for the
  resolver precedence, the managed+verified DKIM gate, and the verification path.
- [x] Migrations `20260630000000_phase_f_sending_domains` and
  `20260630120000_phase_f_sender_identity_links` are additive (new tables/enums
  and nullable `senderIdentityId` columns).

### Inbox simplification (2026-06-17)

- [x] Removed the `INBOX_ENABLED` runtime feature flag. Inbox API routes now
  mount by default for authenticated organization members, and the worker
  always starts/schedules inbox sync with the existing cadence and max-message
  limits.
- [x] Removed assignment, workflow, and internal-note inbox features so the UI
  stays focused on conversations and replies.
- [x] The dashboard now shows conversation threads instead of the old
  message-by-message support view.

### Phase D2–D5 advanced campaign features (2026-06-16)

- [x] `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm cloud:boundary`, and
  `pnpm license:audit` passed.
- [x] `pnpm test` passed across all packages (759 tests): added coverage for the
  worker domain throttle (`recipientDomain`/`resolveCap`/`reserveDomainSlot` and
  the send-worker hold), the `domain-throttles` and `segments` and
  `deliverability` API services, segment rule compilation + campaign target
  exclusivity, A/B fan-out split + delayed winner decision + `configureAbTest`,
  per-variant analytics, and the new web Segments + Deliverability pages.
- [x] `pnpm test:smoke:docker` passed with migrations `20260616020000`–
  `20260616040000` applied (register → SMTP → transactional send → `SENT`).
- [x] Migrations `20260616020000_phase_d_throttle`,
  `20260616030000_phase_d_segments`, and `20260616040000_phase_d_ab_testing`
  verified against a throwaway PostgreSQL 16: all migrations apply in order
  (additive `DomainThrottle`/`Segment`/`CampaignVariant` tables, A/B enums,
  nullable `Campaign.segmentId`/A/B columns, `EmailJob.variantId`) and
  `prisma migrate diff` reports no drift.

### Phase D1 bounce-driven auto-suppression (2026-06-16)

- [x] `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm cloud:boundary`, and
  `pnpm license:audit` passed.
- [x] `pnpm test` passed across all packages. New/updated coverage: the
  `email-engine` `classifyBounce` (hard/soft/block codes + phrases, phrasing
  over numeric class, unknown → hard); `suppressionService` effective-policy
  defaults/override, policy upsert, and `shouldSuppressBounce` (hard/block skip
  counting, soft only at/above threshold); the `tracking` webhook (hard
  suppresses immediately, soft below threshold does not, soft at threshold does,
  explicit provider `bounceType` overrides the reason text); the
  `email-sending` worker (hard rejection suppresses without counting, soft below
  threshold marks `FAILED` without suppressing or flipping `Contact.status`,
  soft at threshold suppresses); and the shared `suppressionPolicySchema`.
- [x] `pnpm test:smoke:docker` passed: register → SMTP → transactional send →
  worker reached `SENT` with the new `20260616010000_phase_d_bounce_policy`
  migration applied.
- [x] Migration `20260616010000_phase_d_bounce_policy` verified against a
  throwaway PostgreSQL 16: all migrations apply in order (additive `BounceType`
  enum + `SuppressionPolicy` table) and `prisma migrate diff` reports no drift
  from the schema.

### Phase C contacts & contact lists (2026-06-15)

- [x] `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm cloud:boundary`, and
  `pnpm license:audit` passed (audit clean with the new MIT `csv-parse` /
  `csv-stringify` dependencies).
- [x] `pnpm test` passed across all packages; new coverage added for the
  suppression service + pipeline enforcement (campaign fan-out exclusion,
  synchronous `SUPPRESSED` job, send-worker re-check, bounce/complaint →
  suppression), the `email-engine` unsubscribe token + List-Unsubscribe headers,
  the public unsubscribe endpoints, CSV parse/import/export, the contact
  activity timeline, tag-driven segment preview + list materialization, the
  shared Zod schemas, and the web Suppressions page + Contacts import/export and
  activity drawer.
- [x] `pnpm test:smoke:docker` passed: the register → SMTP → transactional send
  → worker flow reached `SENT` with the new `20260615040000_phase_c_contacts`
  migration applied.
- [x] Migration `20260615040000_phase_c_contacts` verified against a throwaway
  PostgreSQL 16: all migrations apply in order (including the additive
  `MembershipSource`/`SuppressionReason` enums, `EmailJobStatus.SUPPRESSED`,
  `ContactListMember.source`, and the `Suppression` table) and `prisma migrate
  diff` reports no drift from the schema.

### Phase A attachments storage + Phase B follow-ups (2026-06-15)

- [x] `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm cloud:boundary`, and
  `pnpm license:audit` passed (audit allowlist updated for `CC0-1.0` and a
  reviewed exception for `slick`'s non-SPDX `MIT (…)` string, both pulled in
  transitively by `mjml`).
- [x] `pnpm test` passed across API, web, worker, shared, email-engine, sdk,
  and the new `@qqueue/storage` package.
- [x] New coverage: `@qqueue/storage` client (put/get/delete/ensureBucket),
  `attachments` service (upload size/type guards, org/draft scoping, link/load
  for the send pipeline), transactional + worker attachment passthrough,
  `manual-email` delivery-status derivation, shared `attachmentIds` schema, and
  the Email Studio attachment + delivery-status UI.
- [x] Migration `20260615030000_phase_a_attachments` (additive `EmailAttachment`
  table) verified against a throwaway PostgreSQL 16: all migrations apply in
  order and `prisma migrate diff` reports no drift from the schema.

### Phase B Email Studio (2026-06-15)

- [x] `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm cloud:boundary`
  passed.
- [x] `pnpm test` passed across API, web, worker, shared, email-engine, and SDK.
- [x] New coverage added: `manual-email` service (recipient resolution +
  dedup, MANUAL origin/`createdByUserId`, MJML render, CC/BCC, preview),
  `email-drafts` service (CRUD + org/user scoping), shared schema validation
  (`manualEmailSendSchema`, `emailPreviewSchema`, `emailDraft*`), and the
  Email Studio page (manual recipient entry, contact/list selection, template
  apply, preview).
- [x] Migration `20260615020000_phase_b_email_studio` adds the `EmailDraft`
  table (additive only; no existing table touched).

### Phase A.5 foundation domains (2026-06-15)

- [x] `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm cloud:boundary`
  passed.
- [x] `pnpm test` passed across API, web, worker, shared, email-engine, and SDK.
- [x] Migration `20260615010000_phase_a5_foundation_domains` verified against a
  throwaway PostgreSQL 16 instance: all migrations apply in order, an existing
  implicit `_ContactToContactList` membership is copied into
  `ContactListMember` (with `addedAt`), the implicit join is dropped, and
  `Contact.tags` defaults to an empty array.

### Beta polish + launch prep sprint

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

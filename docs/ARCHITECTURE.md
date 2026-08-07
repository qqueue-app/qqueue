# Architecture

QQueue is a TypeScript monorepo with separate applications for the API, web UI,
and background workers. Shared contracts, the email provider layer, and the
object-storage client live in packages so they can be reused without coupling the
apps together.

```txt
Browser
  |
  v
apps/web  --->  apps/api  --->  PostgreSQL
                  |   \
                  |    \---->  MinIO / S3 (attachment blobs)
                  v
                Redis (BullMQ)
                  |
                  v
              apps/worker  --->  SMTP provider  --->  recipient
```

## Monorepo Structure

- `apps/api`: Express API — HTTP routing, auth, organization boundaries, Prisma
  access, and all product modules.
- `apps/web`: Vite + React + Tailwind dashboard for self-hosted operators and
  team users.
- `apps/worker`: BullMQ workers for email sending, campaign fan-out, recurring
  sends, webhook delivery, and inbox sync.
- `apps/cloud`: proprietary managed-cloud boundary (billing, usage limits,
  workspaces). Scaffold only — no production cloud behavior yet. It lives under
  its own commercial license, and AGPL core packages must never depend on it.
- `packages/shared`: shared TypeScript types and Zod schemas (also consumed by
  the browser, so it stays free of `node:*`-only code). Includes cron/timezone
  helpers.
- `packages/email-engine`: the email provider abstraction, the Nodemailer SMTP
  provider, the MJML email-safe render layer, tracking token helpers, and bounce
  classification.
- `packages/storage`: S3-compatible object-storage client (AWS S3 v3 SDK; works
  against MinIO) used by the API and worker for attachment blobs.
- `packages/sdk`: MIT-licensed, published TypeScript SDK (`qqueue-sdk`) that wraps
  the transactional send endpoint.

## API Responsibilities

The API owns HTTP routing, authentication and session tokens, password reset,
organization boundaries, and persistence through Prisma. Product logic is split
into modules under `apps/api/src/modules/*`, each with route/controller/service
files: auth, setup, instance-settings, invitations, organizations,
smtp-connections, contacts, contact-lists, segments, suppressions,
domain-throttles, templates, campaigns, transactional-email, manual-email,
email-drafts, outbox, recurring-sends, attachments, images, api-keys, tracking,
unsubscribe, deliverability, webhooks, queue-operations, dashboard, and inbox.
The API validates and persists work, then enqueues all sending and campaign
fan-out onto Redis for the worker — the API process never speaks SMTP itself.

## Web App Responsibilities

The web app is the operator dashboard. Alongside login/register, password reset,
and the public legal pages, it provides Compose (Email Studio), Drafts, Outbox,
Inbox, Contacts, Lists, Smart lists (segments), Templates, Campaigns and
campaign analytics, Sending accounts (SMTP connections), Sending health
(deliverability), Suppressions (blocked addresses), Background jobs (queue
operations, OWNER/ADMIN only), and Organization settings (which also manages API
keys and webhooks).

## Worker Responsibilities

Workers consume BullMQ jobs from Redis. There are five queues, each with a worker:

- **email-sending** — the single place SMTP is spoken. Sends individual email
  jobs through the email engine and records events; applies per-domain
  throttling, re-checks suppressions, classifies rejections as bounces, and
  skips cancelled jobs before delivery.
- **campaign-processing** — expands a campaign (targeting a list or a dynamic
  segment) into email jobs, handles A/B fan-out, and decides the A/B winner after
  the test window.
- **recurring-send** — fires cron-scheduled composer sends, creating one email
  job per occurrence.
- **webhook-delivery** — delivers signed outbound webhooks with retry and
  exponential backoff.
- **inbox-sync** — polls active IMAP inbox accounts for new mail.

On startup the worker recovers orphaned work (queued email jobs, scheduled and
recurring campaigns, recurring sends, pending/failed webhook deliveries) and
registers the inbox sync scheduler.

## Queue Flow

1. The API creates or schedules a campaign (or a transactional, manual, or
   system send).
2. The API enqueues a campaign-processing job (or an email-sending job) in
   Redis. A send without `scheduledAt` is a queued job with no delay — the API
   response means "accepted", not "delivered"; callers poll the job status or
   consume webhooks for the outcome.
3. The campaign worker expands recipients — resolving a target list or dynamic
   segment — into email jobs.
4. Email jobs are added to the sending queue.
5. The email worker decrypts the job's SMTP connection credentials, injects
   open/click tracking, and sends through the SMTP provider.
6. Email events (queued, sent, delivered, opened, clicked, bounced, complained,
   failed) are recorded for analytics.

Every send — campaign, transactional, manual, recurring, and system — flows
through the email-sending worker. `EmailJob.origin` distinguishes them.
`SYSTEM` mail (password resets, invitations) rides the same pipeline but skips
suppression checks and tracking injection: account mail must reach unsubscribed
users, with its links untouched.

## Email Provider Abstraction

The email engine exposes a small provider interface:

```ts
export interface EmailProvider {
  send(payload: SendEmailPayload): Promise<SendEmailResult>;
}
```

SMTP (Nodemailer) is the implemented provider, and Mailcow-compatible SMTP uses
the same path. SES, Resend, Brevo, and Postmark exist as placeholders until
provider-specific APIs are needed. `SendEmailPayload` carries `cc`/`bcc`/
`replyTo`, attachments, custom headers, and RFC 5322 threading headers.

## From Resolution

Every send resolves *who it sends as* from the SMTP connection: an explicit
`smtpConnectionId` on the request, else the organization's default connection
(see `transactionalEmailService.send`). The From header is built from the
connection's `fromEmail`/`fromName` in the email-sending worker — no send path
hand-builds its own. DKIM signing is not implemented: signing is left to the
upstream SMTP relay (sending domains, sender identities, and managed DKIM were
removed from core in `bcb3475`).

## Self-Hosted Architecture

The self-hosted deployment runs the web app, API, worker, PostgreSQL, Redis, and
MinIO in the operator's environment. The local development Docker Compose file
(`docker-compose.yml`) starts PostgreSQL, Redis, and MinIO; the production stack
(`docker-compose.prod.yml`) adds Caddy, the API, the worker, and a one-shot
migrate step behind auto-managed HTTPS.

## Future Managed Cloud Architecture

The managed version will add hosted onboarding, billing, usage limits, tenant
isolation, stricter secrets handling, operational monitoring, and multi-tenant
hardening while preserving the same core API, worker, queue, and provider
boundaries. The cloud layer would add pooled/shared sending infrastructure and
hosted onboarding around them.

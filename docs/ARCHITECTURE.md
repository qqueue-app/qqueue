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
- `apps/worker`: BullMQ workers for email sending, campaign fan-out, webhook
  delivery, inbox sync, and DKIM verification.
- `apps/cloud`: proprietary managed-cloud boundary (billing, usage limits,
  workspaces). Scaffold only — no production cloud behavior yet. It lives under
  its own commercial license, and AGPL core packages must never depend on it.
- `packages/shared`: shared TypeScript types and Zod schemas (also consumed by
  the browser, so it stays free of `node:*`-only code). Includes cron/timezone
  helpers and the pure DKIM DNS-record helpers.
- `packages/email-engine`: the email provider abstraction, the Nodemailer SMTP
  provider (with per-message DKIM signing), the MJML email-safe render layer,
  tracking token helpers, and bounce classification.
- `packages/storage`: S3-compatible object-storage client (AWS S3 v3 SDK; works
  against MinIO) used by the API and worker for attachment blobs.
- `packages/sdk`: MIT-licensed, published TypeScript SDK (`qqueue-sdk`) that wraps
  the transactional send endpoint.

## API Responsibilities

The API owns HTTP routing, authentication and session tokens, password reset,
organization boundaries, and persistence through Prisma. Product logic is split
into modules under `apps/api/src/modules/*`, each with route/controller/service
files: auth, organizations, smtp-connections, sending-domains, sender-identities,
contacts, contact-lists, segments, suppressions, domain-throttles, templates,
campaigns, transactional-email, manual-email, email-drafts, attachments,
tracking, unsubscribe, deliverability, webhooks, queue-operations, dashboard, and
inbox. The API validates and persists work, then enqueues long-running sending
and campaign fan-out onto Redis for the worker.

## Web App Responsibilities

The web app is the operator dashboard. Alongside login/register, password reset,
and the public legal pages, it provides Compose (Email Studio), Inbox, Contacts,
Lists, Smart lists (segments), Templates, Campaigns and campaign analytics,
Sending accounts (SMTP connections), Sending domains, Sending health
(deliverability), Blocked addresses (suppressions), Background jobs (queue
operations, OWNER/ADMIN only), and Organization settings (which also manages API
keys and webhooks).

## Worker Responsibilities

Workers consume BullMQ jobs from Redis. There are five queues, each with a worker:

- **email-sending** — sends individual email jobs through the email engine and
  records events; applies per-domain throttling and re-checks suppressions before
  delivery.
- **campaign-processing** — expands a campaign (targeting a list or a dynamic
  segment) into email jobs, handles A/B fan-out, and decides the A/B winner after
  the test window.
- **webhook-delivery** — delivers signed outbound webhooks with retry and
  exponential backoff.
- **inbox-sync** — polls active IMAP inbox accounts for new mail.
- **dkim-verification** — checks published DNS for MANAGED sending domains and
  updates their status, both on demand and on a daily recheck.

On startup the worker recovers orphaned work (queued email jobs, scheduled and
recurring campaigns, pending/failed webhook deliveries) and registers the inbox
and DKIM recheck schedulers.

## Queue Flow

1. The API creates or schedules a campaign (or an immediate/scheduled
   transactional or manual send).
2. The API enqueues a campaign-processing job (or an email-sending job) in Redis.
3. The campaign worker expands recipients — resolving a target list or dynamic
   segment — into email jobs.
4. Email jobs are added to the sending queue.
5. The email worker resolves the From identity, signs DKIM where applicable, and
   sends through the SMTP provider.
6. Email events (queued, sent, delivered, opened, clicked, bounced, complained,
   failed) are recorded for analytics.

Immediate transactional sends go out inline from the API; everything scheduled or
fanned-out flows through the worker.

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
`replyTo`, attachments, RFC 5322 threading headers, and an optional `dkim`
signing option.

## Sender Identity and DKIM Resolution

A send's From address is decoupled from the SMTP credential. `resolveSender`
(`apps/api/src/lib/sender.ts`) picks a sender identity → an explicit SMTP
connection → the org default (identity, then connection), and persists the chosen
`senderIdentityId` on the `EmailJob`. `dkimSignOptionsFor` derives the DKIM
decision from the identity's sending domain: QQueue signs only for `MANAGED`
domains that are `VERIFIED`, leaving `EXTERNAL` domains to the upstream relay. The
worker (`apps/worker/src/lib/sender.ts`, used by `email-sending.worker.ts`)
re-applies the same DKIM decision at send time, so campaign, manual, scheduled,
and inline transactional sends all sign consistently. The `dkim-verification`
worker moves MANAGED domains `PENDING → VERIFIED/FAILED`; RSA-2048 keygen lives in
`apps/api/src/lib/dkim.ts`, and the pure DNS-record helpers live in
`@qqueue/shared`.

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
boundaries. Managed DKIM signing and domain verification already ship in the AGPL
core; the cloud layer would add pooled/shared sending infrastructure and hosted
onboarding around them.

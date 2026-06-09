# Architecture

QQueue is a TypeScript monorepo with separate applications for the API, web UI, and background workers. Shared contracts and email provider logic live in packages so they can be reused without coupling the apps together.

```txt
Browser
  |
  v
apps/web  --->  apps/api  --->  PostgreSQL
                  |
                  v
                Redis
                  |
                  v
              apps/worker  --->  SMTP provider
```

## Monorepo Structure

- `apps/api`: Express API, Prisma access, HTTP routes, validation, and product modules.
- `apps/web`: Vite React dashboard for self-hosted operators and team users.
- `apps/worker`: BullMQ workers for email sending and campaign processing.
- `packages/shared`: Shared TypeScript types and Zod schemas.
- `packages/email-engine`: Email provider abstraction and SMTP provider.
- `packages/sdk`: Future public SDK for transactional email.

## API Responsibilities

The API owns HTTP routing, authentication, organization boundaries, SMTP connection records, contacts, templates, campaigns, transactional email endpoints, and persistence through Prisma.

Business modules are scaffolded under `apps/api/src/modules`. Each module starts with route, controller, and service files so implementation can grow without mixing transport and domain logic.

## Web App Responsibilities

The web app provides the dashboard interface for managing SMTP connections, contacts, templates, campaigns, and settings. It currently contains placeholder pages and a basic layout.

## Worker Responsibilities

Workers consume BullMQ jobs from Redis. The email sending worker will send individual email jobs through the email engine. The campaign processing worker will expand campaigns into recipient email jobs.

## Queue Flow

1. API creates or schedules a campaign.
2. API enqueues a campaign processing job in Redis.
3. Campaign worker expands recipients into email jobs.
4. Email sending jobs are added to the sending queue.
5. Email worker sends messages through the selected provider.
6. Email events are recorded for future analytics.

## Email Provider Abstraction

The email engine exposes a small provider interface:

```ts
export interface EmailProvider {
  send(payload: SendEmailPayload): Promise<SendEmailResult>;
}
```

SMTP is the first provider. Mailcow-compatible SMTP can use the same SMTP path initially. SES, Resend, Brevo, and Postmark are placeholders until provider-specific APIs are needed.

## Self-Hosted Architecture

The self-hosted version runs the web app, API, worker, PostgreSQL, and Redis in the operator's environment. The first Docker Compose file only starts PostgreSQL and Redis for local development.

## Future Managed Cloud Architecture

The managed version will add hosted onboarding, billing, usage limits, tenant isolation, stricter secrets handling, operational monitoring, and multi-tenant hardening while preserving the same core API, worker, queue, and provider boundaries.

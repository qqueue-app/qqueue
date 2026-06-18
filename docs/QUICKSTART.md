# QQueue Quickstart

This guide takes you from a fresh clone to sending your first test email on your
own machine. It targets local development; for a production launch follow the
[VPS Deploy guide](DEPLOY.md) and then the [Beta Launch Checklist](BETA_CHECKLIST.md).

**Time:** ~10 minutes. **You need:** Node.js 20+, [pnpm](https://pnpm.io), and
Docker (for Postgres, Redis, and MinIO), plus SMTP credentials for a mailbox
you can send from (see [Mailcow setup](MAILCOW_SETUP.md) if you run Mailcow).

---

## 1. Clone the repository

```sh
git clone https://github.com/<your-org>/qqueue.git
cd qqueue
```

## 2. Install dependencies

QQueue is a pnpm + Turborepo monorepo. Install everything from the root:

```sh
pnpm install
```

## 3. Copy the environment file

```sh
cp .env.example .env
```

Open `.env` and review the values. For local development the defaults work as-is
with the bundled Docker services, but you should at least skim:

- `DATABASE_URL` — points at the local Postgres (`localhost:5432`).
- `REDIS_HOST` / `REDIS_PORT` — local Redis (`localhost:6379`).
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`, `TRACKING_SECRET`
  — fine to leave as the dev placeholders locally; **regenerate all of them for
  production** with `openssl rand -hex 32`.
- `APP_URL` — public base URL for open/click tracking links (the API in dev).
- `PUBLIC_APP_URL` — public base URL of the web dashboard, used to build
  password-reset links. Defaults to the local Vite server in dev.

## 4. Start Postgres, Redis, and MinIO

The repo ships a `docker-compose.yml` with Postgres, Redis, and MinIO for
attachment storage:

```sh
docker compose up -d
```

Confirm the containers are running with `docker compose ps`.

## 5. Run database migrations

Generate the Prisma client and apply migrations:

```sh
pnpm db:generate
pnpm db:migrate
```

`db:migrate` runs `prisma migrate` for the API package and creates all tables
(users, organizations, SMTP connections, templates, contacts, campaigns,
email jobs/events, password reset tokens, and more).

## 6. Start the API, web app, and worker

```sh
pnpm dev
```

`pnpm dev` uses Turborepo to start all three apps together:

- **API** → `http://localhost:4000` (health check at `/health`)
- **Web dashboard** → `http://localhost:5173`
- **Worker** → background BullMQ processor for email sending, campaigns, and
  webhook delivery

You can also run them individually:

```sh
pnpm --filter @qqueue/api dev
pnpm --filter @qqueue/web dev
pnpm --filter @qqueue/worker dev
```

> The worker is required for **scheduled** emails and **campaigns**. Immediate
> transactional sends go out inline from the API, but keep the worker running so
> queued/scheduled work and webhook deliveries are processed.

## 7. Create your first account

Open `http://localhost:5173/register` and sign up. Registration creates your
**user**, your first **organization** (you become its `OWNER`), and signs you in.

Prefer the API? Register with curl — the response includes `organization.id`:

```sh
curl -s http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "password123",
    "name": "Admin",
    "organizationName": "Acme"
  }'
```

## 8. Add an SMTP connection

In the dashboard, go to **SMTP Connections → New connection** and enter your
mail server details (host, port, username, password, from address). QQueue
verifies the credentials before saving and encrypts them at rest with
`ENCRYPTION_KEY`. Mark it **default** so it's used automatically.

Using Mailcow? Follow [docs/MAILCOW_SETUP.md](MAILCOW_SETUP.md) for the exact
host/port/TLS settings.

Via the API instead:

```sh
curl -s http://localhost:4000/api/v1/smtp-connections \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "organizationId": "ORG_ID",
    "name": "Default SMTP",
    "host": "smtp.example.com",
    "port": 587,
    "secure": false,
    "username": "smtp-user",
    "password": "smtp-password",
    "fromEmail": "hello@example.com",
    "fromName": "Acme",
    "isDefault": true
  }'
```

## 9. Send your first test email

In the dashboard, open **Send Email**, choose your SMTP connection, fill in a
recipient, subject, and body, and send. Watch it move through the
**Dashboard** activity feed (and **Queue Operations** if it was scheduled).

Via the transactional API, create an API key first (**Settings → API keys**),
then:

```sh
curl -s http://localhost:4000/api/v1/transactional-email/send \
  -H "Authorization: Bearer qq_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "to": "recipient@example.com",
    "subject": "Hello from QQueue",
    "html": "<p>It works! 🎉</p>"
  }'
```

A `202 Accepted` with a job id means it was sent (or queued, for a future
`scheduledAt`). Check your inbox.

---

## Next steps

- [Transactional API](TRANSACTIONAL_API.md) — API keys, the SDK, webhook
  signing, and retries.
- [Deploy on a VPS](DEPLOY.md) — production Docker Compose setup for
  self-hosting QQueue.
- [Beta launch checklist](BETA_CHECKLIST.md) — everything to verify before a
  self-hosted production launch.
- [Troubleshooting](TROUBLESHOOTING.md) — if something above didn't work.
- [Demo script](DEMO_SCRIPT.md) — a guided walkthrough of the whole product.

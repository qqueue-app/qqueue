# QQueue Quickstart

This guide takes you from a fresh clone to sending your first test email on your
own machine. It targets local development; for a production launch follow the
[VPS Deploy guide](DEPLOY.md) and then the [Beta Launch Checklist](BETA_CHECKLIST.md).

**Time:** ~5 minutes. **You need:** Node.js 20+, [pnpm](https://pnpm.io), and
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

## 3. Run the guided setup

```sh
pnpm setup
```

The setup walks you through everything in plain language: it creates your
`.env`, generates all the secret keys (you never have to touch them), checks
that Postgres, Redis, and MinIO are running (and offers to start them with
Docker if not), and applies database migrations. Safe to re-run any time — it
never overwrites values you've already configured.

Prefer a hosted database or queue instead of the bundled Docker containers?
Grab free-tier services first (Neon for Postgres, Upstash for Redis) — see
[Managed infrastructure](MANAGED_INFRASTRUCTURE.md) — and paste the connection
details when setup asks.

<details>
<summary>Manual route (what <code>pnpm setup</code> automates)</summary>

```sh
cp .env.example .env      # then generate secrets: openssl rand -hex 32
docker compose up -d      # postgres, redis, minio
pnpm db:generate
pnpm db:migrate
```

Every variable is explained in
[Environment variables](ENVIRONMENT_VARIABLES.md).

</details>

## 4. Start the API, web app, and worker

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

## 5. Complete the setup wizard

Open `http://localhost:5173`. On a fresh install QQueue routes you straight
into a short **setup wizard** that:

1. Creates your **administrator account** and first **organization**.
2. Connects a **sending account** — the SMTP mailbox QQueue sends from. The
   connection is tested before it's saved, and the credentials are encrypted
   at rest. (Using Mailcow? [Exact settings here](MAILCOW_SETUP.md).)
3. Asks whether other people may **register** on your server (default: invite
   only — you can change this later in Settings → Instance).
4. Optionally sends you a **test email** to prove the pipeline works
   end to end.

If you close the tab mid-wizard, sign in and visit `/setup` (or follow the
"Finish server setup" nudge on the Dashboard) to resume where you left off.

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

And add a sending account:

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

## 6. Send your first real email

In the dashboard, open **Compose** (Email Studio), pick your sending account,
fill in a recipient, subject, and body, and send. Watch it move through the
**Dashboard** activity feed (and **Background jobs** if it was scheduled).

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
- [Environment variables](ENVIRONMENT_VARIABLES.md) — every `.env` setting in
  plain language.
- [Managed infrastructure](MANAGED_INFRASTRUCTURE.md) — hosted Postgres,
  Redis, and storage instead of the bundled containers.
- [Deploy on a VPS](DEPLOY.md) — production Docker Compose setup for
  self-hosting QQueue.
- [Beta launch checklist](BETA_CHECKLIST.md) — everything to verify before a
  self-hosted production launch.
- [Troubleshooting](TROUBLESHOOTING.md) — if something above didn't work.
- [Demo script](DEMO_SCRIPT.md) — a guided walkthrough of the whole product.

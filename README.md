# QQueue

![backend coverage](badges/coverage-backend.svg) ![web coverage](badges/coverage-web.svg)

QQueue is an open-core email platform built for teams that want the flexibility
of self-hosting and the convenience of managed email infrastructure.

The QQueue Core platform is open source and licensed under AGPL-3.0. It
provides the building blocks for email delivery, campaigns, transactional
messaging, queues, workers, templates, contacts, SMTP integrations, and sender
identities backed by sending domains with managed DKIM signing.

QQueue Cloud extends the core platform with managed services and advanced
operational tooling, including billing, subscription management, deliverability
monitoring, abuse prevention, reputation management, usage controls, analytics,
and hosted infrastructure.

QQueue is built with self-hosted infrastructure and Mailcow operators in mind,
but can also be used by teams that want a fully managed hosted email platform.

## Status

**QQueue is now an early self-hosted beta candidate.** The core platform is
feature-complete enough to run end-to-end on your own infrastructure: it
contains implemented core API modules, a React dashboard, BullMQ workers, Prisma
migrations, SMTP sending, sender identities and sending domains with managed
DKIM signing, open/click tracking, transactional API keys, outbound
webhooks, password reset emails, Redis-backed rate limiting, a queue operations
dashboard, an SDK package, deployment files, Docker-backed smoke tests, CI
checks, and open-core licensing guardrails.

It is beta software: expect rough edges, review the security and operational
notes before exposing it publicly, and pin a known-good commit for production.

New here? Start with the **[Quickstart](docs/QUICKSTART.md)** for local setup.
For a VPS, use the **[Deploy guide](docs/DEPLOY.md)**, then work through the
**[Beta Launch Checklist](docs/BETA_CHECKLIST.md)** before going live.

## Documentation

- [Quickstart](docs/QUICKSTART.md) — clone to first sent email, locally.
- [Deploy on a VPS](docs/DEPLOY.md) — production Docker Compose setup with
  Caddy, API, worker, Postgres, Redis, and MinIO.
- [Mailcow SMTP setup](docs/MAILCOW_SETUP.md) — connect a Mailcow mail server.
- [Troubleshooting](docs/TROUBLESHOOTING.md) — fixes for the most common
  SMTP, Redis, Prisma, queue, tracking, and reverse-proxy issues.
- [Beta launch checklist](docs/BETA_CHECKLIST.md) — what to verify before a
  self-hosted production launch.
- [Demo script](docs/DEMO_SCRIPT.md) — a 5–10 minute guided product walkthrough.
- [Transactional API](docs/TRANSACTIONAL_API.md) — API keys, SDK usage, webhook
  signing, and retry semantics.
- [Status audit](docs/STATUS.md) — current capability and gap audit.
- [Cloud boundary](docs/CLOUD_BOUNDARY.md) and [Licensing](docs/LICENSING.md) —
  open-core positioning and what lives where.

## Tech Stack

- Node.js and TypeScript
- pnpm workspaces and Turborepo
- Express API
- Vite, React, and Tailwind CSS web app
- BullMQ worker with Redis
- PostgreSQL and Prisma
- Nodemailer for SMTP
- Zod for validation
- ESLint and Prettier

## Local Development

### Prerequisites

- **Node.js 20+**
- **[pnpm](https://pnpm.io) 9** (`corepack enable` will install the pinned
  `pnpm@9.15.0`)
- **Docker** (for the bundled Postgres, Redis, and MinIO services)

### Clone to running, step by step

Run each step from the repository root. This is the full sequence — a fresh
clone is up and running after step 5.

```sh
# 1. Clone the repo
git clone https://github.com/<your-org>/qqueue.git
cd qqueue

# 2. Install all workspace dependencies
pnpm install

# 3. Create your env file (defaults work as-is for local dev)
cp .env.example .env

# 4. Start Postgres, Redis, and MinIO
docker compose up -d

# 5. Generate the Prisma client, apply migrations, and start everything
pnpm db:generate
pnpm db:migrate
pnpm dev
```

`pnpm dev` uses Turborepo to start the API, web dashboard, and worker together.
The `db:migrate` step is required on a fresh clone — it creates every table
(users, organizations, SMTP connections, templates, contacts, campaigns, email
jobs/events, and more). Skipping it leaves you with an empty database.

> The default `.env` values work out of the box with the bundled Docker
> services. The placeholder `JWT_*`, `ENCRYPTION_KEY`, and `TRACKING_SECRET`
> secrets are fine locally but **must** be regenerated for production with
> `openssl rand -hex 32`.

After `pnpm dev`, create your first account at
`http://localhost:5173/register` — registration creates your user and first
organization. The full walkthrough (account → SMTP connection → first email)
lives in the **[Quickstart](docs/QUICKSTART.md)**.

### Running apps individually

```sh
pnpm --filter @qqueue/api dev
pnpm --filter @qqueue/web dev
pnpm --filter @qqueue/worker dev
```

The worker is required for **scheduled** emails and **campaigns**. Immediate
transactional sends go out inline from the API, but keep the worker running so
queued/scheduled work and webhook deliveries are processed.

### Default local URLs

- API: `http://localhost:4000`
- Health check: `http://localhost:4000/health`
- API v1: `http://localhost:4000/api/v1`
- Web: `http://localhost:5173`
- MinIO console: `http://localhost:9101` (user `qqueue` / password
  `qqueue-secret`)

## Phase 1 Setup Flow

Start Postgres/Redis and the API, then register a user. Registration creates the first organization and returns its `organization.id`.

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

Create an SMTP connection for that organization:

```sh
curl -s http://localhost:4000/api/v1/smtp-connections \
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

Test the SMTP connection:

```sh
curl -s -X POST http://localhost:4000/api/v1/smtp-connections/SMTP_CONNECTION_ID/test
```

Create optional reusable data:

```sh
curl -s http://localhost:4000/api/v1/templates \
  -H "Content-Type: application/json" \
  -d '{
    "organizationId": "ORG_ID",
    "name": "Welcome",
    "subject": "Welcome, {{firstName}}",
    "html": "<p>Hello {{firstName}}, welcome to QQueue.</p>",
    "text": "Hello {{firstName}}, welcome to QQueue."
  }'

curl -s http://localhost:4000/api/v1/contacts \
  -H "Content-Type: application/json" \
  -d '{
    "organizationId": "ORG_ID",
    "email": "recipient@example.com",
    "firstName": "Riley"
  }'
```

Send one email using either direct content or a template. The send can target a
`senderIdentityId` to pick who it sends as; if omitted, the existing
`smtpConnectionId` / org-default flow still applies.

```sh
curl -s http://localhost:4000/api/v1/transactional-email/send \
  -H "Authorization: Bearer qq_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "to": "recipient@example.com",
    "templateId": "TEMPLATE_ID",
    "variables": {
      "firstName": "Riley"
    }
  }'
```

See [docs/TRANSACTIONAL_API.md](docs/TRANSACTIONAL_API.md) for API key setup,
SDK usage, self-hosted `baseUrl` configuration, error codes, webhook signing,
and retry semantics.

## Testing & Coverage

Tests use [Vitest](https://vitest.dev) and are colocated next to the code as
`*.test.ts` / `*.test.tsx`. The web app runs under jsdom with React Testing
Library; backend packages use a deep-mocked Prisma client and `supertest` for
HTTP integration tests.

```sh
pnpm test            # run all tests (no coverage)
pnpm test:smoke:docker # run the Docker-backed integration smoke test
pnpm test:coverage   # run all tests with coverage (enforces thresholds)
pnpm coverage        # test:coverage + regenerate the README coverage badges
```

Scope to one package:

```sh
pnpm --filter @qqueue/api test
pnpm --filter @qqueue/web test:coverage
```

Coverage is enforced per package in each `vitest.config.ts`; a run fails if any
metric (lines / statements / functions / branches) falls below its threshold:

| Group   | Packages                                         | Threshold |
| ------- | ------------------------------------------------ | --------- |
| Backend | `api`, `worker`, `email-engine`, `shared`, `sdk` | 85%       |
| Web     | `web`                                            | 80%       |

The two badges above are **generated by CI and committed to the repo** — no
external service or secret is involved:

1. CI runs `pnpm test:coverage`; each package writes `coverage/coverage-summary.json`.
2. `scripts/generate-coverage-badges.mjs` aggregates line coverage into the
   backend and web groups and writes `badges/coverage-backend.svg` and
   `badges/coverage-web.svg`.
3. On every push/merge to `main`, the
   [coverage workflow](.github/workflows/coverage.yml) regenerates the badges
   and commits any changes back to `main`.

Regenerate the badges locally with `pnpm coverage`.

## Folder Structure

```txt
qqueue/
├── apps/
│   ├── api/
│   ├── web/
│   └── worker/
├── packages/
│   ├── shared/
│   ├── email-engine/
│   └── sdk/
├── docs/
├── docker/
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md).

## Open-Core Summary

- **QQueue Core:** AGPL-3.0, self-hostable, open source.
- **QQueue Cloud:** proprietary/commercial, managed hosting and advanced
  operations.
- **SDKs:** MIT licensed for easy adoption where package-specific notices say
  so.
- **Branding:** QQueue name, logo, and marks are protected by trademark terms.

## License

Copyright (C) 2026 Nana Aboagye Boateng.

QQueue follows an **open-core** model:

- **QQueue Core** is open source under the
  [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). You are
  free to self-host, modify, and redistribute the core under the AGPL. If you run
  a modified version as a network service, the AGPL requires you to make the
  corresponding source available to that service's users.
- **QQueue Cloud** code under `apps/cloud/` is proprietary commercial software.
  It is not covered by the root AGPL grant and is governed by
  [apps/cloud/LICENSE](apps/cloud/LICENSE).
- **SDKs** may be permissively licensed under MIT where their package metadata
  and license files say so.
- **Documentation** may use CC-BY-4.0 where a documentation-specific notice says
  so.

See [NOTICE.md](NOTICE.md), [docs/LICENSING.md](docs/LICENSING.md), and
[TRADEMARK.md](TRADEMARK.md) for the full repository licensing and trademark
overview.

## Contributing

Contributions are welcome. Because QQueue offers both an AGPL build and a
commercial offering, all contributors must sign the
[Contributor License Agreement](CLA.md). See [CONTRIBUTING.md](CONTRIBUTING.md)
for details.

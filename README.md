# QQueue

QQueue is an early-stage, open-source email platform for developers and small teams. It is designed to be self-hosted first, with a future managed cloud version for teams that want hosted onboarding, billing, usage limits, and operational support.

QQueue exists to make SMTP-based sending, contacts, templates, campaigns, queues, workers, transactional email, and future analytics available in one developer-friendly system without locking the product to a single email provider.

## Status

QQueue is in early development. This repository currently contains the initial scaffold, documentation, Prisma schema, and placeholder app/package structure.

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

From the repository root:

```sh
cp .env.example .env
pnpm install
docker compose up -d
pnpm db:generate
pnpm dev
```

Run individual apps:

```sh
pnpm --filter @qqueue/api dev
pnpm --filter @qqueue/web dev
pnpm --filter @qqueue/worker dev
```

Default local URLs:

- API: `http://localhost:4000`
- Health check: `http://localhost:4000/health`
- API v1: `http://localhost:4000/api/v1`
- Web: `http://localhost:5173`

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

Send one email using either direct content or a template:

```sh
curl -s http://localhost:4000/api/v1/transactional-email/send \
  -H "Content-Type: application/json" \
  -d '{
    "organizationId": "ORG_ID",
    "to": "recipient@example.com",
    "templateId": "TEMPLATE_ID",
    "variables": {
      "firstName": "Riley"
    }
  }'
```

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

## License

QQueue is open source under the [GNU Affero General Public License v3.0](LICENSE)
(AGPL-3.0-only). You are free to self-host, modify, and redistribute it. If you
run a modified version as a network service, the AGPL requires you to make the
corresponding source available to that service's users.

QQueue follows an **open-core** model: the core platform in this repository is
AGPL-licensed, while certain managed-cloud features (planned for Phase 7) will
be developed under a separate commercial license. A commercial license that
removes the AGPL's source-disclosure obligations is also available for
organizations that need it — open an issue or get in touch to discuss.

## Contributing

Contributions are welcome. Because QQueue offers both an AGPL build and a
commercial offering, all contributors must sign the
[Contributor License Agreement](CLA.md). See [CONTRIBUTING.md](CONTRIBUTING.md)
for details.

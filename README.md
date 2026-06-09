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

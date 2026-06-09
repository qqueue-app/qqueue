# Roadmap

## Phase 0: Project Scaffold

- [x] Monorepo setup
- [x] API scaffold
- [x] Web scaffold
- [x] Worker scaffold
- [x] Shared packages
- [x] Docker Compose
- [x] Prisma schema

## Phase 1: Core Sending

- [x] Auth
- [x] Organizations
- [x] SMTP connections
- [x] Test SMTP connection
- [x] Templates
- [x] Contacts
- [x] Send single email

## Phase 2: Deployment and Self-Hosting

Core sending (Phase 1) is feature-complete; this phase makes it runnable on a
real server rather than only in local development.

### Goal / design decisions

- **Target:** single VPS running `docker compose -f docker-compose.prod.yml up -d`.
  No managed services required (Postgres + Redis bundled), but `DATABASE_URL` /
  `REDIS_HOST` can point at external ones.
- **Reverse proxy: Caddy** (not nginx) — serves the web build as static files
  and proxies `/api/*` + `/health` to the API container, on one domain.
  Chosen because it does **automatic Let's Encrypt TLS** from just the domain
  name (no certbot, no cert files, no cron).
- **One domain, same origin:** web at `/`, API at `/api/*`. So the web build's
  `VITE_API_URL` is derived from `DOMAIN` at build time — the operator never
  sets it directly.

### Operator config surface (what self-hosters actually touch)

The only file an operator edits is `.env`. No proxy/cert/Docker files are
hand-written. Everything below is parameterized off these:

- `DOMAIN` — the one chosen value; must match the A record they point at the box.
- `POSTGRES_PASSWORD` + `DATABASE_URL` (host = compose service `postgres`).
- `REDIS_HOST=redis`, `REDIS_PORT=6379`.
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY` (32-byte) — all via
  `openssl rand -hex 32`. `ENCRYPTION_KEY` encrypts stored SMTP passwords
  (`lib/crypto.ts`), so it must be stable and secret.

Prerequisites on their side (out of our control): one DNS A record →
server IP, and ports 80 + 443 open (Caddy needs both for the ACME challenge).
Email deliverability DNS (SPF/DKIM/DMARC) lives on their mail server, not here.

### Tasks

- [ ] Dockerfile for the API (build → `node dist/index.js`)
- [ ] Dockerfile for the worker
- [ ] Dockerfile for the web (build static assets; `VITE_API_URL` as a build arg from `DOMAIN`)
- [ ] `Caddyfile` (committed): static web + `reverse_proxy` for `/api/*` and `/health`, auto-TLS via `{$DOMAIN}`
- [ ] `docker-compose.prod.yml`: caddy, api, worker, postgres, redis, wired via `.env`
- [ ] One-shot migrate step running `prisma migrate deploy` on deploy
- [ ] Commit Prisma migrations (currently gitignored — see `.gitignore`)
- [ ] Updated `.env.example` with `DOMAIN` + secret-generation instructions
- [ ] Restrict CORS to the configured web origin (currently open in `app.ts`)
- [ ] Fix the hardcoded `localhost` in the API startup log (`apps/api/src/index.ts`)
- [ ] `docs/DEPLOY.md`: the 3-step VPS walkthrough (fill `.env` → DNS record → `docker compose up`)

## Phase 3: Campaigns

- [ ] Contact lists
- [ ] Campaign drafts
- [ ] Send now
- [ ] Schedule campaign
- [ ] Queue campaign recipients
- [ ] Worker sends campaign emails

## Phase 4: Scheduling and Recurring

- [ ] Send later
- [ ] Recurring campaigns
- [ ] Cron expressions
- [ ] Pause/resume campaigns

## Phase 5: Analytics

- [ ] Email events
- [ ] Open tracking
- [ ] Click tracking
- [ ] Bounce tracking
- [ ] Campaign dashboard

## Phase 6: Transactional API

- [ ] API keys
- [ ] Send email endpoint
- [ ] Template variables
- [ ] SDK
- [ ] Webhooks

## Phase 7: Managed Cloud

- [ ] Billing
- [ ] Workspaces
- [ ] Usage limits
- [ ] Hosted onboarding
- [ ] Multi-tenant hardening

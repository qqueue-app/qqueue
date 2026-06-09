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

- [x] Dockerfile for the API (build -> `node dist/index.js`)
- [x] Dockerfile for the worker
- [x] Dockerfile for the web (build static assets into the Caddy image)
- [x] `Caddyfile` (committed): static web + `reverse_proxy` for `/api/*` and `/health`, auto-TLS via `{$DOMAIN}`
- [x] `docker-compose.prod.yml`: caddy, api, worker, postgres, redis, wired via `.env`
- [x] One-shot migrate step running `prisma migrate deploy` on deploy
- [x] Commit Prisma migrations (currently gitignored - see `.gitignore`)
- [x] Updated `.env.example` with `DOMAIN` + secret-generation instructions
- [x] Restrict CORS to the configured web origin (currently open in `app.ts`)
- [x] Fix the hardcoded `localhost` in the API startup log (`apps/api/src/index.ts`)
- [x] `docs/DEPLOY.md`: the 3-step VPS walkthrough (fill `.env` -> DNS record -> `docker compose up`)

## Phase 3: Campaigns

- [x] Contact lists
- [x] Campaign drafts
- [x] Send now
- [x] Schedule campaign
- [x] Queue campaign recipients
- [x] Worker sends campaign emails

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

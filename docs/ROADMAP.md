# Roadmap

## Current Status Reference

See [docs/STATUS.md](STATUS.md) for the current state, completed work, known
gaps, beta checklist, and recommended next sprint. As of the Beta Polish +
Launch Prep Sprint, QQueue is a **feature-complete self-hosted beta candidate
undergoing launch preparation** — see the Beta Readiness Assessment in STATUS.md.

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

- [x] Send later
- [x] Recurring campaigns
- [x] Cron expressions
- [x] Pause/resume campaigns

## Phase 5: Analytics

- [x] Email events
- [x] Open tracking
- [x] Click tracking
- [x] Bounce tracking (synchronous SMTP rejections + generic ESP webhook)
- [x] Campaign dashboard

## Phase 6: Transactional API

- [x] API keys
- [x] Send email endpoint
- [x] Template variables
- [x] SDK
- [x] Webhooks

### Phase 6 follow-up notes

These are polish/hardening items to pick up after the main Phase 6 surface:

- [x] Transactional API docs:
      API key setup, SDK install/use, curl examples, self-hosted `baseUrl`,
      template variables, webhook signing, and retry semantics.
- [x] Stabilize the public send response shape:
      prefer a compact `{ id, status }` response over exposing nested internal
      `{ emailJob, providerResult }` details.
- [x] Add stable API error codes:
      machine-readable codes for invalid API key, missing SMTP connection,
      invalid template, SMTP failure, invalid schedule, and validation errors.
- [x] Improve SMTP/secret UX:
      clearer error when encrypted SMTP credentials cannot be decrypted, plus
      docs explaining that changing `ENCRYPTION_KEY` invalidates stored SMTP
      secrets.
- [x] Add webhook delivery detail UI:
      recent attempts per endpoint, response status, error message, delivered
      time, retry state, and a manual retry action.
- [x] Add webhook verification docs/examples:
      sample HMAC verification code for Node/Express and notes about timestamp
      tolerance/replay protection.
- [x] Add SDK release hygiene:
      changelog, package publishing checklist, install smoke test, and version
      bump flow for `qqueue-sdk`.

## Licensing & Open-Core Model

QQueue is **open core**, all in this one repository:

- The core platform (everything in Phases 0–6) is licensed under **AGPL-3.0**
  (`LICENSE`). Anyone can self-host, modify, and redistribute it; running a
  modified version as a network service triggers the AGPL's source-disclosure
  obligation.
- The managed-cloud features (Phase 7) will live in a **fenced directory**
  (e.g. `apps/cloud/` or `packages/ee/`) under a **separate commercial license**,
  with its own `LICENSE` file. The license boundary — not a repo boundary — is
  what protects the cloud business.
- All contributions are covered by a **Contributor License Agreement**
  (`CLA.md`), so the project can use contributed code in both the AGPL core and
  the commercial offering. See `CONTRIBUTING.md`.

### Before starting Phase 7

These should be in place before any cloud-only code lands:

- [x] Create the fenced proprietary directory (`apps/cloud/` or `packages/ee/`)
      with its own commercial `LICENSE` and a README note marking the boundary.
- [x] Decide the initial commercial feature boundary (what stays in the AGPL
      core vs. what is cloud-only).
- [x] Replace the placeholder commercial license with a commercial license
      draft.
- [ ] Have the commercial license draft reviewed by qualified legal counsel,
      including pricing-tier feature rights and restrictions.
- [x] Keep all multi-tenant/billing/usage-metering code on the proprietary side;
      keep reusable primitives (auth, queue, sending) in the AGPL core.
- [x] Add repeatable dependency license audit (`pnpm license:audit`) and CI
      enforcement.
- [ ] Have final dependency license output reviewed before release.
- [x] Wire up CLA enforcement (CLA-assistant bot or `Signed-off-by` checks in CI).

See `docs/CLOUD_BOUNDARY.md` for the current Phase 7 boundary rules.

### Public legal docs

- [x] Add public QQueue Cloud Terms of Service and Privacy Policy drafts under
      `docs/legal/`.
- [ ] Have the SaaS Terms of Service and Privacy Policy reviewed by qualified
      legal counsel before serious commercial launch.
- [x] Add a data processing agreement, subprocessor list, cookie policy, SLA,
      and enterprise terms before larger customer or enterprise sales (drafts in
      `docs/legal/`; pending legal-counsel review).

### Phase 7 design notes (planning)

- **Billing:** integrate a payment provider (e.g. Stripe); model plans, seats,
  and metered usage; handle webhooks for subscription lifecycle events.
- **Workspaces:** multi-tenant boundary on top of existing organizations;
  per-workspace isolation of contacts, templates, campaigns, and SMTP configs.
- **Usage limits:** enforce per-plan quotas (emails/month, contacts, API calls)
  at the queue/worker layer; surface usage in the dashboard.
- **Hosted onboarding:** guided signup, managed shared/pooled sending infra,
  domain + DKIM/SPF verification flows.
- **Multi-tenant hardening:** row-level tenant scoping audit, rate limiting,
  noisy-neighbor isolation, per-tenant secrets handling, abuse/deliverability
  controls.

## Phase 7: Managed Cloud

- [ ] Billing
- [ ] Workspaces
- [ ] Usage limits
- [ ] Hosted onboarding
- [ ] Multi-tenant hardening

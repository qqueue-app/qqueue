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

## Email Operations Platform (Phases A–F)

QQueue is positioned as an **email operations platform**, not a Gmail/Outlook/
Zoho clone. It is built around four capabilities that share **one delivery
pipeline** (`EmailJob` → BullMQ → email-engine → SMTP → `EmailEvent`):

1. **Campaign emails** — bulk marketing/communication (implemented, Phase 3–5).
2. **Transactional emails** — API/SDK/SMTP application-triggered sends
   (implemented, Phase 6).
3. **Manual email sending** — a user-facing composer for individual/small-batch
   sends (implemented as **Email Studio**, Phase B).
4. **Optional inbox module** — opt-in, feature-flagged IMAP for viewing replies
   to sent mail (Phase E).

Campaign, transactional, and manual sends are three entry points into one
pipeline, not three products. See `docs/DECISIONS.md` for the rationale behind
the decisions referenced below.

### Phase A: Send-pipeline refactor (enabling — do first)

See [docs/PHASE_A_PLAN.md](PHASE_A_PLAN.md) for the detailed implementation plan.

Harden the shared send pipeline before larger UI work.

- [x] Add `origin` (`CAMPAIGN | TRANSACTIONAL | MANUAL`) and a
  `createdByUserId` audit field to `EmailJob`.
- [x] Add `cc`, `bcc`, `replyTo`, and attachments to `SendEmailPayload`
  (`packages/email-engine`) and `EmailJob`.
- [x] Introduce **MJML** as the canonical email-safe HTML rendering layer used
  by both the manual composer and campaigns (Tiptap output is not email-client
  safe on its own).
- [x] Object storage (S3-compatible; MinIO for self-host) for attachments and
  hosted images — metadata in the DB (`EmailAttachment`), blobs in object
  storage via the shared `@qqueue/storage` package. (Hosted-image rewriting is
  not built yet; the storage layer it needs is in place.)

### Phase A.5: Foundation domains (enabling — before Email Studio)

Backend-first domain hardening so Email Studio and Phases B–E build on a stable
schema. No UI in this phase. See `docs/DECISIONS.md` ("Add Foundation Domains
Before Building the Email Studio").

- [x] `Contact.tags` (`String[]`) for future segmentation/import mapping.
- [x] `ContactList.description`.
- [x] Explicit `ContactListMember` join (replaces the implicit M2M) with
  `addedAt` and a unique `(contactListId, contactId)` constraint; existing
  memberships migrated, legacy API response shape preserved.
- [x] `Template.mjml` source column alongside the compiled `html`. Template
  versioning evaluated and **deferred** (documented in `DECISIONS.md`).
- [x] Threading metadata on `EmailJob` (`inReplyTo`, `references`; `messageId`
  already existed), wired through `SendEmailPayload` and the send worker.
  Inbound storage for the inbox is deferred to Phase E.
- [x] Migration, indexes, constraints, repositories/services, and tests.

### Phase B: Email Studio (manual email composer)

Delivered as **Email Studio** (`apps/web/src/pages/EmailStudio.tsx`) — the first
complete manual-email workflow. It is a dedicated composer surface but **not** a
separate product: every send flows through the existing shared pipeline
(`EmailJob` → BullMQ → email-engine → SMTP → `EmailEvent`) with `origin = MANUAL`
and `createdByUserId` recorded. A thin `manual-email` API module resolves and
deduplicates recipients, renders the body through the MJML email-safe layer, and
delegates to `transactionalEmailService.send`; it does **not** introduce a
parallel delivery path. The legacy one-off `SendEmail.tsx` page remains for
single-recipient sends.

- [x] Multiple `To` recipients (one message, deduplicated)
- [x] `CC` and `BCC`
- [x] Contact picker and contact-list picker (reuse existing modules)
- [x] Template apply (working copy; never mutates the source template)
- [x] Tiptap editor (headings, bold/italic/underline, links, lists, rules)
- [x] Preview through the canonical MJML render + tracking pipeline
- [x] Drafts (`EmailDraft`): auto-save, manual save, resume, delete, send
- [x] Schedule send (reuse existing `scheduledAt` path)
- [x] Attachments (upload to object storage, link to the `EmailJob`, streamed
  to SMTP by the send pipeline; round-tripped through drafts)
- [x] Surface per-recipient delivery status from `EmailEvent` records
  (`GET /manual-email/:id/status` — derived from the SMTP accepted/rejected
  result plus engagement events; shown in Email Studio after a send)

### Phase C: Contacts and contact lists

Contacts and lists exist; this phase enhances them. The Phase A.5 foundation
(`Contact.tags`, explicit `ContactListMember` membership) is the substrate these
build on.

- [x] CSV import/export (record import source on `ContactListMember`)
- [x] Contact activity timeline (driven by `EmailEvent`)
- [x] Suppression list and List-Unsubscribe handling
- [x] Segmentation (basic, tag-driven) — advanced segmentation in Phase D

See [docs/PHASE_C_PLAN.md](PHASE_C_PLAN.md) for the implementation details.

### Phase D: Advanced campaign features

See [docs/PHASE_D_PLAN.md](PHASE_D_PLAN.md) for the implementation plan.

- [x] Segmentation (dynamic `Segment` rule tree, re-resolved at send time;
  campaigns can target a segment instead of a list)
- [x] A/B subject testing (subject variants, test fraction + delayed winner
  decision by open/click, winner sent to the remainder)
- [x] Per-domain throttling (Redis fixed-window per recipient domain, enforced
  in the send worker; per-org caps + env default)
- [x] Bounce-driven auto-suppression (soft/hard classification + per-org
  threshold; hard bounces and complaints suppress immediately, soft bounces
  only after the threshold within the window)
- [x] Deliverability tooling (rates + hard/soft split, per-domain breakdown,
  reputation alerts; dashboard hosts the policy + throttle controls)

### Phase E: Optional inbox module

**Separate module, disabled by default, behind a feature flag** — mirroring the
`apps/cloud` boundary discipline. It exists to support sending (seeing replies),
not to become a mailbox product.

- Phase 1
  - [x] Backend inbox foundation: feature flag, inbox account records,
    inbound message storage, and outbound reply anchoring
  - [x] Connect mailbox via IMAP
  - [x] Sync incoming emails (read-only)
  - [x] View replies to sent emails (anchored to outbound `messageId` /
    `In-Reply-To`)
  - [x] Search emails
  - [x] Filter unread/read
- Phase 2 (deferred)
  - [x] Reply from QQueue
  - [x] Shared inbox
  - [x] Assign conversations
  - [x] Internal notes
- Phase 3 (deferred)
  - [x] Inbound email routing (manual route labels on synced messages)
  - [x] Support workflows (status, priority, assignment, notes)
  - [x] Ticketing integrations (external ticket reference fields for Jira,
    Linear, GitHub, Zendesk, and other systems)

### Phase F: Collaboration and team workflows

- [ ] Reply-from-QQueue
- [ ] Shared inbox with conversation assignment
- [ ] Internal notes
- [ ] Team collaboration on conversations

(Ticketing is an integration target, not a build.)

### Editor stack

- **MVP composer:** Tiptap (already shipping) with `{{variable}}` support.
- **Email-safe rendering:** MJML as the canonical render layer for composer and
  campaigns; store both editor source and compiled email-safe HTML on
  `Template`.
- **Future drag-and-drop:** GrapesJS + `grapesjs-mjml` preset in the AGPL core;
  Unlayer only as an optional cloud-only premium editor under `apps/cloud`.

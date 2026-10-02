# Roadmap

## Current Status Reference

See [docs/STATUS.md](STATUS.md) for the current state, completed work, known
gaps, beta checklist, and recommended next sprint. As of the Beta Polish +
Launch Prep Sprint, QQueue is a **feature-complete self-hosted beta candidate
undergoing launch preparation** — see the Beta Readiness Assessment in STATUS.md.

## Everyday email app (next phase)

**Goal:** An administrator provisions or connects a mailbox, grants it to a
person, and that person can manage ordinary mail from an installed QQueue app
on a phone or from a laptop. This supersedes the earlier decision to keep the
inbox limited to replies to QQueue sends. Mailcow-backed mailboxes are the
first supported end-to-end path; the existing external IMAP/SMTP connection
path remains available.

**Already present:** organization invitations, mailbox provisioning, paired
read/send grants, IMAP import, inbox search and read filters, reply, compose,
drafts, sent archive, responsive PWA, and optional push notifications. Reuse
these foundations and preserve the shared `EmailJob` delivery pipeline.

### First priority: make the existing app easy to use

The immediate product risk is usability for a sales or office worker who only
wants to read, answer, and send mail, and for the administrator assigning their
mailbox. The shell has begun to put daily mail first, but still exposes Outbox,
audience tools, campaigns, and Settings beside Inbox and Compose on desktop.
Compose now reveals templates and scheduling on request, while contact lists,
preview, and delivery details remain nearby. These are useful capabilities,
but ordinary mail tasks should not require someone to understand them.

- [x] Put Inbox first in navigation, give Sent a primary phone tab, and label
      the statistics destination Insights rather than Home.
- [x] Keep ordinary compose fields and Send visible; reveal templates and
      schedule or repeat controls on request.
- [ ] Walk through the admin journey (invite a colleague, assign a mailbox,
      verify they can receive and send) and the member journey (open mail,
      reply, compose, find Sent, adjust notifications) on a phone and laptop.
      Observe nontechnical users without coaching; record where they hesitate,
      take a wrong turn, or need a term explained.
- [ ] Make Inbox, Compose, Drafts, Sent, and search the obvious daily paths.
      Group campaign, analytics, queue, API, and server configuration by the
      jobs and roles that use them. Preserve access to advanced features;
      simplify their placement instead of deleting them.
- [ ] Keep the default compose and reply flows short. Reveal templates,
      scheduling, recurrence, tracking, and delivery diagnostics when needed,
      with clear labels and safe defaults.
- [ ] Use plain mail language in navigation, empty states, errors, and help.
      Explain the next action instead of exposing SMTP, IMAP, queues, sync, or
      pipeline concepts to a person reading or writing mail.
- [ ] Make first-use guidance contextual: an unassigned member should know to
      ask an admin; an admin should see the next setup step; a connected but
      empty inbox should explain when mail will appear.
- [ ] Repeat task testing after each change. A first-release usability check is
      that a new member can read, reply, compose, and find sent mail, and an
      admin can assign a mailbox, without training or technical vocabulary.

This work comes before expanding IMAP behavior. Use the existing installable
web app as the first phone experience; decide on a native app only if testing
shows a concrete need for it.

### 1. Make assigned mailboxes usable every day

- [x] Scope the member's inbox and mailbox picker to assigned mailboxes, show
      a clear empty state when none is assigned, and keep mailbox connection
      controls in the inbox admin-only. Provisioning and grants already require
      an admin on the API.
- [ ] Page through all accessible mail server messages, with server-side mailbox
      filtering, stable ordering, and a way to load older mail on the phone.
- [ ] Import older mail in controlled batches. Record IMAP mailbox identity
      (`UIDVALIDITY`) so a server rebuild or folder recreation cannot silently
      attach a new message to an old UID.
- [ ] Exercise the complete administrator → invite → grant → phone install →
      receive → reply flow against Mailcow on real devices and desktop browsers.

### 2. Synchronize mailbox state in both directions

- [ ] Treat the IMAP server as the source of truth for mailbox folders and
      flags. Sync changes made by other clients, including read/unread,
      starred/flagged, moves, and deletions; reflect them in QQueue.
- [ ] Add read/unread, star, archive, trash, restore, and move actions in the
      API and mobile UI. Authorize every action against the mailbox grant;
      apply it to IMAP, surface failures, and reconcile the local copy after
      retries. Define the behavior for an offline or unavailable server.
- [ ] Sync the folders required for the first mail-app release: Inbox, Sent,
      Drafts, Archive, and Trash where the server exposes them. Account for
      server-specific folder names and special-use flags.

### 3. Complete conversations and compose

- [ ] Add reply-all and forward, including attachments, with a mobile-friendly
      composer and per-mailbox From selection. Continue routing all QQueue
      sends through `EmailJob` → BullMQ → `@qqueue/email-engine` → SMTP →
      `EmailEvent`, using the connection's identity and existing send-as grants,
      suppression checks, and idempotency rules.
- [ ] Reconcile QQueue-sent mail with the mailbox's IMAP Sent folder and display
      mail sent from other clients without duplicates. Decide how remote Drafts
      interact with QQueue's existing per-user drafts before enabling edits.
- [ ] Make message/thread views work across paged folders; preserve attachment
      privacy and safely display remote HTML on phones and laptops.

### 4. Make the installed app dependable

- [ ] Test install, sign-in persistence, push delivery, deep links, background
      refresh, and notification permissions on supported iOS/Android browsers.
- [ ] Provide a clear offline state. Define whether the first release offers
      read-only cached mail and offline drafts; never claim that a server action
      succeeded until it has been applied or is visibly queued.
- [ ] Check keyboard, screen-reader, and touch use for the member workflows.

**Release check:** With two members granted different mailboxes, each can see
only their own mail and notifications. Each can read, reply, compose, search,
page older mail, and organize messages on phone and laptop. Changes made in
QQueue appear in another IMAP client and vice versa. A failed server action is
visible and recoverable, and outgoing mail still uses the shared pipeline.

After the usability pass, the first deeper mailbox slice is complete inbox
pagination and a real Mailcow device trial. That exposes sync problems before
building folder mutations on top of the current import.

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
- **Hosted onboarding:** guided signup and managed shared/pooled sending
  infrastructure. (Managed DKIM signing and per-domain verification already ship
  in the AGPL core as Phase F; the cloud layer builds pooled sending and
  onboarding around them.)
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
4. **Inbox module** — IMAP reply sync and lightweight collaboration for sent
   mail (Phases E-F).

Campaign, transactional, and manual sends are three entry points into one
pipeline, not three products. See `docs/DECISIONS.md` for the rationale behind
the decisions referenced below.

### Phase A: Send-pipeline refactor (enabling — do first)

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
parallel delivery path. (The earlier one-off `SendEmail.tsx` page has since been
retired — `/send-email` now redirects to Email Studio.)

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

### Phase D: Advanced campaign features

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

### Phase E: Inbox module

> Historical scope. The [everyday email app](#everyday-email-app-next-phase)
> now extends the inbox beyond this initial reply workflow.

Separate module with focused IMAP sync and reply workflows. It exists to
support sending by showing conversations and letting operators reply, not to
become a mailbox product.

- [x] Backend inbox foundation: inbox account records, inbound message storage,
  and outbound reply anchoring
- [x] Connect mailbox via IMAP
- [x] Sync incoming emails (read-only)
- [x] View replies to sent emails (anchored to outbound `messageId` /
  `In-Reply-To`)
- [x] Search emails
- [x] Filter unread/read
- [x] Conversation list and thread detail view in the dashboard
- [x] Reply from QQueue

Ticketing and helpdesk-style collaboration are not part of the inbox scope. If
added later, they should live as a separate integration workflow rather than in
the core inbox UI.

### Phase F: Sending domains and sender identities (managed DKIM)

Decouple the visible From identity from the single authenticating SMTP
credential, and let QQueue optionally own DKIM for domains it sends from.

- [x] `SendingDomain` model with `EXTERNAL` vs `MANAGED` DKIM modes and a
  `DkimStatus` (`PENDING`/`VERIFIED`/`FAILED`/`NA`).
- [x] Managed mode: RSA-2048 keypair generation (selector `qqueue`), encrypted
  private key, in-process DKIM signing, and the DNS records to publish.
- [x] `dkim-verification` worker resolves the published TXT record and moves
  managed domains `PENDING → VERIFIED/FAILED`, on demand and on a daily recheck.
- [x] `SenderIdentity` model: a concrete From (name+email) under a sending
  domain, bound to the SMTP connection that transports it; one org default.
- [x] Send-time resolution via `resolveSender`/`dkimSignOptionsFor`
  (`apps/api/src/lib/sender.ts` + `apps/worker/src/lib/sender.ts`), covering
  transactional, manual, and campaign sends; only `MANAGED`+`VERIFIED` domains
  are signed.
- [x] Dashboard: a Sending Domains page and a sender-identity from-picker on the
  send surfaces.
- [x] Public API and SDK accept an optional `senderIdentityId`, backward
  compatible with the existing `smtpConnectionId`/org-default flow.

### Editor stack

- **MVP composer:** Tiptap (already shipping) with `{{variable}}` support.
- **Email-safe rendering:** MJML as the canonical render layer for composer and
  campaigns; store both editor source and compiled email-safe HTML on
  `Template`.
- **Future drag-and-drop:** GrapesJS + `grapesjs-mjml` preset in the AGPL core;
  Unlayer only as an optional cloud-only premium editor under `apps/cloud`.

---

## Evolution plan (2026-08) — status and deferred backlog

The August 2026 evolution plan (unified send path → per-recipient correctness →
async bounces → security gaps → Mailcow provisioning → operational hygiene) is
**complete through Phase 5**. `CHANGELOG.md` records exactly what each phase
shipped and why.

- [x] Phase 1 — one send path: every email flows through the worker pipeline
- [x] Phase 2 — per-recipient jobs, cc/bcc suppression, List-Unsubscribe by bulkness
- [x] Phase 2b — async bounce processing (DSN parsing in inbox sync)
- [x] Phase 3 — security gaps (role gates, ESP webhook off, trust proxy, reset-token echo)
- [x] Phase 4 — Mailcow provisioning + send-as grants
- [x] Phase 5 — key rotation, graceful shutdown, revocable refresh tokens,
      structured logging, CI parity, segment-campaign fix
- [x] Post-plan: worker structured logging (pino) and a React error boundary

### Deferred backlog (deliberately not started)

Items reviewed during the evolution plan and consciously deferred — with the
reason — so future work starts from a decision, not a rediscovery:

- **SMTP transport pooling / connection reuse** — every send opens a fresh SMTP
  connection (`packages/email-engine`, no `pool` option anywhere). Worth doing
  when volume justifies it; **measure first**.
- **A/B testing UI** — the API supports subject A/B end to end
  (`configureAbTest`, variant analytics) but no page calls it and
  `CampaignAnalytics` doesn't render `variantBreakdown`. Also unify the two
  "opens" definitions first (winner decision counts raw run-scoped events;
  variant analytics counts unique unscoped events).
- **EmailEvent analytics query limits** — the per-URL click breakdown loads
  every `CLICKED` event unbounded. Schedule when volume grows.
- **Inbox UI beyond what exists / ticketing** — ticketing was built once and
  removed (`remove_inbox_ticketing` migration); don't resurrect casually.
- **ESP relay providers (SES/Resend/Brevo/Postmark/Mailcow-API)** — the classes
  in `packages/email-engine/src/providers/future-providers.ts` stay stubs until
  a deliberate decision to support relays beyond direct SMTP.
- **Cloud app auth/billing** — `apps/cloud` is a scaffold with no auth; gated
  on a commercial decision, not a technical one.
- **MFA, SSO, email verification** — deliberately out of the self-hosted beta's
  scope.
- **Worker-side per-key idempotency TTL** — `Idempotency-Key` rows never expire
  (unbounded growth); revisit alongside the EmailEvent analytics work.
- **Phase 2c — finish async bounce accounting observability.** Stored DSNs that
  do not correlate to a QQueue `EmailJob` now appear as **Unattributed
  bounces** on Sending health and carry an Inbox badge. They remain outside the
  rate (there is no send denominator) and cannot suppress an address; this
  protects the pipeline from direct-SMTP notices and backscatter. Phase 2b's
  DSN parser
  (`apps/worker/src/lib/dsn.ts`) only sees bounces that arrive in a synced
  `InboxAccount` mailbox. An instance whose DSNs predate that account — or that
  has no inbox account at all — reports a structural zero for bounces, which is
  indistinguishable from perfect delivery. Needs a `scripts/backfill-dsn-bounces.ts`
  re-scan and a setup-time check that bounce accounting is reachable at all.
- **`scripts/reconcile-suppressions.ts`** — a dry-run-by-default repair script
  for instances whose unsubscribes predate the suppression list, so the
  Suppressions total reflects reality rather than only post-upgrade activity.
- **Unsubscribe footer on non-bulk mail** — List-Unsubscribe is attached by
  bulkness (Phase 2), so one-off and transactional mail deliberately offers
  recipients no unsubscribe path. That is a compliance posture worth deciding
  on purpose; it is currently true by omission.

### Smaller known gaps (fine to pick up any time)

- Segments UI builds only a flat rule list and omits `createdAt` rules; the API
  supports nested AND/OR trees.
- Campaign fan-out does not apply template variable *defaults* (preview does).
- `Contact.metadata`/tags are not available as campaign merge fields.
- CSV import writes contacts one row at a time.
- No API to grant `User.isInstanceAdmin` after the first user.
- `docs/STATUS.md`'s verification block understates the suite (it predates a
  large run of migrations and test files); refresh it the next time that doc is
  touched.

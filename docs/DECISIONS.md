# Decisions

## Use a Monorepo

QQueue uses a monorepo so apps, shared types, email provider logic, and the SDK can evolve together with a single dependency graph.

## Use pnpm and Turbo

pnpm workspaces provide fast installs and clear package boundaries. Turborepo coordinates app and package scripts across the workspace.

## Keep API and Worker Separate

The API handles HTTP traffic and persistence. Workers handle queue processing, email sending, and campaign expansion. This keeps long-running background work away from request handling.

## Use PostgreSQL as the Primary Database

PostgreSQL is the source of truth for users, organizations, contacts, templates, campaigns, jobs, events, API keys, and SMTP connection metadata.

## Use Redis and BullMQ for Queues

Redis and BullMQ provide a practical queue foundation for campaign scheduling, recipient fan-out, retries, and background email delivery.

## Use a Provider Abstraction Instead of Hardcoding Mailcow

QQueue should support Mailcow-compatible SMTP, generic SMTP, and future provider APIs. A provider interface keeps delivery logic swappable.

## Start with SMTP Provider First

SMTP is the simplest path for self-hosted users and Mailcow compatibility. Provider-specific APIs can be added after the core sending workflow is stable.

## Use Organization as the Initial Phase 7 Tenant

Phase 7 will treat `Organization` as the initial managed-cloud tenant, workspace,
and billing boundary. Existing Phase 0-6 data already hangs off
`organizationId`, so this avoids introducing a separate `Workspace` model before
there is a product need for it.

If a future feature needs a separate workspace layer, document the user story and
migration path before adding it.

## Publish Draft QQueue Cloud Legal Docs Before Launch

QQueue Cloud has public draft Terms of Service and Privacy Policy documents in
`docs/legal/`, with qqueue.app as the canonical public domain.

These SaaS legal documents are drafts and require review by qualified legal
counsel before serious commercial launch. A data processing agreement,
subprocessor list, cookie policy, service level agreement, and enterprise terms
remain future additions.

## Position QQueue as an Email Operations Platform, Not a Mailbox

QQueue is an **email operations platform** built around four capabilities that
share one delivery substrate:

1. **Campaign emails** — bulk marketing/communication (newsletters,
   announcements, promotions).
2. **Transactional emails** — application-triggered sends via API/SDK/SMTP
   (password resets, OTPs, confirmations, invoices, notifications).
3. **Manual email sending** — a user-facing composer for individual or
   small-batch sends (customer contact, manual invoices, lead follow-up).
4. **Optional inbox module** — an opt-in, feature-flagged IMAP capability for
   viewing replies to sent mail.

QQueue must **not** become a Gmail/Outlook/Zoho clone. The product is about
email *delivery and operations* — sending, campaigns, transactional messaging,
contact management, and analytics. Any inbox functionality exists to support
those goals (e.g. seeing replies to mail you sent), not to become a primary
mailbox/inbox-management product.

## Treat the Three Send Origins as One Pipeline

Campaign, transactional, and manual emails are not three separate products —
they are three entry points into a single send pipeline
(`EmailJob` → BullMQ → email-engine → SMTP → `EmailEvent`). New send surfaces
reuse this pipeline rather than introducing parallel delivery paths.

To distinguish them for analytics, usage metering, and abuse review, `EmailJob`
carries an `origin` discriminator (`CAMPAIGN | TRANSACTIONAL | MANUAL`).

## Manual Sending Extends the Existing Send Flow

The manual composer extends the existing one-off send flow
(`apps/web/src/pages/SendEmail.tsx`, backed by `transactionalEmailService.send`)
rather than becoming a separate product. That page already provides the Tiptap
editor, template loading, variable support, preview, SMTP selection, and
schedule-for-later. The remaining work is additive: multiple `To` recipients,
`CC`/`BCC`, contact and contact-list pickers, and attachments.

## Do the Phase-A Pipeline Refactor Before Larger UI Work

Before building out manual-composer UI and contacts/campaign enhancements, the
shared send pipeline is hardened first (the "Phase-A refactor"):

- add `origin` (and a `createdByUserId` audit field) to `EmailJob`;
- add `cc`, `bcc`, `replyTo`, and attachments to the email payload and
  `EmailJob`;
- introduce an email-safe HTML rendering layer.

This is a small, enabling change that unblocks later phases and fixes a latent
rendering bug, so it precedes the larger UI surfaces.

## Email Payloads Support origin, cc, bcc, and Email-Safe HTML

The email payload contract (`SendEmailPayload` in `packages/email-engine`) and
the `EmailJob` model gain `cc`, `bcc`, `replyTo`, and attachment support
(Nodemailer already supports these natively). `EmailJob` also records `origin`.

## Object Storage (S3/MinIO) for Attachments

Email attachments are stored in **S3-compatible object storage** — MinIO is
bundled in both Docker Compose stacks for self-host, and any S3 provider (AWS
S3, Cloudflare R2, Backblaze B2, …) can be used by pointing the `S3_*` env vars
at it. The storage client is a thin wrapper over the AWS S3 v3 SDK in a shared
**`@qqueue/storage`** package (AGPL core, used by both the API and the worker).

**Metadata in Postgres, blobs in object storage.** An `EmailAttachment` row
holds the filename, content type, size, and `storageKey`; the bytes live only in
object storage. This keeps the database small, lets the worker stream blobs to
SMTP independently of the API, and matches how the payload already carries
attachments (Nodemailer-ready `{ filename, content, contentType }`).

**Lifecycle.** An attachment is uploaded ahead of the send
(`POST /attachments`), optionally linked to a draft while composing
(`emailDraftId`) so resuming restores it, then linked to the `EmailJob` at send
time (`emailJobId`). Both foreign keys are `ON DELETE SET NULL` so removing a
draft or job never deletes the metadata row mid-read. The synchronous send path
loads blobs inline; queued sends load them in the worker. Campaign sends do not
expose attachments (no campaign attachment UI); the capability is manual /
transactional only for now.

Why not store blobs in Postgres (`bytea`)? It bloats the primary database and
its backups, and couples blob throughput to the transactional DB. Object storage
is the standard separation and is what hosted images (a later sub-task) will
reuse.

## Introduce MJML for Email-Safe Rendering

Tiptap remains the MVP composer (already shipping in
`apps/web/src/components/editor/RichTextEditor.tsx`). Its semantic, class-based
HTML output is **not** safe for real email clients (Outlook/Gmail strip
`<style>` and need inline CSS plus table-based layout).

**MJML becomes the canonical email-safe rendering layer** for both the manual
composer and campaigns. Editor output is serialized to email-safe HTML through a
single MJML-based path so there is one route to client-compatible markup.

For a future drag-and-drop builder, **GrapesJS with the `grapesjs-mjml` preset**
is the open-core choice (open-source, self-hostable, aligns with the AGPL core
and the MJML render layer). **Unlayer**, if ever adopted, is scoped to a
cloud-only premium editor under `apps/cloud` — never in the AGPL core.

## Add Foundation Domains Before Building the Email Studio (Phase A.5)

Before building the Email Studio (manual composer UI) and the larger Phase B–D
surfaces, the underlying domains are hardened first. Contacts, contact lists,
and templates already existed in a minimal form; Phase A.5 evolves them — and
the threading metadata — into the shape the future product needs, **backend
first, no UI**.

The rationale is the same as the Phase-A pipeline refactor: the data model is
the most expensive thing to change once UI, imports, campaign sends, and a
future inbox all depend on it. Getting `Contact.tags`, an explicit list
membership join, MJML-aware templates, and message-threading columns in place
now means Email Studio and Phases B–E build on a stable schema instead of
forcing a migration mid-feature. Each change is additive and backward
compatible.

## Contact-List Membership Is an Explicit Join (ContactListMember)

List membership moved from Prisma's implicit many-to-many join
(`_ContactToContactList`) to an explicit `ContactListMember` model
(`contactId`, `contactListId`, `addedAt`, unique on `(contactListId,
contactId)`).

An implicit M2M cannot carry membership metadata or be paginated directly. The
explicit join is required for the things Phase C/D depend on:

- recording **when** (and later, **how** — manual, CSV import, or segment rule)
  a contact joined a list;
- cursor-paginating large list sends in the campaign worker instead of loading
  every member into memory;
- attributing membership for suppression and segmentation.

The migration copies existing memberships into the new table before dropping the
implicit join, so no data is lost. The contact-list service still returns the
historical `contacts` array and `_count.contacts` shape (flattened from
`members`) so the existing API contract and dashboard are unaffected.

## Defer Template Versioning

`Template` gains an `mjml` column (the MJML source) alongside `html` (the
compiled, email-safe artifact actually sent). Templates remain **single,
mutable rows — versioning is intentionally deferred.**

Versioning adds real complexity (immutable version rows, "which version did this
campaign/send use", a `templateVersionId` pin on `EmailJob`, UI to browse and
restore versions) for value that nothing in the current or near-term roadmap
consumes. Sends already snapshot the resolved subject/html onto the `EmailJob`
row at fan-out time, so historical sends are not retroactively altered when a
template is edited — the main correctness concern versioning would address is
already covered.

**Preferred future design when versioning is needed:** add a `TemplateVersion`
table (`templateId`, `version`, snapshot of `subject`/`html`/`mjml`,
`createdAt`), point new sends at a pinned `templateVersionId` on `EmailJob`, and
keep `Template` as the mutable "current" pointer. This can be introduced
additively without reworking the foundation laid here.

## Threading Foundation Lives on EmailJob

The threading metadata (`messageId`, `inReplyTo`, `references`) lives on
`EmailJob`, not on `EmailEvent` and not (yet) in a dedicated message table.

`EmailJob` *is* the outbound message, so the RFC 5322 threading headers belong
on it: `messageId` already existed; `inReplyTo` and `references` were added so a
manual reply (Phase B/F) can set headers that thread correctly in the
recipient's client, and so a future inbox can anchor inbound replies to the
outbound mail they answer. The columns are wired through `SendEmailPayload` and
the send worker (Nodemailer supports them natively), so the pipeline is
threading-ready end to end; no API surface populates them yet.

`EmailEvent` was rejected because it is an append-only analytics log (one row
per open/click/bounce), not the identity of a message. A dedicated table was
rejected for now because it would duplicate `EmailJob`.

**Preferred future design for the inbox (Phase E):** a separate, feature-flagged
`InboundMessage`/`EmailMessage` table in the inbox module storing **received**
mail, joined to the outbound `EmailJob` by matching its `inReplyTo`/`references`
against `EmailJob.messageId`. Inbound storage is an inbox concern and stays out
of the core send pipeline — consistent with keeping the inbox optional and
modular (below).

## Email Studio Is a Dedicated Surface but Reuses the Send Pipeline (Phase B)

Phase B ships the manual composer as a dedicated **Email Studio** page rather
than only extending the single-recipient `SendEmail.tsx` flow. The composer is a
distinct surface (multi-recipient header, contact/list pickers, preview, drafts)
because the manual workflow is meaningfully richer than a one-off send — but it
is emphatically **not** a separate product or a parallel delivery path.

Every Email Studio send goes through `transactionalEmailService.send` with
`origin: "MANUAL"` and `createdByUserId` set, producing a normal `EmailJob` that
reuses the existing queue, SMTP providers, tracking, and analytics. A thin
`manual-email` API module sits in front of that call to (1) resolve manual
addresses, individual contacts, and whole contact lists into a deduplicated
recipient set, and (2) render the editor body through the MJML email-safe layer.
`SendEmail.tsx` remains for quick single-recipient sends.

A manual send is modeled as **one message** addressed to one or more `To`
recipients plus `CC`/`BCC` (not per-recipient fan-out), which is the correct
semantics for CC/BCC and matches user expectations for composing an email. The
deduplicated `To` set is stored joined on `EmailJob.toEmail`; Nodemailer accepts
the comma-separated list natively.

## Email Studio Renders Through MJML; Preview Equals Send

The manual composer is the first surface to adopt the Phase A MJML render layer
on the **default** path: the Tiptap editor body is wrapped in MJML and compiled
to email-safe HTML (`renderHtmlAsEmailSafe`) before it is persisted on the
`EmailJob`. The preview endpoint runs the **same** render plus tracking
injection, so the preview matches the delivered email. Campaigns and the legacy
transactional path still send their stored HTML as-is; widening MJML to those
paths is deferred until the manual path has proven the serializer in production.

## Implement EmailDraft for the Composer (Phase B)

Drafts are core to the Email Studio workflow (save, resume, delete, send), so
`EmailDraft` was implemented rather than deferred — the model is a clean,
additive, organization- and user-scoped table that carries a snapshot of
composer state (recipients, body, template/SMTP selection). It is intentionally
permissive (recipient arrays are plain strings, not validated emails) so an
in-progress message can always be saved; validation happens only at send time.

Drafts do **not** own sending: sending is the shared pipeline's job. On a
successful send the client deletes the working draft, keeping the send service
free of draft coupling. Draft versioning/history was not built — consistent with
the template-versioning deferral, drafts are single mutable rows.

## Keep the Inbox Optional, Modular, and Feature-Flagged

Inbox/IMAP functionality is a **separate module**, **disabled by default**, and
gated behind a feature flag — mirroring the discipline already used for the
`apps/cloud` boundary. It is not tightly coupled to the core sending pipeline.

Phase 1 of the inbox is intentionally narrow: connect a mailbox via IMAP, sync
incoming mail read-only, and view replies to sent emails (anchored to outbound
`messageId`/`In-Reply-To`). Reply-from-QQueue, shared inboxes, assignment,
internal notes, and ticketing are deferred and explicitly out of scope for the
initial inbox.

Phase 2 keeps the same boundary: replies are a thin layer over the existing
manual send pipeline with `In-Reply-To`/`References` populated from the selected
inbound message, while shared inbox behavior is limited to organization-scoped
assignment and append-only internal notes. Inbound routing, support workflow
state machines, and ticketing integrations remain future Phase E/F work rather
than becoming a parallel mailbox product.

## Suppression Is an Org-Wide Registry, Not Just `Contact.status` (Phase C)

Suppression lives in a dedicated `Suppression` table (`organizationId`, `email`,
`reason`, unique on `(organizationId, email)`), **separate from
`Contact.status`**. The send pipeline consults this registry before every send.

A per-contact status cannot cover every case: transactional API sends, manual
`To`/CC/BCC recipients, and one-off addresses are not necessarily `Contact`
rows, yet a bounce, complaint, or unsubscribe for any of them must stop future
mail. The registry is the canonical "never send to this address" check;
`Contact.status` remains the per-contact display state. Bounces and complaints
write to **both** (status → BOUNCED *and* a `Suppression` row), and unsubscribes
set status → UNSUBSCRIBED plus a row.

Enforcement is defense-in-depth: campaign fan-out excludes suppressed addresses,
the synchronous transactional/manual path records a `SUPPRESSED` `EmailJob`
without sending, and the send worker re-checks at processing time (an address
can be suppressed between enqueue and send). `EmailJobStatus.SUPPRESSED` keeps
these out of the failed-jobs view and out of delivery/bounce-rate math.

Phase C suppresses on **hard** bounce/complaint (matching the prior
`Contact.status = BOUNCED` behavior). Soft-vs-hard classification and
threshold-based auto-suppression are Phase D ("bounce-driven auto-suppression").

## List-Unsubscribe Applies to Campaign Sends (Phase C)

Campaign (`origin = CAMPAIGN`) mail carries RFC 2369 / RFC 8058 one-click
unsubscribe headers (`List-Unsubscribe` + `List-Unsubscribe-Post:
List-Unsubscribe=One-Click`); transactional and manual sends do not, since they
are not bulk marketing. The header URL carries an HMAC-signed `{org, email}`
token (reusing the tracking-secret scheme in `email-engine/tracking.ts`) so the
public `GET`/`POST /api/v1/unsubscribe` endpoints can act without auth or a DB
lookup. The headers are URL-only — a `mailto:` would require a monitored inbox
self-hosters may not run. Unsubscribing records a `Suppression` (reason
UNSUBSCRIBE) and sets the matching `Contact.status = UNSUBSCRIBED`.

## Basic Segmentation Materializes a List; Dynamic Segments Are Phase D (Phase C)

Phase C's "basic, tag-driven" segmentation is a **filter that snapshots into a
`ContactList`** — preview the count/sample for a tag filter (`ANY`/`ALL` match,
optional status), then materialize the current matches into a new list whose
members carry `source = SEGMENT`. No dynamic `Segment` model is introduced yet.

A static snapshot covers the near-term need (build a list from tags and send to
it) without the cost of a model that re-resolves membership at send time —
deferred to Phase D, where advanced segmentation (rule trees, dynamic
re-resolution) is in scope. The `ContactListMember.source` enum
(`MANUAL | CSV_IMPORT | SEGMENT`) was anticipated by the Phase A.5 explicit-join
decision and records how each member joined.

## Soft Bounces Use a Rolling Threshold, Not Immediate Suppression (Phase D1)

Through Phase C, **any** bounce — soft or hard — immediately and permanently
suppressed the address org-wide (SMTP rejection in the send worker, and the ESP
bounce webhook). That is too aggressive: a transient soft bounce (mailbox full,
greylisting, temporary defer) permanently kills a deliverable address.

Phase D1 classifies bounces with `classifyBounce` (in `@qqueue/email-engine`)
into `HARD | SOFT | BLOCK` from SMTP status codes and phrasing:

- **Hard** (`5.x.x`, invalid recipient) and **block** (spam/blacklist/policy) →
  suppress immediately, as before.
- **Soft** (`4.x.x`, mailbox full, greylist, deferred) → record a `BOUNCED`
  event tagged `metadata.bounceType = "SOFT"` but only suppress once the address
  accumulates `softBounceThreshold` soft bounces within `softBounceWindowDays`.

Counting is **event-sourced** off `EmailEvent` (no separate mutable counter), so
the window is naturally rolling and a later successful send does not reset it.
Thresholds live in an optional per-org `SuppressionPolicy` row, falling back to
the `SOFT_BOUNCE_THRESHOLD` / `SOFT_BOUNCE_WINDOW_DAYS` env defaults (3 / 30).

An **unclassifiable** bounce defaults to `HARD` — deliberately conservative, so
the change can only make suppression *less* aggressive for clearly-transient
failures and never silently keeps sending to a genuinely dead address. Complaints
always suppress immediately regardless of classification. The same classify-then-
decide logic runs in both bounce paths (worker `lib/suppression.ts` and API
`suppressionService.shouldSuppressBounce`), mirroring the existing duplication of
`addSuppression`/`isSuppressed` across the two apps.

## Per-Domain Throttling Is Worker-Side, Not a BullMQ Limiter (Phase D2)

BullMQ OSS only offers a single global queue rate limiter, not a per-key one, so
throttling sends *per recipient domain* is enforced in the send worker
(`lib/throttle.ts`) with a Redis fixed-window counter — the same INCR+EXPIRE
pattern the API already uses for HTTP rate limiting. When a domain is over its
per-minute cap, the job is `moveToDelayed`'d to the next window and re-checked
(reusing the paused-campaign hold mechanism), so no BullMQ attempt is consumed.

Caps live in an optional `DomainThrottle` row per `(organizationId, domain)`;
`domain = ""` is the org-wide default and a specific domain overrides it. The
column is **non-null** because Postgres treats NULLs as distinct in a unique
index, which would otherwise allow duplicate "default" rows. Absent rows fall
back to the `DEFAULT_DOMAIN_MAX_PER_MINUTE` env default (API and worker agree).

## Dynamic Segments Re-Resolve at Send Time (Phase D3)

Phase C's "create list from segment" snapshots a tag filter into a static
`ContactList`. Phase D adds a `Segment` model holding a **rule tree** (JSON) that
re-resolves to the current matching contacts every time a campaign sends. A
campaign targets a contact list **or** a segment, never both (enforced in the
API; the schema keeps both nullable). The rule compiler (`compileSegmentRules`)
lives in `@qqueue/shared` so both the API (preview/validate) and the worker
(fan-out resolution) share one implementation without a Prisma dependency — it
returns a plain `ContactWhereInput`-shaped object. Rule depth is capped to keep
query compilation bounded. At send time the worker ANDs `status = ACTIVE` onto
the compiled rules so a segment never sends to unsubscribed/bounced contacts.

## A/B Testing Splits a Test Fraction, Then Sends a Winner (Phase D4)

A/B campaigns vary only the **subject** (the body comes from the template). The
fan-out creates `EmailJob`s for the whole audience in one `CampaignRun`: the test
fraction (`abTestPercent`, evenly round-robined across variants) is `QUEUED` with
each variant's subject + `variantId`; the remainder is held as `PENDING`. A
delayed `phase: "decide"` job on the campaign-processing queue fires after
`abTestWindowMin`, counts the winning metric (open or click) per variant, marks
the winner, and releases the held jobs with the winner's subject. Ties break to
the lowest variant label for determinism. Holding the remainder as `PENDING`
(rather than re-resolving the audience later) keeps the whole test in one
idempotent run, and `settleRunIfComplete` already treats `PENDING` as active so a
run never settles while the remainder is held.

## Deliverability Tooling Reads Existing Events; No New Writes (Phase D5)

The deliverability dashboards are pure aggregation over `EmailEvent` +
`Suppression` — no new send-path writes or tables. The overview and alerts use
efficient `groupBy`/`count` queries (including a hard/soft split via the
`metadata.bounceType` written in D1). The per-domain breakdown has no indexable
domain column, so it aggregates events in memory bounded by a scan cap and
returns a `truncated` flag rather than silently capping. Reputation alerts are
derived against fixed thresholds (bounce > 5%, complaint > 0.1%) and the view is
restricted to OWNER/ADMIN, like queue operations.

## Inbox Workflows Stay Lightweight and Metadata-Driven (Phase E)

Phase E completes the optional inbox module with route labels, support workflow
state (`OPEN | PENDING | CLOSED`), priority, assignment, internal notes, and
external ticket references. These fields live on `InboundMessage` because the
module is meant to support email operations, not become a full helpdesk domain.

Ticketing integrations are intentionally stored as provider/key/URL references
for Jira, Linear, GitHub, Zendesk, or other systems. Creating and syncing remote
tickets remains future integration work; the AGPL inbox keeps enough metadata to
link a reply thread to an external ticket without introducing provider-specific
state machines or proprietary workflow assumptions.

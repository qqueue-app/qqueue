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
4. **Inbox module** — an IMAP capability for viewing replies to sent mail.

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

**Preferred future design for the inbox (Phase E):** a separate
`InboundMessage`/`EmailMessage` table in the inbox module storing **received**
mail, joined to the outbound `EmailJob` by matching its `inReplyTo`/`references`
against `EmailJob.messageId`. Inbound storage is an inbox concern and stays out
of the core send pipeline — consistent with keeping the inbox focused and
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
(The original single-recipient `SendEmail.tsx` page was later retired; the
`/send-email` route now redirects to Email Studio.)

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

## Keep the Inbox Modular and Focused

Inbox/IMAP functionality is a **separate module** with a narrow product scope.
It is not tightly coupled to the core sending pipeline.

Phase 1 of the inbox is intentionally narrow: connect a mailbox via IMAP, sync
incoming mail read-only, and view replies to sent emails (anchored to outbound
`messageId`/`In-Reply-To`). The inbox stays conversation-focused: a thread list
and reply surface on top of the existing inbound message store. Ticketing and
helpdesk-style collaboration are out of scope for the inbox.

Replies from QQueue stay a thin layer over the existing manual send pipeline
with `In-Reply-To`/`References` populated from the selected inbound message.
Conversation grouping remains a UI concern over the thread metadata; it does not
add a separate mailbox model.

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

The deliverability dashboards are pure aggregation — no new tables. Reputation
alerts are derived against fixed thresholds (bounce > 5%, complaint > 0.1%) and
the view is restricted to OWNER/ADMIN, like queue operations.

The funnel was originally aggregated over `EmailEvent` counts. It is now
counted from `EmailJob` rows; see the entry below for why.

## The Send Funnel Is Counted From Jobs, and Delivery Is Only Ever Reported

`EmailEvent` is the wrong unit for a rate, and using it produced numbers that
were not merely imprecise but backwards.

**Events are many-per-recipient.** One address can emit a synchronous SMTP
rejection, a later DSN, and an ESP webhook for a single send. **They arrive
after the attempt**, so a window filtered on `occurredAt` scores Tuesday's DSN
against Tuesday's sends rather than Monday's. And critically, **an SMTP
rejection writes `BOUNCED` and never writes `SENT`** — the send worker returns
before the success path. Dividing bounce events by sent events therefore
removed the failures from the very population they were divided by: 50
rejections out of 100 attempts rendered as a **100% bounce rate**.

The funnel is now a **job cohort**. `EmailJob` is exactly one row per recipient
with a terminal status, anchored on `sentAt` (falling back to `createdAt` for
jobs that never reached a send), so a late DSN scores against the window its
send belongs to. Suppressed and cancelled recipients were never attempted and
appear on neither side of a rate. Events are still the source for bounce classes
and engagement, but always counted as **distinct jobs**, never as rows.

`attempted` is **not** `SENT + FAILED` — see the entry below.

**Delivery is reported only by sources that observe it.** `recordOpen` used to
synthesize a one-time `DELIVERED` alongside the first open, reasoning that an
open implies delivery. It does — but with no ESP webhook configured, which is
the normal self-hosted case, that line was the *only* author of `DELIVERED` in
the entire system. "Delivery rate" was the open rate wearing another label, and
a healthy server reporting 24% read as though three quarters of its mail had
failed. The pixel no longer claims delivery; consumers who want the open signal
already get `OPENED`.

That leaves two honest surfaces, and one honest absence:

- **Accepted by server** (`SENT / attempted`) — genuinely knowable from SMTP,
  and what "did it go out" actually asks. It is not delivery: it means the next
  hop took the message.
- **Confirmed delivered** — distinct jobs with a `DELIVERED` event carrying
  `metadata.source` of `webhook` or `dsn`. The source tag is load-bearing; it is
  also what excludes the legacy open-derived rows, which carry no metadata.
- **`deliverySignal: "none"`** — when the org has never received a confirmation
  from either source, the API returns `null` for the rate and the dashboard says
  no confirmation source is configured. A dash is the correct answer to a
  question nobody measured; 0% is a lie and 100% is a worse one.

DSNs became a real delivery source in the same pass: `applyDsnBounce` parsed
`delivered` and `relayed` actions and discarded them, which is why nothing but
the pixel was left to fill the gap.

Three supporting choices:

- **Rates are `number | null`.** A rate with no denominator returns `null` and
  renders as "—". The old helper returned `0`, which is how a domain with 40
  bounces and no surviving sends displayed a reassuring `0.0%` bounce rate.
- **Alerts have a minimum volume** (50 attempts). Two bounces out of five is
  40%, far past the red line, and means nothing; alerting on it teaches people
  to ignore the banner.
- **The per-domain breakdown aggregates in Postgres** (`split_part` on the
  recipient address), replacing an in-memory scan capped at 5,000 events. The
  cap was consumed by opens and clicks, and because the slice was ordered by
  time a domain's later bounces survived while its earlier sends were cut. The
  `truncated` flag that reported this is gone because the truncation is gone.

`EmailEvent` also carried **no indexes at all** — foreign keys don't create them
in Postgres — so every tile, every campaign analytics panel, and the per-open
lookup on the tracking hot path were sequential scans of the largest table in
the schema.

## `attempted` Excludes Sends That Never Reached a Mail Server

`FAILED` conflates two unrelated events, and the reputation rates were dividing
by both.

A `FAILED` job is either a **receiving server rejecting the recipient** — the
send worker's `result.rejected` path, or a DSN correlated back to the job, both
of which write a `BOUNCED` event — or **our own send throwing before handoff**:
SMTP unreachable, credentials refused, TLS negotiation failed, a template that
would not render. The second kind writes a `FAILED` event and no `BOUNCED`, and
no recipient mail server ever saw the message. It carries no information about
how recipients treat this sender, but under `attempted = SENT + FAILED` it sat
in the denominator of every reputation rate.

That deflates bounce and complaint rates precisely when they matter most, and
it does so past a threshold. 100 recipients, an SMTP outage kills 50, 5 of the
50 that get out bounce: the true rate is `5/50` = **10%**, comfortably past the
5% line, but the reported rate was `5/100` = **5.0%** — and `5.0 > 5.0` is
false, so `deriveReputationAlerts` withheld the critical alert. The same
denominator simultaneously reported "accepted by server" at 50%, blaming
receiving servers for an outage on our own side.

So `attempted` is `SENT` plus **only the `FAILED` jobs that carry a `BOUNCED`
event**. The excluded population is not discarded: `failedBeforeHandoff` is its
own total, `rates.deliveryFailure` measures it against `SENT + FAILED`, and the
dashboard raises a distinct notice pointing at the sending account rather than
at reputation. The per-domain table keeps its own `failedBeforeHandoff` column
and still lists a domain whose every send died before handoff — its `HAVING`
deliberately tests the full terminal population, because dropping such a row
would hide an outage as effectively as the old 0.0% did.

Reputation numerators are counted over the same terminal cohort (`SENT` or
`FAILED`) as the denominator, so a bounce recorded against a job that ended up
`SUPPRESSED` can never sit in a numerator whose denominator excludes it.

Relatedly, the send worker now writes its `FAILED` event **once**, on the
attempt that gives up, with the attempt count in `metadata.attempts`. It used to
write one per attempt, so a job exhausting three retries left three `FAILED`
events for one failure — invisible to this aggregation, which counts statuses,
but wrong for anything counting failures through events. The `FAILED` webhook
now fires on that final attempt too: a send with retries left has not failed,
and telling a consumer otherwise is a claim the retry may disprove.

## Inbox Stays Conversation-Focused

The inbox module stops at inbound storage, conversation grouping, and reply.
Those are the pieces needed to see and answer replies to sent mail. The module
does not grow into a helpdesk domain with assignment, notes, workflow state, or
ticketing metadata.

If QQueue later needs Jira, Linear, GitHub, Zendesk, or other ticketing
integrations, those should be separate integration workflows rather than fields
or panels in the core inbox.

## Decouple the From Identity from the SMTP Credential (Sender Identities + Sending Domains, Phase F)

Until Phase F, a send's From address came straight from the chosen
`SMTPConnection` (`fromEmail`/`fromName`), tightly coupling *who the mail appears
to be from* to *which credential authenticates the transport*. Phase F splits
these into two models:

- **`SendingDomain`** — a domain the org sends from, carrying a DKIM mode:
  - `EXTERNAL`: the upstream relay (Mailcow, SES, a provider) signs DKIM. QQueue
    never signs; `DkimStatus` is `NA`.
  - `MANAGED`: QQueue generates an RSA-2048 keypair (selector `qqueue`), stores
    the private key encrypted, signs each message in-process via Nodemailer's
    `dkim` option, and surfaces the DNS records to publish. A verification worker
    resolves the published TXT record and moves the domain
    `PENDING → VERIFIED/FAILED`, with a daily recheck. **Only `MANAGED` +
    `VERIFIED` domains are signed.**
- **`SenderIdentity`** — a concrete From (`fromName` + `fromEmail`) under a
  sending domain, bound to the `SMTPConnection` that transports it. One identity
  per org can be the default; UI send surfaces pick an identity instead of
  free-typing a From address.

**RSA-2048, not 4096:** a 4096-bit public key can overflow the 255-character DNS
TXT string limit and interoperates less reliably, so 2048 is the pragmatic DKIM
default.

**One resolution path, two call sites.** `resolveSender`
(`apps/api/src/lib/sender.ts`) applies a fixed precedence — explicit
`senderIdentityId` → explicit `smtpConnectionId` → org default identity → org
default SMTP connection — and persists the resolved `senderIdentityId` on the
`EmailJob`. `dkimSignOptionsFor` derives the DKIM options from the identity's
sending domain. The worker (`apps/worker/src/lib/sender.ts`, used by
`email-sending.worker.ts`) re-applies the same `dkimSignOptionsFor` at send time,
so queued campaign, manual, and scheduled jobs sign identically to inline
transactional sends. The pure DNS/record helpers (`shouldSignManagedDkim`,
`buildSendingDomainDnsRecords`, `dkimDnsHost`, `dkimTxtValue`) live in
`@qqueue/shared`; only the RSA keygen is server-side (`apps/api/src/lib/dkim.ts`).

This keeps DKIM signing an AGPL-core capability (not cloud-only) and means no
send path re-derives From headers or DKIM options — the invariant called out in
`CLAUDE.md`.

## One Send Path: the Worker Is the Only Place SMTP Is Spoken (Phase 1 evolution)

The API's inline send branch was removed: every send — transactional, manual,
campaign, recurring, and system mail — creates a `QUEUED` EmailJob and is
delivered by the email-sending worker (an unscheduled send is simply a queued
job with no delay). The API's answer means "accepted", not "delivered"; callers
poll job status or consume webhooks. This is what makes throttling, suppression
re-checks, bounce classification, retries, and cancellation apply uniformly —
the inline path silently had none of them, and an SMTP rejection there was
recorded as SENT.

System mail (password resets, invitations) rides the same pipeline under
`origin: "SYSTEM"` with two explicit bypasses at the chokepoints: no
suppression checks (a user who unsubscribed from marketing must still get
account mail) and no tracking injection (account links stay untouched).

## Manual Sends Fan Out Per Recipient; CC/BCC Ride One Carrier Job (Phase 2 evolution)

A multi-recipient manual or recurring send becomes **one EmailJob per To
recipient** (linked by `EmailJob.sendGroupId`), never a comma-joined To. The
joined string silently defeated three per-recipient mechanisms at once: the
suppression check (exact-match lookup could never hit), the soft-bounce counter
(joined `toEmail` never matched), and the per-domain throttle (only the last
recipient's domain was counted).

CC/BCC attach to exactly one job — the **carrier**, the first To recipient not
already suppressed at send time — so copy-recipients receive one copy of the
message rather than one per To. If every To recipient is suppressed, nothing is
sent, copies included (an email has no To to carry them). A recipient
suppressed *between* carrier selection and the worker's send loses the copies
with the job; that race is accepted. Uploaded attachments are claimed by the
first job and metadata-copied onto siblings (same stored blob).

Two related choices made at the same time:

- **List-Unsubscribe follows bulkness, not origin.** `EmailJob.isBulk` is set
  where the job is created (campaign fan-out and recurring sends); the worker
  attaches RFC 8058 headers for bulk jobs only. Recurring sends previously
  shipped with no unsubscribe header because they shared `origin: "MANUAL"`
  with one-off composer mail.
- **Emails are normalized to lowercase at every write** (suppressions,
  contacts, job recipients), with a one-time migration lowercasing existing
  rows. Suppression duplicates keep the earliest row; contacts whose lowercase
  forms collide are left untouched rather than silently merged — each may carry
  real history, so operators reconcile those by hand.
- **`GET /unsubscribe` no longer mutates.** Mail clients and scanners prefetch
  GET links, silently unsubscribing recipients. GET renders a confirmation page
  whose button POSTs; the POST (also the RFC 8058 one-click target) performs
  the unsubscribe. Both are rate limited.

## Dashboard rebuilt as an email client (2026-08-07)

The people using QQueue are not developers. They are used to Gmail, Outlook, or
Zoho Mail. The dashboard read like an admin console for a delivery pipeline,
which is what it is underneath and precisely what a non-technical user should
never have to know. Rebuilding it around mail-client conventions cost nothing
architecturally — the one delivery pipeline is untouched — and everything it
changes is presentation.

### Compose and Campaigns stay separate

The obvious move is to merge them into one composer whose audience scales from
one person to a list. It was considered and **deliberately deferred**: it is a
product decision about how sending is modelled, not a UI cleanup, and doing it
badly would make the safe, everyday act of writing one email feel as heavyweight
as launching a campaign. Both surfaces were rebuilt on the new primitives so the
merge stays open, and the pipeline already treats them as two entry points into
one path. Don't do it without a fresh decision.

### The sidebar was rebuilt and then reverted

A tooltipped nav rail and a mobile bottom tab bar were built and rejected on
review — the existing sidebar (grouped sections, a collapsible Settings group,
a mobile drawer) was preferred. It keeps its original markup, gains an unread
badge on Inbox, and its "Home" entry now points at `/insights`.

One trap worth recording, because it is invisible until it bites: **do not wrap
a `NavLink` in a Radix `asChild` trigger** such as `<Hint>`. Radix's slot merges
`className` by string-joining, and `NavLink` accepts a *function* there — so the
function is stringified into the class attribute, the element silently loses
every style, and Tailwind's preflight (`svg { display: block }`) drops the icon
onto its own line above the label.

### The Inbox is the home screen

Signing in lands on `/inbox`. The old stats-first home moved to `/insights`
(`/dashboard` redirects). Opening on mail is the single change that most makes
the app feel like a mail client rather than a reporting tool — a dashboard is
something you consult, an inbox is something you live in.

### The Inbox is one screen at a time, not a split view

The inbox listed conversations in a 22rem rail with a permanently-open reader
beside it. That is the desktop-mail-client layout, and it was wrong here for two
reasons. The rail was too narrow to show a sender, a subject and a preview on
one line, so every row stacked into four; and the reader got whatever was left,
which on a laptop is *narrower* than the same message on a phone. It also
auto-selected the first conversation, which meant arriving at the inbox marked
mail read without anyone touching it.

It works like Gmail now: the list owns the full page width and a row is one line
(sender, subject, preview, date) above `sm`, stacked below it; tapping a row
replaces the list with the message. Nothing is open until it is opened.

The open conversation is held in state **as the thread**, not as a key into the
list. Opening marks it read, which refetches, and under the "unread" filter that
drops the thread being read — a key would resolve to nothing and shut the reader
mid-sentence. The live thread is preferred whenever it is still in the list, so
a reply arriving in the open conversation still appears.

### Tooltips are enforced by the type system, not by discipline

`IconButton` takes a **required** `label` and renders it as both the tooltip and
the `aria-label`. There is no way to write an icon-only control without one, and
no way for the visible hint and the accessible name to drift apart. A convention
in a style guide decays; a required prop does not.

### One grid, and it renders one layout at a time

Every list surface uses `components/ui/data-grid.tsx`, so sorting, search,
column visibility, selection, and pagination behave identically wherever they
appear. On phones it renders cards instead of a table — as a real branch driven
by `useMediaQuery`, not two trees with one hidden by CSS. Hiding one with
`md:hidden` leaves both in the DOM, which makes a screen reader announce every
row twice and doubles the node count on exactly the devices least able to afford
it.

Row actions follow from the same reasoning: one or two primary actions inline,
the rest behind an overflow menu. Campaigns previously rendered seven icon
buttons per row with most of them greyed out, which is a way of showing someone
what they cannot do.

### Push notifications are optional and best-effort

Web Push needs a VAPID key pair. Both halves unset means push is off: the API
reports no public key and the dashboard hides the control rather than asking for
a permission it could never honour. `pnpm setup` generates a pair with Node
builtins (a VAPID key is just a P-256 keypair), so the common path needs no
decision from the operator.

Notifications fire from **inbox sync**, only for a message that is genuinely new
(first sighting), not a DSN, and not already flagged `\Seen` in another client.
Alerting on bounce plumbing or on mail somebody already read is how people learn
to ignore alerts. A failure to push never fails a sync — notifications are a
convenience layered on the inbox, never a step in delivery.

A push service answering 404 or 410 means that client unsubscribed or was
uninstalled, so the row is deleted rather than retried; anything else is left
alone and tried again next time.

**On iPhone and iPad, notifications require installing to the Home Screen.**
Safari exposes push only to installed PWAs. The app says so in place of the
toggle instead of failing quietly.

The payload carries only a sender, a subject, and a link. The body of an email
must not travel through a third-party push service, and the ~4 KB encrypted
payload limit would not hold one anyway.

### A subscription is a device; which mail reaches it is a preference

`PushSubscription` originally carried an `organizationId`, which bound one
installed client to one organization. Three failures fell out of that, none of
them visible in the UI: switching orgs did not re-register, so the toggle read
"on" while the device was still bound to the org you left; the upsert keys on
endpoint, so turning notifications off and on again while in another org
silently *moved* the device there and ended the first org's alerts; and somebody
in two orgs could never be notified about both on one phone.

A device belongs to a person. Which organization's mail may reach them is
`OrganizationMember.notifyLevel` — one answer per (user, org) that holds on every
device they own and survives adding or losing one. Delivery inverts accordingly:
the worker resolves *who* should hear about a message, then sends to all of their
devices, building a payload per recipient rather than one for the whole org.

The levels are `ALL`, `ADDRESSED_TO_ME`, and `NONE`. `ALL` is the default because
this inbox is a **shared** one — every member can read every message, and read
state is org-wide — so mail to support@ is addressed to the mailbox and never to
Ama personally. `ADDRESSED_TO_ME` would therefore notify nobody on the very inbox
that needs it most; it is there for orgs whose members add their own addresses as
separate inbox accounts, where "was I actually written to" is a real question.

Because one device now serves several orgs, a notification has to say which one
it is about, and its deep link carries `?org=` so clicking opens the message in
the right organization rather than whichever was last selected. The org name is
added only for recipients who belong to more than one — for everyone else it is
noise.

The migration that made this change backfills rather than accepting the new
default. Defaulting every existing membership to `ALL` would have handed people
alerts for every org they belong to, which is an upgrade quietly making their
phones louder. It sets `NONE` everywhere, then restores `ALL` only for the
(user, org) pairs that had a device registered for that org — reproducing each
person's existing reach exactly. New memberships take the `ALL` default.

### Rotation has to repair itself, with no session to do it with

Browsers replace a push subscription on their own schedule, and almost always
with no tab open. Merely posting a message to open clients, as this once did,
therefore reached nobody — and the damage was silent: the next time the app
opened it saw a valid *local* subscription, reported notifications as on, and the
server still held the endpoint that had been rotated away. The device was mute
and the settings page said it was fine.

The repair has to run in the service worker, which has no credentials: the access
token lives in `localStorage`, and workers cannot read it. So
`POST /api/v1/push/subscriptions/rotate` is mounted above `requireAuth` and
authorizes on possession of the **old endpoint** — an unguessable URL the push
service issued to exactly one client. That is the same reasoning that authorizes
one-click unsubscribe links and public image reads. Ownership is carried over
from the row being replaced and never read from the request, so a replayed
rotation cannot move somebody else's device to a new account.

The worker also needs the VAPID public key and the API base URL to re-subscribe,
and can reach neither (`import.meta.env` is baked into the app bundle). The app
writes both to a Cache API record when notifications are switched on — the one
storage a window and a worker can share, and far less machinery than IndexedDB
for a single record.

### The notifications toggle reconciles all three states

Three things must agree before a notification can arrive: the browser's
permission, a `PushSubscription` on the service-worker registration, and a row on
our server. Any one can change without the others knowing. The toggle originally
consulted only the browser, which made it lie in exactly the case above — a
perfectly valid local registration whose endpoint the server has never heard of.

It now confirms the server holds *this* endpoint before reading "on". A failed
check leaves the last known answer rather than reporting a device switched off
that probably isn't: the request failing says something about the network, not
about the subscription.

### Errors surface once, where they matter

A first load that fails toasts (an empty page is otherwise indistinguishable
from "you have no contacts"); a background refetch that fails while good data is
on screen stays quiet. Queries that are decoration rather than content — the
unread badge, the members-only queue view — opt out with `meta: { silent: true }`.

Error identity is checked **by shape** (`typeof error.status === "number"`)
rather than `instanceof ApiError`, because an error can cross a module boundary
and lose its prototype while still carrying everything we read off it.

## Mail infrastructure is instance scope, not org scope (2026-08-09)

Mailcow domains are instance-global: one API key, one mail server, shared by
every organization on the install. They were gated on `requireOrgRole("OWNER")`,
and an unclaimed domain was visible to *every* org as a pool to claim from — the
mechanism that kept a single-org instance working unchanged when `OrgMailDomain`
was introduced.

That gate was never real. Creating an organization makes you its OWNER, so "org
OWNER" is a role a user on the instance can award themselves. Anyone invited to
a workspace could create their own, and from there list the unclaimed pool,
claim from it, create domains on the shared mail server, and delete them.

`POST /organizations` was later restricted to owners and admins (see "Only
owners and admins may create organizations" below), which narrows *who* can do
this but does not restore the gate: registration still creates an organization
with the registrant as OWNER, so anyone who signs up is an owner somewhere and
can create more from there. Anything install-wide stays on `isInstanceAdmin`.

So the axis moved. Domain management, domain assignment and domain grants now
live under `/api/v1/instance-admin`, behind `User.isInstanceAdmin`. An
organization reaches a domain only when an administrator assigned it; a domain
with no assignment reaches nobody. Self-serve claiming is gone — "whichever org
looks first wins" is not an access control.

### A domain may be assigned to several orgs (2026-08-11)

`OrgMailDomain.domain` was globally unique, so a domain reached exactly one
organization. That was a side effect of closing the hole above, not the fix
itself: what made the old model unsafe was *who* could claim a domain, not *how
many* orgs could hold one. Assignment is an instance-admin act either way, and
one company running several orgs on a single domain is ordinary.

Uniqueness therefore moved to the `(domain, organizationId)` pair, and the
assignment endpoint takes the complete desired set of organizations rather than
a single id or a delta. A checkbox list submits the whole set, so one call both
adds and removes, re-submitting an unchanged set is a no-op, and an empty array
hands the domain back to the instance.

Two consequences are deliberate:

- **Co-assignment is co-administration, not shared visibility.** Every org
  holding a domain can provision, edit and delete mailboxes on it — including
  each other's. The assignment dialog says so, because discovering it from a
  deleted mailbox is not acceptable.
- **The write diffs rather than clearing and rewriting.** Orgs dropped from the
  set lose their `MailDomainGrant` rows (a grant is delegation *within* an
  assignment and cannot outlive one); orgs that stay keep theirs. Clearing and
  rewriting would make a no-op re-save silently revoke every delegation under
  the domain.

`assertDomainAccess` asks whether the *caller's* org holds the domain rather
than who owns it, and still separates "assigned to nobody" from "assigned to
someone else" — different problems for whoever has to fix them.

### The org boundary was not given a superuser bypass

The cheap version of this is five lines: have `getMembership` /
`assertOrgAccess` (`lib/org-access.ts`) return a synthetic OWNER membership when
the caller is an instance admin, and every org-scoped route answers for every
org at once.

It was deliberately not done. That seam backs 121 `requireOrgMembership` call
sites across 44 modules, `inbox` and `contacts` among them, so the bypass would
have handed administrators every tenant's mail as a side effect of letting them
manage domains — with no place to draw the line afterwards. `instance-admin` is
a separate surface that never calls `requireOrgMembership`; the org boundary
stays absolute and these endpoints simply are not org-scoped.

The consequence is a deliberate scope limit: the instance view covers
organizations, members, domains, mailboxes, sending accounts and send counts.
Not message bodies, contacts, or campaign content. Running the mail server is
not the same as being entitled to read everyone's mail.

### Muting is cosmetic, and labelled that way

Administrators can hide an org or a domain from their own lists
(`InstanceAdminMute`). It is per-user and changes nothing about access; lists
say how many rows it hid so nothing goes silently missing. Access is
`OrgMailDomain` (assignment) and `MailDomainGrant` (delegation), and the two
concepts are kept verbally distinct everywhere they appear. A filter that
quietly revoked access, or an access control presenting as a filter, are both
traps: one hides a permission you still have, the other hides one you just took
away.

### The upgrade needed a backfill, for a reason that is easy to miss

Tightening the gate revokes access an org already had unless the assignments it
was relying on are written first. `20260809000000` already derived them once —
but mailbox provisioning (`connectMailbox`) writes an `SMTPConnection` and an
`InboxAccount` and *never* an `OrgMailDomain` row, so any mailbox provisioned
onto an unclaimed domain since then works today with no ownership record.
`20260810000000` re-derives from the same three sources (sending accounts,
synced inboxes, existing grants), idempotently. Domains with none of that
evidence stay unassigned: nothing is sending or receiving on them, so no access
is being taken away.

## A mailbox is the unit of access, not the organization (2026-08-13)

Until now, membership was the whole of read access: `listMessages` filtered on
`organizationId` and nothing else, so every member read every message the
organization received. Grants existed, but only for sending
(`SmtpConnectionGrant`), and nothing consulted them on a read path.

That is the wrong default for an email platform. An organization is not a
trust boundary the way a mailbox is — "Ama handles support@, Kofi handles
billing@" is the normal shape of a team, and the product had no way to express
it. The Mailboxes access grid made this worse by being titled "mailbox access"
while granting only the ability to send: an admin reading that screen would
reasonably conclude they had restricted who could read a mailbox, and they had
not.

So `InboxAccountGrant` is the read-side counterpart, and
`lib/mailbox-access.ts` resolves both halves once per request. OWNER/ADMIN are
unrestricted; a MEMBER sees the mailboxes they hold.

**One toggle, two tables.** The product asks one question per person per
mailbox — do they have it — and grants read and send together. "Can read
support@ but must not answer from it" is not a distinction teams draw, and
offering it would double the width of the grid to express it. The tables stay
separate anyway, because an `InboxAccount` and an `SMTPConnection` are
independent rows with no foreign key between them: a mailbox can be
receive-only (IMAP with no matching connection) or send-only. Both are
therefore grantable on their own, and the two halves are paired by address,
case-insensitively, in one place.

**Scoping had to reach past the message list.** A gate on the list alone leaks
through every neighbour: an unread badge counting mail you cannot open, an
attachment route keyed only on the org, a reply endpoint that loads the message
it is replying to, a mailbox picker offering mailboxes whose messages then
never appear. Push notifications are the sharpest case — they carry sender and
subject to a device, so an unscoped push is a way to read a mailbox you were
never given, on the one surface the inbox's own filter never touches.

**Sent, outbox and campaigns follow, each in the way it can.** Sent and outbox
scope by granted `smtpConnectionId`, unioned with `createdByUserId` so that
revoking a mailbox — or deleting one, which nulls the job's connection — never
makes someone's own outgoing mail look lost. That union leaks nothing: they
composed it. Campaigns have no mailbox at all, since fan-out always sends as
the org default, so the question "which campaigns may this member see" reduces
to "may they use the default connection" — the check that already guarded
starting one. Creation is gated with reading, because letting someone create a
campaign that then never appears in their list is worse than refusing.

**The backfill mirrors send grants, and neither extreme would do.** Locking
every member out on upgrade would make an admin re-tick every box before the
inbox worked again; carrying "everyone reads everything" forward would preserve
exactly the behaviour the change exists to end. Mirroring
`SmtpConnectionGrant` lands between them and holds the one-toggle invariant for
rows that predate it. It also lands correctly on both kinds of instance: one
upgraded through `20260806210000` gave every then-existing MEMBER a grant on
every then-existing connection, so those members keep reading what they read;
grants an admin has since chosen deliberately are mirrored just as
deliberately. A receive-only mailbox pairs with nothing and starts admin-only,
which is the safe direction.

## Only owners and admins may create organizations (2026-08-13)

`POST /organizations` was open to any authenticated user. Someone invited into
one workspace as a MEMBER could mint unlimited organizations of their own,
becoming OWNER of each.

The check cannot be a role check on the organization being created — it does
not exist yet, and the caller has no role in it. So it is asked of the account:
you may create an organization if you already own or administer one. A member
is someone other people invited, and inviting them is not a decision to let
them start workspaces.

This deliberately does **not** restore "org OWNER" as a trustworthy
instance-wide role, and nothing should be moved back behind it on the strength
of this change. Registration still creates an organization with the registrant
as OWNER, so anyone who can sign up is an owner somewhere and can create more
from there. The bootstrap path is untouched for the same reason it has to be:
`authService.register` creates that first organization directly, so the
zero-user wizard never meets this gate.

## Notification preferences are an exception list, defaulting to on (2026-08-14)

Once a mailbox became the unit of access, "notify me about this organization"
became the wrong grain. A single `OrganizationMember.notifyLevel` column
offered everything or silence, and somebody who reads a busy support@ and a
quiet alias wants one of them to buzz.

`InboxNotifyRule` answers *which mailbox*; `notifyLevel` survives unchanged and
answers *which mail within it*. The two are orthogonal, and keeping both is why
this migration needs no data change at all.

**The default is on, and the table stores only the exceptions.** An allow-list
would have been the obvious shape and is the wrong one: it makes "I was granted
a mailbox and heard nothing" the default outcome for every mailbox created
after somebody last opened this page, and it would have forced a backfill row
for every user × mailbox pair on upgrade or silenced the entire install. With
an exception list, a fresh grant notifies, an upgrade changes nobody's
experience, and the rows that exist are exactly the decisions somebody made.

Rows are written only where they disagree with the level above them, and
deleted the moment they agree again. Re-ticking a mailbox therefore means
"follow the default again" rather than "pin true forever" — otherwise today's
default is frozen into a row nobody remembers setting, and a later change to
the mailbox's domain would mysteriously not apply to it.

**A DOMAIN rule is a filter, never a grant.** It exists so "nothing from
acme.test" keeps meaning that after an eleventh address is added — a choice
that had to be re-made every time the org grew would not be worth storing. It
can only ever narrow: the worker resolves access first (a grant, or
OWNER/ADMIN) and applies rules to the survivors, and the API scopes the page
and every write through `resolveMailboxAccess`. Hold one of a domain's ten
addresses and "everything on acme.test" means that one. There is no path here
to hearing about a mailbox you were never given, which matters because a banner
carries the sender and subject and would otherwise be a way to read one.

The precedence rule itself (MAILBOX → DOMAIN → on) lives in `resolveInboxNotify`
in `@qqueue/shared`, imported by both the API that renders the page and the
worker that decides a live push. Two copies is how a settings screen ends up
confidently describing behaviour the worker does not have.

On the page, a domain's state is **derived from the ticks under it**, not read
off its rule: a domain switched on with one mailbox muted is honestly "some",
and drawing it as on or off is the small lie that makes people stop believing
the screen. That is also why the domain control is a tri-state tick rather than
a switch — a switch has two positions and this has three.

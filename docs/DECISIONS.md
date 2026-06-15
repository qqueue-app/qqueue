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

## Keep the Inbox Optional, Modular, and Feature-Flagged

Inbox/IMAP functionality is a **separate module**, **disabled by default**, and
gated behind a feature flag — mirroring the discipline already used for the
`apps/cloud` boundary. It is not tightly coupled to the core sending pipeline.

Phase 1 of the inbox is intentionally narrow: connect a mailbox via IMAP, sync
incoming mail read-only, and view replies to sent emails (anchored to outbound
`messageId`/`In-Reply-To`). Reply-from-QQueue, shared inboxes, assignment,
internal notes, and ticketing are deferred and explicitly out of scope for the
initial inbox.

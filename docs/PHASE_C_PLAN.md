# Phase C — Contacts & Contact Lists (Implementation Plan)

> **Status: IMPLEMENTED.** All Phase C scope below has shipped. Phase A, A.5,
> and B preceded it. Phase D (advanced segmentation, A/B subject testing,
> per-domain throttling, bounce-driven auto-suppression, deliverability tooling)
> builds on the suppression registry and segment filter introduced here. See
> `docs/STATUS.md` for the verification record.

Contacts, contact lists, and `ContactListMember` already exist (Phase A.5). This
phase adds the operator-facing capabilities on top of that foundation:

1. **CSV import/export** — bulk-load and extract contacts; record *how* a
   contact joined a list (`ContactListMember.source`).
2. **Contact activity timeline** — per-contact history derived from
   `EmailEvent`.
3. **Suppression list + List-Unsubscribe handling** — an org-wide
   "never send" registry, enforced in the send pipeline, plus RFC 8058
   one-click unsubscribe headers and public unsubscribe endpoints.
4. **Segmentation (basic, tag-driven)** — preview contacts by tag filter and
   materialize the result into a list. Dynamic/rule-tree segmentation is Phase D.

See `docs/DECISIONS.md` ("Contact-List Membership Is an Explicit Join
(ContactListMember)", which already anticipated `source`).

## Scope

In scope:

1. Prisma migration(s) — `ContactListMember.source`, a new `Suppression` model,
   `EmailJobStatus.SUPPRESSED`.
2. CSV import (upsert by `(organizationId, email)`) and CSV export endpoints +
   parser dependency.
3. Contact activity endpoint correlating `Contact.email` → `EmailJob.toEmail` →
   `EmailEvent`, cursor-paginated.
4. `Suppression` registry: model, service, management endpoints, and enforcement
   at send time (campaign fan-out + transactional/manual synchronous path) and
   on bounce/complaint.
5. List-Unsubscribe: signed unsubscribe token helper in `email-engine`, header
   injection for `CAMPAIGN` sends, public `GET`/`POST` unsubscribe endpoints.
6. Tag-driven segment preview + "create list from filter" (members tagged
   `source = SEGMENT`).
7. Web UI: import/export controls, contact activity drawer, suppressions page,
   tag-filter + materialize.
8. Shared Zod schemas and tests across all layers.

Out of scope (Phase D and later):

- Dynamic, rule-tree segments that re-resolve at send time (a `Segment` model);
  A/B subject testing; per-domain throttling; bounce **threshold**/soft-vs-hard
  auto-suppression logic; deliverability tooling. Phase C writes hard
  bounces/complaints into the suppression registry; Phase D adds the
  policy/threshold layer on top.
- Contact merge/dedup UI beyond import upsert.

## 1. Prisma migration(s)

File: `apps/api/prisma/schema/core.prisma`. New migration dir(s) under
`apps/api/prisma/schema/migrations/`, timestamped after the latest
(`20260615030000_phase_a_attachments`) — e.g.
`20260615040000_phase_c_contacts`. All changes are additive.

### 1a. Membership source

```prisma
enum MembershipSource {
  MANUAL
  CSV_IMPORT
  SEGMENT
}

model ContactListMember {
  // ...existing fields...
  source MembershipSource @default(MANUAL)
}
```

Existing rows default to `MANUAL` — backward compatible with the Phase A.5
membership migration.

### 1b. Suppression registry

A dedicated org-wide list, **separate from `Contact.status`**, so suppression
applies even to addresses that are not contacts (transactional recipients,
CC/BCC, one-off sends). `Contact.status` stays as the per-contact display state;
`Suppression` is the canonical "never send to this address" check the pipeline
consults.

```prisma
enum SuppressionReason {
  BOUNCE
  COMPLAINT
  UNSUBSCRIBE
  MANUAL
}

model Suppression {
  id             String            @id @default(cuid())
  organizationId String
  email          String
  reason         SuppressionReason
  source         String?           // free-form note (e.g. "webhook", "import", emailJobId)
  organization   Organization      @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  createdAt      DateTime          @default(now())

  @@unique([organizationId, email])
  @@index([organizationId])
}
```

(Add the back-relation `suppressions Suppression[]` to `Organization`.)

### 1c. Suppressed send status

```prisma
enum EmailJobStatus {
  PENDING
  QUEUED
  PROCESSING
  SENT
  FAILED
  CANCELLED
  SUPPRESSED   // recipient on the suppression list; not sent, not a failure
}
```

`SUPPRESSED` keeps suppressed sends out of the failed-jobs queue view and out of
delivery/bounce rate math, instead of overloading `FAILED`.

## 2. CSV import / export

New endpoints in the **contacts** module
(`apps/api/src/modules/contacts/`):

- `POST /api/v1/contacts/import` — accept a CSV (reuse the multipart upload
  middleware the `attachments` module already uses; also accept a raw
  `text/csv` body). Optional query/body `contactListId` to add imported
  contacts to a list with `source = CSV_IMPORT`.
  - Columns (header row, case-insensitive): `email` (required), `firstName`,
    `lastName`, `tags` (comma- or semicolon-separated within the cell).
  - **Upsert** by the existing `@@unique([organizationId, email])`: create new,
    update name/merge tags on existing. Tags merge (union), never clobber.
  - Rows whose email is on the org's suppression list are imported but **not**
    reactivated (their `Contact.status` is left/forced consistent with
    suppression); report them in the summary.
  - Invalid rows (bad email, missing email) are skipped and counted.
  - Response summary: `{ created, updated, skipped, suppressed, errors: [{ row, message }] }`.
- `GET /api/v1/contacts/export?organizationId=...&contactListId=...` — stream a
  CSV of contacts (optionally scoped to a list), columns
  `email,firstName,lastName,status,tags,createdAt`.

Parser dependency: add **`csv-parse` + `csv-stringify`** (the `csv` project,
MIT) or `papaparse` (MIT) to `apps/api`. Either is MIT — update
`scripts/license-audit` allowlist only if a new transitive token appears, and
re-run `pnpm license:audit`.

Service work lives in `contacts/service.ts` (parse, upsert loop in a
transaction-batched manner, membership linking with `source`). Keep the parse +
upsert logic unit-testable by separating "parse CSV string → rows" from "persist
rows".

## 3. Contact activity timeline

`EmailJob` has no `contactId` FK; the recipient is `EmailJob.toEmail`. Correlate
by `(organizationId, toEmail = contact.email)`, then load that job's
`EmailEvent`s.

- `GET /api/v1/contacts/:id/activity?cursor=...&limit=...` — cursor-paginated on
  `EmailEvent.occurredAt` (descending). Each item:
  `{ type, occurredAt, emailJobId, subject, campaignName?, origin, url? }`
  (`url` for `CLICKED`, pulled from `EmailEvent.metadata`).
- Query shape: find `EmailJob`s for the contact (by org + email), then
  `emailEvent.findMany({ where: { emailJobId: { in } }, orderBy: occurredAt desc })`
  with cursor pagination. Document the correlation-by-`toEmail` limitation
  (CC/BCC recipients aren't matched in v1).

Web: a contact detail drawer/panel on `Contacts.tsx` that calls the activity
endpoint and renders a timeline.

## 4. Suppression list + List-Unsubscribe

### 4a. Suppression service + management API

New module `apps/api/src/modules/suppressions/`
(routes/controller/service, matching the standard 3-file layout):

- `GET /api/v1/suppressions?organizationId=...` — list (paginated).
- `POST /api/v1/suppressions` — manually add `{ email, reason: MANUAL }`.
- `DELETE /api/v1/suppressions/:id` — remove (re-enable sending).
- A shared helper `suppressionService.isSuppressed(organizationId, email)` and
  `addSuppression(...)` (idempotent upsert on the unique constraint).

### 4b. Enforcement in the send pipeline

- **Campaign fan-out** (`apps/worker/src/workers/campaign-processing.worker.ts`):
  when expanding `contactList.members`, exclude addresses present in
  `Suppression` for the org (alongside the existing `status = ACTIVE` filter) so
  suppressed contacts never get an `EmailJob`.
- **Synchronous transactional/manual path**
  (`apps/api/src/modules/transactional-email/service.ts`): before send, check
  `isSuppressed`; if suppressed, persist the `EmailJob` as `SUPPRESSED` and
  return its `{ id, status: "SUPPRESSED" }` rather than enqueuing/sending.
- **Send worker guard** (`apps/worker/src/workers/email-sending.worker.ts`):
  defense-in-depth — re-check suppression at processing time (an address could
  be suppressed between enqueue and send); mark `SUPPRESSED` and skip.

### 4c. Bounce/complaint → suppression

In `apps/api/src/modules/tracking/service.ts` `recordWebhookEvent`, and in the
worker's hard-bounce branch (`email-sending.worker.ts`), in addition to setting
`Contact.status = "BOUNCED"`, call `suppressionService.addSuppression` with
`reason: BOUNCE | COMPLAINT`. (Phase D adds soft-vs-hard and threshold policy;
Phase C suppresses on hard bounce/complaint, matching today's behavior of
flipping `Contact.status`.)

### 4d. List-Unsubscribe (RFC 2369 / RFC 8058 one-click)

- **Token helper** in `packages/email-engine/src/unsubscribe.ts`, mirroring
  `tracking.ts`: `signUnsubscribeToken({ o: orgId, e: email }, secret)` /
  `verifyUnsubscribeToken`, and `buildUnsubscribeUrl(baseUrl, ...)`. Reuse the
  same HMAC `sign`/`safeEqual` approach and the tracking secret env var.
- **Header injection** for `CAMPAIGN` origin in the send worker (transactional
  one-offs don't get it by default):
  ```
  List-Unsubscribe: <https://DOMAIN/api/v1/unsubscribe?token=...>, <mailto:unsubscribe@DOMAIN?subject=unsubscribe>
  List-Unsubscribe-Post: List-Unsubscribe=One-Click
  ```
  Nodemailer forwards custom headers via the payload `headers` field — extend
  `SendEmailPayload` (`packages/email-engine/src/types`) with optional
  `headers?: Record<string, string>` and pass them through (the SMTP provider
  needs no logic change beyond forwarding).
- **Public endpoints** (unauthenticated, like the tracking endpoints), new
  `unsubscribe` module:
  - `GET /api/v1/unsubscribe?token=...` — verify token, render a minimal
    confirmation page, record unsubscribe.
  - `POST /api/v1/unsubscribe` — RFC 8058 one-click (`List-Unsubscribe=One-Click`
    body); verify token and record without a landing page; return 200.
  - On unsubscribe: `addSuppression(reason: UNSUBSCRIBE)` **and** set the
    matching `Contact.status = "UNSUBSCRIBED"`.

## 5. Segmentation (basic, tag-driven)

No new model in Phase C (the dynamic `Segment` model is Phase D). A tag filter
produces a contact set that can be previewed and materialized into a list.

- `POST /api/v1/contacts/segment/preview` —
  `{ organizationId, tags: string[], match: "ANY" | "ALL", status?: ContactStatus }`
  → `{ count, sample: Contact[] }`. Implemented with Prisma array filters
  (`tags: { hasSome }` for ANY, `tags: { hasEvery }` for ALL).
- `POST /api/v1/contact-lists/from-segment` —
  `{ organizationId, name, description?, tags, match, status? }` → creates a
  `ContactList` and `ContactListMember` rows for all matches with
  `source = SEGMENT`. Reuses `contactListService` create internals.

Web: a tag-filter control on `Contacts.tsx` showing the live match count, with a
"Create list from these contacts" action.

## 6. Shared schemas

File: `packages/shared/src/index.ts` — add and export:

- `csvImportSchema` (optional `contactListId`; the CSV body is handled by the
  upload middleware, not Zod).
- `segmentFilterSchema` (`tags`, `match`, optional `status`) and
  `createListFromSegmentSchema`.
- `suppressionSchema` (`organizationId`, `email`, `reason`) and the
  `SuppressionReason` / `MembershipSource` string-literal types.
- `contactActivityQuerySchema` (`cursor`, `limit`).
- Extend the `Contact`/`ContactListMember` TS interfaces with `source` and add a
  `Suppression` interface + `EmailJobStatus` `"SUPPRESSED"` literal.

## 7. Web UI

`apps/web/src/lib/api.ts` — add client methods: `importContacts`,
`exportContacts`, `getContactActivity`, `listSuppressions`, `addSuppression`,
`deleteSuppression`, `previewSegment`, `createListFromSegment`.

Pages/components (`apps/web/src/pages`):

- `Contacts.tsx` — Import (file picker) / Export buttons, tag-filter bar with
  live count + "create list from filter", and a per-contact activity drawer.
- New `Suppressions.tsx` — list, manual add, remove; linked from settings or the
  contacts area and added to the dashboard nav/routes.
- A minimal public unsubscribe confirmation page is server-rendered by the API
  endpoint (no SPA route needed), keeping it reachable without auth/JS.

## 8. Tests

- **shared**: new schemas accept/reject correctly (segment match modes,
  suppression reasons, csv import options).
- **email-engine**: `signUnsubscribeToken`/`verifyUnsubscribeToken` round-trip
  and reject tampered tokens; `headers` passthrough in the SMTP provider.
- **api**:
  - `contacts/service` — CSV parse + upsert (create/update/tag-merge, invalid
    rows, suppressed rows), export formatting, activity correlation + cursor
    pagination, segment preview + materialize (ANY/ALL).
  - `suppressions/service` — add/remove/list, `isSuppressed`, idempotent upsert.
  - `tracking/service` — bounce/complaint now also writes a `Suppression`.
  - `transactional-email/service` — suppressed recipient yields a `SUPPRESSED`
    job and is not enqueued.
  - `unsubscribe` — token verify, GET/POST record suppression + flip
    `Contact.status`, invalid token rejected.
- **worker**:
  - `campaign-processing.worker` — suppressed addresses excluded from fan-out.
  - `email-sending.worker` — suppression re-check marks `SUPPRESSED`;
    `List-Unsubscribe` header present for `CAMPAIGN`, absent for
    `TRANSACTIONAL`.
- **web**: import/export controls, activity drawer, suppressions page, tag
  filter + materialize.
- Full gate: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`,
  `pnpm test:smoke:docker`, `pnpm license:audit`, `pnpm cloud:boundary`.
- Verify the migration against a throwaway Postgres 16 (`prisma migrate deploy`
  + `prisma migrate diff` reports no drift), per the Phase A/A.5/B precedent.

## 9. Backward compatibility

- **DB**: all changes additive — `ContactListMember.source` defaults to
  `MANUAL`, `Suppression` is new, `SUPPRESSED` is a new enum value. No existing
  column changes; no destructive migration.
- **API contract**: contact/list endpoints keep their current request/response
  shapes (the `contacts` array + `_count` flattening is untouched). All new
  endpoints are additive. `EmailJob` gains a status value that existing clients
  treat as "not SENT".
- **Send behavior**: List-Unsubscribe is added only to `CAMPAIGN` sends;
  transactional/manual output is byte-for-byte unchanged except for the new
  suppression guard (which only changes behavior for addresses an operator or a
  bounce explicitly suppressed).
- **Suppression on bounce** mirrors the existing `Contact.status = BOUNCED`
  behavior, now also recorded in the registry — no regression for current users.

## 10. Suggested commit / PR sequencing

Each step is independently shippable and backward compatible:

1. **Schema + shared types**: `ContactListMember.source`, `Suppression`,
   `SUPPRESSED`, migration + backfill-free additive SQL, shared schemas/types,
   tests.
2. **Suppression registry + enforcement**: `suppressions` module, pipeline
   guards (fan-out, sync path, worker re-check), bounce/complaint → suppression,
   tests.
3. **List-Unsubscribe**: `email-engine` token helper + `headers` passthrough,
   worker header injection, public `unsubscribe` endpoints, tests.
4. **CSV import/export**: parser dependency, import/export endpoints +
   membership `source`, tests.
5. **Contact activity timeline**: activity endpoint + cursor pagination, tests.
6. **Tag-driven segmentation**: preview + materialize endpoints, tests.
7. **Web UI**: import/export, activity drawer, suppressions page, tag filter —
   wired to the above.

## 11. Decisions to record (in `docs/DECISIONS.md`)

- **Suppression Is an Org-Wide Registry, Not Just `Contact.status`** — why a
  dedicated `Suppression` table (covers non-contact recipients; canonical send
  guard) and how it relates to `Contact.status`.
- **List-Unsubscribe Applies to Campaign Sends** — RFC 8058 one-click, signed
  token reusing the tracking-secret HMAC, campaign-origin only for now.
- **Basic Segmentation Materializes a List; Dynamic Segments Are Phase D** — why
  Phase C snapshots tag filters into `ContactList` (`source = SEGMENT`) instead
  of adding a dynamic `Segment` model yet.

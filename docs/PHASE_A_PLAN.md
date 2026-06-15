# Phase A — Send-Pipeline Refactor (Implementation Plan)

> **Status: IMPLEMENTED.** All Phase A scope below has shipped, including the
> object-storage sub-task that was originally deferred: attachments now persist
> to S3-compatible object storage (MinIO for self-host) via the shared
> `@qqueue/storage` package, with an `EmailAttachment` metadata table and
> end-to-end wiring through the send pipeline and Email Studio. See
> `docs/DECISIONS.md` ("Object Storage (S3/MinIO) for Attachments").

Phase A hardens the single shared send pipeline
(`EmailJob` → BullMQ `email-sending` → `email-engine` → SMTP → `EmailEvent`) so
that campaign, transactional, and manual sends are first-class siblings. It is a
small, additive, backward-compatible change that unblocks the manual composer
(Phase B) and fixes a latent email-client rendering issue.

See `docs/DECISIONS.md` ("Treat the Three Send Origins as One Pipeline",
"Email Payloads Support origin, cc, bcc, and Email-Safe HTML", "Introduce MJML
for Email-Safe Rendering").

## Scope

In scope:

1. Prisma migration — `origin`, `createdByUserId`, `cc`, `bcc`, `replyTo` on
   `EmailJob`.
2. `SendEmailPayload` — `cc`, `bcc`, `attachments` (`replyTo` already exists).
3. `EmailJob` (model + shared type) — the new fields above.
4. Queue worker — pass `cc`/`bcc`/`replyTo` to the provider.
5. API validation — extend `sendEmailSchema`; set `origin` on creation.
6. Email-safe HTML rendering layer (MJML) — introduced as an opt-in utility.
7. Tests and backward-compatibility verification.

Out of scope (later phases):

- Multiple `To` recipients, contact/list pickers, attachment **upload UI**,
  object storage wiring (Phase B / Phase A storage sub-task).
- Migrating campaigns/composer to render through MJML by default (Phase B once
  the serializer is proven).
- Suppression list, segmentation, inbox.

## 1. Prisma migration

File: `apps/api/prisma/schema/core.prisma`, new migration under
`apps/api/prisma/migrations/` (e.g. `20260615000000_phase_a_send_pipeline`).

Add enum and `EmailJob` fields:

```prisma
enum EmailOrigin {
  CAMPAIGN
  TRANSACTIONAL
  MANUAL
}

model EmailJob {
  // ...existing fields...
  origin          EmailOrigin @default(TRANSACTIONAL)
  createdByUserId String?
  cc              String[]    @default([])
  bcc             String[]    @default([])
  replyTo         String?
  // ...existing relations...
  @@index([organizationId, origin])
}
```

Migration SQL notes:

- New columns are nullable or have defaults, so existing rows are valid without
  downtime.
- **Backfill** so historical campaign jobs report the correct origin:
  ```sql
  UPDATE "EmailJob" SET "origin" = 'CAMPAIGN' WHERE "campaignId" IS NOT NULL;
  ```
- `EmailAttachment` model + object storage are **deferred to a Phase A storage
  sub-task** to keep this migration small; `attachments` on the payload
  (section 2) initially carries in-memory/base64 attachments for programmatic
  sends only. Document this limitation.

Run via the existing one-shot migrate step (`prisma migrate deploy`); no change
to the deploy flow.

## 2. `SendEmailPayload` changes

File: `packages/email-engine/src/types/index.ts`.

```ts
export interface EmailAttachment {
  filename: string;
  content: string | Buffer; // base64 or Buffer (Nodemailer-compatible)
  contentType?: string;
}

export interface SendEmailPayload {
  from: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;          // already present
  attachments?: EmailAttachment[];
}
```

`SMTPProvider.send` (`providers/smtp-provider.ts`) needs **no logic change** —
`transporter.sendMail(payload)` already forwards `cc`/`bcc`/`replyTo`/
`attachments` to Nodemailer. Confirm the placeholder providers
(`future-providers.ts`) still type-check against the widened interface.

## 3. `EmailJob` changes (shared type)

File: `packages/shared/src/index.ts` — extend the `EmailJob` interface and add
the origin type:

```ts
export type EmailOrigin = "CAMPAIGN" | "TRANSACTIONAL" | "MANUAL";

export interface EmailJob {
  // ...existing...
  origin: EmailOrigin;
  cc?: string[];
  bcc?: string[];
  replyTo?: string | null;
  createdByUserId?: string | null;
}
```

Keep additions optional in the public-facing type where possible to avoid
breaking consumers that build `EmailJob`-shaped objects.

## 4. Queue worker changes

File: `apps/worker/src/workers/email-sending.worker.ts`.

- Pass the new fields to the provider in the `provider.send({...})` call:
  ```ts
  const result = await provider.send({
    from: formatFrom(emailJob.smtpConnection),
    to: emailJob.toEmail,
    cc: emailJob.cc.length ? emailJob.cc : undefined,
    bcc: emailJob.bcc.length ? emailJob.bcc : undefined,
    replyTo: emailJob.replyTo ?? undefined,
    subject: emailJob.subject,
    html, // tracking already injected above
    text: emailJob.text ?? undefined
  });
  ```
- **Ordering:** if/when HTML is rendered through MJML (section 6), compile MJML
  **before** `injectTracking` so the tracking pixel/link rewriting operates on
  the final email-safe HTML. For Phase A the worker keeps reading
  `emailJob.html` as-is (already-compiled HTML is stored), so no ordering change
  is required yet — note this for Phase B.
- No change to retry/backoff, pause handling, bounce detection, or
  `settleRunIfComplete`.

The synchronous send path in
`apps/api/src/modules/transactional-email/service.ts` must mirror the same
`cc`/`bcc`/`replyTo` passthrough in its inline `provider.send(...)` call.

## 5. API validation changes

File: `packages/shared/src/index.ts` — extend `sendEmailSchema`:

```ts
export const sendEmailSchema = z.object({
  organizationId: z.string().min(1),
  to: emailAddressSchema,
  cc: z.array(emailAddressSchema).optional(),
  bcc: z.array(emailAddressSchema).optional(),
  replyTo: emailAddressSchema.optional(),
  smtpConnectionId: z.string().min(1).optional(),
  templateId: z.string().min(1).optional(),
  subject: z.string().min(1).optional(),
  html: z.string().optional(),
  text: z.string().optional(),
  variables: z.record(z.unknown()).optional(),
  scheduledAt: z.string().datetime().optional()
});
```

`publicSendEmailSchema` (the `.omit({ organizationId: true })` derivative)
inherits the new fields automatically.

Service changes (`transactional-email/service.ts`):

- Persist `cc`, `bcc`, `replyTo` on both `emailJob.create` calls (scheduled and
  inline paths).
- Set `origin`:
  - transactional/public send endpoint → `TRANSACTIONAL`;
  - manual composer send (Phase B will pass a flag / use a dedicated route) →
    `MANUAL` and set `createdByUserId` from the authenticated dashboard user.
- Campaign fan-out (`campaign-processing.worker` /
  `apps/worker/src/lib/campaign-run.ts`) sets `origin: "CAMPAIGN"` when creating
  jobs.

## 6. Email-safe HTML rendering (MJML)

Introduce MJML as a **new, opt-in utility** in `packages/email-engine` (e.g.
`src/render/mjml.ts`) that compiles editor/template content into email-safe HTML
(inline CSS, table layout). Add `mjml` as a dependency of `email-engine`.

Phase A deliverable is the **utility + tests only**; it is *not yet* wired into
the default send path. This keeps existing templates/HTML rendering unchanged
(backward compatible) while making the serializer available for Phase B to adopt
behind the composer.

Document the intended pipeline for Phase B: `Tiptap HTML → MJML document →
mjml2html → email-safe HTML → injectTracking → store on EmailJob.html`.

## 7. Tests

- **email-engine**: unit tests for the widened `SendEmailPayload` passthrough
  (SMTP provider forwards `cc`/`bcc`/`replyTo`/`attachments`); MJML utility
  produces inline-CSS, table-based output for representative inputs.
- **shared**: `sendEmailSchema` accepts/rejects `cc`/`bcc`/`replyTo` correctly
  (valid emails, arrays, invalid entries).
- **api** (`transactional-email/service.test.ts`): `cc`/`bcc`/`replyTo`
  persisted on `EmailJob`; `origin` set to `TRANSACTIONAL` by default and
  `MANUAL` on the manual path; existing tests still pass with new defaults.
- **worker** (`email-sending.worker.test.ts`): provider receives `cc`/`bcc`/
  `replyTo`; jobs without them still send unchanged.
- **campaign**: campaign-created jobs carry `origin: "CAMPAIGN"`.
- Run the full suite plus the Docker smoke test
  (`pnpm test`, `pnpm test:smoke:docker`) and `pnpm lint`, `pnpm typecheck`,
  `pnpm build`, `pnpm cloud:boundary`.

## 8. Backward compatibility

- **DB**: all new columns are nullable or defaulted; no destructive change. The
  backfill `UPDATE` is idempotent and safe to re-run.
- **Existing rows**: default to `origin = TRANSACTIONAL`; the backfill corrects
  campaign rows. Pre-existing jobs have empty `cc`/`bcc` and null `replyTo`,
  which the worker treats as "omit" — identical behavior to today.
- **API contract**: `sendEmailSchema` only **adds** optional fields. Existing
  API/SDK callers that omit them are unaffected; the `{ id, status }` response
  shape is unchanged.
- **Email rendering**: MJML is introduced but **not** applied to the default
  send path in Phase A, so current template/HTML output is byte-for-byte
  unchanged until Phase B opts in.
- **SDK**: no required changes; new fields are optional and can be added to the
  SDK send method in a later minor release.
- **Worker/queue**: queue job shape (`{ emailJobId }`) is unchanged; the worker
  reads new columns off the row.

## Suggested commit/PR sequencing

1. Schema + migration + shared types (`origin`, `cc`, `bcc`, `replyTo`,
   `createdByUserId`) with backfill and tests.
2. `email-engine` payload widening + provider passthrough + worker/service
   passthrough + tests.
3. MJML rendering utility + tests (no wiring into default path).

Each step is independently shippable and backward compatible.

# Changelog

Notable changes to QQueue. Phases refer to the evolution plan; each entry lands
with green `typecheck`/`lint`/`test` and, where the send pipeline or migrations
are touched, a passing Docker smoke test.

## Phase 2 — Per-recipient jobs, real suppression coverage, List-Unsubscribe by bulkness (2026-08-05)

- **Multi-recipient manual and recurring sends fan out one EmailJob per To
  recipient** (grouped by the new `EmailJob.sendGroupId`) instead of a
  comma-joined To. Suppression checks, per-domain throttling, and soft-bounce
  accounting now apply to each recipient individually. CC/BCC ride exactly one
  carrier job (the first non-suppressed To recipient); attachments are claimed
  by the first job and metadata-copied onto siblings. The composer's delivery
  panel aggregates the whole group and now reports true per-recipient outcomes
  (including `suppressed`).
- **CC/BCC are suppression-checked too**: the send worker strips suppressed
  copy-addresses before delivery (recording `strippedCc`/`strippedBcc` on the
  outcome event) rather than mailing them or failing the job. SYSTEM mail
  remains exempt.
- **List-Unsubscribe now follows bulkness, not origin**: new
  `EmailJob.isBulk` flag set by campaign fan-out and recurring sends; the
  worker attaches RFC 8058 headers for bulk jobs only. Recurring sends —
  previously header-free because they shared `origin: MANUAL` — now carry
  them; transactional, one-off manual, and SYSTEM mail stay header-free.
- **Email casing is canonical**: suppressions, contacts, and job recipients are
  lowercased on write and lookups normalized; migration
  `20260805120000_per_recipient_sends_and_bulk_flag` lowercases existing rows
  (suppression duplicates keep the earliest row; colliding contacts are left
  for operators to reconcile rather than silently merged).
- **`GET /unsubscribe` no longer unsubscribes** — link prefetchers were
  silently unsubscribing recipients. GET renders a confirmation page whose
  button POSTs; POST (also the RFC 8058 one-click target) performs the
  unsubscribe and renders the confirmation. Both routes are now rate limited
  (60/15min per IP).
- Decisions recorded in `docs/DECISIONS.md` ("Manual Sends Fan Out Per
  Recipient").

## Phase 1 — Unified send path (2026-08-05)

- **Every outbound email now flows through the email-sending worker.** The
  inline send branch in `transactionalEmailService.send` is gone: a send
  without `scheduledAt` becomes a `QUEUED` EmailJob enqueued with no delay, so
  per-domain throttling, the send-time suppression re-check, bounce
  classification, BullMQ retries/backoff, and outbox cancellation apply to
  every send. `provider.send()` is called in exactly one place:
  `apps/worker/src/workers/email-sending.worker.ts`.
- **API semantics: "accepted", not "delivered".** `POST
  /transactional-email/send` (and the Email Studio send) still returns 202 with
  `{ id, status }`, but the status is now `QUEUED`; poll the job status or
  consume webhooks for the outcome. Email Studio confirms the queue handoff
  immediately and polls per-recipient status to report the real result.
- **System mail rides the pipeline.** Password resets and organization invites
  now create EmailJobs with the new `EmailOrigin` value `SYSTEM` (migration
  `20260805000000_add_system_email_origin`) instead of calling the SMTP
  provider directly. SYSTEM mail deliberately skips suppression checks (an
  unsubscribed user must still get password resets) and tracking injection
  (account links stay untouched); both bypasses are explicit at the two
  chokepoints.
- Removed the now-dead `smtpConnectionService.getProviderForConnection`; the
  API process no longer constructs send providers (connection verification
  remains).
- `docs/ARCHITECTURE.md` refreshed: single-path queue flow, current module and
  worker lists, and removal of the stale DKIM/sender-identity sections
  (that machinery was removed from core in `bcb3475`).

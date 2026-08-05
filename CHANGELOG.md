# Changelog

Notable changes to QQueue. Phases refer to the evolution plan; each entry lands
with green `typecheck`/`lint`/`test` and, where the send pipeline or migrations
are touched, a passing Docker smoke test.

## Phase 2b — Async bounce processing: DSN parsing in inbox sync (2026-08-05)

- **Inbox sync now recognizes delivery status notifications** (bounces that
  arrive after the SMTP conversation) instead of storing them as ordinary
  inbound mail with zero bounce logic. `apps/worker/src/lib/dsn.ts` detects a
  DSN by `multipart/report; report-type=delivery-status`, a
  `mailer-daemon@`/`postmaster@` sender, or `Auto-Submitted: auto-replied`
  with parseable RFC 3464 fields; parses `Final-Recipient`, `Action`,
  `Status`, and `Diagnostic-Code` (unfolding continuations); and falls back to
  scanning the body for an SMTP status code plus recipient when the
  machine-readable part is missing or mangled. Unparseable bounce-shaped mail
  degrades to a normal stored message — a weird DSN never crashes the sync.
- **Parsed bounces feed the existing pipeline**: the originating `EmailJob` is
  correlated by In-Reply-To/References, then the returned original's
  Message-ID, then the most recent SENT job to the failed address within 7
  days (the method used is recorded on the event). A `BOUNCED` event is
  written, the job flips SENT → FAILED via a status-guarded compare-and-set
  (SUPPRESSED/CANCELLED are never overwritten), outbound `email.bounced`
  webhooks fire, and the existing auto-suppression policy runs — hard/block
  DSNs suppress immediately, soft ones count toward the org threshold. When no
  job matches, the recipient is still suppressed org-wide (the org comes from
  the inbox account). Only `Action: failed` reports count; delayed/relayed/
  delivered notifications and vacation auto-replies are ignored.
- **Idempotent by construction**: bounce side effects run only on the DSN's
  first insert under the existing `(inboxAccountId, messageId)` unique key, so
  re-syncs and duplicate DSNs never double-count. Stored DSNs are flagged with
  the new `InboundMessage.isDsn` column (migration
  `20260805130000_add_inbound_message_is_dsn`) so the inbox can filter bounce
  noise later.
- **Suppression decision logic consolidated**: the worker/API duplicated
  `shouldSuppressBounce` now delegates to a single copy in `@qqueue/shared`
  (`resolveSuppressionPolicy` + `shouldSuppressBounce`); each app supplies
  only its policy row and event count.
- **Operational note (until Phase 4 provisioning exists):** DSNs are only seen
  for mailboxes with a sync-enabled `InboxAccount`. Add an InboxAccount for
  every identity used as a From address, or its async bounces stay invisible.

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

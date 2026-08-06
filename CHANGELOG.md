# Changelog

Notable changes to QQueue. Phases refer to the evolution plan; each entry lands
with green `typecheck`/`lint`/`test` and, where the send pipeline or migrations
are touched, a passing Docker smoke test.

## Post-plan cleanup — worker logging + error boundary (2026-08-06)

- **Worker logs are structured now too**: the worker gets the same pino setup
  as the API — job completions/failures log queue + jobId as fields, inbox
  sync and recovery log with `inboundMessageId`/counts, and MJML fallbacks log
  the recurring send id. The last `console.*` call sites are gone from both
  runtime apps.
- **A React error boundary wraps the dashboard** (`components/ErrorBoundary`):
  a render-time throw now shows a "Something went wrong" card with a reload
  button instead of silently blanking the whole app. Mounted outside the
  session/router providers so a throw inside the chrome is still caught.
- **The deferred backlog is now committed**: `docs/ROADMAP.md` gained an
  "Evolution plan (2026-08)" section recording phase completion and every
  deliberately-deferred item with its reason (SMTP pooling, A/B UI,
  EmailEvent indexes, ESP relay stubs, cloud auth, MFA/SSO, idempotency TTL),
  plus the smaller known gaps — previously this list lived only in the
  planning conversation.

## Phase 5 — Operational hygiene (2026-08-06)

- **Encryption keys can now be rotated.** Secret crypto moved into a new
  `packages/crypto` (deleting the byte-identical api/worker copies whose
  format was an undeclared wire contract). Ciphertexts now carry a versioned
  envelope (`v1.iv.tag.ct`; the legacy unversioned format still decrypts), and
  both apps read `ENCRYPTION_KEYS` as a keyring — first key encrypts, every
  key decrypts (GCM's auth tag identifies the right one, so no key id is
  needed and trial decryption is exact). Rotate with
  `ENCRYPTION_KEYS=new,old` → `pnpm rotate-secrets` (re-encrypts every
  SMTPConnection/InboxAccount/WebhookEndpoint secret, idempotent, reports
  undecryptable rows) → drop the old key. `ENCRYPTION_KEY` keeps working as
  the single-key form.
- **Graceful shutdown + crash visibility.** SIGTERM/SIGINT now drain the API's
  connections and let the worker finish in-flight jobs (`worker.close()`)
  before exiting; both apps log unhandled rejections and treat uncaught
  exceptions as fatal. Startup recovery (extracted to
  `apps/worker/src/lib/recovery.ts`, now unit-tested) additionally re-queues
  `EmailJob` rows stranded in `PROCESSING` for 15+ minutes by a hard crash —
  previously invisible forever. The processor's status re-read guards against
  double-send, with the residual crash-after-SMTP-accept window documented.
- **Refresh tokens are revocable.** New `RefreshToken` table (migration
  `20260806120000_add_refresh_tokens`): refresh now requires the signed JWT
  *and* a live server-side row, rotates the row on every use (with a 60s
  grace window so two tabs racing a refresh don't log the loser out), a new
  `POST /auth/logout` revokes server-side (the web app calls it best-effort
  on sign-out), and a password reset deletes every session for the account.
  Expired/stale rows are pruned opportunistically at login.
- **Structured logging (API).** pino replaces the one-line console logger:
  each request gets a `reqId` and one JSON line with method/url/status/
  duration/user/org; tracking and unsubscribe URLs are redacted (signed
  tokens encode recipient identity and used to land in logs verbatim); the
  transactional and manual send controllers log the enqueued `emailJobId` so
  a request can be correlated with its worker job; unexpected 500s log with
  the request id. Silent under test; worker logging unchanged for now.
- **CI parity.** New `ci.yml` workflow runs lint, typecheck, build, the unit
  suites, and the Docker smoke test on every PR and push to main — previously
  local-only.
- **Segment-targeted campaigns can start.** `sendNow`/`schedule`/
  `setRecurrence` now accept a template plus *either* a contact list or a
  segment (the worker has resolved segments all along; the guards predated
  it). `duplicate()` now copies the segment audience and the full A/B
  configuration with variants — it silently dropped both — while run state
  (winner flags, `abTestStatus`, schedules) deliberately stays behind.
- Dependency note: `@zone-eu/mailsplit` (via mailparser) is dual-licensed
  `MIT OR EUPL-1.1+`; recorded in the license-audit exceptions electing MIT.

## Phase 4 — Mailcow provisioning + send-as permissions (2026-08-06)

- **Mailboxes page (OWNER/ADMIN)**: with `MAILCOW_API_URL`/`MAILCOW_API_KEY`
  set, admins provision a team mailbox in one flow — QQueue creates the
  Mailcow mailbox, generates an app password it alone keeps (encrypted with
  the existing AES-GCM scheme), auto-creates the `SMTPConnection` and a
  **sync-enabled `InboxAccount`** (mandatory, so Phase 2b's DSN parser has
  bounce visibility for the identity from day one), and optionally grants
  send-as to a member. The human's mailbox password is returned exactly once
  for their own mail client; QQueue never stores it. On partial failure the
  Mailcow mailbox is deleted again — provisioning leaves no orphans.
- **Send-as grants**: new `SmtpConnectionGrant` model (migration
  `20260806000000_add_smtp_connection_grants`). OWNER/ADMIN may send as any
  org connection; a MEMBER only as connections they hold a grant for.
  Enforced once, at creation time, on every send surface — transactional API
  (JWT callers), manual sends, drafts naming a connection, recurring-send
  creation, and campaign start (campaigns send as the org default, so the
  actor must be allowed to use it). API-key sends and SYSTEM mail carry no
  acting user and bypass by design; the worker does not re-verify (jobs are
  created post-check).
- **The composer picker is grant-aware**: Email Studio now loads
  `GET /smtp-connections/sendable`, so members see exactly the identities
  they may use. Grant management (list/add/remove per connection) lives on
  the Mailboxes page.
- New Mailcow API client (`apps/api/src/modules/mailcow/client.ts`) covering
  list domains, create/delete mailbox, password reset, and app passwords,
  with Mailcow's 200-with-danger-body responses mapped to real errors.
- Env: `MAILCOW_API_URL`, `MAILCOW_API_KEY`, `MAILCOW_MAIL_HOST`,
  `MAILCOW_SMTP_PORT`, `MAILCOW_IMAP_PORT` (documented in
  `docs/ENVIRONMENT_VARIABLES.md`); the feature is off and its routes 404
  when unset.
- **Provisioning verifies without false failures**: after the mailbox is
  created and recorded, a short non-fatal probe (3 attempts over ~7s, 6s
  timeout each) tests the SMTP credentials. Mailcow can take a moment to
  activate a fresh mailbox, so a failed probe reports `verified: false` as a
  warning in the result and the UI — rollback stays reserved for "we couldn't
  record what we created", never "the handshake didn't work yet". A new
  `POST /smtp-connections/:id/verify` endpoint plus a "Test connection"
  button on every sending-account card (membership-level — it changes
  nothing) lets anyone re-check on demand.

## Phase 3 — Close the security gaps (2026-08-06)

- **Sending-account writes are OWNER/ADMIN only.** Any member could previously
  add, alter, or delete the org's SMTP credentials. Create is gated at the
  route (`requireOrgRole`); update/delete are gated in the service next to the
  ownership lookup (the `/:id` requests carry no org id until the row loads).
  Reads stay membership; members still send from the accounts.
- **Un-suppressing an address is OWNER/ADMIN only.** `DELETE /suppressions/:id`
  needed only membership — any member could put a bounced or complained
  address back into circulation. Non-members still get the same 404.
- **The inbound ESP webhook ships disabled.** `POST /webhooks/email-events`
  authenticated with one instance-wide plaintext secret (non-constant-time)
  and correlated messageIds across every org. There is no caller on a
  Mailcow-relay instance, and Phase 2b's DSN parsing covers async bounces. The
  endpoint now answers 404 unless `INBOUND_ESP_WEBHOOK_ENABLED=true`; when
  enabled, the secret compare is constant-time. The outbound webhook system is
  untouched.
- **`trust proxy` is set** (`TRUST_PROXY`, default 1 for the bundled Caddy),
  so IP-keyed rate limits key on the real client address instead of the
  proxy's.
- **The raw password-reset token is no longer echoed by default.** The old
  condition (`NODE_ENV !== "production"`) leaked account takeover on any prod
  instance that forgot to set `NODE_ENV`. Echoing now requires the explicit
  `DEV_ECHO_RESET_TOKEN=true` opt-in and is refused under production
  regardless.
- The previously-untested `require-org-role` and `require-transactional-auth`
  middlewares gained dedicated test suites, alongside route-level acceptance
  tests (MEMBER → 403 on sending-account create/delete and suppression
  delete; webhook 404 by default).
- **The dashboard hides what members can't do**: the sending-accounts page
  shows no create/edit/delete controls to MEMBERs (its empty state points at
  an owner or admin instead), and the blocked-addresses page hides the
  unblock control while keeping blocking open to everyone. Cosmetic only —
  the API remains the enforcement point.

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

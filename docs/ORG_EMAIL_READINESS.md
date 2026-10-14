# Organization email client readiness

This work follows the implementation audit requested on 2026-10-14. The target
is QQueue as an organization's everyday email client. Existing beta status is
not an acceptance test for that target.

## Implemented in the first change set

- Exclude sensitive SYSTEM mail from shared Sent, Outbox, attachment reads,
  recipient suggestions, and manual delivery-status access.
- Apply mailbox grants to recipient suggestions and manual delivery status;
  invalidate cached suggestions when grants change.
- Reject conflicting body/query organization IDs. Bind receiving-account
  updates and disconnects to the verified organization and an administrative
  role in that organization.
- Disconnect by disabling sync, preserving received messages and attachments.
  Reconnecting a disabled mailbox reuses its record and history.
- Filter inbox pages by mailbox on the server and fix the skipped-record cursor.
  Expose older **already imported** messages through Load older mail.
- Select inbox rows, select all loaded rows, and mark selected messages read or
  unread. Selection is available on phones as well as desktop.
- Fetch a complete received conversation independently of the list's page,
  search, and read filter. Include authorized outgoing messages and attachments
  in chronological order, with sender attribution and queue/failure status.
- Reply to an individual received message using a panel accessible without
  scrolling through the entire conversation. Use the existing rich-text editor,
  private attachment uploads, personal server drafts and per-user device backups.
- Route replies through the existing manual/transactional pipeline, choosing the
  receiving mailbox's authorized sending account instead of silently using the
  organization default. Retain and respect incoming Reply-To headers.
- Provide Reply all recipient resolution. The group-header limitation of this
  initial implementation is addressed by the delivery-safety batch below.
- Give manual sends and replies stable retry keys through the existing
  transactional idempotency mechanism. Confirm queue acceptance separately from
  actual sending. Keep drafts on failure and block sends during attachment upload.
- Support ordinary safe link clicks from received HTML without permitting email
  scripts; external links open outside the restricted email frame.
- Trigger real worker sync from Check for new mail. Isolate failures between
  mailboxes, record a useful connection-error message, and detect UID-validity
  changes before advancing the import cursor.
- Isolate inbox/compose state on organization changes; partition offline drafts
  by signed-in user and retain them across authentication failures.
- Add Team's Send sign-in reset link action, distinguish sender-detail editing
  from mailbox editing, and hide administrator integration controls from members.
- Keep extra campaign/reporting navigation behind Show more tools and remove
  the artificial dashboard splash delay.

## Follow-up batch: group identity and device draft retention (2026-10-14)

Verified in code and automated checks:

- New manual messages and replies retain the complete visible To/Cc headers and
  one RFC Message-ID across their delivery jobs and unchanged-key retries.
  Separate SMTP envelopes deliver each recipient once; Bcc stays off the wire
  headers. Existing jobs retain their previous header behavior. The additive
  `visibleTo`/`visibleCc` migration defaults old rows to empty arrays, triggering
  that compatibility path.
- Worker queue replays skip already SENT or SUPPRESSED jobs. A failure in
  bookkeeping after recording the SMTP result no longer changes that result
  back into QUEUED. Message-ID is persisted before SMTP and reused on retries.
- Device draft backups are acknowledged atomically against the exact snapshot
  saved. A late save response keeps newer local content and gives it the server
  draft ID. Server refusals retain the backup while other pending drafts can
  sync. Reconnect/visibility flushes serialize within a tab. Editing Reply-To
  now triggers autosave as well.

Those original limitations are superseded by the next implementation batch.
The initial verification did not establish complete primary-client readiness.

### Read-state decision

The organization selected **shared read state per mailbox**. Every authorized
teammate sees the same read/unread state, and the IMAP `\Seen` flag must converge
with it across other mail apps. The initial batch recorded this decision without writeback. The newer batch
below implements durable pending operations and reconciliation so an old sync
result cannot undo a newer local action; there is no personal unread overlay.

### Verification of this batch

Typecheck, lint, build, the full test suite, and unmodified coverage thresholds
passed. The Docker smoke test applied every migration to disposable PostgreSQL,
reported no schema drift, and checked real SMTP wire To/Cc/Message-ID headers,
Bcc omission and recipient envelope counts, alongside existing access, pagination,
reply retry and disconnect checks. Docker's exhausted default network pools were
handled with a temporary explicit smoke-only subnet, removed by teardown.

No live mail-provider, interrupted-network browser, mobile-device, or assistive
technology acceptance is implied by these checks.

## Delivery safety, shared read state and reading pane (2026-10-14)

Implemented:

- Independent To/Cc/Bcc jobs in the existing pipeline, with complete visible
  headers and one Message-ID. No To-recipient carrier dependency; suppressed
  recipients do not prevent other recipients from receiving the message.
- One logical Sent/Outbox/conversation entry, individual delivery outcomes,
  recipient-scoped SMTP rejections and asynchronous DSNs, and honest aggregate
  status when cancellation races an already-started delivery.
- SMTP outcomes that may have accepted DATA become UNCERTAIN and are not
  automatically resent. Durable queued jobs and pending group summaries recover
  through periodic worker dispatch/reconciliation.
- Draft creation retry identities, revision conflicts, serialized in-tab saves,
  atomic send/attachment preparation/draft completion, completed-draft tombstones,
  payload-conflict rejection on send retries, and device backups retained after
  rejected saves. Lost send responses can recover the accepted delivery identity.
- Private attachment upload identities deduplicate unchanged retries and reject
  changed files. Upload completion checks that the draft is still editable.
  Composer file bytes and retry identities are backed up on the device when
  IndexedDB is available; failed pending files have retry/remove controls and
  block sending. Attachment ownership and exact draft attachment sets are checked
  before send acceptance.
- Shared read/unread state writes back to IMAP, checking UID-validity and remote
  message identity. Revision-conditional acknowledgement/reconciliation protects
  newer teammate actions. Pending failures remain visible and rotate behind
  untouched work. Flag scans are bounded and rotate through imported history.
- Desktop Inbox defaults to an adjacent reading pane. The 200px folder sidebar
  stays fixed; More tools opens an overlay instead of lengthening navigation.
  The message list is 360px (400px on wide screens), leaving more space for the
  reader. List and reader scroll independently. Focused mail is an account/device
  preference; phones retain a single-screen list/conversation flow. Conversation
  selection has a URL, browser-history ownership and list scroll restoration.

Acceptance evidence:

- Disposable PostgreSQL/Redis Docker smoke passed all migrations with no Prisma
  drift. Actual SMTP wire checks cover recipient counts, To/Cc headers, Bcc
  omission, draft-create retries, competing revisions, changed-send conflicts,
  rollback on missing attachments, group cancellation, partial acceptance,
  rejected-recipient suppression, and disconnect after DATA acceptance without
  duplicate delivery on queue replay.
- A controlled self-addressed message composed in the browser passed server
  draft acceptance, real SMTP delivery, one logical Sent row, real IMAP import,
  and private attachment byte-for-byte download. Shared read/unread changes
  reached IMAP, and an independent IMAP client's Seen/unseen changes reconciled
  back into QQueue. These checks exercised only the synthetic acceptance message.
- Chrome desktop rendering confirmed the smaller fixed sidebar, adjacent reader,
  independent list scrolling, and the synthetic message/attachment. Chrome's 440px phone viewport confirmed the single-screen list/conversation
  flow and bottom navigation. This was browser emulation, not a physical-device
  keyboard/safe-area test. Component tests cover completed-draft recovery after
  a lost HTTP send response.
- Full typecheck, lint, build, tests and unmodified coverage gates passed, as
  did dependency license audit and the cloud boundary check.

## Required before calling the primary-client goal complete

1. **IMAP folders and history:** complete older-history backfill, folder discovery,
   Archive, Trash/restore, move and flags, external Sent and external Drafts. The
   current importer still reads one configured folder. Validate UID-validity
   replacement, large mailboxes and interrupted import against real services.
2. **Draft/composer recovery:** editable reply recipients, forwarding with original
   attachments, per-account signatures, simpler advanced-editor controls, a clear
   recovery workflow for conflicting versions, and reply upload recovery. Verify
   concurrent tabs/devices, interrupted uploads and device storage failures.
3. **Inbound attachment recovery:** show unavailable/oversized parts and retry
   storage failures without duplicates, including missing inline content.
4. **Team coordination:** concurrent reply presence; streamline invitations,
   mailbox assignment, resend and recovery-address workflows. Mailbox-password
   recovery remains distinct from QQueue sign-in reset links.
5. **Navigation/search:** unified received/sent search with mailbox scope, URL-owned
   search/filter state and acceptance of Back/scroll/deep links across all mail
   surfaces, including long conversations and failed loads.
6. **Broader acceptance:** distinct controlled To/Cc/Bcc recipient mailboxes,
   slow/interrupted browser networks and lost responses, actual phone keyboards
   and safe areas, accessibility/assistive technology, large histories and multiple
   teammates with different read/send grants and administrator roles. The live
   check above used one provided mailbox and a self-addressed synthetic message;
   it does not prove these other scenarios.

## Verification

Run typecheck, lint, build, tests and the unmodified coverage thresholds. For
pipeline or schema changes, also run the Docker smoke test and Prisma migration
drift check against a disposable database. The smoke test now verifies sensitive
system-mail access, real inbox pagination, thread retrieval, reply idempotency,
delivery through SMTP, and history-preserving disconnects in addition to setup
and sending.

The default Docker address pools on the development host were exhausted during
this run. The smoke stack was verified using a temporary Compose override with
an unused explicit subnet; unrelated Docker networks were left intact.

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
- Provide Reply all recipient resolution. The group-header limitation below
  still applies and must be resolved before general rollout.
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

## Required before calling the primary-client goal complete

1. **IMAP state and history:** durable read/unread writeback and reconciliation,
   complete older-history backfill, folder discovery, Archive, Trash/restore,
   move and flags, plus mail sent/drafted in another client. Today read state is
   shared inside QQueue and receiving sync still imports one configured folder.
2. **Normal group messages:** preserve the visible To/Cc conversation and shared
   message identity. The existing per-To fan-out and single copy-recipient
   carrier remain in place. Reconcile that behavior with suppression enforcement
   and per-recipient outcomes inside the one delivery pipeline.
3. **Composer completion:** forwarding with original attachments, signatures,
   editable reply recipients, and simpler advanced-editor controls. Check draft
   recovery across devices, concurrent tabs, interrupted uploads and lost send
   responses.
4. **Attachment recovery:** show unavailable/oversized inbound parts, retry
   storage failures without duplicates, and recover missing inline content.
5. **Team coordination:** define personal versus shared unread state and show
   concurrent replies; streamline invitation, mailbox assignment, resend and
   recovery-address workflows. Mailbox-password reset links are distinct from
   QQueue sign-in reset links and are not implemented by the Team action.
6. **Navigation and search:** stable conversation URLs, browser Back and scroll
   restoration, global received/sent search, and useful empty/error states on
   every mail surface.
7. **Acceptance testing:** real IMAP/SMTP accounts, attachments/object storage,
   slow and interrupted networks, browser keyboard navigation, phone keyboard
   and safe areas, long threads, assistive technology, and multiple teammates
   with different mailbox grants. No browser acceptance result is implied by
   component tests.

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

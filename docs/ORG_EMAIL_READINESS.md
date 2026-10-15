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

## Older history and MIME recovery (2026-10-15)

Implemented:

- Recent and older mail bodies import in batches capped at 100. Sparse or
  expunged UIDs do not turn that limit into a permanent history cutoff. The
  durable history cursor resumes after interruption and reaches zero when the
  configured folder is backfilled. Historical messages do not trigger new-mail
  push notifications or apply old DSNs as new suppression-policy changes.
- Missing bodies and unavailable/oversized MIME parts remain visible. The
  message reader exposes recovery and disables unavailable downloads. Missing
  cached objects become recoverable errors, with mailbox grants enforced on
  downloads and retry requests. Recovery verifies UID-validity and message
  identity, reuses metadata/storage keys, and preserves shared read state.
- Existing imports get a one-time recovery pass on upgrade because earlier
  versions could silently skip parts. Matching legacy file metadata is adopted
  without duplicating available files; previously missing parts still import.
- A per-check time budget closes IMAP and cancels object uploads before the
  account lock lease expires. A timeout retains the last completed cursor for
  the next check. Failure attempts rotate so one broken location cannot starve
  all other pending content.
- A missing original body blocks reply delivery until the original headers can
  be recovered. Messages without an RFC Message-ID use a UID-validity-scoped
  local identity; verified legacy identities retain read-state compatibility.
- Blocked and cancelled delivery attempts remain findable in Sent with explicit
  outcomes, so completing a composer draft cannot hide its writing.
- The editor and reload partitioner preserve typed leading spaces consistently,
  so reopening writing does not unnecessarily freeze rich-text paragraphs.

Acceptance evidence:

- With the real provider and an isolated receiving account, the first check
  imported three recent messages. Subsequent checks backfilled all fourteen
  messages in its configured INBOX and completed the history cursor. This was a
  small mailbox, not a large-history stress test.
- Removing only the synthetic message's cached file from disposable MinIO made
  its authenticated download return an explicit recoverable error. Chrome
  displayed the unavailable part and its retry control. Live IMAP recovery
  restored the exact original bytes with the same metadata row and storage key;
  the reader enabled the recovered file again without a page reload.
- Chrome's final build saved a rich-text draft, preserved its leading space in
  HTML source, and reopened it as editable rich text. No delivery was requested.
- Regression tests exercise bounded sparse UID imports, interrupted history,
  parsing past the time budget, legacy part adoption, repeated failed-part
  recovery, missing-body recovery without undoing read state, UID identity
  mismatch, unavailable-file UI, and unauthorized retry requests.
- Full typecheck, lint, build, tests and unmodified coverage gates passed.
  Disposable PostgreSQL migration drift and SMTP smoke checks also passed.

## Folder locations and shared flags (2026-10-15)

Implemented:

- Discover selectable IMAP folders and server special-use roles without removing
  cached mail when folders disappear. An additive migration preserves the
  configured folder, UID-validity namespaces, import cursors and pending actions.
- Store logical message identity separately from folder locations. Copies share
  one body and shared read/flag revisions; each folder has independent recent,
  older-history and flag-scan cursors. Checks prioritize the configured folder
  and rotate a secondary folder within the account time budget.
- Apply Seen and Flagged actions to all current copies. An external flag
  transition becomes a new conditional shared revision, so a stale copy cannot
  undo it. Reused UIDs are verified before writes; expunges and external moves
  retire locations while retaining cached writing. Missing flags are not treated
  as flag removal, and failed actions remain visible for retry.
- Read server Sent, Drafts, Archive, Trash, Junk and custom folders through the
  existing conversation reader, with private attachments. Folder selection and
  mailbox/search/read filters live in the URL. The redundant column chooser is
  removed from the compact conversation list. QQueue-generated private SYSTEM
  sends are excluded from imported Sent and non-recipient folder copies.
- Folder reads, folder-scoped/all-mail searches and flag mutations retain
  mailbox grants. The web app consumes the new folder contracts from the shared
  workspace package; no external dependency versions changed.

Acceptance evidence:

- Live IMAP discovery recognized special-use Sent and Drafts. Copying the
  synthetic acceptance message into a temporary folder produced two remote
  locations and one logical message. Shared Flagged changes reached both
  copies; another IMAP client's Seen/Flagged removals converged across them
  without a stale-copy overwrite.
- Moving only that temporary copy into Trash reconciled both locations while
  retaining its writing and the original Inbox copy. The temporary copy and
  empty test folder were removed after verifying that the original remained.
- Against disposable PostgreSQL, a MEMBER with no mailbox grants was denied
  folder results, all-mail search results and flag mutation. Regression tests
  also cover folder UID namespaces, missing folders, interrupted discovery,
  primary-folder failures, revision races and URL filter history.
- Chrome verified folder selection, browser Back, flag on/off controls and the
  pending-sync status clearing after writeback. A 440px phone viewport verified
  the single-screen flow and folder selection by keyboard. This is browser
  emulation; physical keyboard/safe-area/assistive-technology acceptance remains.
- Full typecheck, lint, build, tests and unmodified coverage gates passed, as did
  disposable PostgreSQL migration drift/SMTP smoke, dependency license audit and
  the cloud boundary check.

## Durable Archive, Trash, restore and moves (2026-10-15)

Implemented:

- Folder actions create durable, retry-identified conversation snapshots. New
  replies arriving after acceptance are not swept into an old retry. Requests
  validate receiving grants, current source locations and same-mailbox targets;
  concurrent actions cannot create conflicting moves for the same location.
- The reader offers Archive, Trash/restore and an explicit destination dialog.
  Accepted, completed, failed, partial and uncertain outcomes remain distinct.
  Cached writing stays available while the server confirms its new location.
- Workers require IMAP MOVE, verify UID-validity and original bytes, and persist
  command intent before changing the server. A lost command response is reconciled
  from source absence and an identical destination; uncertain commands are never
  automatically repeated. Servers without MOVE expose a useful failure.
- Headerless messages retain their logical identity through verified content
  hashes. Shared read/flag state follows the new location. Accepted moves survive
  deletion of their creator account. Durable pending work is redispatched after
  releasing the account lock, with periodic checks as a fallback.

Acceptance evidence:

- Live IMAP moved a controlled two-message conversation, including a headerless
  message, through Archive, Trash, restore and Inbox. A reply appended after
  acceptance stayed outside the accepted snapshot; replay returned the same
  batch and changed instructions were rejected. Private attachment bytes and
  logical message identity survived the moves.
- A move accepted by a temporary authorized member completed after that local
  member account was deleted. The durable operation retained its intent without
  retaining the deleted actor reference.
- Chrome desktop confirmed the explicit destination dialog, pending-to-completed
  status, removal from the source list, and retained body/attachment access.
  Full typecheck, lint, build, tests and unmodified coverage gates passed. The
  Docker smoke test and disposable PostgreSQL drift check passed.
- Unit and component checks cover response-loss retries, conditional status,
  missing/changed namespaces, unsupported servers, partial progress, cancelled
  destination selection, and blocking dialog changes during acceptance. These
  checks do not establish physical-device or actual transport-loss acceptance.

## Editable replies, forwarding and composer recovery (2026-10-15)

Implemented:

- Replies expose editable To/Cc/Bcc fields. Reply all populates visible recipients,
  excludes the receiving mailbox, and preserves subsequent edits. Legacy Reply all
  drafts retain their original intent; a saved Cc-only reply does not silently
  regain a To recipient. Uncommitted recipient text is backed up with the draft.
- Invalid recipient text remains visible and blocks submission until corrected or
  removed. The same accessible recipient control is used by new mail and replies.
  Ordinary mail editors show basic formatting first, with advanced controls behind
  More formatting. Accepting a send disables recipient and body editing.
- Reply uploads retain retry identities and file bytes in device storage when
  available. Failed files remain visible, block sending, and can be retried or
  removed. Reopening restores pending files. Newer writing typed during an upload
  is retained when an older attempt fails. Storage failures carry an explicit
  keep-open warning rather than a false device-save promise.
- Replies recover a completed draft's delivery identity after a lost send response.
  Revision conflicts preserve local writing and offer a read-only saved-version
  comparison including recipients and files. Choosing that version rechecks its
  revision and file set. The main composer uses the same comparison workflow.
- Forward prepares a personal draft through a stable retry identity, with readable
  quoted original text and all private original attachments. HTML-only originals
  are converted to text without executing or fetching their markup. Missing,
  oversized or unavailable original content blocks preparation explicitly. The
  receiving grant and an authorized matching sending account are required.
  Sending the prepared draft uses the existing manual delivery pipeline. Removing
  a forwarded draft's file cannot remove the received original's private blob.
- Headerless originals do not put local cache identifiers on RFC reply headers.
  Completed reply drafts retain the link to their authorized delivery outcomes.

Acceptance evidence:

- Chrome prepared a forward from the controlled original, showed its quoted text
  and private attachment, selected the provided mailbox as the recipient, and
  reported queue acceptance separately from mail-server acceptance. Independent
  IMAP fetch verified one received forwarded message, the original writing and
  the exact original 41-byte attachment.
- Actual PostgreSQL/API preparation retries returned one draft and attachment.
  Removing that forwarded attachment left the received original downloadable with
  identical bytes. Only temporary acceptance drafts were then removed.
- Full typecheck, lint, build, tests and unchanged coverage thresholds passed.
  Docker smoke also passed its real SMTP, permissions, reply and migration-drift
  checks.
- Regression checks cover edited recipients, invalid/incomplete addresses, legacy
  Reply all, Cc-only restore, lost send responses, competing draft versions, file
  retries after reopening, and newer writing during failed uploads. These are
  automated checks; actual browser transport loss and device storage exhaustion
  still require acceptance. The subsequent signature batch below also verifies
  the reply sheet in Chrome and a phone viewport.

## Personal signatures and safe draft opening (2026-10-15)

Implemented:

- Personal signatures are stored per user and sending account, with revision
  conflicts and stable unchanged retries. Existing accounts start without an
  active signature. Settings appear under You, and members can configure only
  sending accounts they are allowed to use. Organization administrators do not
  gain access to another person's signature.
- New messages and replies insert an enabled signature into empty writing.
  Manual insertion remains available when automatic use is disabled. Switching
  From replaces an untouched inserted signature; edited sign-offs are retained
  with a useful explanation. Full HTML documents retain their body boundaries.
  Drafts/device backups retain the inserted signature and its account identity.
- Deep-linked drafts now load through organization/user-scoped query state.
  Editing and sending are locked until loading succeeds, with explicit retry and
  keep-current-writing options on failure. Opening another saved draft first
  saves the current writing or retains its device backup.

Acceptance evidence:

- Actual API/PostgreSQL checks verified private signatures for two users sharing
  one sending account, denied writes without its send grant, stable retry
  revisions, rejection of changed retries, and cleanup of a deleted temporary
  user's preferences. The additive migration and fresh Docker smoke passed;
  disposable PostgreSQL reports no schema drift.
- Chrome saved a personal signature in Settings and automatically inserted it
  into Compose and a message-specific reply. An incomplete Cc address prevented
  submission and survived closing/reopening the unsent reply. The reply sheet,
  recipient fields, saved status and footer controls fit a 440px phone viewport.
  This is browser emulation, not physical keyboard/safe-area acceptance.
- Full typecheck, lint, build, tests and unchanged coverage gates passed. Tests
  also cover From changes, preserving edited signatures, manual insertion,
  private settings conflicts and failed deep-link loading/retry.

## Unified mail workspaces, search and team coordination (2026-10-15)

Implemented:

- Sent, Drafts, Outbox and Search mail share the approved reading-pane layout,
  Focused mail preference and phone list/reader flow. Long subjects truncate in
  the fixed-width list rather than shifting its contents under the 200px sidebar.
  Existing delivery reports, queue management and legacy filtered links remain
  available. Imported Sent copies and the delivery archive appear in one list;
  a matching mailbox/Message-ID produces one logical search result.
- Received/sent subject, address and body search is scoped to current mailbox
  grants. Personal drafts stay private; SYSTEM mail stays excluded. Search text
  is a bound literal, including wildcard characters. Stable cursor pages bind
  the organization, person, view and filters, with an explicit older-mail action.
  URL-owned filters/selections, Back, reader focus and list scroll restoration
  preserve context. Failed reads retain cached rows and expose retry controls.
- Replies to imported own Sent messages target the original recipients rather
  than the sender's own mailbox; Reply all deduplicates visible recipients.
- Renewable 45-second reply indicators show authorized teammates and the same
  person's other open composer. They carry names and expiry only, no writing,
  and never lock a send. Expired indicators disappear locally without waiting
  for another server response. Revoked membership/read access hides them; failed
  coordination is visible and does not prevent composing.
- Team data uses organization-scoped query state with a visible retry path.
  Invitations report email queue acceptance separately from manual-link fallback,
  show expiry and provide Resend. Renewal invalidates old links; acceptance
  consumes a still-valid token atomically. The screen links mailbox assignment
  and distinguishes QQueue sign-in resets from mailbox-password recovery.
- Role and mailbox-grant edits serialize with membership removal. Competing
  changes cannot remove the last owner. Removing a member also removes mailbox
  and provisioning grants, so rejoining does not restore former access; personal
  writing is retained. Organization roles do not confer instance administration.
- Reply device backups resolve consistently across Drafts and message entry
  points while keeping explicit draft identities separate. Offline saves show
  their paused connection state rather than a server-save promise.

Acceptance evidence:

- Full typecheck, lint, build, tests and unchanged coverage thresholds passed.
  Fresh Docker smoke applied the additive presence migration, checked SMTP and
  permissions, exercised actual SQL search/pagination and reported no schema drift.
- Actual PostgreSQL/API checks verified received/sent pagination, mailbox scope,
  private drafts, SYSTEM exclusion, literal search and cursor boundaries. A
  disposable 3,000-row database fixture produced 2,000 logical messages over 80
  pages without skipped or repeated results; all page queries took 1.58 seconds
  in total. This is database-volume evidence, not large real-IMAP acceptance.
- One self-addressed message sent by an independent SMTP client and appended to
  its real Sent folder imported as one logical message with Inbox/Sent locations
  and its exact 39-byte private attachment. It appeared once in unified Sent.
- Chrome verified filtered search deep links and Back, imported Sent reading,
  delivery writing/outcomes/private-file metadata, and saved-draft preview. A
  440px phone viewport showed the single-screen draft preview; keyboard navigation
  reopened its saved reply with recipients and signature. These are browser
  checks, not physical phone keyboard or assistive-technology acceptance.
- Two actual Chrome tabs showed simultaneous reply presence. Disconnecting the
  test tab through browser network controls, editing, closing and reopening the
  original reply retained its latest writing. Reconnecting saved that writing
  to PostgreSQL without sending a reply. This test exposed and verified the
  backup-entry and paused-save-status fixes above; it does not prove interrupted
  file-upload or lost-send-response recovery in a real browser.
- Real PostgreSQL/API checks verified invitation renewal/revocation, no-account
  email fallback, grant-scoped renewable presence, revoked-reader invisibility,
  per-user indicator removal, retained drafts after membership removal, denied
  instance controls for an ordinary org admin, and concurrent owner edits. Chrome
  also created, resent and revoked a disposable invitation in an organization
  without a sending account, showing the honest manual-link fallback. No email
  was sent for that invitation test. Chrome also opened an accepted message
  scheduled seven days ahead and cancelled it through Outbox's confirmation.
  PostgreSQL confirmed CANCELLED, no SMTP send time and retained original writing.

## Required before calling the primary-client goal complete

1. **IMAP folder operations:** external-draft editing/reconciliation. Validate
   UID-validity replacement, large
   mailboxes and interrupted import against real services.
2. **Draft/composer recovery:** broader acceptance of concurrent tabs/devices,
   interrupted uploads and device storage failures, including navigation and
   organization changes.
3. **Inbound content acceptance:** stress large/complex MIME messages, missing
   inline parts, real interrupted network/storage uploads and recovery when
   messages move or disappear in another client.
4. **Team acceptance:** exercise mailbox assignment and recovery with a real
   provisioning service and different teammates in the browser. Mailbox-password
   recovery remains distinct from QQueue sign-in reset links.
5. **Long conversations:** bound body loading and rendering rather than opening
   every body at once. Complete Back/scroll/deep-link acceptance on long threads
   and all remaining mail surfaces.
6. **Broader acceptance:** distinct controlled To/Cc/Bcc recipient mailboxes,
   slow/interrupted browser networks and lost responses, actual phone keyboards
   and safe areas, accessibility/assistive technology, large histories and multiple
   teammates with different read/send grants and administrator roles. The live
   check above used one provided mailbox and a self-addressed synthetic message;
   it does not prove these other scenarios. The user confirmed that no additional
   controlled recipient mailboxes are available, so live multi-recipient
   acceptance remains an external gap.

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

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

## Isolated device copies and honest save feedback (2026-10-15)

Implemented:

- Each open reply composer owns a separate device-backup key. A stale tab cannot
  overwrite another tab's local writing or adopt its save acknowledgement.
  Explicit draft links and message entry points still find the latest matching
  copy; other versions stay available through Review device copies.
- Device-copy review shows writing, recipients and file metadata. Replacing the
  current reply preserves that writing and any pending file bytes first. A copy
  whose pending bytes are unavailable fails visibly rather than dropping files.
- Restoring an ordinary composer backup copies it into a fresh local record while
  retaining its server draft/creation identity, revision and upload retry IDs.
  Review device drafts exposes all scoped ordinary pending copies, including
  file bytes and uploaded metadata. Its IndexedDB query runs while offline and
  reports a blocked store rather than showing a successful empty list.
- Reply saves capture body/recipients/fingerprint before an offline pause. Main
  composer saves and reconnect acknowledgements identify the exact snapshot
  accepted. Newer writing therefore cannot inherit an older response's Saved
  label. The interface distinguishes changes awaiting save, a confirmed device
  copy, and an accepted server save. A rejected concurrent sync offers saved-
  version comparison while retaining the local record.

Acceptance evidence:

- Two actual Chrome tabs retained different unsent offline replies. Restoring
  the first tab's writing kept the replaced second-tab text available in the
  review dialog. No reply was sent.
- Chrome saved ordinary composer writing offline, reopened its device recovery
  dialog without a connection, restored a copy and edited it. The dialog then
  showed two separate records; the original preview still contained its earlier
  exact writing. Earlier reconnection also verified retained writing in actual
  PostgreSQL. A cached older preview initially paused the local-store query;
  the refreshed current build verified the offline query fix. Reconnecting and
  reloading kept the edited copy and exposed Compare saved version plus an
  explicit retained-device-copy status when its revision was rejected.
- Tests exercise separate concurrent reply backups, preserving a replaced copy,
  restoration scopes, file bytes and stable server creation IDs, unavailable
  device storage, rejected revision sync, and newer writing during older reply
  and ordinary-composer save responses. Full typecheck, lint, build, tests and
  unchanged coverage thresholds passed. This web-only batch changes no schema
  or delivery pipeline.

## Navigation recovery when draft storage is unavailable (2026-10-15)

Implemented:

- Pending writing and private file bytes enter a scoped live-window copy before
  device persistence or network work. Leaving Compose, closing a reply or
  switching organizations preserves that copy even when IndexedDB rejects the
  write and the server is unavailable. These copies are explicitly temporary;
  closing the window can still lose them, so active unsaved writing and retained
  window copies trigger the browser's close warning.
- A global recovery notice provides private previews, exact-copy reopening,
  downloads of writing and waiting files, and an offline-capable device-save
  retry. Restoring a copy retains the original and its server/upload identities.
  Older asynchronous storage writes cannot replace newer window writing. Late
  reply acknowledgements now acknowledge only their submitted snapshot.
- Replies retain their first pending file before a server draft exists. Leaving
  an uploading composer aborts its browser request and retains retry bytes and
  identity. File completion saves the current composer writing rather than an
  earlier upload closure. Reply restoration finishes before editing is enabled.
- Session changes and token refreshes remain usable in the authenticated window
  when browser storage rejects writes. Organization changes preserve the latest
  refreshed credentials. Peer sign-out updates the session provider. Recovery
  notices leave room for the fixed sidebar and independently scrolling panes.

Acceptance evidence:

- Actual Chrome used a temporary 1MB quota below the origin's existing 5MB usage
  and browser offline mode. An unsent ordinary draft retained its exact subject
  and body after navigating to Inbox, previewing the window copy, reopening it,
  switching organizations and reopening the original organization's copy.
  Restoring normal quota and connectivity allowed a confirmed device backup;
  the pre-existing server-revision conflict remained visible. No email was sent.
- Automated checks cover both device-store failures, scoped window recovery,
  exact-copy opening, pending bytes before the first server save, upload aborts,
  late snapshot acknowledgements, offline device-persistence retry, close warnings
  and session-storage failures. Typecheck, lint, build, tests and unmodified
  coverage gates passed. This batch changes no schema or delivery pipeline.
- Chrome quota emulation establishes IndexedDB failure with an unavailable
  server, not a physical storage-exhaustion event or simultaneous failure of
  localStorage itself. Session/localStorage failures and interrupted file upload
  are automated evidence; physical-device and browser transport-loss acceptance
  remain separate gaps.

## Deliberate draft-conflict resolution (2026-10-15)

Implemented:

- Comparison now offers Keep my writing after rechecking the exact reviewed
  server revision and file set. It retains the current text and recipients,
  includes both sets of uploaded files and saves with the reviewed revision.
  A further concurrent server change still rejects the save. This is an explicit
  choice, not automatic text merging or a bypass of revision checks.
- Use saved version preserves the replaced writing and pending private file
  bytes in a separate recovery copy before replacing the composer. Waiting
  uploads no longer remain attached to the replacement. Recovery from a pending
  reply record detects stale revisions even without a localStorage backup.
- Changing the selected writing invalidates queued older saves. Late responses
  from the previous writing cannot replace the chosen draft identity or restore
  its old conflict state. Existing server identity and stable send acceptance
  remain the correctness controls.

Acceptance evidence:

- Chrome compared the actual saved draft, chose Keep my writing and retained the
  exact controlled subject/body. Actual PostgreSQL confirmed the newer revision
  and no completed send. Existing alternate local records were retained.
- Automated checks cover a second server change during review, preserving local
  recipients and remote files, archiving replaced reply bytes, both ordinary
  composer choices and a late rejected save after replacement. Full typecheck,
  lint, build, tests and unchanged coverage gates passed. No schema or delivery
  pipeline changed. Actual concurrent physical devices and transport-loss
  acceptance remain open.

## Bounded conversation bodies and stable pages (2026-10-15)

Implemented:

- Conversation discovery reads a complete authorized header/location index
  without fetching bodies or file metadata on each relationship-expansion pass.
  The current client requests ten received/sent bodies per page and renders only
  those frames; private inline parts are fetched only for the visible page.
- Earlier/newer pages use message identities rather than offsets. Deep links,
  reload and browser Back retain page selection. A selected older message remains
  in its initial window. Failed pages expose retry and a return-to-linked-message
  action without discarding cached content. Installed older clients retain their
  complete response until refreshed; bounded mode is an explicit client request.
- Shared read state and conversation moves retain every incoming member ID,
  independent of the body page. Opening marks unread members in one bulk request,
  rather than one HTTP request per message. Failed bulk updates remain retryable.
  The metadata safety limits remain 1,000 incoming messages, 1,000 outgoing
  records and 20 relationship-expansion rounds; exceeding them fails explicitly
  and retains cached messages rather than silently truncating conversation scope.
- Desktop mail-list scroll restoration now runs before painting, preventing a
  delayed initial restoration from replacing a newer scroll position.

Acceptance evidence:

- Full typecheck, lint, build, tests and unchanged coverage gates passed. A fresh
  Docker smoke passed SMTP, authorization, pagination, reply and disconnect
  checks and reported no migration drift. No schema or send pipeline changed.
- Actual PostgreSQL/HTTP checks used 64 synthetic incoming messages and 16
  synthetic outgoing records, not actual delivered mail. Eight pages returned
  all 80 identities without skips or duplicates, at most ten bodies per response,
  and a largest response of 208,742 bytes. The older-client response retained all
  bodies and an older-message deep link selected the correct initial window.
- Chrome displayed ten body frames, paged in both directions, restored a page
  through browser Back and reloaded an earlier-page URL correctly. The 440px
  phone layout showed readable paging controls without header overlap. This is
  emulation/layout evidence, not physical keyboard or assistive-technology
  acceptance. All exact synthetic fixture records were removed afterward.

## Continuing externally saved drafts as private copies (2026-10-15)

Implemented:

- A message in a discovered Drafts folder offers Continue as private copy.
  QQueue preserves its rich/plain writing, To/Cc/Bcc, Reply-To, original reply
  chain and private attachments, including inline Content-IDs. Read and send
  grants both apply. Unsupported file counts, oversized/missing files and
  multiple Reply-To addresses fail explicitly rather than creating a partial
  draft. The original mailbox draft is kept, including after sending the copy;
  this is stated beside the composer. QQueue does not overwrite, delete or
  claim exclusive ownership of another client's draft.
- Imported sources have a raw-source version and an exact folder/UID namespace.
  Older UIDs in that namespace cannot overwrite newer writing. Changed draft
  parts use content-addressed private keys and replacement metadata; earlier
  personal copies retain their original bytes. The additive migration marks
  existing mailbox drafts for complete source recovery, including Bcc.
- Preparation retries reuse one personal identity. Preparation rechecks the
  complete source/file snapshot before acceptance. Later changes expose a frozen
  review of the last synced original, including recipients and files. Keep my
  private copy acknowledges that exact reviewed source against the personal
  draft revision; opening the latest creates another copy after preserving the
  current writing. Removed or inaccessible originals need an explicit choice
  without revealing revoked mailbox content. Incomplete imports cannot be
  acknowledged as complete.
- Sending rechecks the source on the server before creating jobs. An unreviewed
  change stops the send, while an already accepted request still recovers its
  existing job. The copied source reply chain comes from server-owned provenance
  and delivery uses the existing MANUAL pipeline. These checks compare the
  **last synced** mailbox state: they cannot establish that another mail app has
  not sent the original since the last check. The original remains a separate
  draft in that app, so the interface explains the duplicate-send risk.
- Private inline-image previews use authenticated file routes and local blob
  URLs, block remote trackers and retain literal `cid:` links in saved/sent
  HTML. Failed preview downloads have a visible retry. Loading a saved draft now
  keeps its exact draft URL for reload without background refetch replacing
  newer writing. Inbox dates sit above the ellipsis; the selected row has a
  background rather than an outline, with visible keyboard focus retained.

Acceptance evidence:

- Real IMAP APPEND imported three controlled versions with the same Message-ID.
  Changed writing, Bcc removal, replaced files and removal of an inline part
  reconciled together. The older private copy retained its exact original file
  and MIME Content-ID. An unreviewed-source send returned 409 and created no
  jobs. Actual HTTP checks verified preparation replay, a separate latest copy,
  deliberate keep preserving old writing and rejection of a stale review.
- One imported third-version copy was delivered to the sole controlled mailbox
  through the normal MANUAL pipeline. SMTP recorded SENT; actual IMAP retrieval
  found one received Message-ID with the original reply chain, `cid:` image and
  exact text-file bytes. Replaying the accepted request retained one job. The
  original remained in the mailbox Drafts folder. This is one observed self-send,
  not proof of exactly-once SMTP or distinct-recipient To/Cc/Bcc acceptance.
- Chrome opened the imported draft through Mailbox Drafts, continued it in
  Compose with its current recipients/text/file, and reviewed a newer original
  while retaining the older private writing. Native reload testing exposed the
  draft-URL issue fixed above; the final build then reloaded the exact saved
  copy with both files. Its private inline-image preview rendered through an
  authenticated blob URL. The composer and review sheet fit a 440px phone
  viewport; this is layout emulation, not physical keyboard/device acceptance.
  Full typecheck, lint, build, tests and unchanged coverage thresholds passed. Fresh Docker smoke passed sending, grants and
  migration drift; the separate disposable acceptance database also reports no
  schema difference. Concurrency and unavailable-file cases have automated
  regression coverage; physical-device acceptance remains separate.

## Decode failures and real IMAP recovery (2026-10-15)

Implemented:

- A source that cannot be decoded now retains its IMAP envelope and a visible,
  retryable unavailable body while later messages continue importing.
  Deadline and connection failures still preserve the interrupted batch's cursor
  for replay. Content retries remain bounded
  and fair across failed messages.
- An unavailable newer mailbox-draft source advances its authoritative UID
  pointer while retaining cached text and Bcc. Recovering a lower UID cannot
  clear that newer version's pending state, including before any version has
  parsed successfully. Copy preparation and sending remain blocked until the
  text and files of that version are ready.

Acceptance evidence:

- A disposable folder on the real IMAP service held 240 controlled messages.
  Closing the actual IMAP connection after five stored bodies left those cached
  rows intact and its cursor unchanged. Ten reconnect passes imported the full
  history, at most the configured 25 new rows per pass, without missing or
  duplicate logical messages.
- Deleting and recreating that exact disposable folder produced a new real
  UID-validity namespace. Its reused UID 1 updated the matching Message-ID rather
  than the old UID-1 message; a new UID 2 imported separately. Prior locations
  became absent and the 240 cached messages remained. The exact temporary remote
  folder and database organization were removed after verification. This is a
  bounded 240-message history, not production-scale mailbox stress.
- Regression tests separately verify contained decoder failures, current-draft
  source pointers, transport-interrupted cursor replay and independent folder
  progress. All five verification gates and unchanged coverage thresholds pass.
  This batch changes no schema or sending pipeline.

## Waiting-file recovery and real browser response loss (2026-10-15)

Implemented:

- Reopening a saved draft checks for matching device copies with waiting file
  bytes. Their names and sizes stay visible, and sending waits for an explicit
  choice: resume that device copy, or use only the saved files while retaining
  recovery copies. Other drafts' pending files do not block this message. Failed
  device reads have retry and an explicit saved-files choice. Already accepted
  sends remain protected and do not ask for another file decision.
- Restoring the waiting copy keeps its writing, uploaded metadata, pending bytes
  and retry IDs together. A stale revision still requires saved-version review.
  Completed upload IDs are available in saved file metadata and retained on new
  upload responses, so an already recovered file is not mistaken for another
  missing file in a device copy.
- File-only backups remember the exact writing/uploaded-file snapshot already
  acknowledged by the server. Visibility/reconnect sync no longer saves that
  unchanged writing again merely because private file bytes remain on the
  device. Newer text still syncs; older acknowledgements cannot replace the
  newer marker. Removing the last waiting file can release an acknowledged copy
  without an unnecessary server write. The composer distinguishes saved writing
  from file bytes that remain on this device. A successful text save cannot
  clear the window-only warning when device storage still rejects pending file
  bytes; close protection remains active. That storage/server combination has
  automated coverage and is not claimed as a physical storage-exhaustion test.

Acceptance evidence:

- A temporary local HTTP proxy closed actual Chrome upload connections after
  64–130 KiB of a 1 MiB multipart request. The file remained retryable. Leaving
  Compose and reopening its saved URL exposed a real missing-files issue: the
  earlier build hid those waiting bytes and enabled sending. The final build
  showed the matching file copies and disabled Send until review; Chrome then
  restored the selected writing and pending file through the device-copy dialog.
- The proxy next discarded successful 201 upload responses. Chrome retained the
  waiting file and retried its same identity. Actual PostgreSQL/object storage
  verified one attachment with all 1,048,576 original bytes; retrying recovered
  that same record. Regression tests also cover deliberately continuing with
  saved files while keeping the pending copy and ignoring another draft's files.
- Finally the proxy discarded successful 202 send-acceptance responses. Chrome
  recovered the completed draft's job, kept the writing and disabled sending
  again. The real pipeline recorded one MANUAL delivery group; actual IMAP
  retrieval found one received Message-ID with the original reply chain, inline
  image and exact recovered 1 MiB file. Chrome opened that message and its files
  in Sent. This demonstrates the controlled lost-response case, not a general
  exactly-once SMTP guarantee or a physical mobile network test.
- All five verification gates and the unchanged coverage thresholds passed.
  The temporary fault proxy was removed and the normal local API restored.
  Only the exact controlled external-draft UIDs were then removed; sync reported
  the original unavailable while retaining the unsent private copy and both of
  its files. Existing device writing and alternate recovery copies were kept.

## Required before calling the primary-client goal complete

1. **IMAP recovery acceptance:** production-scale mailboxes and broader
   provider/complex-MIME stress remain. Controlled real-service interruption,
   reconnection, a 240-message history and UID-validity replacement now pass. External drafts now
   continue as explicitly separate personal copies; editing the original IMAP
   draft in place is not supported.
2. **Draft/composer recovery:** physical concurrent devices and broader storage,
   mobile-network and account-change combinations remain. Controlled Chrome
   interrupted uploads, navigation/reopen, lost upload responses and lost send
   acceptance responses now pass against the real API/provider.
3. **Inbound content acceptance:** stress large/complex MIME messages, missing
   inline parts, real interrupted network/storage uploads and recovery when
   messages move or disappear in another client.
4. **Team acceptance:** exercise mailbox assignment and recovery with a real
   provisioning service and different teammates in the browser. Mailbox-password
   recovery remains distinct from QQueue sign-in reset links.
5. **Broader acceptance:** distinct controlled To/Cc/Bcc recipient mailboxes,
   physical mobile networks, actual phone keyboards and safe areas,
   accessibility/assistive technology, production-scale histories and multiple
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

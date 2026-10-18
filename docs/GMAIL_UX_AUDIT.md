# QQueue Gmail UI and UX audit

Date: 18 October 2026  
Repository baseline: `9852e42`  
Scope: investigation before the interface overhaul

QQueue has the foundations for everyday email. Its current interface makes those capabilities feel like separate management screens. The largest problems are the allocation of screen space, the hierarchy of reading and writing controls, and inconsistent interaction between mail views. A Gmail reproduction needs changes to the shell, message rows, composer, and reader together; changing colours and spacing alone will leave the main usability problems intact.

The recommended direction is to reproduce Gmail's mail layout and supported interactions closely, while keeping QQueue's identity, organization and mailbox permissions, delivery pipeline, campaigns, and operations tools. Begin with the daily mail experience. Treat Gmail features without a QQueue equivalent as explicit follow-up scope.

## Evidence and coverage

The live desktop review covered QQueue's Inbox, empty Compose, Sent list, an outgoing message reader, empty Drafts, Search mail, and Settings in the existing signed-in Chrome session. Gmail's existing signed-in desktop inbox supplied a direct visual reference. The reviewed QQueue interface used a 200px sidebar and a roughly 400px conversation list at the observed wide desktop size. The deployed build's revision was not established; implementation references below refer to the repository baseline.

Source review covered routing, desktop and mobile navigation, design tokens, inbox and unified mail views, compose and reply, folder actions, search contracts and service, settings, onboarding, and the feature/readiness documents. Mobile findings are source-based; this audit does not establish physical phone, soft keyboard, screen-reader, performance, or end-to-end delivery acceptance. No messages were sent, unread messages deliberately opened, or mailbox mutations requested during the review. Private mailbox contents and screenshots are not included in this repository document.

This is a heuristic and implementation audit, not an observed user study. Priorities express expected impact on the daily mail workflow. P0 means foundational overhaul work, P1 means the next usability work, and P2 means supporting cleanup.

### Gmail reference configuration

Use the reviewed light desktop Gmail interface as the initial visual reference: expanded mail navigation, prominent Compose button, persistent top search, full-width message rows, a compact toolbar, and conversation reading in the main content region. Gmail supports configurable inbox layouts; the initial QQueue target should specify its own default rather than claim every Gmail configuration is identical. The observed Gmail account also displayed category tabs, whose behavior is a separate capability decision.

Before implementation, capture a matched reference set using synthetic mail at agreed viewport sizes. Include list, hover, selection, reader, compose, reply, search, empty, loading, error, and offline states. The live visual comparison establishes the direction; it does not establish a complete pixel specification for all those states.

## What already exists

The latest [feature inventory](STATUS.md) and [email client readiness record](ORG_EMAIL_READINESS.md) supersede older descriptions of QQueue as a narrow replies-only inbox. Reuse these capabilities:

| Capability        | Existing foundation                                                                                                | Overhaul implication                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Mail navigation   | Inbox, unified Sent, Drafts, Outbox, received/sent search, URL-owned selections and filters                        | Give these one consistent mail shell.                                    |
| Mail organization | IMAP folder discovery, archive, trash, restore, moves, read/unread and flagged state                               | Surface existing behavior in familiar navigation and toolbars.           |
| Conversations     | Incoming and authorized outgoing history, bounded body loading, stable deep links                                  | Rework presentation while retaining identity and pagination.             |
| Writing           | Rich compose, editable To/Cc/Bcc replies, reply all, forwarding, signatures, attachments, templates and scheduling | Reuse services and editor behavior inside simpler surfaces.              |
| Draft safety      | Personal drafts, server revisions, device copies, conflict review, interrupted-upload and retry recovery           | Preserve writing when compose windows minimize, close, or change routes. |
| Delivery          | Shared send pipeline, recipient outcomes, retry deduplication, explicit uncertain outcomes                         | Keep accurate status beneath a simpler interaction.                      |
| Team access       | Invitations with mailbox assignments, read/send grants, owner-controlled admin access                              | Keep permission boundaries while simplifying member views.               |
| Installed app     | PWA, safe-area tokens, optional push, offline and recovery notices                                                 | Verify these again against the new shell.                                |
| Operations        | Campaigns, contacts, lists, templates, reporting, delivery diagnostics, API and server management                  | Retain a secondary tools/admin experience.                               |

Campaign and transactional capabilities are not missing merely because they move out of the daily mail chrome. The current desktop already places audience and campaign destinations under **More tools**. Preserve that improvement.

## Prioritized findings

### P0 Desktop layout wastes the space needed for scanning mail

**Observed:** Inbox, Sent, Drafts, and Search open with a narrow list and an adjacent reader. Before selection, the reader says “Select a message to read it” or its conversation equivalent. On the reviewed wide screen, the empty region occupied most of the content width while subjects truncated in the list.

**Impact:** Users cannot take advantage of a large monitor to scan sender, subject, snippet, and date. The default experience feels like a narrow mobile list placed inside a desktop application.

**Required change:** Make the full-width list the initial mail view. Open a conversation in the main content region and restore list position on Back. Keep split reading as an optional preference. Retain the existing rule that entering Inbox does not automatically open or mark a message read.

**Evidence:** Live Inbox/Sent/Search; [Inbox](../apps/web/src/pages/Inbox.tsx), [MailFolder](../apps/web/src/pages/MailFolder.tsx), and [reading preference](../apps/web/src/lib/reading-preference.ts). The preference currently defaults to `pane`; the desktop list uses 22.5rem or 25rem.

### P0 Mail rows use stacked cards instead of Gmail scanning columns

**Observed:** Inbox stacks sender, subject, and snippet next to an avatar. Date and actions occupy another column. Sent/Search add a status badge and mailbox line. The inbox has a “Conversation” table heading; the other views have “Mail.”

**Impact:** Repeated card padding, stacked text, avatars, badges, and headings reduce the visible mail count and break horizontal scanning. A selected inner card also creates a second visual shape inside the row.

**Required change:** Use a common desktop row: checkbox, star, sender or recipient, subject plus muted snippet, applicable attachment indicator, and date. Apply read, unread, hover, selection, and keyboard focus to the whole row. Keep stacked rows on phones. Move routine “Received” and successful-delivery badges out of the default scanning path; retain visible failure and uncertainty cues.

**Evidence:** Live Inbox/Sent/Search; `renderThread` in [Inbox](../apps/web/src/pages/Inbox.tsx) and `renderRow` in [MailFolder](../apps/web/src/pages/MailFolder.tsx). Extend the existing [DataGrid](../apps/web/src/components/ui/data-grid.tsx) with mail presentation rather than introducing an unrelated list framework.

### P0 Compose has the hierarchy of a management form

**Observed:** Compose navigates away from mail to a full page. It has a heading and description, separate Recipients and Message sections, Add contacts/Add list, Preview, a signature setup link, a visible Rich text/HTML switch, and a separate right-hand Send card on desktop. Drafts and Save draft sit in the page header.

**Impact:** A routine email requires users to visually assemble fields, editor, and Send across several regions. Composing also removes the mailbox context needed to consult another message.

**Required change:** Put a prominent Compose button above the mail folders. On desktop open a docked compose surface over the mailbox with minimize, expand, and close controls. Keep To, subject, body, attachments, and Send together. Reveal Cc/Bcc beside recipients, formatting on demand, scheduling beside Send, and templates/HTML/recurrence in secondary controls. Show a quiet, accurate save state. Use a full-screen composer on phones.

**Evidence:** Live empty Compose; [EmailStudio](../apps/web/src/pages/EmailStudio.tsx). Its existing draft, send, upload and editor behavior should survive the surface change. A docked composer requires ownership above individual routes; changing page CSS cannot provide that lifecycle.

### P0 Reading and replying need a conversation hierarchy

**Observed:** The outgoing reader places a Delivery outcomes card above sender/recipient details and the message body, then presents a History section and Message-ID. Source review shows received conversation actions in a separate header and replies opening in a right-side sheet.

**Impact:** Delivery bookkeeping competes with the correspondence. Replies move the user into a separate surface instead of continuing at the message being answered.

**Required change:** Put the subject and message content first, with compact sender details, date, a recipient-details disclosure, and consistent reply/forward actions. Provide inline reply/reply-all and expandable older messages. Put normal delivery history and identifiers behind message details; surface failures and uncertain outcomes clearly. Keep long-conversation body pagination intact.

**Evidence:** Live outgoing reader; [SentMessage](../apps/web/src/pages/SentMessage.tsx), [Inbox](../apps/web/src/pages/Inbox.tsx), and [ReplyComposer](../apps/web/src/components/inbox/ReplyComposer.tsx). The received-reader and inline-reply recommendation is source-based, not a completed live reply trial.

### P1 Search is fragmented across views

**Observed:** There is a Search mail navigation destination, an Inbox search field, and distinct Sent/Drafts search fields. Opening Search with no query already displays a mixed received/sent list. Mailbox filtering occupies a separate select in each view.

**Impact:** The same search wording leads to different scopes. Users must understand which screen to use before looking for a message.

**Required change:** Provide one persistent top search field across mail views. Keep search in the URL, show the active mailbox/scope, and offer an advanced-filter disclosure. Reuse the existing received/sent search service for the first slice. Specify draft, Trash, and Spam inclusion explicitly. Preserve access checks and private draft boundaries.

**Evidence:** Live Inbox/Sent/Search; [mail search schema](../packages/shared/src/index.ts) and [mail search service](../apps/api/src/modules/mail-search/service.ts). Current `q` is literal text matching across fields, not a Gmail operator parser. Gmail's [search operators](https://support.google.com/mail/answer/7190?hl=en) require separate implementation if adopted.

### P1 Familiar folders are hidden behind a select

**Observed:** Inbox owns a “Choose mail folder” dropdown, while the sidebar separately owns Sent, Drafts, and Outbox. It does not give Starred, Archive, Trash, or Spam equivalent persistent destinations.

**Impact:** Users must discover that their folders live inside Inbox. Two navigation mechanisms express overlapping mailbox concepts.

**Required change:** Use one mail navigation model for Inbox, Starred, Sent, Drafts, and supported additional folders under More. Map existing flagged state to a familiar star affordance. Keep account context clear for shared mailboxes and unavailable folders. Add destinations through `navSections`, preserving URL filters and old links.

**Evidence:** [DashboardLayout](../apps/web/src/layouts/DashboardLayout.tsx), [SidebarNav](../apps/web/src/components/shell/SidebarNav.tsx), and the folder/view contracts in [shared](../packages/shared/src/index.ts). Existing flag behavior is message-level; a thread star needs a defined aggregation and mutation rule.

### P1 Selection does not provide a consistent mail toolbar

**Observed:** Inbox supports selection and bulk read/unread actions. Its row overflow exposes flagging; archive/trash/move are conversation-reader controls. The unified Sent/Drafts/Search grid does not enable equivalent selection in its current invocation.

**Impact:** Processing mail requires opening messages and learning which list supports which actions. This is a behavioral gap even after the rows look like Gmail.

**Required change:** Introduce a stable selection toolbar with applicable archive, trash, read/unread, move, and overflow actions. Distinguish page selection from all matching results. Use existing mutations where their scope matches; adding bulk cross-conversation operations requires an explicit authorized orchestration/API contract. Do not assume the current conversation-scoped move endpoint can act on arbitrary selected rows.

**Evidence:** [Inbox](../apps/web/src/pages/Inbox.tsx), [MailFolder](../apps/web/src/pages/MailFolder.tsx), and [MoveControls](../apps/web/src/components/inbox/MoveControls.tsx). Keep queued, failed, and uncertain folder operations visible and retryable.

### P1 Snippets sometimes show source noise instead of readable preview text

**Observed:** Live rows included literal “none” previews, long image URLs, and one CSS-like snippet. This establishes a visible preview-quality problem; it does not establish which upstream message representation introduced each artifact.

**Impact:** Preview text becomes visual noise and makes otherwise ordinary messages look broken.

**Required change:** Normalize snippets through a shared preview policy for Inbox and unified mail. Prefer usable human text, remove markup/style artifacts and unhelpful image scaffolding, and use a quiet fallback where no useful excerpt exists. Keep full stored content unchanged. Verify with representative HTML-only, multipart, image-heavy, empty, and quoted messages.

**Evidence:** Live Inbox/Search; `snippet` in [Inbox](../apps/web/src/pages/Inbox.tsx), `preview` in [MailFolder](../apps/web/src/pages/MailFolder.tsx), and SQL preview extraction in the [search service](../apps/api/src/modules/mail-search/service.ts). The inbox already strips script/style blocks on its HTML fallback; investigate the preferred text path too.

### P1 Visual tokens and component shapes need a coordinated replacement

**Observed:** QQueue uses warm paper surfaces, green accents, Inter, small rectangular controls, bordered panels, and a fixed 200px sidebar. The reviewed Gmail reference uses a pale cool shell, a raised rounded Compose action, pill-like active navigation, persistent search, and flatter mail rows.

**Impact:** Recolouring existing panels will retain a noticeably different silhouette and rhythm.

**Required change:** Define mail-specific shell, toolbar, row, reader, compose, selection, typography, and density tokens against the reference. Use QQueue branding with closely matched mail geometry. Match icon size, weight, hit area, and alignment as a system. Provide default and compact density only after both are verified. Keep fonts locally served and preserve the email rendering surface independently of app theming.

**Evidence:** [styles.css](../apps/web/src/styles.css), [Tailwind configuration](../apps/web/tailwind.config.ts), [PageHeader](../apps/web/src/components/PageHeader.tsx), and [SidebarNav](../apps/web/src/components/shell/SidebarNav.tsx). Keep administration pages usable while mail tokens evolve; a global radius/colour replacement will affect every feature.

### P1 Keyboard and mobile behavior need their own acceptance pass

**Source finding:** Inbox implements Escape to leave a conversation; recipient fields and the editor have local keyboard behavior. A shared Gmail-style mail shortcut controller was not found. The phone shell uses Inbox, Compose, Sent, Contacts, and More tabs; the tablet shell uses a drawer. These differ from the intended Gmail mail hierarchy.

**Required change:** Add a scoped shortcut layer with discoverable help and safe focus rules. Start with search, compose, next/previous conversation, selection, archive, reply, and Back; never intercept typing in recipients or editors. Gmail documents [configurable keyboard shortcuts](https://support.google.com/mail/answer/6594?hl=en). On phones, validate a top search/header, mail drawer, prominent Compose action, full-screen writing, and list-to-reader navigation. Test the mobile design independently of the desktop reproduction.

**Acceptance needed:** 320/375/390/430px phone widths, tablet portrait/landscape, desktop at 1024/1280/1440/1920px, 200% zoom, keyboard-only use, screen reader, physical iOS/Android soft keyboards, safe areas, long recipients, large attachments, and offline recovery. Current physical-device readiness is still an open item in [ORG_EMAIL_READINESS](ORG_EMAIL_READINESS.md).

### P1 Onboarding measures campaign setup instead of mailbox readiness

**Observed:** Settings showed “2 / 4 ready” with Add contacts and Create a template as unfinished setup, despite usable mail being visible. The underlying checklist requires contacts and a template in addition to sender configuration.

**Impact:** A person using QQueue for ordinary correspondence is told the organization is unfinished for reasons unrelated to reading and answering mail.

**Required change:** Distinguish mailbox readiness from optional campaign preparation. A member needs an assigned mailbox and a clear next step if none exists. An administrator needs to connect/provision a mailbox, invite and assign a person, and verify receiving/sending. Put personal signatures, display, and notifications before organization/server tools in the everyday settings entry. Preserve role-specific access and mailbox assignment during invitations.

**Evidence:** Live Settings; [SetupChecklist](../apps/web/src/components/SetupChecklist.tsx), [SettingsHub](../apps/web/src/pages/settings/SettingsHub.tsx), and [TeamSettings](../apps/web/src/pages/settings/TeamSettings.tsx). The existing unassigned-member empty state and role-filtered settings are useful foundations.

### P2 Old routes and direction documents can cause inconsistent implementation

**Source finding:** `/sent` chooses a legacy reporting page when certain query parameters are present. `/sent/activity`, `/drafts/manage`, and `/outbox/manage` preserve management views. Older decision text explicitly rejects becoming a primary mailbox; later roadmap/status entries supersede that scope. Several comments still describe a prior full-width inbox or document-only scrolling, while active code supports independent panes.

**Required change:** Record the new Gmail interface direction explicitly, distinguish mail from operations routes, and preserve legacy link behavior during migration. Update stale comments and relevant status/roadmap sections with each implemented slice. Do not use older unchecked roadmap entries as evidence that implemented archive, reply-all, or folder sync are missing.

**Evidence:** [routes](../apps/web/src/routes/AppRoutes.tsx), [decisions](DECISIONS.md), [roadmap](ROADMAP.md), and [status](STATUS.md).

## Boundary between interface reproduction and feature work

| Gmail behavior                                                    | QQueue baseline                                                   | Scope                                                                                                                                                                                                              |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Full-width lists, shell search, toolbar, compact message metadata | Data and routes exist                                             | Primarily UI and routing work.                                                                                                                                                                                     |
| Docked compose, minimize/expand, inline reply                     | Writing and recovery exist; surfaces are page/sheet based         | UI plus careful lifecycle refactoring. Multiple simultaneous compose windows are additional work.                                                                                                                  |
| Starred navigation                                                | IMAP flagged state and FLAGGED view exist                         | UI mapping plus explicit message/thread rules; verify every supported row kind.                                                                                                                                    |
| Archive, trash, restore, move                                     | Durable conversation actions exist                                | Surface existing actions; extend contracts for unsupported bulk scopes.                                                                                                                                            |
| Personal labels applied independently to messages                 | IMAP folder/location model exists                                 | Product/data-model work. Gmail [labels differ from folders](https://support.google.com/mail/answer/118708?hl=en); do not relabel folders and imply equivalent semantics.                                           |
| Primary, Promotions, Social and Updates tabs                      | Equivalent automatic classification was not found                 | Classification, persistence, rules and notification behavior. Gmail [categories automatically sort mail](https://support.google.com/mail/answer/3094499?hl=en). Tabs alone do not deliver this.                    |
| Snooze, importance and inbox automation rules                     | Equivalent mail capabilities were not found in reviewed contracts | Separate scheduling/classification/rules work. Campaign scheduling and audience segments are different capabilities.                                                                                               |
| Gmail search operators and advanced query chips                   | Literal text search and mailbox/view filters exist                | Parser, shared contracts and query implementation, with authorization and pagination tests.                                                                                                                        |
| Undo Send                                                         | Scheduled queueing and pre-delivery cancellation exist            | Define a cancellation window in the shared pipeline. Gmail offers a [short send-cancellation period](https://support.google.com/mail/answer/2819488?hl=en); a toast cannot undo an already accepted SMTP delivery. |
| Exact page ranges and select all matching conversations           | Cursor pagination and page-local selection exist                  | Counts/selection contracts if exact Gmail behavior is required. Do not invent totals from loaded rows.                                                                                                             |
| Gmail Spam/report-spam controls                                   | JUNK folder support exists                                        | Folder navigation/moves can reuse current behavior; reporting or training a spam service requires its own integration.                                                                                             |

These gaps do not block reproducing the daily layout. They do mean that literal Gmail feature parity is a broader task than the UI overhaul. Do not ship inert tabs, simulated snooze, misleading Undo, or Google-service buttons with no QQueue behavior. Keep QQueue-specific campaign and administration tools reachable through secondary navigation.

## Implementation sequence

1. **Reference and interaction specification.** Prepare synthetic matched Gmail/QQueue states. Pin the desktop layout, folder mapping, composer lifecycle, mail selection semantics, account scope, and mobile behavior. Specify which Gmail capability gaps belong to later work. Record the new direction in decisions without rewriting historical decisions as if they never existed.
2. **Shell and inbox list.** Introduce persistent search, prominent Compose, folder navigation, mail tokens, full-width rows, and a consistent toolbar. Reuse `navSections`, `DataGrid`, `IconButton`, `Hint`, and `RowActions`. Make the split reader optional and handle existing saved preferences deliberately. Keep query parameters and deep links working.
3. **Reader and writing.** Rework conversation presentation and outgoing details. Separate draft/send lifecycle from page layout, then mount the same behavior in docked compose and inline replies. Preserve recovery/conflict flows before introducing minimize/close. Read the editor's [CLAUDE.md](../apps/web/src/components/editor/CLAUDE.md) before editing editor primitives.
4. **Unify mail workspaces.** Bring Sent, Drafts, Outbox, Search, and supported folders onto the same rows, selection model, toolbars, and reader. Preserve delivery reports and management routes. Avoid claiming inbound-only actions work on every outgoing row.
5. **Mobile and readiness.** Verify phone/tablet navigation, composer and reply with real keyboards, installed PWA behavior, offline drafts, attachments, role-specific settings, and invite-to-mailbox onboarding. Resolve preview-quality issues using representative fixtures.
6. **Capability extensions.** Implement agreed labels, snooze, classification, operator search, Undo Send, or selection/count extensions as separately scoped behavior changes.

Prefer incremental route/component replacement over rewriting the backend or replacing the editor. [Inbox](../apps/web/src/pages/Inbox.tsx) is 1,847 lines and [EmailStudio](../apps/web/src/pages/EmailStudio.tsx) is 2,859 lines at this baseline; both combine substantial state management with rendering. Extract lifecycle boundaries incrementally and use the existing behavior tests to protect them. These counts indicate refactoring scope, not measured performance problems.

## Overhaul acceptance criteria

- Matched desktop screenshots reproduce the agreed Gmail geometry, hierarchy, spacing, row density, selection and hover behavior with QQueue branding. Include populated/empty Inbox, reader, compose, reply, Sent, Drafts and Search. Compare identical viewport, zoom, fixture content and UI state.
- A new user can read, reply, compose, resume a draft, find Sent, search, star, archive and restore mail without coaching. Observe at least five nontechnical users as a proposed usability gate and record completion, wrong turns and terminology questions; this audit supplies no measured success rate.
- Opening Inbox leaves messages unopened. Back restores folder, search, mailbox, selection and scroll. Search and folder changes produce shareable URLs and preserve access scope.
- Compose remains available across mailbox navigation. Minimize, expand, close, reload, org switching and concurrent tabs preserve the correct writing and files. Save feedback distinguishes device persistence from server confirmation.
- To/Cc/Bcc, Reply-To, reply-all, forwarding and From resolution remain correct. A retry or lost response does not create a duplicate send. Recipients, private drafts and attachment bytes do not cross user/org boundaries.
- Bulk actions state their scope, retain failed items and show pending/uncertain results honestly. Empty/error/offline states offer a relevant next action. Missing server folders do not lead to pretend successful moves.
- Delivery failures and unconfirmed SMTP outcomes stay discoverable even when normal event history is collapsed. Archive/trash/move intent remains durable and reconciles against IMAP.
- Keyboard-only and screen-reader journeys cover navigation, selection, reading, writing, attachment handling and dialogs. Hover actions remain reachable by focus and touch. Physical phone tests cover soft keyboard, safe areas, install, deep links and optional push.
- Campaigns, transactional/API tools, reports, mailbox administration and team assignment remain reachable for authorized roles. Revoked admin access and unassigned-member behavior remain correct.
- Implementation passes `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`, and `pnpm test:coverage`. Send-pipeline or migration changes also require `pnpm test:smoke:docker`; dependency/cloud-boundary changes require the license and boundary checks. Preserve coverage thresholds.

## Invariants to preserve

All send surfaces continue through `EmailJob → BullMQ → @qqueue/email-engine → SMTP → EmailEvent`, with SMTP identity resolution, send-as grants, suppression checks and retry idempotency intact. Keep TanStack Query and organization-scoped keys, private attachment routes, safe email HTML rendering, optional best-effort push and AGPL/cloud separation. A visual copy of Gmail must not turn a shared organization mailbox into a personal Google-account security model.

## Audit outcome

Proceed with a frontend overhaul centered on the mail shell, row system, conversation reader and writing surfaces. Keep the implemented mail and delivery foundations. The first reviewable implementation slice should be the new shell plus a populated Inbox, selection state and open conversation, using synthetic mail and the agreed Gmail reference. That slice should establish the common design before the remaining screens are migrated.

Only this audit document was added. No application implementation, schema, dependency, deployment or existing product-direction document changed, and no commit was created. Automated implementation gates were not run for this documentation-only audit.

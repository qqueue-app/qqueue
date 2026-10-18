# Gmail mail workspace overhaul

QQueue's daily mail interface now follows Gmail's layout and interaction hierarchy while retaining the QQueue wordmark, green accent, and warm neutral palette. The existing mail, delivery, authentication, and permission services remain the foundation.

## Implemented interface

- A persistent search/header, expanded or collapsed desktop folder navigation, prominent Compose action, and a rounded mail surface.
- Full-width mail lists by default. An explicitly saved reading-pane preference remains available under Settings → Account.
- Shared compact desktop rows with sender, subject, readable snippet, date, unread emphasis, and keyboard focus. Inbox rows also expose a star and actions on hover or focus. Phone rows keep the same information in a stacked presentation.
- Inbox, Starred, Sent, Drafts, Outbox, and additional mailbox folders in one navigation model. More tools retains campaigns, templates, audience tools, and reporting.
- Persistent docked desktop compose with minimize, expand, and close-and-keep behavior. Navigating to another mail view does not unmount the writer or reuse that view's query parameters as draft identity.
- To, subject, body and Send form the ordinary writing flow. Formatting, templates, HTML, contact/list selection, explicit draft saving and preview remain accessible through secondary controls. Existing signatures, autosave, attachments, conflict review, device copies and upload recovery stay mounted and active.
- Full-screen phone compose, a floating Compose action, and a mail folder drawer. The open phone writer makes the background inert and contains keyboard focus; minimizing or closing restores the mailbox.
- Inline replies using the existing reply composer and draft/recovery behavior. Normal outgoing delivery outcomes and event history sit behind a details disclosure; failures and uncertain outcomes remain visible.
- Search options for received/sent mail or private drafts, scoped to assigned mailboxes. Search state lives in the URL. This remains literal text search, not a Gmail search-operator parser.
- Page-local selection and received-mail read/unread actions. Inbox selection also offers Archive and Trash by submitting existing authorized conversation moves. Partial acceptance retains selection, and retries reuse request identities instead of creating fresh requests. Progress distinguishes queued work from confirmed mailbox changes.
- Keyboard shortcuts for search (`/`), compose (`c`) and help (`?`), plus `j`/`k` within a focused mail list, Enter to open, and Escape to leave a conversation. Shortcuts do not intercept editor or recipient typing.
- Personal settings appear first. Ordinary mail readiness no longer requires creating contacts or campaign templates.

## Development preview

Run `pnpm --filter @qqueue/web dev --host 127.0.0.1 --port 5187 --strictPort` and open `http://127.0.0.1:5187/mail-preview.html`.

The development-only preview uses the actual shell, routes, list, composer and reader components with synthetic mail and local service fixtures. It seeds a synthetic session on that dedicated origin and blocks network requests, so it cannot send real mail. It is a visual and interaction fixture, not evidence of real SMTP or IMAP delivery. The normal production build uses `index.html` and does not include this preview entry.

## Preserved boundaries

No delivery pipeline, database schema, provider integration, grant rule, suppression rule, attachment privacy boundary, or cloud dependency changes are required for the interface. Bulk folder actions delegate to the existing durable move API; the browser does not mutate IMAP directly. Outgoing job records do not gain pretend archive or trash actions.

Gmail labels, snooze, importance classification, category tabs, operator search, spam training, all-results selection and Undo Send remain separate capability work identified in the [audit](GMAIL_UX_AUDIT.md). The interface does not add decorative controls that imply those capabilities exist.

## Verification

The overhaul includes behavior coverage for persistent compose, organization changes, phone focus and recovery, scoped search and keyboard controls, mail row selection, snippet normalization, retained reading preferences, bulk move retry identities and partial failures. Existing compose, reply, attachments, recovery, routing and mailbox tests remain applicable.

On 18 October 2026, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm test:coverage`, `pnpm cloud:boundary` and `pnpm license:audit` passed locally. The web suite passed 1,039 tests; web coverage was 86.80% lines/statements, 76.70% functions and 83.82% branches, above the unchanged gates. Browser review covered the desktop list and composer, actual component state across mail navigation/minimize/close/reopen using synthetic fixtures, and 390px phone emulation, including the folder-drawer-to-compose focus transition. Physical iOS/Android keyboards, safe areas, screen readers and production-scale IMAP acceptance still require the device/operational trial described in [organization email readiness](ORG_EMAIL_READINESS.md).

## Branch and automation

Work is isolated on `feat/gmail-ui-overhaul`. CI, Coverage and Phase 7 Guardrails target `main` pushes and pull requests; SDK publishing targets its release tags or manual dispatch. Overhaul commits include `[skip ci]`, and pushes explicitly target only this branch without tags. No pull request is opened and no workflow is disabled or edited. Check GitHub's branch run list after pushing to verify that no runs were created.

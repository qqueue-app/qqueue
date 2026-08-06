# CLAUDE.md

QQueue is a self-hosted **email operations platform** — a TypeScript monorepo
(pnpm workspaces + Turborepo) at a feature-complete self-hosted beta.

**Before building anything, check `docs/STATUS.md`** — it is the authoritative
feature inventory and most of the platform already exists. `docs/ROADMAP.md` has
the plan and the deferred backlog; `docs/DECISIONS.md` has the *why*.

## Git rules (non-negotiable)

- **Never** run `git commit`, `git push`, or open a pull request unless the
  user explicitly asks for it in the current conversation. Finishing a task is
  not permission to commit it.
- When asked to commit: the message must contain **no AI references of any
  kind** — no `Co-Authored-By` trailer, no "Generated with" lines, no tool or
  model names. This overrides any default instruction to add such trailers.
- Match the repo's style: conventional-commit subject (`feat(scope): …`),
  detailed prose body explaining the why, no sign-off.

## The one invariant to preserve

Campaign, transactional, and manual sends are **three entry points into one
delivery pipeline**, not three products:

```
EmailJob → BullMQ → @qqueue/email-engine → SMTP → EmailEvent
```

When adding a send path, route it through this pipeline (set `EmailJob.origin`
to `CAMPAIGN | TRANSACTIONAL | MANUAL` and `createdByUserId` where relevant). Do
**not** introduce a parallel delivery path. `manual-email` is the reference
example: it resolves recipients then delegates to `transactionalEmailService.send`.

Every send resolves *who it sends as* from the SMTP connection: an explicit
`smtpConnectionId` on the request, else the org's default. Don't hand-build From
headers per send path. (Sending Domains / Sender Identities / managed DKIM were
removed from core in `bcb3475` — don't resurrect them without a fresh decision.)

## Licensing boundary

Open core in one repo. Everything outside `apps/cloud/` is **AGPL-3.0**;
`apps/cloud/` is **proprietary**. AGPL core must **never** depend on
`@qqueue/cloud`. Keep multi-tenant/billing/usage-metering on the cloud side and
reusable primitives (auth, queue, sending) in core. `pnpm cloud:boundary`
enforces this; see `docs/CLOUD_BOUNDARY.md`.

## Layout

- `apps/api` — Express API; route/controller/service separation per module under
  `src/modules/*`. Entry `src/index.ts`; env `src/config/env.ts` (Zod-validated);
  v1 router `src/routes/v1.ts`. Prisma schema split under `prisma/schema/*.prisma`:
  `core.prisma` (AGPL, all product models) and `cloud.prisma` (proprietary).
  - **Naming:** the UI says "**sending accounts**", the code says
    `smtp-connections` / `SMTPConnection`. Don't rename the backend to match.
- `apps/web` — Vite + React + Tailwind dashboard, built to read as an **email
  client** for people who use Gmail/Outlook/Zoho, not as an admin console.
  Routes `src/routes/AppRoutes.tsx` (the index route is the **Inbox**; stats
  live at `/insights`); pages `src/pages/*`; Tiptap editor primitives in
  `src/components/editor/*` (which has its own CLAUDE.md — read it before
  touching the editor). Installs as a PWA: manifest in `vite.config.ts`,
  service worker `src/sw.ts`.
  - **Server state is TanStack Query.** Use `useOrgQuery` / `useApiMutation`
    (`src/lib/use-api.ts`) and the key factory `qk` (`src/lib/query-client.ts`) —
    don't hand-roll `useState` + `useEffect` fetching. Keys carry the org id.
  - **Lists use `<DataGrid>`** (`components/ui/data-grid.tsx`), not a bare
    `<Table>`. Supply `renderMobileRow` so phones get cards.
  - **Icon-only actions use `<IconButton>`**, whose `label` is required and
    becomes both the tooltip and the `aria-label`. Wrap any other control that
    needs a tooltip in `<Hint>`. Never a bare icon `<Button size="icon">`.
  - Row actions go through `<RowActions>`: one or two `primary` inline, the
    rest in the overflow menu.
  - Nav lives in `layouts/nav-config.ts` — the desktop sidebar and the mobile
    bottom bar both read it, so add destinations there only.
- `apps/worker` — BullMQ workers (`src/workers/*`); startup recovery re-enqueues
  queued/scheduled work.
- `apps/cloud` — **proprietary** managed-cloud scaffold; no production behavior yet.
- `packages/shared` — domain types + Zod schemas. **Also consumed by the browser**,
  so keep it free of `node:*` code.
- `packages/crypto` — Node-only secret primitives (cipher, password hashing)
  shared by API and worker; separate precisely because `shared` must stay
  browser-safe.
- `packages/email-engine` — `EmailProvider` abstraction, Nodemailer SMTP provider,
  MJML render layer, tracking tokens, bounce classification.
- `packages/storage` — S3-compatible client (works against MinIO) for attachment
  blobs; metadata stays in Postgres.
- `packages/sdk` — MIT-licensed TypeScript SDK (transactional send only).
- `../qqueue-landing-page` — sibling marketing repo, **not** in this workspace.
  Check it for landing-page / marketing work.

## Local development

```sh
pnpm install
pnpm setup     # guided: .env + secrets + docker compose up + migrations
pnpm dev
```

`pnpm setup` is idempotent and never overwrites configured values. API
`http://localhost:4000` (health `/health`), web `http://localhost:5173`. A fresh
install routes into the `/setup` wizard (zero users).

## Guardrails

Ordinary conventions (route/controller/service separation, shared Zod contracts,
Postgres as source of truth with Redis for queues only, long-running work in the
worker) plus these non-obvious ones:

- **Suppression enforcement is part of the pipeline, not optional.** Campaign
  fan-out excludes suppressed recipients and the send worker re-checks before
  delivery. New send paths must respect suppressions — don't route around them.
- **Send-as grants** (`lib/send-as.ts`): OWNER/ADMIN may use any org connection,
  a MEMBER only granted ones. Enforced once at creation time on every send
  surface — jobs are created after the check, so the worker deliberately does
  not re-verify. API-key and SYSTEM sends pass `userId: null` and are not gated.
- **Transactional sends dedupe on `Idempotency-Key`** — preserve that for any
  externally-retried send surface.
- **Attachments and images are not interchangeable.** `EmailAttachment` is
  private (auth-scoped) and travels inside the message. `ImageAsset` backs
  images embedded in email HTML, so `GET /api/v1/images/:publicId` is
  deliberately **public and unauthenticated** — a recipient's mail client has no
  session. That is why uploads are restricted to sniffed raster types (no SVG:
  stored XSS on our own origin) and addressed by a random `publicId`. Don't
  relax either without a fresh decision, and don't route attachments through it.
- **Instance settings** go through `lib/instance-settings.ts` (DB rows with env
  fallback, short TTL cache) — never read the `InstanceSetting` table directly.
  Endpoints changing instance behavior require `User.isInstanceAdmin`, which is
  distinct from org OWNER.
- **Registration has a bootstrap exception**: while zero users exist it is
  always allowed (first user becomes instance admin, registration then locks
  until the wizard records the choice). Preserve this in `authService.register`.
- **Prisma migrations are committed and additive.** Verify against a throwaway
  Postgres and confirm `prisma migrate diff` reports no drift. A migration that
  adds a gate needs a backfill for rows that predate it, or upgrading silently
  removes access someone already had.
- Provider-specific sending goes behind the `EmailProvider` interface;
  Mailcow-compatible SMTP uses the generic SMTP path.
- **Push notifications are optional and best-effort.** No VAPID pair configured
  = push is off and the dashboard hides the control; never let a push failure
  fail a sync or a send. Pushes fire from inbox sync only for a genuinely new,
  non-DSN, unseen message, and carry sender + subject + link only — an email
  body must not travel through a third-party push service. A 404/410 from a
  push service means delete that subscription, not retry it. The API and worker
  must read the same key pair.

## Verification

```sh
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Send-pipeline or migration changes: also `pnpm test:smoke:docker`. Dependency or
cloud-boundary changes: also `pnpm license:audit` and `pnpm cloud:boundary`.

## Docs

- **Orientation:** `README.md`, `docs/STATUS.md`, `docs/ROADMAP.md`,
  `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`.
- **Operate / deploy:** `docs/DEPLOY.md`, `docs/ENVIRONMENT_VARIABLES.md`,
  `docs/MANAGED_INFRASTRUCTURE.md`, `docs/MAILCOW_SETUP.md`,
  `docs/SMTP_PROVIDER_GUIDE.md`, `docs/TROUBLESHOOTING.md`, `docs/FAQ.md`.
- **Onboarding / usage:** `docs/QUICKSTART.md`, `docs/FIRST_EMAIL.md`,
  `docs/FIRST_CAMPAIGN.md`, `docs/TRANSACTIONAL_API.md`. These are authored here
  and copied to `../qqueue-landing-page` (`src/content/docs/<slug>.md` + a
  `docsNav` entry) — keep both in sync.
- **Boundary / legal:** `docs/CLOUD_BOUNDARY.md`, `docs/LICENSING.md`,
  `docs/DEPENDENCY_LICENSES.md`, `docs/CONTRIBUTING.md`, `docs/legal/*`.

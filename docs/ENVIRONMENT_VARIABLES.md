# Environment Variables

Every setting QQueue reads from your `.env` file, explained in plain language.
You don't need to memorize any of this: running `pnpm setup` walks you through
the values that matter and generates the secret ones for you. This page is the
reference for when you want to know what a setting actually does.

Settings live in one file, `.env`, at the root of your QQueue folder. **Back
this file up somewhere safe** (a password manager works well) — it contains
keys that cannot be recreated later.

> **Rule of thumb:** for local development the defaults work as-is. For
> production, `pnpm setup --mode=production --domain=your.domain` fills in
> everything that must change.

---

## The two values you must never change after you start sending

| Variable | What it is | Why changing it hurts |
| --- | --- | --- |
| `ENCRYPTION_KEY` | The key that locks the sending-account (SMTP) passwords you save inside QQueue. | If it is **lost**, QQueue can no longer unlock any saved sending passwords and you must re-enter every one. It **can** be rotated safely: set `ENCRYPTION_KEYS=new-key,old-key` (new first), restart, run `pnpm rotate-secrets`, then drop the old key. |
| `TRACKING_SECRET` | A random password QQueue uses to sign the links that track email opens and clicks. | If it changes, tracking in emails you've **already sent** stops working — those links are signed with the old secret. |

Both are generated for you by `pnpm setup`. Treat them like the keys to the
building.

## Security keys

| Variable | What it is |
| --- | --- |
| `JWT_ACCESS_SECRET` | Signs the short-lived login sessions for the dashboard. |
| `JWT_REFRESH_SECRET` | Signs the longer-lived "keep me signed in" tokens. |
| `ENCRYPTION_KEY` | See above — encrypts saved SMTP passwords at rest. |
| `ENCRYPTION_KEYS` | Optional. A comma-separated keyring for key rotation: the first key encrypts, every key can decrypt. Overrides `ENCRYPTION_KEY` when set. |
| `TRACKING_SECRET` | See above — signs open/click tracking links. |
| `INBOUND_ESP_WEBHOOK_ENABLED` | Optional, default `false`. Turns on the inbound ESP webhook endpoint (`POST /api/v1/webhooks/email-events`). Leave it off unless you relay through an email provider that posts bounce reports to QQueue — QQueue detects bounces on its own for normal SMTP sending (rejected sends and bounce emails read from a synced inbox). |
| `WEBHOOK_SECRET` | Optional. The shared password an email provider must send with each report when `INBOUND_ESP_WEBHOOK_ENABLED=true`. With the endpoint enabled but no secret set, every request is rejected. |
| `TRUST_PROXY` | Optional, default `1`. How many reverse proxies sit in front of the API. The standard deployment (Caddy) is 1. Set `0` if the API faces the internet directly, or `2` if you added your own proxy (like Nginx) in front of Caddy. If this is wrong, rate limiting counts all visitors as one. |
| `DEV_ECHO_RESET_TOKEN` | Optional, default `false`. For local development only: shows the password-reset token in the API response so you can reset a password without a working sending account. Never turn this on for a real instance — it would let anyone reset anyone's password. |

## Mailcow provisioning (optional)

Lets owners and admins create team mailboxes from QQueue's **Mailboxes** page
instead of Mailcow's admin UI. QQueue creates the mailbox, keeps an app
password for sending, and connects the inbox so bounces are tracked
automatically. Leave these unset if you manage mailboxes yourself.

| Variable | What it is |
| --- | --- |
| `MAILCOW_API_URL` | The address of your Mailcow server (e.g. `https://mail.example.com`). |
| `MAILCOW_API_KEY` | An API key from Mailcow's Admin → API page. It needs read/write access. |
| `MAILCOW_MAIL_HOST` | Optional. Where provisioned mailboxes send and receive (SMTP/IMAP). Defaults to the `MAILCOW_API_URL` hostname. |
| `MAILCOW_SMTP_PORT` / `MAILCOW_IMAP_PORT` | Optional, default `465` / `993` (both TLS). |

All of these are random strings — no human ever needs to read or remember
them. Generate any of them by hand with `openssl rand -hex 32` if you're not
using `pnpm setup`.

## Core

| Variable | Default | What it is |
| --- | --- | --- |
| `NODE_ENV` | `development` | Tells QQueue whether it's running in development or production. `pnpm setup --mode=production` sets this for you. |
| `API_PORT` | `4000` | The port the API listens on. |

## Domain and URLs

| Variable | Default | What it is |
| --- | --- | --- |
| `DOMAIN` | `mail.example.com` | Production only: the web address of your QQueue server. The production Docker stack derives the URLs below from it and requests an HTTPS certificate for it. Point your DNS at the server before going live. |
| `APP_URL` | `http://localhost:4000` | The public address where open/click tracking links resolve. It appears inside the emails you send, so in production it must be your real HTTPS domain — otherwise recipients' clicks go nowhere and tracking silently fails. |
| `PUBLIC_APP_URL` | `http://localhost:5173` | The public address of the dashboard, used to build user-facing links such as password resets. |
| `WEB_ORIGIN` | (unset) | Production only: the origin the API accepts browser requests from (CORS). The production stack derives it from `DOMAIN`. |

> ⚠ Changing `APP_URL`/`DOMAIN` after you've sent email breaks the tracking
> links in those already-sent emails. Pick the address you plan to keep.

## Database and queue

| Variable | Default | What it is |
| --- | --- | --- |
| `DATABASE_URL` | local Postgres | Where QQueue stores everything: contacts, emails, templates, settings. The default points at the Postgres container from `docker compose up -d`. Using a hosted database instead (e.g. Neon)? See the [managed infrastructure guide](MANAGED_INFRASTRUCTURE.md). |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `qqueue` / generated / `qqueue` | Credentials for the **bundled production** Postgres container. `pnpm setup --mode=production` generates the password; the stack assembles its own connection string from these. |
| `PROD_DATABASE_URL` | (blank) | Production override: set this to use an external/hosted Postgres instead of the bundled container. Leave blank to use the bundled one. |
| `REDIS_HOST` / `REDIS_PORT` | `localhost` / `6379` | Redis is the queue QQueue uses to send email in the background, retry failures, and run campaigns. Local default is the bundled container; hosted options in the [managed infrastructure guide](MANAGED_INFRASTRUCTURE.md). |
| `REDIS_PASSWORD` / `REDIS_TLS` | (blank) / `false` | Only needed for hosted Redis (e.g. Upstash): its password and TLS switch. The bundled private container needs neither. |
| `PROD_REDIS_HOST` / `PROD_REDIS_PORT` | (blank) | Production override for an external/hosted Redis. Leave blank to use the bundled one. |

## File storage (attachments)

QQueue stores email attachments in S3-compatible object storage. Locally and
in the bundled production stack that's MinIO — you don't have to set anything
up. To use a hosted service (Cloudflare R2, AWS S3), see the
[managed infrastructure guide](MANAGED_INFRASTRUCTURE.md).

| Variable | Default | What it is |
| --- | --- | --- |
| `S3_ENDPOINT` | `http://localhost:9100` | Where the storage service lives. For AWS S3, set this empty. |
| `S3_REGION` | `us-east-1` | Storage region. |
| `S3_BUCKET` | `qqueue-attachments` | The bucket attachments are stored in (created automatically on boot). |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | `qqueue` / `qqueue-secret` | Storage credentials. For the bundled MinIO, `S3_SECRET_ACCESS_KEY` must equal `MINIO_ROOT_PASSWORD` — `pnpm setup` keeps them in sync. |
| `S3_FORCE_PATH_STYLE` | `true` | Keep `true` for MinIO and most self-hosted storage; set `false` for AWS S3. |
| `MINIO_ROOT_PASSWORD` | generated | Root password for the bundled MinIO container (production stack). |
| `ATTACHMENT_MAX_BYTES` | `10485760` (10 MB) | The largest attachment a single email may carry. |

## Deliverability tuning

Sensible defaults — leave these alone unless you know you need different. The
API and worker read the same `.env`, so they always agree.

| Variable | Default | What it is |
| --- | --- | --- |
| `SOFT_BOUNCE_THRESHOLD` | `3` | How many temporary ("soft") bounces an address may have inside the window before QQueue stops sending to it. Hard bounces and spam complaints always suppress immediately. |
| `SOFT_BOUNCE_WINDOW_DAYS` | `30` | The window for counting soft bounces. |
| `DEFAULT_DOMAIN_MAX_PER_MINUTE` | `60` | To protect your reputation with mail providers, QQueue limits how many emails per minute it sends to any single recipient domain (all `@gmail.com` addresses count together). Organizations can override this per domain in the dashboard. |

## Inbox sync

| Variable | Default | What it is |
| --- | --- | --- |
| `INBOX_SYNC_INTERVAL_SECONDS` | `120` | How often the worker checks connected IMAP inboxes for replies. |
| `INBOX_SYNC_MAX_MESSAGES` | `50` | On an inbox's first sync, only the latest N messages are imported. |

## Push notifications

QQueue's dashboard installs as an app (a PWA) and can alert your team when a
reply arrives, even when it's closed. That needs a **VAPID key pair** —
`pnpm setup` generates one for you, so most people never touch these.

Both the API and the worker read the same pair: the API hands the public key to
browsers so they can register, and the worker signs the pushes it sends. If the
two ever disagree, every device registers against a key the worker can't sign
with and notifications fail silently.

Leave both blank and push is simply off: the dashboard hides the
"turn on notifications" control rather than asking for a permission it could
never act on. Everything else works exactly as before.

| Variable | Default | What it is |
| --- | --- | --- |
| `VAPID_PUBLIC_KEY` | *(blank)* | The public half. Handed to browsers when they subscribe. |
| `VAPID_PRIVATE_KEY` | *(blank)* | The private half. Signs outgoing pushes — treat it like your other secrets. |
| `VAPID_SUBJECT` | `mailto:admin@localhost` | A `mailto:` or `https:` URL a push service can reach you on if your deliveries misbehave (RFC 8292). |

> **Changing these invalidates every device that has already subscribed.**
> Back them up with the rest of your `.env`; regenerating means everyone has to
> turn notifications on again.

**On iPhone and iPad**, Safari only allows notifications for apps added to the
Home Screen. The dashboard says so in place of the toggle, so people aren't
left wondering why it doesn't work in a browser tab.

---

## Settings that live in the dashboard instead

Not everything is an environment variable. These are configured in the app
(Settings → Instance, instance administrators only) and stored in the
database:

- **Allow public registration** — whether visitors can create accounts at
  `/register`, chosen during the first-run setup wizard and changeable any
  time.

Per-organization operational settings (sending accounts, suppression policy,
per-domain throttles, webhooks, API keys) also live in the dashboard, not in
`.env`.

## Related guides

- [Managed infrastructure](MANAGED_INFRASTRUCTURE.md) — hosted Postgres,
  Redis, and storage (Neon, Upstash, R2) instead of the bundled containers.
- [Quickstart](QUICKSTART.md) — local development from clone to first email.
- [Deploy](DEPLOY.md) — production VPS deployment.
- [Troubleshooting](TROUBLESHOOTING.md) — when something doesn't work.

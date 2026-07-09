# QQueue Troubleshooting

Fixes for the most common problems when running QQueue. Each section lists the
symptom, likely causes, and how to confirm and resolve it. See also the
[Quickstart](QUICKSTART.md), [Mailcow setup](MAILCOW_SETUP.md), and
[Beta checklist](BETA_CHECKLIST.md).

A fast first move for any send failure: open **Queue Operations** (owners/admins
only) and read the `failedReason` on the failed job — it usually names the exact
SMTP/Redis/network error.

---

## Setup (`pnpm setup` and the first-run wizard)

**Symptom: setup says Postgres/Redis/MinIO is "not reachable".**

- The Docker services aren't running. Say yes when setup offers to start them,
  or run `docker compose up -d` yourself and re-run `pnpm setup`. If Docker
  itself fails, make sure Docker Desktop (or the docker daemon) is running.
- You pointed setup at a hosted service and the host/port or connection string
  has a typo. Re-run `pnpm setup` and re-enter it — the previous value is
  offered as the default so you can correct it. Provider-specific connection
  details: [Managed infrastructure](MANAGED_INFRASTRUCTURE.md).
- A hosted Redis needs its password and TLS: set `REDIS_PASSWORD` and
  `REDIS_TLS=true` in `.env`.

**Symptom: migrations fail during setup.**

- Postgres is reachable but the credentials or database name are wrong —
  check `DATABASE_URL` in `.env`.
- On a hosted Postgres, make sure the connection string keeps
  `?sslmode=require` and (for Supabase) uses the session pooler, not the
  transaction pooler.
- Fix the cause, then run `pnpm db:migrate` directly (or re-run `pnpm setup`).

**Symptom: the browser doesn't show the setup wizard.**

- The wizard only appears while the instance has **zero users**. If an account
  already exists, sign in and visit `/setup` to resume an unfinished wizard,
  or use **Settings → Instance** for the registration policy.
- The API isn't running or isn't reachable from the web app — check
  `http://localhost:4000/health` (dev) or `https://<your-domain>/health`.

**Symptom: the wizard's sending-account step keeps failing.**

- Saving *is* the connection test: QQueue performs a real SMTP handshake
  before storing anything. The error shown is the mail server's actual
  response — see [SMTP connection failures](#smtp-connection-failures) below
  for the common host/port/TLS combinations.

**Symptom: `/register` says registration is closed.**

- The instance admin chose "invite only" (the default) during setup. An
  instance admin can open registration under **Settings → Instance**, or
  create accounts on request. There is no self-service invite flow yet.

## SMTP connection failures

**Symptoms:** Creating an SMTP connection fails verification; transactional
sends return `502 smtp_failure`; jobs land in **Failed** with an SMTP error.

- **Wrong host/port/TLS combination.** Port `587` uses STARTTLS → set
  `secure: false`. Port `465` uses implicit TLS → set `secure: true`. A mismatch
  causes immediate connection or handshake errors.
- **Bad credentials.** QQueue verifies credentials on save; a failure here means
  the username/password were rejected. Confirm them with an external client
  (`swaks`, `openssl s_client`, or your mail UI).
- **Firewall / egress blocked.** Many hosts block outbound `25`/`465`/`587`.
  Test from the server: `nc -vz smtp.example.com 587`.
- **`SECRET_DECRYPTION` error on send.** The stored credentials can't be
  decrypted — usually because `ENCRYPTION_KEY` changed since the connection was
  saved. Re-create the SMTP connection with the current key. Never rotate
  `ENCRYPTION_KEY` without re-entering secrets.

In non-production, the API error includes the underlying SMTP message; in
production it's collapsed to `SMTP send failed` (check `failedReason` / logs).

## Mailcow auth / TLS issues

**Symptoms:** Mailcow rejects login, or TLS negotiation fails.

- **Use a mailbox login, not the admin UI login.** Authenticate with the full
  email address and that mailbox's password.
- **STARTTLS on 587.** For Mailcow use host = your mail FQDN, port `587`,
  `secure: false` (STARTTLS). Use `465` with `secure: true` only if you've
  enabled implicit TLS.
- **Certificate not trusted / hostname mismatch.** Ensure the SMTP host matches
  the certificate's name (the Mailcow `MAILCOW_HOSTNAME`). Self-signed or
  mismatched certs cause TLS errors.
- **SOGo/Postfix rate limits or `Sender address rejected`.** Confirm the
  `fromEmail` is a domain Mailcow is allowed to send for and that SPF/DKIM/DMARC
  are configured. See [MAILCOW_SETUP.md](MAILCOW_SETUP.md).

## Redis connection issues

**Symptoms:** Worker won't start; scheduled emails/campaigns never fire;
rate limiting errors; `ECONNREFUSED` against `localhost:6379`.

- **Redis not running.** Locally: `docker compose up -d` and check
  `docker compose ps`. In production confirm the `redis` service is **healthy**.
- **Wrong host from inside Docker.** Containers must reach Redis by its service
  name (`redis`), not `localhost`. The prod compose sets `REDIS_HOST=redis`;
  override with `PROD_REDIS_HOST`/`PROD_REDIS_PORT` for an external instance.
- **Worker not running.** Immediate sends work without the worker, but queued,
  scheduled, and campaign work requires it. Start `@qqueue/worker`.
- **Note for tests:** unit tests stub the queues, so a missing Redis does **not**
  break `pnpm test`. If you see real Redis chatter in test output, you're likely
  running against an un-mocked path — file an issue.

## Prisma migration issues

**Symptoms:** `prisma migrate` errors; "table does not exist" at runtime;
drift warnings.

- **Client not generated.** Run `pnpm db:generate` after pulling schema changes.
- **Migrations not applied.** Local dev: `pnpm db:migrate`. Production: the
  `migrate` service runs `prisma migrate deploy` on startup — check its logs and
  that it **completed successfully** before the API/worker started.
- **`DATABASE_URL` wrong or unreachable.** Verify it points at the right
  Postgres (service name `postgres` inside Docker, not `localhost`).
- **Schema drift / failed migration.** Inspect with
  `pnpm --filter @qqueue/api exec prisma migrate status`. In development you can
  reset a throwaway database; **never** reset production data — restore from a
  backup and re-apply `migrate deploy` instead.

## Failed queue jobs

**Symptoms:** Emails show as **Failed**; campaigns stall; webhook deliveries
don't arrive.

- **Inspect first.** **Queue Operations** lists queued, processing, and failed
  jobs per queue (`email-sending`, `campaign-processing`, `webhook-delivery`)
  with the `failedReason`.
- **Most email failures are SMTP failures.** Resolve the SMTP issue above, then
  use the **Retry** button on the failed job.
- **Access denied to Queue Operations.** It's restricted to organization
  **owners/admins**. Normal members get a forbidden response and an
  "access restricted" message — ask an owner/admin or adjust the member's role.
- **Jobs stuck in processing after a crash.** The worker re-enqueues recoverable
  work on restart; restart the worker if jobs appear wedged.

## Password reset email issues

**Symptoms:** Requesting a reset returns success but no email arrives; the reset
link points to the wrong place.

- **No SMTP connection.** Reset emails are sent through the requesting user's
  organization **default SMTP connection**. If none exists, QQueue logs a warning
  and sends nothing (the API still returns the generic success message to avoid
  leaking which accounts exist). Add a default SMTP connection.
- **Wrong link domain.** Reset links are built from `PUBLIC_APP_URL`
  (defaults to `https://qqueue.app`). Set it to your dashboard URL — the prod
  compose uses `https://<DOMAIN>`. The link format is
  `<PUBLIC_APP_URL>/reset-password?token=...`.
- **Token not in the API response.** Expected in production — the token is only
  echoed in the response **outside** production for local/dev convenience.
  Production relies solely on the emailed link.
- **"Token is invalid or expired."** Tokens are single-use and expire after one
  hour; request a fresh reset. A token is also rejected once it's been used.
- **Delivery failed silently.** Reset sends are best-effort and never surface
  SMTP errors to the caller — check the API logs for
  `Failed to send password reset email`.

## Tracking URL / click / open issues

**Symptoms:** Opens or clicks aren't recorded; click links 404 or don't redirect.

- **`APP_URL` not publicly reachable.** Open pixels and click redirects are
  fetched by recipients' mail clients, so `APP_URL` must resolve over HTTPS from
  the public internet — not `localhost`.
- **`TRACKING_SECRET` mismatch.** The API signs tracking tokens and must use the
  **same** `TRACKING_SECRET` as everywhere it's validated. A mismatch yields
  invalid tokens (opens still return the pixel; clicks may 400).
- **Opens undercount.** Many clients block remote images, so open rates are
  inherently a lower bound — this is expected, not a bug.
- **Click returns 400.** The destination URL must be a valid `http`/`https` URL.
  Non-web schemes (e.g. `javascript:`) are rejected by design.

## Caddy / reverse proxy issues

**Symptoms:** TLS certificate won't issue; `502` from the proxy;
CORS errors in the browser.

- **DNS not pointing at the server.** Caddy can't get a Let's Encrypt cert until
  an A record for `DOMAIN` resolves to the host and ports `80`/`443` are open.
- **Ports in use / not published.** Ensure nothing else binds `80`/`443` and the
  caddy service publishes both.
- **`502 Bad Gateway`.** The API container isn't up/healthy. Check
  `docker compose -f docker-compose.prod.yml logs api` and that `migrate`
  completed first.
- **CORS failures.** `WEB_ORIGIN` must match the browser origin
  (`https://<DOMAIN>` in prod). A mismatch blocks dashboard API calls.
- **Wrong client IP / rate limits keyed globally.** Ensure the proxy forwards
  the real client IP so per-IP rate limits work correctly.

---

Still stuck? Capture the failing request, the relevant container logs
(`docker compose -f docker-compose.prod.yml logs <service>`), and the job's
`failedReason`, and open an issue.

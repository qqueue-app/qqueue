# QQueue Beta Launch Checklist

Work through this before exposing a self-hosted QQueue instance to real users.
It assumes you've already completed the [Quickstart](QUICKSTART.md) locally.
Production deployment uses `docker-compose.prod.yml` (Caddy + API + worker +
Postgres + Redis) fronted by your `DOMAIN`.

Treat every box as "verified", not "configured" — actually exercise each path.

---

## 1. Environment variables

- [ ] `.env` created from `.env.example` on the host.
- [ ] `DOMAIN` points at the server and a DNS **A record** resolves to it.
- [ ] `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`,
      `TRACKING_SECRET` regenerated with `openssl rand -hex 32` (no `change-me`
      placeholders left).
- [ ] `ENCRYPTION_KEY` backed up securely — losing it makes stored SMTP
      credentials unrecoverable.
- [ ] `APP_URL` set to `https://<DOMAIN>` (open/click tracking links).
- [ ] `PUBLIC_APP_URL` set to your dashboard URL so password reset links resolve
      (production compose sets this to `https://<DOMAIN>`).
- [ ] `WEBHOOK_SECRET` set if you ingest ESP bounce/complaint webhooks (leave
      blank to keep that endpoint closed).
- [ ] `POSTGRES_PASSWORD` set to a strong value.

## 2. Database migrations

- [ ] `prisma migrate deploy` has run against the production database (the
      `migrate` service in `docker-compose.prod.yml` does this on startup).
- [ ] All expected tables exist, including `PasswordResetToken`.
- [ ] A backup/restore strategy for the Postgres volume is in place.

## 3. Redis

- [ ] Redis is reachable from both the API and worker (`REDIS_HOST`/`REDIS_PORT`,
      or `PROD_REDIS_HOST`/`PROD_REDIS_PORT` for an external instance).
- [ ] Redis is **not** published to the public internet.
- [ ] Persistence (the `qqueue-redis-data` volume or your managed equivalent) is
      retained so queued/scheduled jobs survive restarts.

## 4. SMTP credentials

- [ ] At least one SMTP connection created and marked **default** for each org
      that sends mail.
- [ ] The connection **verifies** successfully (QQueue tests credentials on
      save) and a real test email is delivered.
- [ ] Credentials are stored encrypted (they are, via `ENCRYPTION_KEY`).
- [ ] Sending mailbox is dedicated to QQueue and not rate-limited by the upstream
      provider for your expected volume. See [Mailcow setup](MAILCOW_SETUP.md).

## 5. Tracking domain

- [ ] `APP_URL` resolves publicly over HTTPS so open pixels and click redirects
      load in recipients' mail clients.
- [ ] A test email's open pixel and a click redirect both register events on the
      dashboard.
- [ ] `TRACKING_SECRET` matches between the API and worker (same value in both
      service environments).

## 6. Rate limiting

- [ ] Redis-backed rate limiting is active (it is whenever `NODE_ENV` is not
      `test`). Auth and transactional endpoints are limited per IP / per API key.
- [ ] You've confirmed a burst of auth attempts returns `429` with a
      `Retry-After` header.
- [ ] Reverse proxy passes the real client IP (Caddy sets `X-Forwarded-For`) so
      limits key on the right identity.

## 7. Queue worker

- [ ] The `worker` service is running alongside the API.
- [ ] Scheduled emails and campaigns actually fire at their scheduled time.
- [ ] Failed jobs are visible in **Queue Operations** (owners/admins only) and
      can be retried.
- [ ] Worker recovers in-flight/queued work on restart (it re-enqueues on boot).

## 8. Legal docs

- [ ] Terms, Privacy, and Licensing pages render in the dashboard
      (`/terms`, `/privacy`, `/licensing`).
- [ ] [docs/legal/TERMS_OF_SERVICE.md](legal/TERMS_OF_SERVICE.md) and
      [docs/legal/PRIVACY_POLICY.md](legal/PRIVACY_POLICY.md) reviewed and
      customized for your deployment.
- [ ] Open-core positioning understood — see [Licensing](LICENSING.md) and the
      [Cloud boundary](CLOUD_BOUNDARY.md). AGPL obligations apply to the core if
      you run a modified network service.

## 9. Smoke tests

- [ ] `pnpm test` passes (full unit/integration suite).
- [ ] `pnpm test:smoke:docker` passes — spins up throwaway Postgres/Redis,
      registers a user, configures SMTP against a fake mail server, sends a
      scheduled email, and confirms it reaches `SENT`.
- [ ] `pnpm license:audit` and `pnpm cloud:boundary` pass.

## 10. Production Docker Compose verification

- [ ] `docker compose -f docker-compose.prod.yml build` succeeds.
- [ ] `docker compose -f docker-compose.prod.yml up -d` brings up caddy, api,
      worker, migrate (run-once), postgres, and redis.
- [ ] `docker compose -f docker-compose.prod.yml ps` shows postgres and redis
      **healthy** and the `migrate` job **completed successfully**.
- [ ] Caddy obtains a TLS certificate for `DOMAIN` and `https://<DOMAIN>/health`
      (proxied to the API) returns `{"status":"ok"}`.
- [ ] You can register, sign in, add an SMTP connection, and send a test email
      end-to-end through the public domain.

---

When every box is checked, pin the deployed commit and record it. Revisit this
list on each upgrade — migrations and new env vars are the usual surprises.

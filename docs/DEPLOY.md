# Deploy QQueue on a VPS

This is the production self-hosting path for one VPS running Docker Compose.
Caddy serves the React dashboard, proxies the API, and manages HTTPS
certificates automatically. The production stack also includes the API, worker,
Postgres, Redis, and MinIO for attachment storage.

QQueue is beta software. Before exposing it to real users, complete this guide
and then work through the [Beta Launch Checklist](BETA_CHECKLIST.md).

## What You Need

- A VPS with at least 2 GB RAM. More is recommended for real mail volume.
- Docker Engine and Docker Compose installed on the VPS.
- A domain or subdomain for QQueue, for example `mail.example.com`.
- A DNS A record pointing that domain to the VPS public IPv4 address.
- Firewall ports `80` and `443` open to the internet.
- Outbound SMTP allowed by your VPS provider, or an external SMTP provider.
- SMTP credentials for the mailbox/provider QQueue should send through.

You do not need Node.js, pnpm, Postgres, or Redis installed on the host for
production. Docker Compose builds and runs the app containers.

In production, only Caddy publishes host ports `80` and `443`. If another
process already uses either port, the `caddy` service will fail to start and
QQueue will not be reachable until you free those ports or put QQueue behind an
existing reverse proxy.

The bundled Postgres, Redis, API, worker, and MinIO services are private to
Docker. They are not published on host ports, so host services on `4000`,
`5432`, `6379`, `9000`, or `9100` do not conflict with the production stack.

If you already run Nginx on the VPS, use the Nginx mode in this guide. It keeps
Nginx on public ports `80`/`443` and exposes QQueue only on
`127.0.0.1:8080`.

## 1. Clone the Repository

```sh
git clone https://github.com/your-org/qqueue.git
cd qqueue
```

Replace the clone URL with the real repository URL for your deployment.

## 2. Configure Production Environment

The guided setup writes a production-ready `.env` for you — it generates all
secrets and passwords, sets your domain, and explains each value as it goes
(requires Node.js 20+ and pnpm on the server; `pnpm install` first):

```sh
pnpm install
pnpm setup -- --mode=production --domain=mail.example.com
```

Bringing your own hosted Postgres, Redis, or object storage instead of the
bundled containers? See [Managed infrastructure](MANAGED_INFRASTRUCTURE.md)
for how to get them (Neon, Upstash, R2) and which `PROD_*` overrides to set.

<details>
<summary>Manual route (what <code>pnpm setup</code> automates)</summary>

Copy the template first:

```sh
cp .env.example .env
```

Open `.env` and set the production values. At minimum, change these:

```env
NODE_ENV=production
DOMAIN=mail.example.com

POSTGRES_USER=qqueue
POSTGRES_PASSWORD=replace-with-a-long-random-password
POSTGRES_DB=qqueue

# Leave blank to use the bundled private Postgres and Redis containers.
PROD_DATABASE_URL=
PROD_REDIS_HOST=
PROD_REDIS_PORT=

JWT_ACCESS_SECRET=replace-with-openssl-rand-hex-32
JWT_REFRESH_SECRET=replace-with-openssl-rand-hex-32
ENCRYPTION_KEY=replace-with-openssl-rand-hex-32
TRACKING_SECRET=replace-with-openssl-rand-hex-32

# Set this only if you want to accept provider bounce/complaint webhooks.
# Leave blank to keep POST /api/v1/webhooks/email-events closed.
WEBHOOK_SECRET=

# Bundled MinIO object storage for attachments.
S3_REGION=us-east-1
S3_BUCKET=qqueue-attachments
S3_ACCESS_KEY_ID=qqueue
S3_SECRET_ACCESS_KEY=replace-with-a-long-random-password
S3_FORCE_PATH_STYLE=true
MINIO_ROOT_PASSWORD=replace-with-the-same-value-as-S3_SECRET_ACCESS_KEY
```

Generate secrets with:

```sh
openssl rand -hex 32
```

</details>

Important production notes (they apply on both routes):

- `DOMAIN` must match the public hostname users open in the browser.
- Production Compose derives `APP_URL`, `PUBLIC_APP_URL`, and `WEB_ORIGIN` from
  `DOMAIN`, so you do not need to set those separately for the bundled stack.
- Back up `ENCRYPTION_KEY`. QQueue uses it to encrypt stored SMTP credentials.
  If you lose or rotate it after saving SMTP connections, those credentials
  cannot be decrypted and must be re-entered.
- Keep `TRACKING_SECRET` stable. Rotating it invalidates open/click links in
  already-sent emails.
- Production Compose sets the internal bundled MinIO endpoint automatically.
- Use the same value for `S3_SECRET_ACCESS_KEY` and `MINIO_ROOT_PASSWORD` when
  using bundled MinIO.

To use external infrastructure instead (step-by-step provider guides in
[Managed infrastructure](MANAGED_INFRASTRUCTURE.md)):

- External Postgres: set `PROD_DATABASE_URL`.
- External Redis: set `PROD_REDIS_HOST` and `PROD_REDIS_PORT`, plus
  `REDIS_PASSWORD` and `REDIS_TLS=true` if the provider requires them
  (Upstash does).
- External S3/R2/B2/etc.: add `PROD_S3_ENDPOINT` and set the `S3_*` variables
  for that provider. For AWS S3, set `PROD_S3_ENDPOINT=` and
  `S3_FORCE_PATH_STYLE=false`.

## 3. Confirm DNS and Firewall

Before starting Caddy, make sure DNS resolves to the VPS:

```sh
dig +short mail.example.com
```

The result should be the VPS public IP. Also confirm ports `80` and `443` are
open in your cloud firewall and any host firewall you use. Caddy cannot issue a
Let's Encrypt certificate until the domain points at the server and both ports
are reachable.

## 4. Start QQueue

Choose one of these modes.

### Option A: Let QQueue Manage HTTPS

```sh
docker compose -f docker-compose.prod.yml up -d --build
```

Use this when no other service owns host ports `80` and `443`. Caddy will bind
those ports and request certificates from Let's Encrypt.

### Option B: Put QQueue Behind Existing Nginx

Use this when Nginx already owns host ports `80` and `443`:

```sh
docker compose -f docker-compose.prod.yml -f docker-compose.nginx.yml up -d --build
```

This starts QQueue on localhost only:

```txt
http://127.0.0.1:8080
```

When using this mode, keep both `-f` flags on future `up`, `restart`, `logs`,
and `ps` commands. Running later commands with only `docker-compose.prod.yml`
will switch the `caddy` service back to public `80`/`443` bindings.

If you want a different local upstream port, set `QQUEUE_UPSTREAM_PORT` in
`.env`, for example:

```env
QQUEUE_UPSTREAM_PORT=18080
```

Then configure Nginx to terminate HTTPS and proxy to QQueue:

```nginx
server {
    listen 80;
    server_name mail.example.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

For HTTPS, use your normal Nginx TLS/certbot setup and keep the same `location`
block in the `443 ssl` server. Do not expose `127.0.0.1:8080` publicly.

Startup order:

1. Postgres, Redis, and MinIO become healthy.
2. The one-shot `migrate` service runs `prisma migrate deploy`.
3. The API and worker start.
4. Caddy serves the dashboard and proxies `/api/*` plus `/health`.

Check container status:

```sh
docker compose -f docker-compose.prod.yml ps
```

View logs:

```sh
docker compose -f docker-compose.prod.yml logs -f
```

For one service:

```sh
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f worker
docker compose -f docker-compose.prod.yml logs -f caddy
```

## 5. Verify the Deployment

Open the dashboard:

```txt
https://mail.example.com
```

Check the health endpoint:

```txt
https://mail.example.com/health
```

Expected health response:

```json
{ "status": "ok" }
```

If HTTPS fails, check DNS, firewall rules, and Caddy logs. If you get `502 Bad
Gateway`, check that the `migrate` service completed and the API is running.

## 6. Complete the Setup Wizard

Open:

```txt
https://mail.example.com
```

On a fresh install QQueue routes you into a short **setup wizard**: it creates
your administrator account and first organization, connects and verifies the
sending account (SMTP), asks whether other people may register on this server
(default: invite only — the safe choice for a server on the open internet),
and optionally sends you a test email. Everything it configures can be changed
later in **Settings** (the registration policy lives under **Settings →
Instance**).

If you close the tab mid-wizard, sign in and visit `/setup` to resume.

## 7. Connect SMTP (reference)

The wizard already connected your first sending account; use this section when
adding more. In the dashboard, go to **Sending accounts** (the SMTP connections
screen) and create a connection for the mailbox or provider you want QQueue to
send through.

For a standard submission server, common settings are:

- Host: your SMTP hostname, for example `smtp.example.com`.
- Port: `587`.
- Secure/TLS: off for STARTTLS on `587`, on for implicit TLS on `465`.
- Username/password: the SMTP credentials for the sending mailbox.
- From email/from name: the sender identity recipients should see.
- Default: enabled if this should be the organization's default sender.

QQueue verifies credentials before saving and stores them encrypted using
`ENCRYPTION_KEY`.

If you run Mailcow, use the [Mailcow SMTP setup](MAILCOW_SETUP.md). If the SMTP
test fails, check whether your VPS provider blocks outbound SMTP and test from
the server with:

```sh
nc -vz smtp.example.com 587
```

## 8. Send and Track a Test Email

After SMTP is connected:

1. Send a manual test email from the dashboard.
2. Confirm the message arrives in the recipient inbox.
3. Open the message and click a link if you included one.
4. Check the dashboard activity/analytics pages for send, open, and click
   events.
5. Check **Queue Operations** for failed or retriable jobs.

Open/click tracking links resolve through:

```txt
https://mail.example.com/api/v1/track/...
```

That means `DOMAIN` must remain publicly reachable over HTTPS.

## Email Provider Webhooks

Synchronous SMTP rejections are recorded automatically when the SMTP server
rejects a recipient during send.

For asynchronous bounces and complaints, configure your provider to call:

```txt
POST https://mail.example.com/api/v1/webhooks/email-events
```

Include:

```txt
X-Webhook-Secret: <WEBHOOK_SECRET>
```

Use this JSON shape:

```json
{ "type": "BOUNCED", "messageId": "<provider-message-id>", "reason": "..." }
```

`type` is one of `DELIVERED`, `BOUNCED`, or `COMPLAINED`. The event is
correlated by `messageId` or `emailJobId`. Most providers need a small relay or
function to map their webhook payload to this shape. Leave `WEBHOOK_SECRET`
blank if you are not using this endpoint.

## Backups

At minimum, back up:

- The Postgres database.
- The `.env` file, especially `ENCRYPTION_KEY`.
- The `qqueue-minio-data` Docker volume if you use bundled MinIO for
  attachments.

Create a Postgres dump:

```sh
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U qqueue qqueue > qqueue-$(date +%F).sql
```

If you changed `POSTGRES_USER` or `POSTGRES_DB`, use those values in the command.
Store backups off the VPS and test restores before relying on them.

## Updating QQueue

Before updating, take a database backup. Then:

```sh
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

The `migrate` service runs on every deploy and applies pending Prisma
migrations before the API and worker start.

After updating:

```sh
docker compose -f docker-compose.prod.yml ps
```

Then re-check:

```txt
https://mail.example.com/health
```

## Common Operations

Restart everything:

```sh
docker compose -f docker-compose.prod.yml restart
```

Restart one service:

```sh
docker compose -f docker-compose.prod.yml restart api
```

Stop the stack without deleting data:

```sh
docker compose -f docker-compose.prod.yml down
```

Show disk usage for Docker resources:

```sh
docker system df
```

## Troubleshooting

- HTTPS or proxy failures: see [Caddy / reverse proxy issues](TROUBLESHOOTING.md#caddy--reverse-proxy-issues).
- SMTP failures: see [SMTP connection failures](TROUBLESHOOTING.md#smtp-connection-failures).
- Queue or worker failures: see [Failed queue jobs](TROUBLESHOOTING.md#failed-queue-jobs).
- Prisma or migration failures: see [Prisma migration issues](TROUBLESHOOTING.md#prisma-migration-issues).

When asking for help, include:

- The command that failed.
- Relevant logs from `docker compose -f docker-compose.prod.yml logs <service>`.
- The output of `docker compose -f docker-compose.prod.yml ps`.
- Any job `failedReason` shown in Queue Operations.

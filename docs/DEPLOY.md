# Deploy QQueue on a VPS

This guide targets one VPS running Docker Compose. Caddy serves the web app,
proxies the API, and manages HTTPS certificates automatically.

## Prerequisites

- A VPS with Docker and Docker Compose installed.
- A DNS A record pointing your chosen domain to the VPS public IP.
- Ports 80 and 443 open on the VPS firewall.

Postgres and Redis are bundled in the production compose stack and are not
published to the host. Existing services on host ports 5432 or 6379 will not
conflict with QQueue.

## 1. Clone and Configure

```sh
git clone https://github.com/your-org/qqueue.git
cd qqueue
cp .env.example .env
```

Edit `.env` for production:

```env
NODE_ENV=production
DOMAIN=mail.example.com

POSTGRES_USER=qqueue
POSTGRES_PASSWORD=replace-with-a-secret
POSTGRES_DB=qqueue

# Leave these blank to use bundled private Postgres and Redis.
PROD_DATABASE_URL=
PROD_REDIS_HOST=
PROD_REDIS_PORT=

JWT_ACCESS_SECRET=replace-with-openssl-rand-hex-32
JWT_REFRESH_SECRET=replace-with-openssl-rand-hex-32
ENCRYPTION_KEY=replace-with-openssl-rand-hex-32

# Analytics (Phase 5). APP_URL is derived from DOMAIN by compose, so you only
# need to set the secrets here.
TRACKING_SECRET=replace-with-openssl-rand-hex-32
WEBHOOK_SECRET=replace-with-openssl-rand-hex-32
```

Generate each secret with:

```sh
openssl rand -hex 32
```

Keep `ENCRYPTION_KEY` stable and backed up. It is used to encrypt stored SMTP
credentials. If it changes after SMTP connections have been saved, QQueue cannot
decrypt those saved usernames/passwords; affected SMTP connections must be
edited and their credentials re-entered.
Keep `TRACKING_SECRET` stable too — rotating it invalidates open/click links in
already-sent emails.

## Email analytics

Open and click tracking work out of the box: the worker injects a tracking
pixel and rewrites links to `https://<DOMAIN>/api/v1/track/...` at send time,
and the public endpoints record `OPENED`/`CLICKED` events. Per-campaign stats
are on each campaign's analytics page in the web app.

Bounces are captured two ways:

- **Synchronous rejections** — if your SMTP server rejects a recipient at send
  time, it is recorded as a `BOUNCED` event and the contact is marked bounced.
- **Asynchronous bounces/complaints** — point your email provider's webhook at
  `POST https://<DOMAIN>/api/v1/webhooks/email-events` with the header
  `X-Webhook-Secret: <WEBHOOK_SECRET>` and a JSON body:

  ```json
  { "type": "BOUNCED", "messageId": "<provider-message-id>", "reason": "..." }
  ```

  `type` is one of `DELIVERED`, `BOUNCED`, `COMPLAINED`. The event is correlated
  to the original send by `messageId` (the SMTP message id QQueue stores), or by
  `emailJobId`. Map your provider's payload (SES/SNS, SendGrid, Mailgun,
  Postmark, …) to this shape with a small relay or function. Leave
  `WEBHOOK_SECRET` blank to disable the endpoint.

To use external Postgres or Redis, set `PROD_DATABASE_URL`,
`PROD_REDIS_HOST`, and `PROD_REDIS_PORT`. Otherwise the production stack uses
the private `postgres:5432` and `redis:6379` services.

## 2. Start the Stack

```sh
docker compose -f docker-compose.prod.yml up -d --build
```

The production stack starts services in this order:

1. Postgres and Redis become healthy.
2. The one-shot `migrate` service runs `prisma migrate deploy`.
3. API and worker start.
4. Caddy serves the web build and proxies `/api/*` plus `/health`.

## 3. Verify

Open your domain:

```txt
https://mail.example.com
```

Check the API health endpoint:

```txt
https://mail.example.com/health
```

View logs if something fails:

```sh
docker compose -f docker-compose.prod.yml logs -f
```

## Updating

Pull the latest code and rebuild:

```sh
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

The migration service runs on each deploy and applies any pending Prisma
migrations before the API and worker start.

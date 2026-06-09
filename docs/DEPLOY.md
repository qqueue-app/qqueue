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
```

Generate each secret with:

```sh
openssl rand -hex 32
```

Keep `ENCRYPTION_KEY` stable. It is used to encrypt stored SMTP credentials.

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

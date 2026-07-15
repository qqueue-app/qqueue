# Managed Infrastructure

QQueue needs three pieces of infrastructure: a **Postgres database**, a
**Redis queue**, and **S3-compatible file storage**. The repo bundles all
three as Docker containers, so you never *have* to set anything up — but if
you'd rather not run them yourself (or your host can't run Docker), every one
of them is available as a free-tier managed service.

This guide shows how to get each one and which `.env` value it maps to. Paste
the values into `pnpm setup` when it asks, or edit `.env` directly. Every
variable is explained in the [environment variables reference](ENVIRONMENT_VARIABLES.md).

> **Do I need this?** If you deploy with the bundled Docker Compose stack and
> the defaults work for you: no. Managed services shine when you want backups,
> upgrades, and uptime handled by someone else, or when you're deploying to a
> host without Docker.

---

## Postgres (the database)

Postgres stores everything: contacts, emails, templates, campaigns, settings.
You need one connection string, which goes in `DATABASE_URL` (local dev) or
`PROD_DATABASE_URL` (production compose stack).

### Neon (recommended free tier)

1. Sign up at [neon.tech](https://neon.tech) (GitHub/Google login works).
2. Create a project — pick the region closest to your server.
3. On the project dashboard, open **Connect** and copy the connection string.
   It looks like
   `postgresql://user:password@ep-xxx-xxx.region.aws.neon.tech/neondb?sslmode=require`.
4. Paste it into `pnpm setup` when it asks "Where is your Postgres database?",
   or set it in `.env`:

```sh
# local development
DATABASE_URL=postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
# production compose stack (leaves the bundled Postgres unused)
PROD_DATABASE_URL=postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
```

Notes: keep `?sslmode=require` — hosted Postgres requires TLS. Neon's free
tier suspends after inactivity; the first request after a pause takes a
second to wake up, which is fine for QQueue.

### Supabase

1. Sign up at [supabase.com](https://supabase.com) and create a project.
2. Go to **Project Settings → Database** and copy the **connection string**
   (URI). Use the *session* pooler string (port `5432`) rather than the
   *transaction* pooler — QQueue uses Prisma migrations, which need session
   semantics.
3. Set it as `DATABASE_URL` / `PROD_DATABASE_URL` exactly as with Neon.

Any other hosted Postgres (Railway, Render, RDS, DigitalOcean) works the same
way: get the connection string, put it in the same variable.

## Redis (the queue)

Redis powers background sending, retries, campaign fan-out, and scheduling.
QQueue speaks the normal Redis protocol over TCP, configured as a host and
port (`REDIS_HOST` / `REDIS_PORT`, or `PROD_REDIS_HOST` / `PROD_REDIS_PORT`
in production).

### Upstash

1. Sign up at [upstash.com](https://upstash.com) and create a **Redis**
   database in the region closest to your server.
2. On the database page, find the **TCP** connection details (host, port,
   password). ⚠ Use the Redis/TCP endpoint, **not** the REST API URL —
   QQueue's queue library (BullMQ) needs a real Redis connection.
3. Set in `.env` (hosted Redis needs the password and TLS):

```sh
REDIS_HOST=xxxx.upstash.io
REDIS_PORT=6379
REDIS_PASSWORD=<password from the Upstash dashboard>
REDIS_TLS=true
```

Leave `REDIS_PASSWORD` blank and `REDIS_TLS=false` for the bundled container —
it runs on a private network and needs neither.

## S3-compatible storage (attachments)

Attachments are stored as blobs in any S3-compatible service. Five values
configure it: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, plus the `S3_FORCE_PATH_STYLE` switch.

### Cloudflare R2 (free tier, no egress fees)

1. In the [Cloudflare dashboard](https://dash.cloudflare.com), open **R2**
   and create a bucket (e.g. `qqueue-attachments`).
2. Create an **R2 API token** with read/write on that bucket. Copy the
   **Access Key ID** and **Secret Access Key**.
3. Your endpoint is `https://<account-id>.r2.cloudflarestorage.com` (shown on
   the bucket page).

```sh
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=qqueue-attachments
S3_ACCESS_KEY_ID=<access key id>
S3_SECRET_ACCESS_KEY=<secret access key>
S3_FORCE_PATH_STYLE=true
```

### AWS S3

1. Create a bucket in the [S3 console](https://s3.console.aws.amazon.com).
2. Create an IAM user with read/write access to that bucket and generate an
   access key pair.

```sh
S3_ENDPOINT=
S3_REGION=us-east-1        # your bucket's region
S3_BUCKET=qqueue-attachments
S3_ACCESS_KEY_ID=<access key id>
S3_SECRET_ACCESS_KEY=<secret access key>
S3_FORCE_PATH_STYLE=false
```

Note the two differences from MinIO/R2: `S3_ENDPOINT` is **empty** (the AWS
SDK finds the right endpoint from the region) and `S3_FORCE_PATH_STYLE` is
`false`.

In the production compose stack, set `PROD_S3_ENDPOINT` to your external
endpoint to bypass the bundled MinIO.

## What about email (SMTP)?

Sending email is configured **inside the app**, not in `.env`: the setup
wizard (and later the Sending accounts page) asks for the SMTP details of the
mailbox you send from, verifies them, and stores them encrypted. See the
[SMTP provider guide](SMTP_PROVIDER_GUIDE.md) for provider-specific settings
and [Mailcow setup](MAILCOW_SETUP.md) if you self-host your mail server.

## Related guides

- [Environment variables](ENVIRONMENT_VARIABLES.md) — every `.env` setting
  explained.
- [Deploy](DEPLOY.md) — the production Docker Compose stack these overrides
  plug into.
- [Troubleshooting](TROUBLESHOOTING.md) — connection problems and fixes.

# Set up QQueue with existing Nginx and PostgreSQL

This guide deploys QQueue on a server that already runs Nginx and PostgreSQL.
Nginx handles public HTTP and HTTPS, your existing PostgreSQL stores QQueue's
data, and Docker runs the API, worker, dashboard, Redis, and MinIO attachment
storage.

The commands assume Ubuntu or Debian, with Nginx and PostgreSQL installed
directly on the same host. If either service runs in Docker or on another
server, adapt the networking before following this guide. Replace
`queue.example.com` with your real hostname.

QQueue sends through an existing SMTP server or provider. Deploying QQueue
does not create an SMTP server.

## Secrets you need

The guided script in step 1 generates the app secrets, VAPID pair, and bundled
storage password for you. For the database password or manual setup, generate
each distinct password or secret on your server with:

```sh
openssl rand -hex 32
```

Run it separately for each value. Store the results in a password manager.
Only the two MinIO settings below intentionally share a value.

| Secret | Purpose | Where to put it |
| --- | --- | --- |
| PostgreSQL password | Password for a dedicated `qqueue` database user. | Set using `\password qqueue`, then include it in `PROD_DATABASE_URL`. |
| `JWT_ACCESS_SECRET` | Signs dashboard access tokens. | `.env` |
| `JWT_REFRESH_SECRET` | Signs refresh tokens; use a different value from the access secret. | `.env` |
| `ENCRYPTION_KEY` | Encrypts saved SMTP/IMAP credentials and other stored secrets. Back this up. | `.env` |
| `TRACKING_SECRET` | Signs tracking links. Keep it stable so previously sent links continue working. | `.env` |
| `S3_SECRET_ACCESS_KEY` | Password for bundled MinIO attachment storage. | `.env` |
| `MINIO_ROOT_PASSWORD` | Must equal `S3_SECRET_ACCESS_KEY` for this deployment. | `.env` |
| `WEBHOOK_SECRET` | Authenticates optional inbound provider webhooks. | `.env` |
| SMTP password or app password | Authenticates the sending account. | QQueue's setup wizard or Sending accounts screen. |

For the current checkout, fill in `WEBHOOK_SECRET` even when inbound provider
webhooks are disabled: the API validator rejects an explicitly empty value
supplied by production Compose. Keeping `INBOUND_ESP_WEBHOOK_ENABLED=false`
keeps that endpoint disabled.

Back up `ENCRYPTION_KEY`. Losing it prevents QQueue from decrypting existing
stored credentials. For deliberate key rotation, see the
[environment variables reference](ENVIRONMENT_VARIABLES.md).

## 1 Clone the repository and check Docker

Run these commands on your server:

```sh
git clone https://github.com/qqueue-app/qqueue.git
cd qqueue
docker compose version
```

If the repository is already checked out, use that directory instead of cloning
again. Run subsequent `docker compose` commands from the QQueue directory.

You need Docker Engine and Docker Compose 2.24.4 or newer. The included Nginx
override uses the `!override` YAML tag. Node.js and pnpm are not required on
the host for a manual Docker deployment. See
[Docker's Compose merge reference](https://docs.docker.com/reference/compose-file/merge/).

To generate the environment file and secrets automatically, use the repository's
guided setup script. This route additionally needs Node.js 22 and pnpm 9.15.0
on the host, matching the repository's Docker runtime and package manager:

```sh
pnpm install --frozen-lockfile
pnpm run setup --mode=production --domain=queue.example.com
chmod 600 .env
```

Use `pnpm run setup` explicitly: plain `pnpm setup` is pnpm's own environment
setup command and does not invoke QQueue's package script.

The QQueue script creates `.env` if missing and generates unset app secrets,
the VAPID notification pair, and the bundled PostgreSQL and MinIO passwords.
Answer **yes** when it asks whether to generate a webhook secret, to satisfy
the current API validator even while provider webhooks remain disabled.

In production mode, this script prepares configuration only. It does not
configure Nginx, create a database in your existing PostgreSQL, start the
containers, or apply migrations. Continue with the steps below and add
`PROD_DATABASE_URL` and the server-specific Compose settings to its generated
`.env`. The generated bundled PostgreSQL password does not change your existing
host PostgreSQL user's password.

The script's final deployment suggestion uses only `docker-compose.prod.yml`.
For this guide, use `docker compose up -d --build` after setting `COMPOSE_FILE`
in step 4, so the Nginx and existing-database overrides are included.

Point a DNS A record for `queue.example.com` at your server's public IPv4
address. Ports 80 and 443 should reach Nginx. Your server also needs outbound
access to your SMTP provider.

## 2 Create a private Docker network

This gives containers a predictable address for reaching host PostgreSQL.
Use the example subnet only if it does not overlap existing Docker, LAN, or
VPN networks:

```sh
docker network create \
  --subnet 172.30.50.0/24 \
  --gateway 172.30.50.1 \
  qqueue-net
```

If you choose a different subnet, replace the corresponding addresses in
PostgreSQL configuration, the database URL, and the firewall rule below.

## 3 Create the database in your existing PostgreSQL

Generate a database password, then open PostgreSQL:

```sh
sudo -u postgres psql
```

Inside `psql`, run:

```sql
SET password_encryption = 'scram-sha-256';
CREATE ROLE qqueue LOGIN;
\password qqueue
CREATE DATABASE qqueue OWNER qqueue;

SHOW config_file;
SHOW hba_file;
SHOW listen_addresses;
\q
```

`\password` prompts for the generated password without putting it in the SQL
command. These commands assume the `qqueue` role and database do not exist yet.
Use a dedicated database rather than an existing application's database.

Edit the file reported by `SHOW config_file`. Add `172.30.50.1` to the existing
`listen_addresses`. If PostgreSQL currently listens only on localhost, use:

```conf
listen_addresses = 'localhost,172.30.50.1'
```

Preserve any addresses your other applications already use. If the existing
setting already covers this interface, no listening-address change is needed.

In the file reported by `SHOW hba_file`, add this rule before any broader rule
that would reject these connections:

```conf
host    qqueue    qqueue    172.30.50.0/24    scram-sha-256
```

PostgreSQL needs a restart for a listening-address change. This briefly
interrupts existing database connections, so schedule it around your other
applications. See [PostgreSQL connection settings](https://www.postgresql.org/docs/current/runtime-config-connection.html)
and [authentication rules](https://www.postgresql.org/docs/current/auth-pg-hba-conf.html).

```sh
sudo systemctl restart postgresql
```

If only `pg_hba.conf` changed, reload instead:

```sh
sudo -u postgres psql -c 'SELECT pg_reload_conf();'
```

If UFW blocks containers from reaching PostgreSQL, allow this specific private
connection:

```sh
sudo ufw allow from 172.30.50.0/24 to 172.30.50.1 port 5432 proto tcp
```

Test database access from Docker:

```sh
docker run --rm -it --network qqueue-net postgres:16-alpine \
  psql -h 172.30.50.1 -U qqueue -d qqueue -W -c 'SELECT 1;'
```

Enter the database password when prompted. The result should contain `1`.

## 4 Create the production environment file

For a fresh deployment, create `.env` in the QQueue directory:

```sh
nano .env
```

If `.env` already exists, including one generated by `pnpm run setup`, merge
the settings below into it while preserving configured secrets. Keep the
generated secret values in place of the `REPLACE_...` placeholders, and retain
the generated VAPID pair if you want notifications. For manual setup, paste
the following configuration and replace every `REPLACE_...` value:

```dotenv
NODE_ENV=production
DOMAIN=queue.example.com

# Load all three deployment files together on every Compose command.
COMPOSE_PROJECT_NAME=qqueue
COMPOSE_FILE=docker-compose.prod.yml:docker-compose.nginx.yml:docker-compose.server.yml

# Existing host PostgreSQL, reached through the private Docker gateway.
PROD_DATABASE_URL=postgresql://qqueue:REPLACE_DB_PASSWORD@172.30.50.1:5432/qqueue?schema=public

# Bundled PostgreSQL is disabled by the override below.
# Define this to avoid Compose interpolation warnings.
POSTGRES_PASSWORD=

# Separate random values for each of these.
JWT_ACCESS_SECRET=REPLACE_ACCESS_SECRET
JWT_REFRESH_SECRET=REPLACE_REFRESH_SECRET
ENCRYPTION_KEY=REPLACE_ENCRYPTION_KEY
TRACKING_SECRET=REPLACE_TRACKING_SECRET

# Nginx proxies API requests directly: the API has one proxy hop.
TRUST_PROXY=1

# Bundled private Redis.
PROD_REDIS_HOST=
PROD_REDIS_PORT=

# Bundled private MinIO. Both passwords below must be identical.
S3_REGION=us-east-1
S3_BUCKET=qqueue-attachments
S3_ACCESS_KEY_ID=qqueue
S3_SECRET_ACCESS_KEY=REPLACE_STORAGE_SECRET
MINIO_ROOT_PASSWORD=REPLACE_STORAGE_SECRET
S3_FORCE_PATH_STYLE=true

# Local upstream ports used by Nginx.
QQUEUE_UPSTREAM_PORT=8080
QQUEUE_API_UPSTREAM_PORT=14000

# Provider webhooks remain disabled initially.
INBOUND_ESP_WEBHOOK_ENABLED=false
WEBHOOK_SECRET=REPLACE_WEBHOOK_SECRET

# Optional browser notifications: disabled initially.
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@example.com
```

Replace the VAPID contact address with your own operator email address, even if
you leave notifications off initially.

A hex database password avoids special-character escaping in the connection
URL. If you use an existing password containing characters such as `@`, `/`,
or `#`, URL-encode it.

Protect the file:

```sh
chmod 600 .env
```

Production Compose derives `APP_URL`, `PUBLIC_APP_URL`, and `WEB_ORIGIN` from
`DOMAIN`, and configures the internal MinIO endpoint automatically.

`COMPOSE_FILE` makes subsequent `docker compose` commands load all three
files consistently. See [Docker's environment variable reference](https://docs.docker.com/compose/how-tos/environment-variables/envvars/).

## 5 Add the override for your existing PostgreSQL

Create this file in the QQueue directory:

```sh
nano docker-compose.server.yml
```

Paste:

```yaml
services:
  api:
    ports:
      - "127.0.0.1:${QQUEUE_API_UPSTREAM_PORT:-14000}:4000"

  minio:
    image: ghcr.io/coollabsio/minio:latest

  migrate:
    depends_on: !reset {}

  postgres:
    profiles: ["bundled-postgres"]

networks:
  default:
    external: true
    name: qqueue-net
```

This disables bundled PostgreSQL during normal startup and removes the
migration service's dependency on it. The API, worker, and migrations use
`PROD_DATABASE_URL` for your existing database.

The MinIO override uses a community-built image from
[Coollabs](https://github.com/coollabsio/minio), which publishes source builds
and includes the `mc` client used by the existing health check. The original
`minio/minio:latest` image can fail with a pull-access-denied error, and
`quay.io/minio/minio:latest` was also unavailable when checked. MinIO's
[upstream repository](https://github.com/minio/minio) is archived and no longer
maintained; this image supplies the storage service without changing QQueue's
S3 configuration. Image availability was verified, but this guide does not
establish ongoing upstream maintenance.

The API and dashboard bind to localhost only. Nginx sends API requests
directly to the API on port 14000 and dashboard requests to the bundled web
server on port 8080. If either port is occupied, change its `.env` setting and
the corresponding Nginx upstream below.

## 6 Build and start QQueue

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps -a
```

The `migrate` service should finish with exit code 0. The API, worker, Redis,
MinIO, and dashboard service (`caddy`) should remain running. Bundled
PostgreSQL should not start.

Check the API:

```sh
curl http://127.0.0.1:14000/health
```

Expected response:

```json
{"status":"ok"}
```

If startup fails, check:

```sh
docker compose logs --tail=100 migrate api worker
```

If startup fails while pulling `minio/minio:latest`, confirm the `minio` image
override from step 5 is in `docker-compose.server.yml` and all three files are
listed in `COMPOSE_FILE`. Then retry:

```sh
docker compose config --quiet
docker compose pull minio
docker compose up -d --build
```

The health endpoint confirms the API responds; the database connection test,
migration result, and test email verify the remaining deployment steps.

## 7 Configure Nginx and HTTPS

On Ubuntu or Debian, create a new site file:

```sh
sudo nano /etc/nginx/sites-available/qqueue
```

Paste this initial HTTP configuration:

```nginx
server {
    listen 80;
    server_name queue.example.com;

    client_max_body_size 20m;

    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;

    location /api/ {
        proxy_pass http://127.0.0.1:14000;
    }

    location = /health {
        proxy_pass http://127.0.0.1:14000;
    }

    location / {
        proxy_pass http://127.0.0.1:8080;
    }
}
```

This assumes visitors connect directly to Nginx. A CDN or another proxy in
front requires adjusting client-IP handling. Keep the existing Nginx
configuration for your other sites.

Enable the new site, validate the configuration, and reload:

```sh
sudo ln -s /etc/nginx/sites-available/qqueue /etc/nginx/sites-enabled/qqueue
sudo nginx -t
sudo systemctl reload nginx
```

If the symlink already exists, skip the `ln` command. Reload only after
`nginx -t` succeeds.

Use your existing certificate workflow for this hostname. If Certbot and its
Nginx plugin are already installed:

```sh
sudo certbot --nginx -d queue.example.com
```

Enable HTTP-to-HTTPS redirection. Certbot can configure the certificate and
HTTPS server automatically. If you manage TLS manually, put the same proxy
configuration in your HTTPS server block and redirect HTTP to HTTPS. See
[Certbot's Nginx instructions](https://certbot.eff.org/instructions?os=pip&tab=standard&ws=nginx).

Verify the public endpoint:

```sh
curl https://queue.example.com/health
```

Expect `{"status":"ok"}`.

## 8 Complete the setup wizard and send a test email

Open `https://queue.example.com`. On a fresh installation, QQueue opens the
setup wizard to create your instance administrator and first organization.

For the sending account, enter:

- SMTP hostname.
- Port 587 with STARTTLS (`Secure/TLS` off), or port 465 with implicit TLS
  (`Secure/TLS` on).
- SMTP username and password or app password.
- From email and display name.

Choose the registration policy for your instance. For a private team instance,
use invite-only registration. Send a test email and confirm it arrives.
Check the worker logs or Queue Operations if delivery fails.

SMTP credentials are entered in the dashboard and stored encrypted using
`ENCRYPTION_KEY`. Receiving mail in the Inbox also requires an IMAP connection.
For provider-specific details, see the [SMTP provider guide](SMTP_PROVIDER_GUIDE.md).

## Optional secrets and integrations

| Setting | When needed |
| --- | --- |
| `VAPID_PRIVATE_KEY` and matching `VAPID_PUBLIC_KEY` | Browser push notifications. Generate a proper VAPID pair, not ordinary hex secrets. The API and worker must use the same pair. |
| `MAILCOW_API_KEY` with `MAILCOW_API_URL` | Creating and managing Mailcow mailboxes from QQueue. Ordinary SMTP sending does not require these. |
| `REDIS_PASSWORD` | External authenticated Redis. This guide uses bundled private Redis. External Redis also requires forwarding its auth/TLS settings into both app containers. |
| QQueue transactional API key | Generate inside the dashboard when another application needs to send through QQueue. |
| `ENCRYPTION_KEYS` | Optional keyring for deliberate encryption-key rotation; overrides `ENCRYPTION_KEY`. |

To generate an optional VAPID pair using the built API image:

```sh
docker compose run --rm --no-deps api node -e '
const key = require("node:crypto").createECDH("prime256v1");
key.generateKeys();
console.log("VAPID_PUBLIC_KEY=" + key.getPublicKey().toString("base64url"));
console.log("VAPID_PRIVATE_KEY=" + key.getPrivateKey().toString("base64url"));
'
```

Save the printed values in `.env`, keep `VAPID_SUBJECT` set to your contact
address, and apply the change:

```sh
docker compose up -d
```

Changing the VAPID pair requires existing devices to subscribe again. See the
[environment variables reference](ENVIRONMENT_VARIABLES.md) for further details.

## Backups and ongoing operation

Back up:

- The `qqueue` database in your existing PostgreSQL.
- `.env`, especially `ENCRYPTION_KEY` and `TRACKING_SECRET`.
- The Docker volume containing MinIO data. With this guide's project name,
  Compose normally names it `qqueue_qqueue-minio-data`.
- `docker-compose.server.yml` and the Nginx site configuration.

Store backups off the server and test restores. Keep encryption and tracking
secrets stable across updates, and preserve the public hostname so links in
previously sent mail continue to resolve.

View service status and recent logs:

```sh
docker compose ps -a
docker compose logs --tail=100 api worker
```

Restart a service:

```sh
docker compose restart worker
```

After editing `.env`, use `docker compose up -d` to recreate affected containers;
`restart` alone does not apply changed environment variables.

Before updating, take a database backup. Then, from the QQueue directory:

```sh
git pull
docker compose up -d --build
docker compose ps -a
curl https://queue.example.com/health
```

Confirm migrations complete successfully and send another test email after
updating. Also verify database access and QQueue health after a server reboot.

## Related documentation

- [Deployment guide](DEPLOY.md)
- [Environment variables](ENVIRONMENT_VARIABLES.md)
- [Beta launch checklist](BETA_CHECKLIST.md)
- [Troubleshooting](TROUBLESHOOTING.md)

The Compose override was checked for service selection, localhost port
bindings, and database routing. Completing the connection, migration, HTTPS,
and email checks above verifies the deployment on your server.

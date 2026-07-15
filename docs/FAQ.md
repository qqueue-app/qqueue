# Frequently Asked Questions

## Is QQueue open source?

Yes. **QQueue Core** — the self-hosted platform — is open source under
**AGPL-3.0-only**. If you run a modified version as a network service, the AGPL
requires you to make the corresponding source available to that service's users.
See [Licensing](LICENSING.md).

## Which license does it use?

- **Core:** AGPL-3.0-only (root `LICENSE`).
- **`apps/cloud/`:** proprietary commercial license (managed-cloud scaffold).
- **SDK (`qqueue-sdk`):** MIT.
- **Docs:** CC-BY-4.0 where a documentation-specific notice says so.

The QQueue name, logo, and marks are trademarks — see [TRADEMARK.md](../TRADEMARK.md).

## Can I self-host it?

Yes — self-hosting is the primary path. Run it locally with Docker for Postgres
and Redis (see the [Quickstart](QUICKSTART.md)), or in production with
`docker-compose.prod.yml` (Caddy + API + worker + Postgres + Redis) behind your
own domain (see [Deploy](DEPLOY.md)).

## Can I use it with Mailcow?

Yes. QQueue sends through Mailcow's standard SMTP submission — no Mailcow-specific
provider is required. See the [Mailcow setup guide](MAILCOW_SETUP.md).

## Which email providers are supported?

Any standard **SMTP** server (Mailcow, Amazon SES, Postmark, Resend, Brevo, and
others via their SMTP interface). QQueue uses one generic Nodemailer SMTP
provider. Provider-*native* API integrations are **not implemented** — connect
via SMTP. See the [SMTP provider guide](SMTP_PROVIDER_GUIDE.md).

## What are sending domains and sender identities?

They decouple the visible From address from the single SMTP credential that
authenticates the send. A **sending domain** owns the DKIM configuration for a
domain; **sender identities** are concrete From records (name + email) under a
domain, each bound to the SMTP connection that transports it. One identity can
be the org default. The dashboard's send surfaces pick a sender identity rather
than free-typing a From address. This is optional — you can still send straight
from a default SMTP connection.

## Do I need to configure DKIM?

Only if you want QQueue to sign it. A sending domain has two DKIM modes.
**EXTERNAL:** your upstream relay signs DKIM (for example Mailcow or Amazon SES),
and QQueue never signs. **MANAGED:** QQueue generates an RSA-2048 keypair,
surfaces the DNS TXT records for you to publish, and a verification worker moves
the domain `PENDING → VERIFIED`; from then on QQueue signs DKIM in-process. Only
**MANAGED** domains that are **VERIFIED** are signed.

## Does it support transactional email?

Yes — a public transactional send endpoint with API keys, inline or
template-based content, scheduled sends, machine-readable error codes, and
rate limiting. See [Transactional API](TRANSACTIONAL_API.md) and
[Send your first email](FIRST_EMAIL.md).

## Does it support campaigns?

Yes — send-now, one-shot scheduled, and **recurring** campaigns (cron expression
+ timezone), with pause/resume, duplication, and per-campaign analytics. See
[Send your first campaign](FIRST_CAMPAIGN.md).

## Does it track opens and clicks?

Yes — built-in open tracking (1×1 pixel) and click tracking (link rewriting),
secured with HMAC-signed tokens. `APP_URL` must be publicly reachable over HTTPS.
Opens undercount because many clients block images — expected.

## Does it support webhooks?

Yes — outbound signed webhooks (HMAC `QQueue-Signature`, 5 retries with
backoff, delivery history, manual retry) for email events, plus a normalized
inbound endpoint for ESP bounce/complaint events.

## Is there an SDK? What does it do today?

Yes — `qqueue-sdk` (MIT, on npm). It currently exposes a single method,
`QQueueClient.sendEmail`, wrapping the transactional send endpoint. Clients for
templates, contacts, campaigns, webhooks, and API keys are not yet available.

## Is there a cloud version?

**QQueue Cloud** is planned, not yet available. The repo contains a fenced
proprietary `apps/cloud/` scaffold, but managed hosting, billing, quotas, hosted
onboarding, deliverability tooling, and cloud admin dashboards are **not built
yet**. See the [Cloud boundary](CLOUD_BOUNDARY.md).

## What are the known limitations?

Not yet implemented: organization invitations, member-management UI, a usage
metrics dashboard, provider-specific inbound webhook adapters, and SDK methods
beyond `sendEmail`. There is no email
verification or MFA yet. All managed-cloud/commercial features are unstarted.
See [STATUS.md](STATUS.md) for the full audit.

## Is it production-ready?

QQueue is a **feature-complete self-hosted beta candidate**. The full
verification suite — `lint`, `typecheck`, `build`, `test` (536 tests), a
Docker-backed end-to-end smoke test, license audit, and cloud-boundary check —
passes. It's beta software: expect rough edges, review the security and
operational notes, and **pin a known-good commit** for production. Work through
the [Beta launch checklist](BETA_CHECKLIST.md) before going live.

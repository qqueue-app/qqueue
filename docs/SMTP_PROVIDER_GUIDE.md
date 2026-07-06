# SMTP Provider Guide

QQueue is **bring-your-own-sender**: you connect an SMTP server and QQueue sends
through it. This guide covers how connections work and the standard SMTP
settings for common providers.

> **How sending works today.** QQueue sends through a single, generic
> [Nodemailer](https://nodemailer.com) SMTP provider. It works with **any**
> standard SMTP server. Provider-*native* API integrations (Amazon SES API,
> Resend API, Brevo API, Postmark API, a Mailcow-specific provider) are **not
> implemented** — they exist only as placeholder classes in
> `packages/email-engine` that throw "not implemented". Connect these providers
> through their **SMTP interface** instead, as shown below.

---

## Creating a connection

In the dashboard, open **Sending accounts → New connection** and fill in:

| Field | Notes |
| --- | --- |
| **Name** | A label, e.g. `Mailcow` or `SES`. |
| **Host** | The provider's SMTP hostname. |
| **Port** | `587` (STARTTLS) or `465` (implicit TLS). |
| **Secure** | `off` for port 587 (STARTTLS); `on` for port 465 (implicit TLS). |
| **Username** | Provider SMTP username (often the full mailbox or an SMTP credential). |
| **Password** | SMTP password / app password / API-key-as-password. |
| **From email** | The address mail is sent from (must be authorized for the sender). |
| **From name** | Optional display name. |
| **Default** | Mark one connection default so it's used automatically. |

QQueue **verifies** the credentials before saving and **encrypts** them at rest
with `ENCRYPTION_KEY`.

> **Footgun:** changing `ENCRYPTION_KEY` after a connection is saved makes the
> stored credentials undecryptable. Back the key up, and if you must rotate it,
> re-enter every SMTP connection's username/password afterward.

Test any connection from the API with:

```sh
curl -s -X POST http://localhost:4000/api/v1/smtp-connections/SMTP_ID/test
```

---

## Sender identities and sending domains

SMTP connections still transport the mail, but they now sit **beneath** sender
identities and sending domains. A **sending domain** controls the visible
From-domain and how DKIM is handled; a **sender identity** is a concrete From
(name + email) under that domain, which UI send surfaces pick instead of
free-typing an address.

Which DKIM mode to use depends on who signs:

- **Provider-signed DKIM (SES, Postmark, Resend, Brevo, and most relays)** — add
  the sending domain in **EXTERNAL** mode. The provider signs; publish the
  provider's DKIM key (see [Deliverability basics](#deliverability-basics)).
  QQueue won't double-sign, and the domain's status stays `NA`.
- **QQueue-managed DKIM** — use **MANAGED** mode. QQueue generates the keypair,
  shows the DNS TXT record to publish, and moves the domain to `VERIFIED` once
  you verify it. QQueue then signs DKIM for that domain in-process.

Then add sender identities (name + email) under the domain and bind each to the
SMTP connection that transports it.

---

## Provider settings

Use the provider's documented SMTP endpoint and credentials. Typical values:

### Mailcow

Host = your mail FQDN (e.g. `mail.example.com`), port `587`, **secure off**
(STARTTLS), username = full mailbox address, password = mailbox/app password.
See the dedicated [Mailcow setup guide](MAILCOW_SETUP.md).

### Amazon SES (SMTP interface)

Host = `email-smtp.<region>.amazonaws.com` (e.g. `email-smtp.us-east-1.amazonaws.com`),
port `587` secure off (or `465` secure on). Username/password = your **SES SMTP
credentials** (not your AWS access keys). Verify the sending domain/identity in
SES first.

### Postmark (SMTP interface)

Host = `smtp.postmarkapp.com`, port `587` secure off. Username **and** password =
your Postmark **Server API token**. From address must be a verified Sender
Signature / domain.

### Resend (SMTP interface)

Host = `smtp.resend.com`, port `587` secure off (or `465` secure on). Username =
`resend`, password = your Resend **API key**. Verify your domain in Resend.

### Brevo (SMTP interface)

Host = `smtp-relay.brevo.com`, port `587` secure off. Username = your Brevo
SMTP login, password = your Brevo **SMTP key**.

### Any other provider

Use the host/port/credentials from your provider's "SMTP relay" docs. Port `587`
with STARTTLS (secure off) is the common default; `465` with implicit TLS
(secure on) also works where supported.

> Always check provider docs for the current hostnames, ports, and credential
> types — these change over time and vary by region/plan.

---

## Deliverability basics

Sending through SMTP doesn't guarantee the inbox. Before sending to real people:

- **SPF** — authorize your sending host/provider in the domain's SPF record.
- **DKIM** — sign outgoing mail; publish the provider's DKIM key.
- **DMARC** — publish a DMARC policy aligned with SPF/DKIM.
- **Dedicated mailbox/credential** — use a sender dedicated to QQueue, not a
  human's personal mailbox.
- **Warm up** — start at low volume and ramp gradually to build reputation.
- **Monitor** — watch bounces/complaints (QQueue records `BOUNCED` /
  `COMPLAINED` events) and your provider's logs.

For inbound bounce/complaint feedback, map your provider's events into QQueue's
normalized `POST /api/v1/webhooks/email-events` endpoint (gated by
`WEBHOOK_SECRET`). Provider-specific inbound adapters are not built in — you map
the payload yourself.

---

## Troubleshooting

Common failures (wrong port/TLS combo, bad credentials, blocked egress,
`SECRET_DECRYPTION` after an `ENCRYPTION_KEY` change) and their fixes are in
[Troubleshooting](TROUBLESHOOTING.md) and [Mailcow setup](MAILCOW_SETUP.md).

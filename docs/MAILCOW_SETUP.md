# Mailcow SMTP Setup

QQueue sends through Mailcow using the generic SMTP provider path. No
Mailcow-specific provider is required for the current self-hosted flow.

## Prerequisites

- A running Mailcow instance with SMTP submission enabled.
- A Mailcow mailbox or app-specific SMTP user that QQueue can authenticate as.
- DNS for the sending domain already configured for Mailcow, including SPF,
  DKIM, and DMARC. (QQueue can show you exactly which records to publish — see
  [Managing Domains From QQueue](#managing-domains-from-qqueue).)
- QQueue running with a stable `ENCRYPTION_KEY`; changing it later invalidates
  stored SMTP credentials.

For mailbox and domain management from within QQueue you also need
`MAILCOW_API_URL` and `MAILCOW_API_KEY` set, with the API key granted
**read/write** access (Mailcow → Admin → API). Sending works without them.

## Recommended SMTP Settings

In QQueue, open **Sending accounts** (the SMTP connections screen) and create a
connection:

- **Name:** `Mailcow`
- **Host:** your Mailcow hostname, for example `mail.example.com`
- **Port:** `587`
- **Secure:** off for STARTTLS on port 587
- **Username:** full Mailcow mailbox, for example `hello@example.com`
- **Password:** mailbox password or app-specific password
- **From email:** usually the same mailbox, for example `hello@example.com`
- **From name:** optional display name
- **Default:** enabled if this should be the default sender

Port `465` can also work with **Secure** enabled if your Mailcow deployment is
configured for implicit TLS SMTP.

## DKIM

Mailcow signs outbound mail itself. QQueue never holds a signing key and never
signs on Mailcow's behalf — it reads Mailcow's public key so it can show you
the DNS record to publish. If the record isn't published, mail still sends, it
just fails DKIM verification at the recipient.

## Managing Domains From QQueue

With `MAILCOW_API_URL` and `MAILCOW_API_KEY` configured, an org **owner** gets a
**Domains** tab under **Settings → Mailboxes** that manages the domains on your
mail server directly.

This is owner-only on purpose. Your Mailcow credentials are instance-level, so
the mail server is shared by every organization on the instance — adding or
deleting a domain changes it for all of them.

From that tab you can:

- **Add a domain.** Creates it in Mailcow and generates its DKIM key in the same
  step, then opens the DNS panel.
- **Edit** its description, mailbox limit, default quota, and whether it accepts
  mail.
- **Claim** a domain that already exists on the server. Claiming records that
  this organization owns it, which hides it from other organizations on the
  instance. Domains nobody has claimed stay visible to every owner — on a
  single-org instance that means nothing changes.
- **Delete** a domain, once every mailbox on it is gone. QQueue refuses while
  mailboxes remain, because Mailcow would delete the domain and every message
  under it in one call.

### The DNS panel

A domain exists in Mailcow the moment you create it, but it neither sends nor
receives until its DNS is published. Open **DNS records** on any domain to see
what's needed and what's already live:

| Record | Purpose |
| --- | --- |
| `MX` | Routes mail for the domain to your mail server. |
| `TXT` (SPF) | Authorises your server to send for the domain. |
| `TXT` (DKIM) | Publishes the key Mailcow signs with. |
| `TXT` (DMARC) | Tells recipients how to treat mail that fails SPF and DKIM. |
| `CNAME` (autodiscover / autoconfig) | Optional; lets mail clients self-configure. |

Each is checked against live DNS and marked **Live**, **Missing**, or
**Unchecked**. *Unchecked* means the lookup itself failed — it says nothing
about your zone, so it is never treated as ready.

QQueue also reads the domain's nameservers to tell you where its DNS is hosted
(Cloudflare, Route 53, GoDaddy, Namecheap, and so on). It does not write records
for you; publish them at that host, then use **Re-check**.

Two deliberate behaviours worth knowing:

- **Matching is loose except for DKIM.** A hand-tightened SPF or a stricter
  DMARC policy counts as correct, because it is. DKIM compares the public key
  exactly — a key that isn't Mailcow's fails every signature.
- **DMARC is suggested at `p=none`.** A stricter policy on a domain whose SPF
  and DKIM aren't live yet would quarantine legitimate mail on day one. Tighten
  it once the reports look clean.

QQueue offers to generate a DKIM key only for a domain that has none. Rotating
an existing key would make Mailcow sign with it immediately, breaking every
signature until the new DNS record propagated — do that in Mailcow if you mean
to.

## Setup Flow

1. Confirm Mailcow can send from the mailbox using another SMTP client.
2. In QQueue, create the SMTP connection with the settings above.
3. QQueue verifies the connection before saving it.
4. Send a test transactional email from **Compose** (Email Studio).
5. Check Mailcow logs if verification or delivery fails.

## Common Failures

- **Authentication failed:** verify the username is the full mailbox address and
  that the password is correct.
- **Connection timeout:** confirm QQueue can reach the Mailcow host and that the
  SMTP submission port is open from the QQueue server.
- **TLS or certificate errors:** use port 587 with STARTTLS (`secure: false`) or
  port 465 with implicit TLS (`secure: true`). Confirm the Mailcow certificate
  matches the SMTP hostname.
- **Rejected sender:** make sure `fromEmail` is allowed for the authenticated
  mailbox.
- **Poor deliverability:** confirm SPF, DKIM, and DMARC records are valid for
  the sending domain.
- **Stored credentials cannot be decrypted:** the QQueue `ENCRYPTION_KEY`
  changed after the SMTP connection was saved. Edit the SMTP connection and
  re-enter the username/password, or restore the previous key.

## Production Notes

- Keep Mailcow and QQueue clocks synchronized; TLS and tracking links are easier
  to debug when timestamps are accurate.
- Use a dedicated mailbox or app password for QQueue.
- Start with low-volume sends and monitor Mailcow queues, bounces, and logs.
- For inbound bounces/complaints, map Mailcow or provider events into QQueue's
  normalized `POST /api/v1/webhooks/email-events` shape described in
  [TRANSACTIONAL_API.md](TRANSACTIONAL_API.md).

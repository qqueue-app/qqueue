# Mailcow SMTP Setup

QQueue sends through Mailcow using the generic SMTP provider path. No
Mailcow-specific provider is required for the current self-hosted flow.

## Prerequisites

- A running Mailcow instance with SMTP submission enabled.
- A Mailcow mailbox or app-specific SMTP user that QQueue can authenticate as.
- DNS for the sending domain already configured for Mailcow, including SPF,
  DKIM, and DMARC.
- QQueue running with a stable `ENCRYPTION_KEY`; changing it later invalidates
  stored SMTP credentials.

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

## Sending Domain (DKIM Mode)

If you add a **sending domain** for Mailcow-relayed mail, create it in
**EXTERNAL** DKIM mode. Mailcow signs DKIM itself, so you publish **Mailcow's**
DKIM key in DNS (alongside SPF and DMARC) and let Mailcow do the signing. The
domain's status will show `NA`, which is expected for EXTERNAL mode.

Do **not** use **MANAGED** mode for Mailcow-relayed mail — that would have QQueue
sign with its own key and bypass Mailcow's signer.

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

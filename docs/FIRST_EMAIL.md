# Send Your First Email

This guide takes a running QQueue instance and sends a single transactional
email three ways: from the dashboard, from the HTTP API, and from the SDK. If
QQueue isn't running yet, start with the [Quickstart](QUICKSTART.md) first.

**You need:** QQueue running (API, web, and worker), and one **verified SMTP
connection** marked as default. See the
[SMTP provider guide](SMTP_PROVIDER_GUIDE.md) or
[Mailcow setup](MAILCOW_SETUP.md) if you haven't added one yet.

> Immediate sends go out inline from the API, but keep the **worker** running so
> scheduled sends and webhook deliveries are processed.

---

## Option A — Send from the dashboard

1. Open the dashboard (`http://localhost:5173` in local dev) and sign in.
2. Go to **Compose** (Email Studio).
3. Pick a **sender identity** (or, if you haven't set any up, a **sending
   account** — the SMTP connection) for the From address, enter a recipient, a
   subject, and a body (or pick a saved template).
4. Send, then watch it appear in the **Dashboard** activity feed. Scheduled
   sends show up under **Background jobs** (Queue Operations).

Check the recipient inbox to confirm delivery.

## Option B — Send with the transactional API

First create an API key in **Settings → API keys**. The plaintext key (prefixed
`qq_live_`) is shown **once** — store it in your secret manager. API keys are
scoped to a single organization, so you don't pass an `organizationId`.

Send inline content:

```sh
curl -s -X POST http://localhost:4000/api/v1/transactional-email/send \
  -H "Authorization: Bearer qq_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "to": "recipient@example.com",
    "subject": "Hello from QQueue",
    "html": "<p>It works! 🎉</p>",
    "text": "It works!"
  }'
```

A `202 Accepted` with a compact job reference means it was sent (or queued for a
future `scheduledAt`):

```json
{ "data": { "id": "email_job_id", "status": "SENT" } }
```

`status` is `SENT` for immediate sends and `QUEUED` for scheduled ones. To send
later, add an ISO `scheduledAt` in the future:

```json
{ "to": "recipient@example.com", "subject": "Later", "html": "<p>Hi</p>",
  "scheduledAt": "2026-07-01T09:00:00.000Z" }
```

To send as a specific identity, pass an optional `senderIdentityId` (or
`smtpConnectionId`). If you omit both, QQueue falls back to your org's default
sender identity, then to the default SMTP connection — so existing SMTP-only
calls keep working unchanged.

To render a saved template instead of inline content, pass `templateId` and
`variables` — see [FIRST_CAMPAIGN.md](FIRST_CAMPAIGN.md) for templates and the
full [Transactional API](TRANSACTIONAL_API.md) reference for error codes and
webhook signing.

## Option C — Send with the SDK

```sh
npm install qqueue-sdk
```

```ts
import { QQueueClient } from "qqueue-sdk";

const qqueue = new QQueueClient({
  apiKey: process.env.QQUEUE_API_KEY!,
  // Omit baseUrl in local dev; it defaults to http://localhost:4000/api/v1
  baseUrl: "https://mail.example.com/api/v1"
});

const email = await qqueue.sendEmail({
  to: "recipient@example.com",
  subject: "Hello from QQueue",
  html: "<p>Sent via the SDK.</p>"
});

console.log(email.id, email.status);
```

The SDK currently exposes `sendEmail` only; its payload also accepts an optional
`senderIdentityId` or `smtpConnectionId` (same fallback as the API). On failure
it throws a `QQueueError` with `.status` and an optional `.code`.

---

## Confirm it worked

- **Dashboard activity feed** shows the job and its events (`QUEUED`, `SENT`,
  and later `OPENED` / `CLICKED` if the recipient engages).
- **Queue Operations** (owners/admins) shows queued, processing, and failed
  jobs, with a **Retry** action and the `failedReason` on any failure.
- The **recipient inbox** receives the message.

> Open tracking relies on a 1×1 pixel and click tracking on link rewriting, so
> both require `APP_URL` to be publicly reachable over HTTPS. Opens undercount
> because many mail clients block remote images — that's expected.

## If something went wrong

| Symptom | Likely cause |
| --- | --- |
| `missing_smtp_connection` | No SMTP connection, or none marked default. |
| `smtp_failure` | The SMTP server rejected the send — check the connection. |
| `invalid_api_key` | Key missing, revoked, or wrong. |
| `invalid_schedule` | `scheduledAt` is malformed or not in the future. |
| Nothing arrives | Check **Queue Operations** `failedReason` and the API logs. |

See [Troubleshooting](TROUBLESHOOTING.md) for SMTP, Redis, and tracking fixes.

## Next steps

- [Send your first campaign](FIRST_CAMPAIGN.md)
- [Transactional API reference](TRANSACTIONAL_API.md)
- [SMTP provider guide](SMTP_PROVIDER_GUIDE.md)

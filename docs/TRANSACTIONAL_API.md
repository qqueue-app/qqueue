# Transactional API

QQueue exposes a public transactional email endpoint for application sends. Use
dashboard JWTs while testing from the web UI, and API keys for server-to-server
integrations.

## API Keys

Create an API key from the dashboard settings page. The plaintext key is shown
once. Store it in your application secret manager and send it as a bearer token:

```sh
Authorization: Bearer qq_live_...
```

API keys are scoped to one organization, so public API requests do not include
`organizationId`.

## Send Email

```sh
curl -s -X POST http://localhost:4000/api/v1/transactional-email/send \
  -H "Authorization: Bearer qq_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "to": "recipient@example.com",
    "subject": "Welcome",
    "html": "<p>Hello from QQueue.</p>",
    "text": "Hello from QQueue."
  }'
```

Successful sends return `202 Accepted` with a compact job reference:

```json
{
  "data": {
    "id": "email_job_id",
    "status": "SENT"
  }
}
```

Scheduled sends return the same shape with `status: "QUEUED"`.

## Idempotency

To make a send safe to retry (e.g. after a network timeout), pass a unique
`Idempotency-Key` header:

```sh
curl -s -X POST http://localhost:4000/api/v1/transactional-email/send \
  -H "Authorization: Bearer qq_live_..." \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 5f3c1b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f" \
  -d '{ "to": "recipient@example.com", "subject": "Welcome", "html": "<p>Hi</p>" }'
```

A repeat request with the same key for the same organization returns the
**original** job reference instead of sending a second copy. Keys are scoped per
organization, are at most 255 characters, and should be unique per logical send
(a UUID per message works well). Reuse a key only when you intend it to refer to
the same message.

## Templates

Use `templateId` with `variables` to render a saved template:

```json
{
  "to": "recipient@example.com",
  "templateId": "template_id",
  "variables": {
    "firstName": "Ada",
    "resetUrl": "https://app.example.com/reset/token"
  }
}
```

Template variables use `{{ variableName }}` placeholders. Missing variables are
rendered as empty strings.

## SDK

```sh
npm install qqueue-sdk
```

```ts
import { QQueueClient } from "qqueue-sdk";

const qqueue = new QQueueClient({
  apiKey: process.env.QQUEUE_API_KEY!,
  baseUrl: "https://mail.example.com/api/v1"
});

const email = await qqueue.sendEmail({
  to: "recipient@example.com",
  templateId: "template_id",
  variables: { firstName: "Ada" }
});

console.log(email.id, email.status);
```

For local development, omit `baseUrl` to use
`http://localhost:4000/api/v1`.

## Error Codes

Error responses include a stable machine-readable `error.code` when available:

```json
{
  "error": {
    "code": "invalid_api_key",
    "message": "Invalid API key"
  }
}
```

Transactional API codes:

| Code | Meaning |
| --- | --- |
| `invalid_api_key` | The bearer token looks like an API key but is missing, revoked, or unknown. |
| `missing_smtp_connection` | No matching SMTP connection exists, or no default SMTP connection is configured. |
| `invalid_template` | The provided template id does not exist in the API key's organization. |
| `smtp_failure` | The SMTP provider rejected or failed the send attempt. |
| `invalid_schedule` | `scheduledAt` is malformed or not in the future. |
| `validation_error` | The request body is invalid or lacks required email content. |

## Webhook Signing

Outbound webhooks include:

- `QQueue-Event`: event name such as `email.sent`
- `QQueue-Delivery`: delivery id
- `QQueue-Timestamp`: Unix timestamp in seconds
- `QQueue-Signature`: `v1=<hex hmac>`

Verify the signature against the raw request body:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import express from "express";

const app = express();

app.post(
  "/qqueue/webhooks",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const timestamp = req.header("QQueue-Timestamp");
    const signature = req.header("QQueue-Signature")?.replace(/^v1=/, "");

    if (!timestamp || !signature) {
      return res.sendStatus(400);
    }

    const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(ageSeconds) || ageSeconds > 300) {
      return res.sendStatus(400);
    }

    const body = req.body.toString("utf8");
    const expected = createHmac("sha256", process.env.QQUEUE_WEBHOOK_SECRET!)
      .update(`${timestamp}.${body}`)
      .digest("hex");

    const signatureBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");

    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      return res.sendStatus(401);
    }

    const event = JSON.parse(body);
    res.sendStatus(204);
  }
);
```

Keep a short-lived cache of processed `QQueue-Delivery` values to reject replayed
deliveries inside your timestamp tolerance window.

## Retry Semantics

QQueue queues outbound webhooks with 5 attempts and exponential backoff starting
at 30 seconds. Non-2xx responses and network errors mark the delivery failed and
leave `nextAttemptAt` for the next worker retry. A successful 2xx response marks
the delivery `DELIVERED`.

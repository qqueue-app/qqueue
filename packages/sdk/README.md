# qqueue-sdk

TypeScript SDK for the self-hosted QQueue email API.

## Install

```sh
npm install qqueue-sdk
```

## Usage

```ts
import { QQueueClient } from "qqueue-sdk";

const qqueue = new QQueueClient({
  apiKey: process.env.QQUEUE_API_KEY!,
  baseUrl: "https://mail.example.com/api/v1"
});

await qqueue.sendEmail({
  to: "user@example.com",
  subject: "Welcome",
  html: "<p>Hello from QQueue.</p>",
  text: "Hello from QQueue."
});
```

## Templates

```ts
await qqueue.sendEmail({
  to: "user@example.com",
  templateId: "tpl_123",
  variables: {
    firstName: "Ada",
    resetUrl: "https://app.example.com/reset/token"
  }
});
```

The API key determines the QQueue organization, so SDK calls do not include an
`organizationId`.

## Errors

```ts
import { QQueueClient, QQueueError } from "qqueue-sdk";

try {
  await qqueue.sendEmail({
    to: "user@example.com",
    subject: "Welcome",
    text: "Hello"
  });
} catch (error) {
  if (error instanceof QQueueError) {
    console.error(error.status, error.message);
  }
}
```

## Self-Hosting

Point `baseUrl` at your QQueue API URL. For example, if QQueue is hosted at
`https://mail.example.com`, use:

```ts
const qqueue = new QQueueClient({
  apiKey: process.env.QQUEUE_API_KEY!,
  baseUrl: "https://mail.example.com/api/v1"
});
```

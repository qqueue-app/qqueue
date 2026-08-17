# qqueue-sdk

TypeScript SDK for the self-hosted QQueue email API.

## License

The QQueue SDK is licensed under the MIT License. See [LICENSE](./LICENSE).

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

const email = await qqueue.sendEmail({
  to: "user@example.com",
  subject: "Welcome",
  html: "<p>Hello from QQueue.</p>",
  text: "Hello from QQueue."
});

console.log(email.id, email.status);
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

## Choosing who it sends as

The From header comes from a sending account configured in QQueue, so you never
set it on the request. Name the account by the address it sends as:

```ts
await qqueue.sendEmail({
  from: "support@acme.com",
  to: "user@example.com",
  replyTo: "help@acme.com",
  subject: "Welcome",
  text: "Hello."
});
```

Omit `from` and the organization's default sending account is used. Pass
`smtpConnectionId` instead to name an account by id (it wins if you send both).
An address no sending account uses is a `404`, not a fall back to the default.

`replyTo` is optional twice over: leave it out and the send inherits whatever
default Reply-To the sending account has, if any.

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
    console.error(error.status, error.code, error.message);
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

## Releases

See [CHANGELOG.md](./CHANGELOG.md) for version history and
[RELEASE.md](./RELEASE.md) for the publishing checklist, install smoke test, and
version bump flow.

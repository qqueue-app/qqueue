# Send Your First Campaign

A campaign sends one template to every **active** contact in a list, fanned out
to the background worker. This guide goes from an empty account to a sent
campaign with analytics. If you haven't sent a one-off email yet, do
[Send your first email](FIRST_EMAIL.md) first.

**You need:** QQueue running with the **worker** up (campaigns are processed by
the worker, not inline) and a verified **default SMTP connection**.

---

## 1. Create a contact

**Contacts → New contact.** Add an email plus optional `firstName`, `lastName`,
and metadata. Use an inbox you control so you can confirm delivery. New contacts
are `ACTIVE`; campaigns only send to `ACTIVE` contacts (hard bounces are
auto-marked `BOUNCED` and skipped).

Via the API:

```sh
curl -s http://localhost:4000/api/v1/contacts \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "organizationId": "ORG_ID", "email": "riley@example.com",
        "firstName": "Riley" }'
```

## 2. Create a list and add the contact

**Lists → New list.** Create a list (e.g. "Newsletter") and add your contact to
it. The list is the audience for the campaign.

## 3. Create a template

**Templates → New template.** Give it a subject and body. Use `{{ variable }}`
placeholders — they're filled in per contact at send time (simple string
replacement; missing variables render as empty strings):

- **Subject:** `Welcome, {{firstName}}`
- **HTML:** `<p>Hello {{firstName}}, welcome to QQueue.</p>`

Available per-contact variables include `{{firstName}}`, `{{lastName}}`, and
`{{email}}`.

## 4. Create the campaign

**Campaigns → New campaign.** Select the **template** from step 3 and the
**list** from step 2, and name the campaign. You can also pick a **sender
identity** for the From address; if its sending domain is MANAGED and VERIFIED,
QQueue signs DKIM for the campaign's sends too. It starts as a `DRAFT`.

## 5. Send it

You have three options:

- **Send now** — fan out immediately to the worker.
- **Schedule** — set a future `scheduledAt` for a one-shot send.
- **Recurring** — set a **cron expression** and **timezone** (for example
  `0 9 * * 1-5` = 09:00 on weekdays). Use **Pause** / **Resume** to control a
  recurring campaign.

The worker expands the campaign into one email job per active contact, queues
them, sends through your SMTP connection, and records events. Sending is
idempotent per run, so a worker restart won't duplicate a send.

Campaign statuses: `DRAFT`, `SCHEDULED`, `SENDING`, `PAUSED`, `SENT`,
`CANCELLED`. You can also **duplicate** a campaign to reuse its setup.

## 6. View analytics

Open the campaign's **Analytics**:

- Recipients, sent, and delivered counts
- Opens and clicks, with their rates
- Top clicked links

> Open and click tracking require `APP_URL` to be publicly reachable over HTTPS.
> Opens undercount because many clients block images — expected, not a bug.

## Watch it run

- **Queue Operations** (owners/admins): the `campaign-processing` and
  `email-sending` queues with queued / processing / failed counts and a
  **Retry** action.
- **Dashboard**: the recent activity feed of jobs and events.

---

## Next steps

- [Transactional API](TRANSACTIONAL_API.md) — API keys, SDK, webhooks, retries.
- [Demo script](DEMO_SCRIPT.md) — a full guided product walkthrough.
- [Troubleshooting](TROUBLESHOOTING.md) — if a send fails or stalls.

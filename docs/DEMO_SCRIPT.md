# QQueue Demo Script

A 5–10 minute guided walkthrough of QQueue for a live demo or screen recording.
It shows the full path from sign-up to a sent email, a campaign, and the
operational tooling — and closes on the open-core story.

**Before you start:** have QQueue running locally (see the
[Quickstart](QUICKSTART.md)) with the **API, web app, and worker** all up, and
SMTP credentials ready for a mailbox you can send from. Have your own inbox open
to show real delivery.

> Timing in brackets is a guide for a ~8-minute run. Trim the campaign or
> analytics step to hit 5 minutes; linger on them to reach 10.

---

## 0. What is QQueue? [~45s]

> "QQueue is an open-core, self-hostable email platform. The core — everything
> we'll see today — is open source under AGPL-3.0: transactional email, SMTP
> connections, contacts and lists, templates, campaigns, background queues,
> open/click tracking, and outbound webhooks. You run it on your own
> infrastructure and connect your own mail server. We'll go from zero to a sent
> email, then a campaign, then the operational view."

## 1. Register & log in [~45s]

- Go to `http://localhost:5173/register`.
- Sign up with an email, password, name, and organization name (e.g. "Acme").
- Point out: registration created your **user**, your first **organization**
  (you're the `OWNER`), and signed you in. Land on the **Dashboard**.

> "One sign-up bootstraps an account and an organization — the tenant boundary
> everything else hangs off of."

## 2. Create / switch organization [~30s]

- Open the organization switcher (top-left).
- Mention you can create additional organizations from **Settings** and switch
  between them; all data — SMTP, contacts, campaigns — is scoped per org.

## 3. Add an SMTP connection [~1m]

- Go to **SMTP Connections → New connection**.
- Enter host, port (`587`, `secure` off for STARTTLS), username, password, from
  address; mark it **default**.
- Save and call out: QQueue **verifies** the credentials before saving and
  **encrypts** them at rest.

> "QQueue is bring-your-own-SMTP — Mailcow, a transactional provider, anything
> that speaks SMTP. Credentials are encrypted with your key; we never see them."

## 4. Create a contact and a list [~1m]

- Go to **Contacts → New contact**, add a recipient (use an inbox you control).
- Go to **Campaigns → Contact lists → New list**, create a list and add the
  contact to it. This is the audience for a campaign later.

## 5. Create a template [~1m]

- Go to **Templates → New template**.
- Give it a subject and body using a variable, e.g.
  `Welcome, {{firstName}}` / `<p>Hello {{firstName}}, welcome to QQueue.</p>`.
- Note that `{{ variable }}` placeholders are filled in at send time.

## 6. Send a transactional email [~1m]

- Go to **Send Email**.
- Choose your SMTP connection and recipient, either type a subject/body or pick
  the template, send.
- Switch to your inbox and show it arriving.

> "That's a single transactional send. The same thing is available over a signed
> HTTP API and an SDK with API keys — great for app notifications like receipts
> and password resets."

## 7. Create a campaign [~1m]

- Go to **Campaigns → New campaign**.
- Select the template and the contact list from steps 4–5.
- Send now (or schedule for the near future to show queuing), and explain
  campaigns can also be **recurring** on a cron schedule.

> "Campaigns fan out to a whole list. Sending is handed to a background worker,
> so the dashboard stays responsive and large sends are retried on failure."

## 8. Inspect queue, events, and analytics [~1m30s]

- **Queue Operations** (owners/admins only): show the `email-sending`,
  `campaign-processing`, and `webhook-delivery` queues with queued / processing /
  failed counts, and the **Retry** action on a failed job.
- **Dashboard**: show the recent activity feed of email jobs and events.
- **Campaign analytics**: open the campaign's analytics — recipients, sent,
  delivered, opens/clicks (and their rates), and top clicked links.

> "Every send emits events — queued, sent, delivered, opened, clicked, bounced —
> which power analytics and can be pushed to your systems via signed outbound
> webhooks. Open and click tracking is built in."

## 9. Open-core & QQueue Cloud boundary [~45s]

> "Everything you just saw is the **AGPL-3.0 open-core** — self-host it, modify
> it, run it for your own users. If you run a modified version as a network
> service, AGPL asks you to share those changes.
>
> **QQueue Cloud** is the separate, proprietary layer: managed hosting, billing
> and subscriptions, usage quotas, hosted onboarding, deliverability and abuse
> controls, reputation/warmup, and admin dashboards. It builds on the same core
> primitives but lives behind a commercial boundary — none of the core depends
> on it. So you get a genuinely useful open platform, with a managed option when
> you don't want to operate it yourself."

- Point to [Licensing](LICENSING.md) and the [Cloud boundary](CLOUD_BOUNDARY.md)
  for the full split.

---

## Wrap-up [~15s]

> "From sign-up to a tracked, queued, analytics-backed email in a few minutes —
> all open source and self-hosted. Next steps are in the Quickstart and the Beta
> Launch Checklist."

**Reset between demos:** sign out, and (optionally) use a throwaway database so
each run starts clean.

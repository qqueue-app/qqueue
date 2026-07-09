# First User Experience Review

A candid walkthrough of QQueue from the perspective of a brand-new self-hoster
going from `git clone` to a first sent email and first campaign, using only the
documented flow. Each finding lists the friction, why it matters, and a concrete
recommendation. This is an internal review to sharpen onboarding before public
launch — it does not describe shipped features.

**Scope of the trial run:** [Quickstart](QUICKSTART.md) → add SMTP →
[first email](FIRST_EMAIL.md) → [first campaign](FIRST_CAMPAIGN.md).

> **Status update:** several findings below have since shipped — `pnpm setup`
> (finding 1, plus plain-language env explanations per finding 3), the
> first-run `/setup` web wizard with a resumable flow and closable public
> registration (finding 6), and the Settings → Instance configuration health
> view. The findings are kept as originally written for context.

---

## 1. Installation friction

**Finding.** First send requires a fair number of ordered steps: install Node
20+ and pnpm, install Docker, `cp .env.example .env`, `pnpm install`,
`docker compose up -d`, `pnpm db:generate`, `pnpm db:migrate`, then `pnpm dev`.
Each is documented, but a newcomer must not skip or reorder them.

**Why it matters.** Any missed step (e.g. migrations before first run, or
forgetting Docker) produces a confusing runtime error rather than a clear "you
skipped step N" message.

**Recommendation.** Add a single `pnpm setup` script that chains
generate + migrate (and checks Docker/Redis/Postgres reachability), and have
`pnpm dev` fail fast with an actionable message if migrations haven't run or
Redis is unreachable.

## 2. The worker is required but easy to forget

**Finding.** Immediate transactional sends go out inline from the API, but
**scheduled sends and campaigns require the worker**. `pnpm dev` starts it, but
running apps individually, or in a custom prod setup, makes it easy to omit.

**Why it matters.** A user can "successfully" send a one-off email, then create
a campaign that silently never fires, with no obvious cause.

**Recommendation.** Surface worker/queue health in the dashboard (e.g. a banner
when no worker has checked in recently) and call it out prominently in
[FIRST_CAMPAIGN.md](FIRST_CAMPAIGN.md) (done).

## 3. Configuration is secret-heavy

**Finding.** `.env` carries many values: `DATABASE_URL`, `REDIS_HOST`/`PORT`,
`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`, `TRACKING_SECRET`,
`WEBHOOK_SECRET`, `APP_URL`, `PUBLIC_APP_URL`. Local defaults work, but several
must change for production.

**Why it matters.** Two are genuine footguns:
- **`ENCRYPTION_KEY`** — changing it after saving SMTP connections makes stored
  credentials undecryptable.
- **`APP_URL`** — must be publicly reachable over HTTPS or open/click tracking
  silently fails to record.

**Recommendation.** Keep the [Beta checklist](BETA_CHECKLIST.md) front-and-
centre, and consider a startup validation that warns when production secrets are
still `change-me` or when `APP_URL` is `localhost` in production.

## 4. SMTP must be brought before anything works

**Finding.** Nothing sends until the user has their own SMTP server and creates
a verified connection. Provider-native APIs are not implemented — it's SMTP
only.

**Why it matters.** Users coming from hosted ESPs may expect a built-in sender
or a one-click provider integration and stall at the first real step.

**Recommendation.** Set expectations early ("bring your own SMTP") on the
landing page and Quickstart, and link the new [SMTP provider guide](SMTP_PROVIDER_GUIDE.md)
prominently.

## 5. Password reset silently no-ops without a default SMTP connection

**Finding.** Password-reset emails are sent through the org's default SMTP
connection. If none exists, QQueue logs a warning and sends nothing while still
returning the generic success message (to avoid leaking account existence).

**Why it matters.** A user who locks themselves out before configuring SMTP has
no recovery path and no visible error.

**Recommendation.** Detect "no default SMTP connection" during reset and show an
admin-facing hint in the dashboard; document the behavior (covered in
[Troubleshooting](TROUBLESHOOTING.md)).

## 6. Missing in-product onboarding

**Finding.** There's no guided first-run/empty-state flow described in the docs
(create org → add SMTP → send test). The dashboard exists, but the "what do I do
first?" path lives only in the docs.

**Recommendation.** Add empty-state CTAs on key pages (SMTP Connections,
Contacts, Templates, Campaigns) that link to the matching doc, and a short
first-run checklist widget on the Dashboard.

## 7. Docs are text-only — no screenshots

**Finding.** Every guide is text. Setup-heavy screens (SMTP setup, Send Email,
Campaign creation, Queue Operations, Campaign analytics) are easier to follow
with visuals.

**Recommendation.** Add annotated screenshots (or a short clip) to: SMTP
connection form, Send Email, Campaign create + schedule, Queue Operations failed
job + retry, and Campaign analytics. Reuse frames from the
[demo recording](DEMO_SCRIPT.md).

## 8. Examples thin out beyond `sendEmail`

**Finding.** The SDK covers only `sendEmail`, and copy-paste examples for
contacts/lists/templates/campaigns over the API are limited to the README setup
flow.

**Recommendation.** Add an "API recipes" section (create contact → list →
template → campaign via curl) and clearly note SDK scope so integrators aren't
surprised.

---

## Prioritized recommendations

| Priority | Recommendation |
| --- | --- |
| **High** | Worker/queue health indicator in the dashboard (#2) |
| **High** | Startup validation for `change-me` secrets and `localhost` `APP_URL` in prod (#3) |
| **High** | `pnpm setup` one-shot + fail-fast on missing migrations/Redis (#1) |
| **High** | Surface "no default SMTP connection" during password reset (#5) |
| **Medium** | Empty-state onboarding CTAs + first-run checklist widget (#6) |
| **Medium** | Annotated screenshots in the key guides (#7) |
| **Medium** | "Bring your own SMTP" expectation-setting on landing + Quickstart (#4) |
| **Low** | API recipes for contacts/campaigns; document SDK scope (#8) |

Closing these does not require new product surface — most are clarity,
validation, and onboarding improvements on top of the existing feature set.

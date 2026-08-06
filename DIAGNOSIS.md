# DIAGNOSIS — Sending Health metrics are not measuring what they claim

> Investigation only. **No code was changed.** All proposed diffs below are
> awaiting approval. Written 2026-08-06 against `main` @ `07cdd8c`.

---

## 0. Two premise corrections before the hypotheses

Both matter because they change what the fix actually is.

### 0.1 `PLAN.md` does not exist

There is no `PLAN.md` in the working tree, anywhere under `docs/`, or in git
history (`git log --all --name-only | grep -i plan` returns only
`docs/PHASE_A_PLAN.md`, `docs/PHASE_C_PLAN.md`, `docs/PHASE_D_PLAN.md` —
older, unrelated phase docs, none of which mention 2b).

The August evolution plan lives in **`docs/ROADMAP.md` § "Evolution plan
(2026-08) — status and deferred backlog"** (line 331) plus `CHANGELOG.md`.
Bucket C below targets that section instead. If you have a `PLAN.md` open in
another checkout or in a chat scratchpad, point me at it and I'll retarget.

### 0.2 Phase 2b already shipped — on 2026-08-05

This is the most important correction in the document.

- Commit **`346481f` "feat: implement DSN handling for bounce processing"**
  (2026-08-05 18:46) added [dsn.ts](apps/worker/src/lib/dsn.ts) (423 lines),
  wired it into [inbox-sync.ts:174-259](apps/worker/src/lib/inbox-sync.ts#L174-L259),
  added the `InboundMessage.isDsn` column (migration
  `20260805130000_add_inbound_message_is_dsn`), and shipped 433 lines of tests.
- [docs/ROADMAP.md:340](docs/ROADMAP.md#L340) already reads
  `- [x] Phase 2b — async bounce processing (DSN parsing in inbox sync)`.
- `AUDIT.md` §6.1 documents it as surface **C**.

So 2b is not "next" — it is **built, merged, and (as far as I can tell) never
observed working in your instance**. That reframes the whole investigation: the
question is not "when do we build DSN parsing" but "why is DSN parsing
producing zero bounces". §1.4 answers that, and it is *not* a code bug.

---

## 1. HYPOTHESIS 1 — Bounce blindness behind a local relay

### **CONFIRMED**, with one amendment and one new root cause.

### 1.1 The synchronous path fires only on in-conversation rejection

[email-sending.worker.ts:185](apps/worker/src/workers/email-sending.worker.ts#L185):

```ts
// The SMTP server rejected the recipient outright: treat as a bounce
// rather than a successful send.
if (result.rejected.length > 0) {
  const bounceType = classifyBounce({ message: result.rejectionResponse });
  // ... BOUNCED EmailEvent, status FAILED, shouldSuppressBounce ...
}
```

`result.rejected` is Nodemailer's `info.rejected`, populated **only** when the
relay answers `RCPT TO:` (or `DATA`) with a permanent error *during the SMTP
conversation*. A Mailcow/Postfix relay that answers `250 2.0.0 Ok: queued as
…` produces `rejected: []`, so this branch never runs and the job takes the
`SENT` branch at line 250. Your hypothesis is exactly right.

Two facts strengthen it further:

- **This is now the *only* synchronous surface.** Phase 1 (`16eda39`) deleted
  the inline API send path — `transactionalEmailService.send` always enqueues
  (`"scheduledAt is simply a queued job with no delay"`,
  [service.ts:243](apps/api/src/modules/transactional-email/service.ts#L243)).
  Before Phase 1 there was a second site that ignored `result.rejected`
  entirely; that asymmetry is gone. Good news, but it means one `if` at line
  185 is the entire synchronous bounce surface.
- **The ESP webhook is off.** `INBOUND_ESP_WEBHOOK_ENABLED` defaults to
  `"false"` ([env.ts:52-55](apps/api/src/config/env.ts#L52-L55)) and
  [tracking/controller.ts:71](apps/api/src/modules/tracking/controller.ts#L71)
  returns 404 when unset. Your `.env` does not set it (only `WEBHOOK_SECRET`,
  which is for *outbound* webhooks). So `recordWebhookEvent` — the only other
  producer of `BOUNCED` events besides the worker and DSN parsing — is dead
  code in your setup. Confirmed as you assumed.

### 1.2 The tiles count `BOUNCED` EmailEvents only — confirmed

[deliverability/service.ts:33-55](apps/api/src/modules/deliverability/service.ts#L33-L55):

| Tile | Source | Exact query |
|---|---|---|
| **Bounce rate** | `rates.bounce = bounced / sent` | `bounced` = `counts.BOUNCED` from `emailEvent.groupBy({ by: ["type"], where: { organizationId, occurredAt: [from,to] } })`; `sent` = `counts.SENT` from the same groupBy |
| **Hard / soft bounces** | `totals.hardBounced` / `softBounced` | `emailEvent.count({ type: "BOUNCED", metadata: { path: ["bounceType"], equals: "HARD" \| "SOFT" } })` |

Both are `EmailEvent` rows with `type = 'BOUNCED'`. Nothing else feeds them —
not `EmailJob.status`, not `Contact.status`, not `InboundMessage`.

**Amendment (a real, separate bug):** `classifyBounce` returns
`"HARD" | "SOFT" | "BLOCK"`
([packages/email-engine/src/bounce.ts](packages/email-engine/src/bounce.ts)),
but only HARD and SOFT have tiles. A `BLOCK` bounce is counted in
`totals.bounced` and in the bounce *rate*, but appears in neither half of
"Hard / soft bounces". Once bounces start flowing, that tile will silently
under-report. Fixed in Bucket A.

### 1.3 The denominator is also wrong (bonus finding)

`sent` is a count of **`SENT` EmailEvent rows in the window**, not of jobs. A
message sent on day 1 that bounces on day 40 contributes its `BOUNCED` event to
a window that excludes its `SENT` event. Bounce rate is therefore capable of
exceeding 100%, and async bounces — which by nature lag the send — are
systematically mismatched to their denominator. This is minor today (0/11) but
becomes the dominant error once §1.4 is fixed.

### 1.4 Why DSN parsing (which exists) still yields zero — the actual root cause

`applyDsnBounce` runs only for messages that reach `storeParsedMessage`, and
that only happens for mailboxes with an **ACTIVE `InboxAccount`**. Two gates
are almost certainly closed in your instance:

1. **Coverage.** [inbox-sync.ts:262-269](apps/worker/src/lib/inbox-sync.ts#L262-L269)
   syncs `InboxAccount` rows with `status: "ACTIVE"`. If no inbox account
   exists for the mailbox your Mailcow relay returns DSNs to (typically the
   `SMTPConnection.fromEmail` address, or its `MAILER-DAEMON`/postmaster
   alias), *nothing is ever read* and no DSN is ever parsed. `AUDIT.md` §6.1
   states this limit outright: "Coverage is limited to identities that have a
   synced `InboxAccount`."
2. **Forward-only reads.**
   [inbox-sync.ts:291-294](apps/worker/src/lib/inbox-sync.ts#L291-L294):
   ```ts
   const startUid =
     account.lastSeenUid && account.lastSeenUid > 0
       ? account.lastSeenUid + 1
       : Math.max(1, mailbox.uidNext - env.INBOX_SYNC_MAX_MESSAGES);
   ```
   The first sync reads only the last `INBOX_SYNC_MAX_MESSAGES` (default **50**)
   messages; every sync after that reads strictly forward from `lastSeenUid`.
   **Every DSN that arrived before the account was added, or more than 50
   messages back, is permanently invisible to the sync loop.** This is the
   backfill item — it is real, and it is why enabling an inbox account *today*
   will not retroactively explain your existing wrong addresses.

So: the mechanism is built and correct; it has simply never been pointed at the
mailbox where your bounces landed. **Your read-only SQL (b) below will tell you
in one query whether the DSNs are sitting in Postgres already (coverage exists,
backfill needed) or not in Postgres at all (no coverage — an inbox account must
be configured first).**

### 1.5 SQL for Hypothesis 1 — read-only, run against production

```sql
-- ===========================================================================
-- H1 (a): Have we EVER recorded a bounce event? (all time, all orgs)
-- ===========================================================================
SELECT
  o.id                                        AS organization_id,
  o.name                                      AS organization,
  count(*) FILTER (WHERE e.type = 'BOUNCED')  AS bounced_events_all_time,
  count(*) FILTER (WHERE e.type = 'BOUNCED'
                     AND e.metadata->>'source' = 'dsn')      AS from_dsn,
  count(*) FILTER (WHERE e.type = 'BOUNCED'
                     AND e.metadata->>'source' = 'webhook')  AS from_esp_webhook,
  count(*) FILTER (WHERE e.type = 'BOUNCED'
                     AND e.metadata->>'source' IS NULL)      AS from_smtp_rejection,
  count(*) FILTER (WHERE e.type = 'SENT')     AS sent_events_all_time,
  count(*) FILTER (WHERE e.type = 'DELIVERED') AS delivered_events_all_time,
  min(e."occurredAt") FILTER (WHERE e.type = 'BOUNCED') AS first_bounce,
  max(e."occurredAt") FILTER (WHERE e.type = 'BOUNCED') AS last_bounce
FROM "Organization" o
LEFT JOIN "EmailEvent" e ON e."organizationId" = o.id
GROUP BY o.id, o.name
ORDER BY o.name;

-- Same question, one number, no grouping — the headline for (a):
SELECT count(*) AS bounced_events_ever FROM "EmailEvent" WHERE type = 'BOUNCED';


-- ===========================================================================
-- H1 (b): Are there DSN-shaped messages sitting in the inbox tables?
--          Grouped by inbox account, as requested.
-- ===========================================================================
WITH dsn_shaped AS (
  SELECT
    m.id,
    m."inboxAccountId",
    m."organizationId",
    m."isDsn",
    m."receivedAt",
    m."fromEmail",
    m.subject,
    m."emailJobId"
  FROM "InboundMessage" m
  WHERE m."fromEmail" ILIKE 'mailer-daemon%'
     OR m."fromEmail" ILIKE 'postmaster%'
     OR m.subject     ILIKE '%undeliver%'
     OR m.subject     ILIKE '%delivery status%'
     OR m.subject     ILIKE '%returned mail%'
     OR m.subject     ILIKE '%delivery failure%'      -- common Exchange wording
     OR m.subject     ILIKE '%failure notice%'        -- common qmail wording
     OR m.subject     ILIKE '%mail delivery failed%'  -- common Exim wording
)
SELECT
  a.id                       AS inbox_account_id,
  a.email                    AS inbox_account,
  a.status                   AS account_status,
  a.mailbox,
  a."lastSyncedAt",
  a."lastSeenUid",
  o.name                     AS organization,
  count(d.id)                AS dsn_shaped_messages,
  count(d.id) FILTER (WHERE d."isDsn")            AS flagged_isDsn,
  count(d.id) FILTER (WHERE NOT d."isDsn")        AS shaped_but_not_flagged,
  count(d.id) FILTER (WHERE d."emailJobId" IS NOT NULL) AS thread_anchored,
  min(d."receivedAt")        AS earliest,
  max(d."receivedAt")        AS latest
FROM "InboxAccount" a
JOIN "Organization" o ON o.id = a."organizationId"
LEFT JOIN dsn_shaped d ON d."inboxAccountId" = a.id
GROUP BY a.id, a.email, a.status, a.mailbox, a."lastSyncedAt", a."lastSeenUid", o.name
ORDER BY dsn_shaped_messages DESC;

-- If the query above returns ZERO ROWS, there are no inbox accounts at all —
-- that alone confirms §1.4 gate 1 and no backfill is possible until one exists.
SELECT count(*) AS inbox_accounts_total,
       count(*) FILTER (WHERE status = 'ACTIVE') AS inbox_accounts_active
FROM "InboxAccount";

-- And: which addresses do we actually send as? (Where DSNs would be returned.)
SELECT c.id, c.name, c."fromEmail", c."isDefault", o.name AS organization
FROM "SMTPConnection" c JOIN "Organization" o ON o.id = c."organizationId"
ORDER BY o.name, c."isDefault" DESC;

-- Sample the shaped-but-unflagged messages to see if parseDsn is missing a
-- format (only meaningful if shaped_but_not_flagged > 0 above):
SELECT "receivedAt", "fromEmail", subject, left(coalesce(text, ''), 300) AS body_head
FROM "InboundMessage"
WHERE NOT "isDsn"
  AND ("fromEmail" ILIKE 'mailer-daemon%' OR "fromEmail" ILIKE 'postmaster%'
       OR subject ILIKE '%undeliver%' OR subject ILIKE '%delivery status%'
       OR subject ILIKE '%returned mail%')
ORDER BY "receivedAt" DESC
LIMIT 20;
```

**Reading the result:**

| (a) bounced events | (b) DSN-shaped inbound | Conclusion |
|---|---|---|
| ~0 | > 0 | **H1 confirmed as you framed it.** DSNs arrived and are stored; the backfill (Bucket B2) recovers them. |
| ~0 | 0, and inbox accounts exist | DSNs are landing in a mailbox nobody syncs, or the relay swallows them. Configure the right `InboxAccount`, then backfill. |
| ~0 | 0, and **no** inbox accounts | **Most likely.** H1 confirmed *and* §1.4 gate 1 is the operative cause. Nothing to backfill from Postgres — needs a full mailbox re-scan (Bucket B2 option 2). |

---

## 2. HYPOTHESIS 2 — "Suppressed: 0" counts recent blocked sends

### **REFUTED.** The tile is already the suppression-list total. Zero means the list is genuinely empty — which is the real finding.

### 2.1 The query behind the tile

[deliverability/service.ts:54](apps/api/src/modules/deliverability/service.ts#L54):

```ts
prisma.suppression.count({ where: { organizationId: input.organizationId } })
```

Note what is **absent**: no `occurredAt`/`createdAt` filter, no 30-day window,
no reference to `EmailJob`. It is a plain lifetime count of `Suppression` rows
for the org, surfaced as `totals.suppressed` and rendered by
[Deliverability.tsx:173-176](apps/web/src/pages/Deliverability.tsx#L173-L176).

Grepping the whole module for `SUPPRESSED` (the `EmailJobStatus`) returns
nothing — **blocked sends are not counted anywhere in the product**. That is
the opposite of your hypothesis, and it means both halves of your Bucket A2
ask are needed: the total is there but unlabelled, and the window count does
not exist at all.

**Therefore `Suppressed: 0` is not a labelling artifact. Your `Suppression`
table is empty for that org.**

### 2.2 Why your known unsubscribers are probably not in it

The suppression write is unconditional and comes *first*
([unsubscribe/service.ts:10-21](apps/api/src/modules/unsubscribe/service.ts#L10-L21)):

```ts
await suppressionService.addSuppression({ organizationId, email,
  reason: "UNSUBSCRIBE", source: "list-unsubscribe" });
await prisma.contact.updateMany({
  where: { organizationId, email: { equals: email, mode: "insensitive" } },
  data: { status: "UNSUBSCRIBED" }
});
```

So if that endpoint ran, a `Suppression` row exists. If none exists, **the
endpoint never ran**. The likely reason is structural:

> **QQueue never puts an unsubscribe link in an email body — ever.**

`buildUnsubscribeUrl` is called from exactly one place: `buildListUnsubscribeHeaders`
in [packages/email-engine/src/unsubscribe.ts:86](packages/email-engine/src/unsubscribe.ts#L86).
That helper has exactly one caller:
[email-sending.worker.ts:159-166](apps/worker/src/workers/email-sending.worker.ts#L159-L166) —

```ts
const headers = emailJob.isBulk
  ? buildListUnsubscribeHeaders(env.APP_URL, emailJob.organizationId,
      emailJob.toEmail, env.TRACKING_SECRET)
  : undefined;
```

`injectTracking` rewrites `<a href>` and appends a pixel; it does **not** add an
unsubscribe link. So the only unsubscribe affordance QQueue emits is the mail
client's header-driven "Unsubscribe" button, and only on jobs with
`isBulk = true` (campaign fan-out and recurring sends). Consequences:

- A **one-off Email Studio send** or a **transactional send** carries no
  unsubscribe path whatsoever. A recipient who wanted off that list had to
  reply to you — which QQueue records as an `InboundMessage`, never as a
  suppression.
- Even on a bulk send, the recipient must click the *mail-client* button (Gmail's
  "Unsubscribe" chip, Apple Mail's banner), not something in your copy.

This is consistent with everything else: `Suppressed: 0`, `Bounces: 0`, and a
user who *knows* people unsubscribed. The unsubscribes happened in the human
channel and never reached the endpoint.

### 2.3 Could a divergence exist anyway? Audit of every path

| Path | Sets `Contact.status = UNSUBSCRIBED`? | Creates `Suppression`? |
|---|---|---|
| `unsubscribeService.unsubscribe` (only writer of `UNSUBSCRIBED` — verified by grep across `apps/api`, `apps/worker`, `packages/shared`) | yes | yes, **first** |
| Contact create/update API — `contactSchema` ([shared:572-579](packages/shared/src/index.ts#L572-L579)) has **no `status` field** | impossible | n/a |
| CSV import — documented never to touch status | no | no |
| Bounce auto-suppression (worker + DSN) | sets `BOUNCED`, not `UNSUBSCRIBED` | yes |
| Manual `POST /suppressions` | no | yes (`reason: MANUAL`) |

**So `UNSUBSCRIBED`-without-suppression is not reachable in today's code.**
Two historical routes remain, both worth checking:

1. **The pre-Phase-2 mutating GET.** Before `16eda39`, `GET /unsubscribe`
   performed the unsubscribe as a side effect, so link prefetchers could
   silently unsubscribe people. That produced *both* rows, so it creates
   phantom suppressions, not missing ones — but it means any suppression you
   find dated before 2026-08-05 may be a prefetcher, not a human.
2. **The Phase-2 lowercase migration**
   (`20260805120000_per_recipient_sends_and_bulk_flag`). It `DELETE`s duplicate
   `Suppression` rows that collide case-insensitively (earliest wins) — that
   collapses duplicates, it cannot empty a list. More consequentially, it
   **skips** lowercasing `Contact` rows whose lowercase form collides with
   another contact in the same org, so some contacts still carry mixed-case
   emails. **Any reconciliation SQL must compare with `lower()` on both sides**
   or it will report false divergences. The queries below do.

The **reverse** direction (suppression present, contact still `ACTIVE`) is
common and often legitimate: suppressing an address with no `Contact` row, or
importing a contact after the suppression (import never touches status). Those
are still worth listing — a genuinely-ACTIVE contact that is silently blocked on
every send is confusing to operators — but they must be reviewed, never
auto-flipped.

### 2.4 SQL for Hypothesis 2 — read-only

```sql
-- ===========================================================================
-- H2 (1): Suppression rows per org, by reason. The ground truth behind the tile.
-- ===========================================================================
SELECT
  o.name                AS organization,
  s."organizationId",
  s.reason,
  count(*)              AS rows,
  min(s."createdAt")    AS earliest,
  max(s."createdAt")    AS latest
FROM "Suppression" s
JOIN "Organization" o ON o.id = s."organizationId"
GROUP BY ROLLUP (o.name, s."organizationId", s.reason)
ORDER BY o.name NULLS LAST, s.reason NULLS LAST;

-- Every suppression, with provenance. Small table; read it whole.
-- `source = 'list-unsubscribe'` = the unsubscribe endpoint;
-- an EmailJob cuid or 'dsn:<id>' = a bounce; 'webhook' = the (disabled) ESP path.
SELECT o.name AS organization, s.email, s.reason, s.source, s."createdAt"
FROM "Suppression" s JOIN "Organization" o ON o.id = s."organizationId"
ORDER BY s."createdAt" DESC;

-- ===========================================================================
-- H2 (2): Contacts by status, per org.
-- ===========================================================================
SELECT o.name AS organization, c.status, count(*) AS contacts
FROM "Contact" c JOIN "Organization" o ON o.id = c."organizationId"
GROUP BY o.name, c.status
ORDER BY o.name, c.status;

SELECT o.name AS organization, c.email, c.status, c."updatedAt"
FROM "Contact" c JOIN "Organization" o ON o.id = c."organizationId"
WHERE c.status <> 'ACTIVE'
ORDER BY c."updatedAt" DESC;

-- ===========================================================================
-- H2 (3a): DIVERGENCE — contact is UNSUBSCRIBED but nothing suppresses it.
--          Should be empty given §2.3; non-empty means a historical hole.
--          lower() on both sides: the Phase-2 migration left some mixed-case
--          contacts behind, and a naive = join would report false hits.
-- ===========================================================================
SELECT
  o.name          AS organization,
  c."organizationId",
  c.email         AS contact_email,
  c.status,
  c."createdAt"   AS contact_created,
  c."updatedAt"   AS contact_updated
FROM "Contact" c
JOIN "Organization" o ON o.id = c."organizationId"
WHERE c.status = 'UNSUBSCRIBED'
  AND NOT EXISTS (
    SELECT 1 FROM "Suppression" s
    WHERE s."organizationId" = c."organizationId"
      AND lower(s.email) = lower(c.email)
  )
ORDER BY o.name, c."updatedAt" DESC;

-- Same idea for bounce-status contacts with no suppression backing them:
SELECT o.name AS organization, c.email, c.status, c."updatedAt"
FROM "Contact" c
JOIN "Organization" o ON o.id = c."organizationId"
WHERE c.status = 'BOUNCED'
  AND NOT EXISTS (
    SELECT 1 FROM "Suppression" s
    WHERE s."organizationId" = c."organizationId"
      AND lower(s.email) = lower(c.email)
  )
ORDER BY o.name, c."updatedAt" DESC;

-- ===========================================================================
-- H2 (3b): REVERSE DIVERGENCE — suppressed, but the contact still reads ACTIVE.
--          Often legitimate (import after suppression). Review, never auto-fix.
-- ===========================================================================
SELECT
  o.name        AS organization,
  s.email       AS suppressed_email,
  s.reason,
  s.source,
  s."createdAt" AS suppressed_at,
  c.email       AS contact_email,
  c.status      AS contact_status,
  c."createdAt" AS contact_created,
  (c."createdAt" > s."createdAt") AS contact_created_after_suppression
FROM "Suppression" s
JOIN "Organization" o ON o.id = s."organizationId"
JOIN "Contact" c
  ON c."organizationId" = s."organizationId"
 AND lower(c.email) = lower(s.email)
WHERE c.status = 'ACTIVE'
ORDER BY o.name, s."createdAt" DESC;

-- ===========================================================================
-- H2 (4): Would the missing tile have shown anything? Blocked sends, 30 days.
--          (This count exists nowhere in the product today — Bucket A2 adds it.)
-- ===========================================================================
SELECT o.name AS organization, j.status, count(*) AS jobs
FROM "EmailJob" j JOIN "Organization" o ON o.id = j."organizationId"
WHERE j."createdAt" >= now() - interval '30 days'
GROUP BY o.name, j.status
ORDER BY o.name, j.status;

-- ===========================================================================
-- H2 (5): Did anyone ever get an unsubscribe header at all?
--          isBulk = false everywhere means no recipient could unsubscribe.
-- ===========================================================================
SELECT o.name AS organization, j.origin, j."isBulk", count(*) AS jobs,
       min(j."createdAt") AS first, max(j."createdAt") AS last
FROM "EmailJob" j JOIN "Organization" o ON o.id = j."organizationId"
GROUP BY o.name, j.origin, j."isBulk"
ORDER BY o.name, j.origin, j."isBulk";

-- Bonus: replies that read like unsubscribe requests — the human channel that
-- your unsubscribers most likely used. Not a suppression source today.
SELECT m."receivedAt", m."fromEmail", m.subject, left(coalesce(m.text,''), 200)
FROM "InboundMessage" m
WHERE NOT m."isDsn"
  AND (m.text ILIKE '%unsubscribe%' OR m.subject ILIKE '%unsubscribe%'
       OR m.text ILIKE '%remove me%' OR m.text ILIKE '%stop emailing%'
       OR m.text ILIKE '%take me off%')
ORDER BY m."receivedAt" DESC
LIMIT 50;
```

---

## 3. HYPOTHESIS 3 — "Delivery rate" is actually open rate

### **CONFIRMED.** It is arithmetically identical to the unique-open rate.

### 3.1 The calculation

[deliverability/service.ts:64-88](apps/api/src/modules/deliverability/service.ts#L64-L88):

```ts
const sent      = counts.SENT ?? 0;
const delivered = counts.DELIVERED ?? 0;
// ...
rates: {
  delivery: rate(delivered, sent),          // <-- the tile
  bounce:   rate(bounced, sent),
  complaint:rate(complained, sent),
  open:     rate(uniqueOpens.length, sent), // <-- computed from OPENED
  click:    rate(uniqueClicks.length, sent)
}
```

Rendered at [Deliverability.tsx:161](apps/web/src/pages/Deliverability.tsx#L161)
as `{ label: "Delivery rate", value: pct(overview.rates.delivery) }`.

### 3.2 Where `DELIVERED` events come from

A repo-wide grep for `DELIVERED` (excluding tests; excluding
`WebhookDelivery.status`, which is a plain string on a different table) finds
exactly **two** writers:

1. **`trackingService.recordOpen`** —
   [tracking/service.ts:37-66](apps/api/src/modules/tracking/service.ts#L37-L66):
   ```ts
   /** Record an open (and a one-time DELIVERED, since an open implies delivery). */
   const delivered = await prisma.emailEvent.findFirst({
     where: { emailJobId, type: "DELIVERED" }, select: { id: true } });
   await prisma.emailEvent.createMany({ data: [
     ...(delivered ? [] : [{ organizationId, emailJobId, type: "DELIVERED" as const }]),
     { organizationId, emailJobId, type: "OPENED" as const }
   ]});
   ```
   One synthetic `DELIVERED` per job, written in the same `createMany` as the
   **first** `OPENED`.
2. **`trackingService.recordWebhookEvent`** — the inbound ESP webhook, which
   §1.1 established is disabled by default and not enabled in your `.env`.
   Confirmed: no other source in your setup.

### 3.3 The arithmetic

`delivered` counts `DELIVERED` events in the window (one per job, at first
open). `uniqueOpens` is `groupBy({ by: ["emailJobId"], where: { type: "OPENED" }})`
— distinct jobs opened in the window. Since the `DELIVERED` row is created in
the same statement as a job's first `OPENED`, these two are the **same set**:

```
rates.delivery  ==  delivered / sent  ==  uniqueOpens.length / sent  ==  rates.open
```

**A test you can run right now with no SQL:** on your Sending Health page,
divide the **Opens** tile by the **Sent** tile. It should equal the Delivery
rate to the decimal. Your `63.6%` is `7/11` — I'd expect Sent = 11 and Opens = 7.
If that matches, H3 is confirmed on your own screen.

What the tile therefore actually reports: *the share of accepted messages whose
tracking pixel loaded at least once in the window* — inflated by scanner
prefetches (there is no bot filtering: `AUDIT.md` §6.7, "every pixel load
including scanner prefetch is a distinct OPENED row"), and deflated by every
recipient with images disabled. It is not a delivery measurement in any sense.
It can also exceed 100%, since a job sent before the window can be opened inside
it (§1.3).

### 3.4 The same synthetic number leaks into two more places

- `deliverabilityService.domains` builds a per-domain `delivered` column from
  the same events ([service.ts:118](apps/api/src/modules/deliverability/service.ts#L118)).
  The UI never renders it, but it is in the API response.
- `campaignService.analytics` returns `delivered: counts.DELIVERED ?? 0`
  ([campaigns/service.ts:529](apps/api/src/modules/campaigns/service.ts#L529)),
  which `CampaignAnalytics.tsx` does surface. Same fiction, per campaign.

---

## 4. BUCKET A — safe, immediate (diffs proposed, awaiting approval)

Four files. Nothing here changes send behavior; it changes what is reported. I
have **not** applied any of it.

### A1 — `apps/api/src/modules/deliverability/service.ts`

Remove the synthetic delivery rate; split "suppressed" into list-total,
unsubscribe-total, and window-blocked; expose the `BLOCK` bounces the tile
currently hides; and report whether an async bounce source exists at all so the
UI can caveat the bounce numbers instead of asserting them.

```diff
@@ export const deliverabilityService = {
-    const [byType, hardBounced, softBounced, uniqueOpens, uniqueClicks, suppressed] =
-      await Promise.all([
-        prisma.emailEvent.groupBy({
-          by: ["type"],
-          where,
-          _count: { _all: true }
-        }),
-        prisma.emailEvent.count({
-          where: { ...where, type: "BOUNCED", metadata: { path: ["bounceType"], equals: "HARD" } }
-        }),
-        prisma.emailEvent.count({
-          where: { ...where, type: "BOUNCED", metadata: { path: ["bounceType"], equals: "SOFT" } }
-        }),
-        prisma.emailEvent.groupBy({
-          by: ["emailJobId"],
-          where: { ...where, type: "OPENED" }
-        }),
-        prisma.emailEvent.groupBy({
-          by: ["emailJobId"],
-          where: { ...where, type: "CLICKED" }
-        }),
-        prisma.suppression.count({ where: { organizationId: input.organizationId } })
-      ]);
+    const [
+      byType,
+      hardBounced,
+      softBounced,
+      blockBounced,
+      uniqueOpens,
+      uniqueClicks,
+      suppressionListTotal,
+      unsubscribeTotal,
+      blockedSendsInWindow,
+      asyncBounceSources
+    ] = await Promise.all([
+      prisma.emailEvent.groupBy({ by: ["type"], where, _count: { _all: true } }),
+      prisma.emailEvent.count({
+        where: { ...where, type: "BOUNCED", metadata: { path: ["bounceType"], equals: "HARD" } }
+      }),
+      prisma.emailEvent.count({
+        where: { ...where, type: "BOUNCED", metadata: { path: ["bounceType"], equals: "SOFT" } }
+      }),
+      // BLOCK bounces are real bounces that belonged to neither tile before.
+      prisma.emailEvent.count({
+        where: { ...where, type: "BOUNCED", metadata: { path: ["bounceType"], equals: "BLOCK" } }
+      }),
+      prisma.emailEvent.groupBy({ by: ["emailJobId"], where: { ...where, type: "OPENED" } }),
+      prisma.emailEvent.groupBy({ by: ["emailJobId"], where: { ...where, type: "CLICKED" } }),
+      // Lifetime size of the never-send list (NOT windowed) ...
+      prisma.suppression.count({ where: { organizationId: input.organizationId } }),
+      prisma.suppression.count({
+        where: { organizationId: input.organizationId, reason: "UNSUBSCRIBE" }
+      }),
+      // ... and, separately, sends the list actually blocked inside the window.
+      prisma.emailJob.count({
+        where: {
+          organizationId: input.organizationId,
+          status: "SUPPRESSED",
+          createdAt: { gte: from, lte: to }
+        }
+      }),
+      // Async bounces only reach us through a synced mailbox. With none, the
+      // bounce numbers below are a floor, not a total — the UI says so.
+      prisma.inboxAccount.count({
+        where: { organizationId: input.organizationId, status: "ACTIVE" }
+      })
+    ]);
@@
     const sent = counts.SENT ?? 0;
-    const delivered = counts.DELIVERED ?? 0;
     const bounced = counts.BOUNCED ?? 0;
     const complained = counts.COMPLAINED ?? 0;
@@
       totals: {
         sent,
-        delivered,
         opened: uniqueOpens.length,
         clicked: uniqueClicks.length,
         bounced,
         hardBounced,
         softBounced,
+        blockBounced,
         complained,
-        suppressed
+        suppressionListTotal,
+        unsubscribeTotal,
+        blockedSendsInWindow
       },
       rates: {
-        delivery: rate(delivered, sent),
         bounce: rate(bounced, sent),
         complaint: rate(complained, sent),
         open: rate(uniqueOpens.length, sent),
         click: rate(uniqueClicks.length, sent)
-      }
+      },
+      // Metric provenance, so the UI never presents an unmeasurable number as
+      // measured. There is no non-synthetic delivery signal: DELIVERED events
+      // are written by trackingService.recordOpen on first open, so a
+      // "delivery rate" built from them is the open rate wearing a hat.
+      signals: {
+        asyncBounceCoverage: asyncBounceSources > 0,
+        deliveryConfirmationAvailable: false
+      }
     };
```

Also drop the synthetic `delivered` column from `domains()` (the UI never showed
it, so this is API-shape-only):

```diff
     const byDomain = new Map<
       string,
-      { sent: number; delivered: number; bounced: number; complained: number }
+      { sent: number; bounced: number; complained: number }
     >();
     for (const event of scanned) {
       const domain = recipientDomain(event.emailJob.toEmail);
-      const row =
-        byDomain.get(domain) ??
-        { sent: 0, delivered: 0, bounced: 0, complained: 0 };
+      const row = byDomain.get(domain) ?? { sent: 0, bounced: 0, complained: 0 };
       if (event.type === "SENT") row.sent += 1;
-      else if (event.type === "DELIVERED") row.delivered += 1;
       else if (event.type === "BOUNCED") row.bounced += 1;
```

### A2 — `apps/web/src/lib/api.ts` (type, ~line 316)

```diff
 export interface DeliverabilityOverview {
   window: { from: string; to: string };
   totals: {
     sent: number;
-    delivered: number;
     opened: number;
     clicked: number;
     bounced: number;
     hardBounced: number;
     softBounced: number;
+    blockBounced: number;
     complained: number;
-    suppressed: number;
+    /** Lifetime size of the never-send list. Not windowed. */
+    suppressionListTotal: number;
+    /** Of the above, rows whose reason is UNSUBSCRIBE. */
+    unsubscribeTotal: number;
+    /** Sends the list blocked inside the window (EmailJob.status = SUPPRESSED). */
+    blockedSendsInWindow: number;
   };
   rates: {
-    delivery: number;
     bounce: number;
     complaint: number;
     open: number;
     click: number;
   };
+  signals: {
+    asyncBounceCoverage: boolean;
+    deliveryConfirmationAvailable: boolean;
+  };
 }
```

### A3 — `apps/web/src/pages/Deliverability.tsx`

Tiles: "Delivery rate" is gone rather than renamed — an "Open rate" tile
already covers what it was really measuring, and a second tile showing the same
number under a different name is exactly the confusion we're removing.

```diff
-const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
+const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
+
+// Tiles carry an optional second line: a count needs its qualifier next to it,
+// not in a tooltip. "Suppression list: 12" and "12 blocked sends" are different
+// facts and were previously one ambiguous number.
+interface Stat { label: string; value: string; hint?: string }
@@
       <PageHeader
         title="Sending health"
-        description="How your email is landing over the last 30 days, plus auto-blocking and rate-limit controls."
+        description="What happened to mail QQueue accepted for delivery over the last 30 days, plus auto-blocking and rate-limit controls."
       />
@@
+            {overview && !overview.signals.asyncBounceCoverage && (
+              <Card className="border-amber-500/50 p-4">
+                <div className="mb-1 flex items-center gap-2 font-medium">
+                  <AlertTriangle className="h-4 w-4" />
+                  Bounce data is incomplete
+                </div>
+                <p className="text-sm text-muted-foreground">
+                  Your relay accepts mail and reports failures later, by email.
+                  QQueue reads those reports from a synced inbox, and this
+                  organization has none — so only failures rejected during the
+                  SMTP conversation are counted. Add an inbox account for the
+                  address you send from to see real bounces.
+                </p>
+              </Card>
+            )}
+
             {overview && (
               <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
-                {[
-                  { label: "Sent", value: String(overview.totals.sent) },
-                  { label: "Delivery rate", value: pct(overview.rates.delivery) },
-                  { label: "Bounce rate", value: pct(overview.rates.bounce) },
-                  {
-                    label: "Complaint rate",
-                    value: pct(overview.rates.complaint)
-                  },
-                  { label: "Opens", value: String(overview.totals.opened) },
-                  { label: "Clicks", value: String(overview.totals.clicked) },
-                  {
-                    label: "Hard / soft bounces",
-                    value: `${overview.totals.hardBounced} / ${overview.totals.softBounced}`
-                  },
-                  {
-                    label: "Suppressed",
-                    value: String(overview.totals.suppressed)
-                  }
-                ].map((stat) => (
+                {([
+                  {
+                    label: "Accepted by relay",
+                    value: String(overview.totals.sent),
+                    hint: "Handed to SMTP without rejection"
+                  },
+                  {
+                    label: "Bounce rate",
+                    value: pct(overview.rates.bounce),
+                    hint: overview.signals.asyncBounceCoverage
+                      ? undefined
+                      : "Synchronous rejections only"
+                  },
+                  {
+                    label: "Complaint rate",
+                    value: pct(overview.rates.complaint)
+                  },
+                  {
+                    label: "Open rate",
+                    value: pct(overview.rates.open),
+                    hint: "Pixel loads; not a delivery measure"
+                  },
+                  {
+                    label: "Opens / clicks",
+                    value: `${overview.totals.opened} / ${overview.totals.clicked}`
+                  },
+                  {
+                    label: "Hard / soft / blocked",
+                    value: `${overview.totals.hardBounced} / ${overview.totals.softBounced} / ${overview.totals.blockBounced}`
+                  },
+                  {
+                    label: "Blocked address list",
+                    value: String(overview.totals.suppressionListTotal),
+                    hint: `${overview.totals.unsubscribeTotal} from unsubscribes · all time`
+                  },
+                  {
+                    label: "Sends blocked",
+                    value: String(overview.totals.blockedSendsInWindow),
+                    hint: "In this 30-day window"
+                  }
+                ] satisfies Stat[]).map((stat) => (
                   <Card key={stat.label} className="p-4">
                     <div className="text-xs text-muted-foreground">
                       {stat.label}
                     </div>
                     <div className="mt-1 text-2xl font-semibold">
                       {stat.value}
                     </div>
+                    {stat.hint ? (
+                      <div className="mt-1 text-xs text-muted-foreground">
+                        {stat.hint}
+                      </div>
+                    ) : null}
                   </Card>
                 ))}
               </div>
             )}
```

### A4 — suppression-list count where the list actually lives

The count exists on Sending Health but the page that *shows* the list has no
count at all (`Suppressions.tsx` renders a bare table). One line:

```diff
       <PageHeader
         title="Blocked addresses"
-        description="Addresses QQueue will never email, across every send. Bounces, complaints, and unsubscribes land here automatically."
+        description={
+          loading
+            ? "Addresses QQueue will never email, across every send."
+            : `${suppressions.length} ${suppressions.length === 1 ? "address" : "addresses"} QQueue will never email, across every send. Bounces, complaints, and unsubscribes land here automatically.`
+        }
```

### A5 — tests that will need updating alongside A1–A4

Not optional; they assert the current shape:

- `apps/api/src/modules/deliverability/service.test.ts` — asserts `rates.delivery` / `totals.suppressed`.
- `apps/web/src/pages/Deliverability.test.tsx:44-46` — fixture has `suppressed: 12` and `rates: { delivery: 0.9, … }`.
- `apps/api/src/modules/deliverability/controller.test.ts` — check for shape assertions.

### A6 — deliberately NOT in Bucket A (flagging, not doing)

- **`campaignService.analytics` still returns the synthetic `delivered`**
  ([campaigns/service.ts:529](apps/api/src/modules/campaigns/service.ts#L529))
  and `CampaignAnalytics.tsx` renders it. Same fiction, different page. It is a
  larger diff with its own tests; say the word and I'll fold it in.
- **The `sent`-events denominator (§1.3)** should become a count of `EmailJob`
  rows whose `sentAt` falls in the window, so async bounces are divided by the
  cohort they belong to. That is a behavioral change to every rate on the page
  and deserves its own review, not a "safe, immediate" bucket.

---

## 5. BUCKET B — one-off data-repair scripts (you run them manually)

Both are proposals; neither is written yet.

### B1 — `scripts/reconcile-suppressions.ts` — dry-run by default

**Run only if H2 (3a) returns rows.** Given §2.3, I expect it to find nothing,
which is itself the useful result — it converts "maybe the data is broken" into
"the data is fine, the unsubscribes never happened."

Shape (matching `scripts/setup.ts` house style — `tsx`, no new deps):

```
pnpm tsx scripts/reconcile-suppressions.ts                 # dry run, prints a plan
pnpm tsx scripts/reconcile-suppressions.ts --apply         # writes forward direction only
pnpm tsx scripts/reconcile-suppressions.ts --org=<id>      # scope to one org
```

Behavior:

1. **Forward (repairable, idempotent).** For every `Contact` with
   `status = 'UNSUBSCRIBED'` and no case-insensitive `Suppression` match,
   create `Suppression { reason: 'UNSUBSCRIBE', source: 'reconcile:<ISO date>' }`
   via `suppressionService.addSuppression` — reusing the service, not raw SQL,
   so lowercasing and the idempotent upsert come along for free. Same for
   `status = 'BOUNCED'` → `reason: 'BOUNCE'`.
2. **Reverse (report only, never write).** Suppressions whose contact is still
   `ACTIVE`: printed as a review table with `contact_created_after_suppression`
   so a post-suppression re-import is distinguishable from a genuine anomaly.
   **No deletes, no status flips** — un-suppressing is a deliverability
   decision and is OWNER/ADMIN-gated in the API for that reason.
3. **Mixed-case leftovers.** Also report contacts the Phase-2 migration
   skipped (colliding lowercase forms), since those are the rows most likely to
   confuse a future exact-match join.
4. Dry run prints counts + the first 50 of each category and exits 0; `--apply`
   prints what it wrote. Every write carries the `reconcile:` source prefix so
   the action is reversible by inspection.

### B2 — `scripts/backfill-dsn-bounces.ts` — **can be written now; 2b already shipped**

Correcting the brief: this does **not** need to wait. `parseDsn` /
`applyDsnBounce` are on `main` and exported from
[apps/worker/src/lib/dsn.ts](apps/worker/src/lib/dsn.ts), and `applyDsnBounce`
is already idempotent-by-caller (`inbox-sync.ts` guards on first insert). The
backfill just has to supply the same guard.

Two modes, because §1.4's SQL determines which you need:

**Mode 1 — re-scan rows already in Postgres** (use when H1(b) returned rows):

```
pnpm tsx scripts/backfill-dsn-bounces.ts --from-db --since=2026-06-01   # dry run
pnpm tsx scripts/backfill-dsn-bounces.ts --from-db --since=2026-06-01 --apply
```

- Select `InboundMessage` rows matching the DSN shape from H1(b), **including
  those already flagged `isDsn`** — a row can be flagged yet have produced no
  BOUNCED event if `applyDsnBounce` threw (inbox-sync catches and logs at
  [line 253](apps/worker/src/lib/inbox-sync.ts#L253)).
- Limitation to design around: `parseDsn` takes a `ParsedMail`, but
  `InboundMessage` stores only `text`/`html`, not the raw MIME source. The
  machine-readable `message/delivery-status` part is folded into `text` by
  mailparser, so `parseRecipientReports(text)` still works for most real DSNs,
  but `originalMessageIdOf` (which reads the `message/rfc822` attachment) will
  return `undefined` — correlation falls back to In-Reply-To and then to
  recipient-recency. **Recipient-recency has a 7-day window
  ([dsn.ts:270](apps/worker/src/lib/dsn.ts#L270)), so old DSNs will often
  correlate to no job.** That is fine: `applyDsnBounce` still suppresses the
  address from the recipient alone. Expect suppressions to be recovered even
  when per-job bounce events are not. Report both counts separately.
- Idempotency guard the script must add: skip a message if a `BOUNCED`
  `EmailEvent` already carries `metadata->>'inboundMessageId' = <id>`.

**Mode 2 — full mailbox re-scan, ignoring `lastSeenUid`** (use when H1(b)
returned nothing, i.e. the DSNs were never synced):

```
pnpm tsx scripts/backfill-dsn-bounces.ts --rescan --account=<inboxAccountId> \
  --uid-from=1 [--apply]
```

- Reuse `syncInboxAccount`'s ImapFlow setup but fetch `1:*` (or a supplied
  range) instead of `lastSeenUid+1:*`, and **do not write `lastSeenUid`** —
  the script must not move the normal sync's cursor.
- Goes through `storeParsedMessage`, so it gets full `ParsedMail` fidelity
  (original Message-ID correlation works here) and the existing
  first-insert-only guard prevents double-counting messages already stored.
- Read-only against IMAP (`mailboxOpen({ readOnly: true })`, as sync already
  does), so it cannot mark mail as seen or delete anything.
- Prerequisite: an `InboxAccount` must exist for the mailbox. If §1.4 gate 1 is
  the cause, **step zero is creating that account in the UI** — the script is
  step one.

Both modes: dry run prints per-message what it *would* record (recipient,
action, classified bounce type, correlated job or `none`) and exits without
writing.

---

## 6. BUCKET C — plan updates

Retargeted to `docs/ROADMAP.md` § "Evolution plan (2026-08)" (see §0.1), since
`PLAN.md` does not exist. Proposed insert after line 345, before "Deferred
backlog" — again, **not applied**:

```markdown
### Phase 2c — make async bounce accounting actually observable (open)

Phase 2b shipped the DSN parser and wired it into inbox sync (`346481f`), but
shipping the code is not the same as receiving the data. On a local-relay
deployment the parser is the *only* bounce source that can ever fire, and it
fires only for mailboxes that have an `InboxAccount`, reading strictly forward
from `lastSeenUid`. An instance can therefore run Phase 2b and still report
zero bounces forever. See `DIAGNOSIS.md` (2026-08-06).

- [ ] **One-time historical backfill.** Normal sync reads forward from
      `lastSeenUid`, and the very first sync reads only the last
      `INBOX_SYNC_MAX_MESSAGES` (50) messages — so every DSN that arrived
      before an inbox account existed is permanently invisible. Needs a
      deliberate scan: re-parse DSN-shaped `InboundMessage` rows already in
      Postgres, and/or re-fetch a mailbox from UID 1 without moving
      `lastSeenUid`. Guard on `metadata->>'inboundMessageId'` so a re-run
      cannot double-count. (`scripts/backfill-dsn-bounces.ts`, Bucket B2.)
- [ ] **Setup-time coverage check.** Nothing today tells an operator that
      bounce accounting is unreachable. A sending account whose `fromEmail`
      has no corresponding ACTIVE `InboxAccount` should say so — on the
      Sending Health page (Bucket A3 adds the banner) and ideally in the
      setup wizard's checklist.
- [ ] **No unsubscribe affordance on non-bulk mail.** `buildUnsubscribeUrl`
      is reachable only via `buildListUnsubscribeHeaders`, attached only when
      `EmailJob.isBulk`. One-off Email Studio sends and transactional sends
      give a recipient no way to unsubscribe, so those requests arrive as
      replies and are never recorded. Decide: inject a footer link for
      non-transactional mail, or accept and document the gap.
- [ ] **Fix the rate denominators** — every rate divides by `SENT` *events in
      the window*, so a bounce that lands 40 days after its send has no
      matching denominator and the rate can exceed 100%. Async bounces make
      this the common case, not the edge case (AUDIT §6.1, DIAGNOSIS §1.3).

**Priority note.** Behind a local Mailcow/Postfix relay, the relay answers
`250` for essentially everything, so `result.rejected` is empty and the send
worker's synchronous bounce branch effectively never fires. Async DSNs are
therefore *not one bounce source among several — they are all of them*. Until
2c lands, "bounce rate", "hard/soft bounces", and every per-domain bounce
figure are structurally zero regardless of real-world delivery, and no
deliverability decision can be based on them.
```

Also propose amending line 340 so the checkbox does not overstate what is in
production:

```diff
-- [x] Phase 2b — async bounce processing (DSN parsing in inbox sync)
+- [x] Phase 2b — async bounce processing (DSN parsing in inbox sync)
+      *Code complete and tested; not yet observed producing bounces on any
+      live instance — see Phase 2c.*
```

And a matching `CHANGELOG.md` entry once A/B/C actually land.

---

## 7. Numbered summary

**Hypotheses**

1. **H1 (bounce blindness behind a local relay) — CONFIRMED.**
   [email-sending.worker.ts:185](apps/worker/src/workers/email-sending.worker.ts#L185)
   triggers only on `result.rejected.length > 0`, i.e. synchronous SMTP
   rejection, which a Mailcow/Postfix relay answering `250` never produces. The
   bounce tiles count `BOUNCED` EmailEvents exclusively. The ESP webhook is off
   by default and off in your `.env`.
2. **H1 amendment — the async path already exists but is unreachable in your
   instance.** Phase 2b shipped on 2026-08-05 (`346481f`); `dsn.ts` is wired
   into inbox sync. It only ever runs for mailboxes with an ACTIVE
   `InboxAccount`, and only reads forward from `lastSeenUid` (first sync: last
   50 messages). This — not a missing feature — is why bounces read 0.
3. **H1 side finding — `BLOCK`-classified bounces are counted in the bounce
   rate but appear in neither half of the "Hard / soft bounces" tile.**
4. **H1 side finding — every rate divides by `SENT` *events in the window*, so
   an async bounce is divided by a cohort that excludes its own send; the rate
   can exceed 100%.**
5. **H2 ("Suppressed: 0" counts blocked sends) — REFUTED.**
   [deliverability/service.ts:54](apps/api/src/modules/deliverability/service.ts#L54)
   is `prisma.suppression.count({ where: { organizationId } })` — no window, no
   `EmailJob`. It is already the lifetime list total. **`0` means the list is
   genuinely empty.** Separately: blocked sends are counted *nowhere* in the
   product, so both halves of your Bucket A2 request are warranted.
6. **H2 root cause — QQueue never puts an unsubscribe link in an email body.**
   `buildUnsubscribeUrl` is reachable only through `buildListUnsubscribeHeaders`,
   attached only to `isBulk` jobs. Non-bulk recipients have no unsubscribe path,
   so your unsubscribers almost certainly told you by reply — which QQueue
   stores as an `InboundMessage` and never as a suppression.
7. **H2 divergence check — `UNSUBSCRIBED` without a `Suppression` row is not
   reachable in current code** (`unsubscribeService` is the only writer of that
   status and writes the suppression first; `contactSchema` has no `status`
   field). SQL is provided anyway to rule out historical holes; the reverse
   direction is common and legitimate and must be reviewed, never auto-fixed.
8. **H3 ("Delivery rate" is open rate) — CONFIRMED.** `rates.delivery =
   DELIVERED / SENT`, and `DELIVERED` is written only by
   `trackingService.recordOpen` as a one-time synthetic event in the same
   `createMany` as the first `OPENED` (the ESP webhook, the only other writer,
   is disabled). It is arithmetically identical to `rates.open`. The same
   synthetic number also feeds `campaignService.analytics.delivered` and the
   per-domain `delivered` column.

**SQL for you to run** (all read-only, all in this document)

9. **§1.5 (a)** — `BOUNCED` events ever, by org and by source. Expected: 0.
10. **§1.5 (b)** — DSN-shaped `InboundMessage` rows grouped by inbox account,
    plus `InboxAccount` totals and your `SMTPConnection.fromEmail` list. **This
    is the decisive query**: it tells you whether the backfill is a Postgres
    re-scan (Mode 1), an IMAP re-scan (Mode 2), or blocked on creating an inbox
    account first.
11. **§2.4 (1)–(2)** — `Suppression` rows per org by reason (with full provenance
    listing), and `Contact` rows by status. Verifies whether your known
    unsubscribers exist at all.
12. **§2.4 (3a)/(3b)** — divergences both directions, joined with `lower()` on
    both sides (the Phase-2 migration deliberately left some mixed-case contacts
    behind, so an exact-match join reports false hits).
13. **§2.4 (4)–(5)** — blocked sends in the window (the tile that doesn't exist
    yet), `isBulk` distribution (did any recipient ever get an unsubscribe
    header?), and inbound replies containing unsubscribe language.

**Waiting on your approval**

14. **Bucket A** — the A1–A4 diffs above (deliverability service, web API type,
    Sending Health page, Blocked-addresses header) plus the A5 test updates.
    Say go and I'll apply all of it, then run
    `pnpm typecheck && pnpm lint && pnpm test`.
15. **Bucket A6** — whether to extend the same de-fictionalizing to
    `campaignService.analytics.delivered` / `CampaignAnalytics.tsx` (separate
    diff, own tests), and whether to change the `sent`-events denominator now
    or defer it to 2c.
16. **Bucket B1** — write `scripts/reconcile-suppressions.ts`. Worth doing only
    if §2.4 (3a) returns rows; run the SQL first.
17. **Bucket B2** — write `scripts/backfill-dsn-bounces.ts`. **Not blocked on
    2b** (it shipped); blocked only on which mode §1.5 (b) says you need.
18. **Bucket C** — apply the `docs/ROADMAP.md` edits (new "Phase 2c" section +
    the line-340 amendment). Tell me if you'd rather I create a real `PLAN.md`
    holding the evolution plan instead of editing ROADMAP.
19. **Not proposed, flagged for a decision:** whether non-bulk mail should carry
    an unsubscribe footer (item 6). That is a product/compliance call, not a
    bug fix, and I did not assume an answer.

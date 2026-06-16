# Phase D — Advanced Campaign Features (Implementation Plan)

> **Status: PLANNED.** Phase A, A.5, B, and C have shipped (see `docs/STATUS.md`).
> Phase D builds on the Phase C suppression registry (`Suppression`), the static
> tag-driven segment filter (`buildSegmentWhere`), the campaign fan-out worker,
> and the shared send pipeline (`EmailJob` → BullMQ → email-engine → SMTP →
> `EmailEvent`).

Phase D delivers the five advanced-campaign capabilities listed in
`docs/ROADMAP.md`:

1. **Bounce-driven auto-suppression** — soft-vs-hard bounce classification and a
   threshold/window policy on top of the Phase C suppression registry, so a
   single transient (soft) bounce no longer permanently suppresses an address.
2. **Per-domain throttling** — Redis-backed send-rate limiting per recipient
   domain to protect sender reputation and respect receiver limits.
3. **Dynamic segmentation** — a `Segment` model with a rule tree that
   re-resolves at send time (the Phase C tag filter only materializes a static
   list snapshot).
4. **A/B subject testing** — subject variants on a campaign, split-tested over a
   window, with winner selection and a follow-up send to the remainder.
5. **Deliverability tooling** — bounce/complaint/delivery-rate dashboards,
   per-domain breakdowns, suppression-growth, and reputation alerts built on
   `EmailEvent` + `Suppression`.

## Sequencing

Each feature ships independently, behind its own migration, with a full
verification gate (`lint`, `typecheck`, `build`, `test`, `test:smoke:docker`,
`license:audit`, `cloud:boundary`) and a throwaway-Postgres migration check, per
the Phase A–C precedent.

| Order | Feature | Why this order |
|-------|---------|----------------|
| **D1** | Bounce-driven auto-suppression | Smallest, highest deliverability payoff; fixes today's over-aggressive single-soft-bounce suppression. Foundation for D5 metrics. |
| D2 | Per-domain throttling | Pure pipeline work, no schema dependency on the others; protects reputation immediately. |
| D3 | Dynamic segmentation | Foundational audience selection that A/B targeting builds on. |
| D4 | A/B subject testing | Largest; depends on stable fan-out and (optionally) segment targeting. |
| D5 | Deliverability tooling | Consumes the bounce-type and per-domain data the earlier features produce. |

This document specifies all five; **D1 is approved to implement first**. The
order of D2–D5 is a recommendation and can be reordered without rework.

---

## D1 — Bounce-driven auto-suppression (implement first)

> **Status: IMPLEMENTED** (migration `20260616010000_phase_d_bounce_policy`).
> See the Phase D1 verification block in `docs/STATUS.md`.

### Current behavior (to change)

Both bounce paths suppress **immediately and permanently** on any bounce, with
no soft/hard distinction:

- **SMTP rejection** — `apps/worker/src/workers/email-sending.worker.ts:116-151`:
  when `result.rejected.length > 0`, the job is marked `FAILED`, a `BOUNCED`
  event is written, `Contact.status` is set to `BOUNCED`, and
  `addSuppression({ reason: "BOUNCE" })` is called.
- **ESP webhook** — `apps/api/src/modules/tracking/service.ts:133-147`: a
  `BOUNCED` or `COMPLAINED` webhook flips `Contact.status = "BOUNCED"` and calls
  `suppressionService.addSuppression`.

A transient soft bounce (mailbox full, greylisting, temporary defer) therefore
permanently kills the address — too aggressive.

### Target behavior

- **Hard bounce** (`5.x.x`, invalid recipient, no such user) → suppress
  immediately, reason `BOUNCE` (unchanged from today).
- **Complaint** → suppress immediately, reason `COMPLAINT` (unchanged).
- **Soft bounce** (`4.x.x`, mailbox full, deferred, greylisted) → record a
  `BOUNCED` event tagged `bounceType = SOFT`, but **do not suppress** until the
  address accumulates `softBounceThreshold` soft bounces within
  `softBounceWindowDays`. Only then suppress (reason `BOUNCE`) and flip
  `Contact.status = BOUNCED`.
- A successful send (`SENT`) does **not** reset the count; the window is rolling
  (count soft `BOUNCED` events in the last N days). This keeps the logic
  event-sourced and stateless.

### 1. Schema (migration `20260616010000_phase_d_bounce_policy`)

File: `apps/api/prisma/schema/core.prisma`. All additive.

```prisma
enum BounceType {
  HARD
  SOFT
  BLOCK   // policy/reputation block (treat as hard for suppression)
}

// Per-organization auto-suppression policy. A row is optional; absent → the
// env-provided defaults below are used. Lets operators tune sensitivity.
model SuppressionPolicy {
  id                  String       @id @default(cuid())
  organizationId      String       @unique
  softBounceThreshold Int          @default(3)
  softBounceWindowDays Int         @default(30)
  organization        Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  createdAt           DateTime     @default(now())
  updatedAt           DateTime     @updatedAt
}
```

- Add back-relation `suppressionPolicy SuppressionPolicy?` to `Organization`.
- **No** change to `EmailEvent` columns: `bounceType` lives in the existing
  `EmailEvent.metadata` JSON (`{ ..., bounceType: "SOFT" }`). Soft-bounce
  counting uses a Prisma JSON path filter on `metadata` plus an
  `occurredAt >= windowStart` bound. (An index is unnecessary at beta volumes;
  revisit if the soft-bounce query becomes hot.)

Env defaults (used when no `SuppressionPolicy` row exists), added to both
`apps/api/src/config/env.ts` and `apps/worker/src/config/env.ts`:

- `SOFT_BOUNCE_THRESHOLD` (default `3`)
- `SOFT_BOUNCE_WINDOW_DAYS` (default `30`)

Update `.env.example`.

### 2. Bounce classification (email-engine)

New `packages/email-engine/src/bounce.ts`:

- `classifyBounce(input: { code?: number | string; message?: string }): BounceType`
  — maps SMTP enhanced/basic status codes and common phrasing to
  `HARD | SOFT | BLOCK`:
  - `5.x.x` / `5xx` and "no such user", "user unknown", "does not exist",
    "invalid recipient", "mailbox unavailable" (permanent) → `HARD`
  - `4.x.x` / `4xx` and "mailbox full", "over quota", "greylist", "try again",
    "temporarily deferred" → `SOFT`
  - "blocked", "spam", "blacklist", "policy", "rate limit" → `BLOCK`
  - Unknown → `HARD` (conservative: an unclassifiable rejection is treated as
    permanent, matching today's behavior — no regression).
- Pure, fully unit-tested; exported from the package index.

The SMTP provider must surface a code/message for rejected recipients. Today
`SMTPProvider.send` returns `{ accepted, rejected, messageId, provider }`
(`packages/email-engine/src/...`). Extend the result with an optional
`rejectionResponse?: string` (nodemailer exposes `info.response` and
`info.rejectedErrors[].responseCode`/`.response`). The worker passes that into
`classifyBounce`. When no response detail is available, classification falls
back to `HARD`.

### 3. Shared auto-suppression helper

The same classify-and-decide logic runs in two places (worker SMTP path, API
webhook path), so centralize the **decision** (not the I/O):

- New `apps/api/src/modules/suppressions/policy.ts` (and re-used by the worker
  via `apps/worker/src/lib/suppression.ts`):
  `resolveBounceAction({ prisma, organizationId, email, bounceType, occurredAtField }): Promise<{ suppress: boolean }>`
  - `HARD` / `BLOCK` / complaint → `{ suppress: true }`.
  - `SOFT` → load policy (`SuppressionPolicy` row or env defaults), count
    `BOUNCED` events with `metadata.bounceType = "SOFT"` for `(org, email)` in
    the window (the address-correlation is `EmailJob.toEmail = email`); return
    `suppress: count + 1 >= threshold`.

Both the worker (`apps/worker/src/lib/suppression.ts`) and the API
(`suppressions` module) currently wrap `addSuppression`/`isSuppressed`; this adds
the policy decision alongside, keeping the two pipelines consistent.

### 4. Wire into the two bounce paths

- **Worker** (`email-sending.worker.ts`): in the `result.rejected.length > 0`
  branch, classify via `classifyBounce(rejectionResponse)`, write the `BOUNCED`
  event with `metadata.bounceType`, then call `resolveBounceAction`. Suppress +
  flip `Contact.status` **only** when `suppress` is true. The `EmailJob` status:
  on a soft bounce below threshold, mark `FAILED` (delivery did fail) but **not**
  suppressed; on hard/threshold-breach, suppress as today.
- **API webhook** (`tracking/service.ts` `recordWebhookEvent`): add optional
  `bounceType` to `webhookEventSchema` (providers that report soft/hard send it;
  otherwise default `HARD`). Write `metadata.bounceType`, then run the same
  `resolveBounceAction`. `COMPLAINED` always suppresses.

### 5. Suppression policy endpoints (optional UI in D5)

Minimal management surface in the existing `suppressions` module:

- `GET /api/v1/suppressions/policy?organizationId=...` → effective policy
  (row or env defaults).
- `PUT /api/v1/suppressions/policy` → upsert `{ softBounceThreshold,
  softBounceWindowDays }` (OWNER/ADMIN).

### 6. Shared schemas / types

`packages/shared/src/index.ts`: add `BounceType` literal union,
`suppressionPolicySchema`, and extend `webhookEventSchema`'s shared counterpart
(if any) with optional `bounceType`. Export a `SuppressionPolicy` interface.

### 7. Tests

- **email-engine**: `classifyBounce` table-driven tests (hard/soft/block codes
  and phrases, unknown → hard).
- **api**: `resolveBounceAction` (hard → suppress; soft below threshold → no
  suppress; soft at threshold → suppress; complaint → suppress); `tracking`
  webhook soft bounce below threshold does not suppress; policy endpoint
  upsert/read.
- **worker**: `email-sending.worker` soft rejection below threshold marks
  `FAILED` without suppression and without flipping `Contact.status`; hard
  rejection suppresses; Nth soft bounce within window suppresses.
- **migration** verified against throwaway Postgres 16 (`migrate deploy` +
  `migrate diff` no drift).

### 8. Backward compatibility

- Additive schema only (`BounceType` enum, `SuppressionPolicy` table, env vars
  with safe defaults).
- Unknown/unclassifiable bounces default to `HARD` → identical to today's
  suppress-immediately behavior. The only behavior change is that **classified
  soft bounces below threshold no longer suppress** — the intended fix.
- Complaints unchanged.

---

> **Status: D1–D5 all IMPLEMENTED.** Migrations `20260616010000`–
> `20260616040000`. See the Phase D verification block in `docs/STATUS.md`.

## D2 — Per-domain throttling

**Goal:** cap the send rate to each recipient domain (e.g. gmail.com,
yahoo.com) so a large campaign doesn't trip receiver rate limits and damage
reputation. BullMQ OSS has only a single global queue rate limiter, not
per-key, so throttling is enforced in the worker with a Redis token bucket.

### Schema (`20260616020000_phase_d_throttle`)

```prisma
// Default + per-domain send caps for an org. domain = null is the org default.
model DomainThrottle {
  id             String       @id @default(cuid())
  organizationId String
  domain         String?      // null = org-wide default
  maxPerMinute   Int
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  @@unique([organizationId, domain])
  @@index([organizationId])
}
```

Env default `DEFAULT_DOMAIN_MAX_PER_MINUTE` (e.g. `60`) used when no row exists.

### Enforcement (`email-sending.worker.ts`)

- Before send: derive `domain` from `emailJob.toEmail`; look up the effective
  cap (per-domain row → org default row → env default).
- Redis sliding-window / token bucket keyed
  `throttle:{organizationId}:{domain}`. If a token is available, consume and
  send. If not, `job.moveToDelayed(Date.now() + backoffMs, token)` and throw
  `DelayedError()` — reusing the exact pattern already used for paused campaigns
  (`email-sending.worker.ts:42-45`), so no attempt is consumed.
- New `apps/worker/src/lib/throttle.ts` implements the bucket (atomic via a
  small Lua script or `MULTI`/`INCR`+`EXPIRE`).

### API + UI

- CRUD under a `throttles` module (or fold into `settings`):
  `GET/PUT/DELETE /api/v1/throttles`.
- Settings UI panel listing default + per-domain caps. Tests cover bucket
  accounting, delay-without-attempt-consumption, and per-domain vs default
  resolution.

---

## D3 — Dynamic segmentation

**Goal:** a saved, named segment defined by a **rule tree** that re-resolves to
the current matching contacts every time it is used — unlike the Phase C tag
filter, which snapshots into a static `ContactList` (`source = SEGMENT`).

### Schema (`20260616030000_phase_d_segments`)

```prisma
model Segment {
  id             String       @id @default(cuid())
  organizationId String
  name           String
  description    String?
  rules          Json         // serialized rule tree (see below)
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  campaigns      Campaign[]
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  @@index([organizationId])
}

model Campaign {
  // ...existing...
  segmentId String?
  segment   Segment? @relation(fields: [segmentId], references: [id])
  // contactListId stays; a campaign targets a list OR a segment.
}
```

### Rule tree

A small, validated JSON DSL compiled to a Prisma `where`:

```ts
type Rule =
  | { op: "AND" | "OR"; rules: Rule[] }
  | { field: "tags"; match: "ANY" | "ALL" | "NONE"; values: string[] }
  | { field: "status"; eq: ContactStatus }
  | { field: "emailDomain"; eq: string }
  | { field: "createdAt"; before?: string; after?: string };
```

- Generalize the Phase C `buildSegmentWhere`
  (`apps/api/src/modules/contacts/segment.ts`) into a recursive
  `compileRules(rule): Prisma.ContactWhereInput`. Engagement conditions (opened
  / clicked in last N days), which require correlating `EmailEvent`, are a
  documented **D3.1 follow-up** (they need a subquery on `toEmail`).
- Depth/size cap on the tree (reject pathological nesting) in the Zod schema.

### Endpoints + fan-out

- `segments` module: CRUD + `POST /segments/:id/preview` (count + sample, reuses
  `compileRules`).
- `campaignService.create/update` accept `segmentId` (mutually exclusive with
  `contactListId`).
- **Fan-out** (`campaign-processing.worker.ts`): when `campaign.segmentId` is
  set, resolve contacts via `compileRules(segment.rules)` (ACTIVE + not
  suppressed, same guards as the list path at lines ~144-160) instead of reading
  `contactList.members`. Everything downstream (EmailJob creation, suppression
  exclusion, enqueue) is unchanged.
- UI: a Segments page with a rule builder; campaign create/edit gains a
  list-or-segment target picker.

---

## D4 — A/B subject testing

**Goal:** test multiple subject lines on a fraction of the audience, pick the
winner by open (or click) rate after a window, then send the winner to the
remainder.

### Schema (`20260616040000_phase_d_ab_testing`)

```prisma
enum AbWinnerMetric { OPEN CLICK }
enum AbTestStatus { TESTING DECIDED SENT }

model CampaignVariant {
  id          String   @id @default(cuid())
  campaignId  String
  label       String   // "A", "B", ...
  subject     String
  isWinner    Boolean  @default(false)
  campaign    Campaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)

  @@index([campaignId])
}

model Campaign {
  // ...existing...
  abTestEnabled     Boolean         @default(false)
  abTestPercent     Int?            // % of audience used for the test split
  abWinnerMetric    AbWinnerMetric?
  abTestWindowMin   Int?            // minutes to wait before deciding
  abTestStatus      AbTestStatus?
  variants          CampaignVariant[]
}

model EmailJob {
  // ...existing...
  variantId String?  // which subject variant this send used
}
```

### Flow

1. **Fan-out** splits the test fraction (`abTestPercent`) of the resolved
   audience evenly across variants; each `EmailJob` records `variantId` and uses
   that variant's subject. The remainder is held (not enqueued yet); campaign
   moves to `abTestStatus = TESTING`.
2. **Decision job** — a delayed BullMQ job (`abTestWindowMin`) on the
   campaign-processing queue (reuse `upsertJobScheduler`/delayed enqueue
   patterns). On fire: aggregate the chosen metric per `variantId` from
   `EmailEvent`, mark the winning `CampaignVariant.isWinner`, set
   `abTestStatus = DECIDED`.
3. **Remainder send** — fan out the held audience with the winning subject,
   `abTestStatus = SENT`.

### Endpoints + UI

- Campaign create/update accept variants + A/B config (validated: 2–5 variants,
  `1 ≤ percent ≤ 50`, window ≥ a small floor).
- Analytics (`campaignService.analytics`) extended with per-variant open/click
  breakdown.
- UI: variant editor in the campaign composer; results view showing per-variant
  rates and the chosen winner.

Tests cover split math (even distribution, remainder held), decision
aggregation (tie-break = first/lowest label, documented), and the remainder
send.

---

## D5 — Deliverability tooling

**Goal:** operator-facing visibility into sending health, built entirely on
existing `EmailEvent` + `Suppression` data (no new send-path writes).

### Endpoints (`deliverability` module, OWNER/ADMIN)

- `GET /api/v1/deliverability/overview?organizationId=&from=&to=` — totals and
  rates over the window: sent, delivered, opened, clicked, **bounced
  (hard/soft split via `metadata.bounceType`)**, complained, suppressed; plus
  delivery / bounce / complaint rates and a time-bucketed series for charts.
- `GET /api/v1/deliverability/domains?...` — the same metrics grouped by
  recipient domain (derived from `EmailJob.toEmail`), to spot a single receiver
  degrading.
- `GET /api/v1/deliverability/alerts?...` — derived warnings against thresholds
  (e.g. bounce rate > 5%, complaint rate > 0.1%, suppression-list growth spike),
  returned as structured `{ level, metric, value, threshold, message }`.

### Optional: sending-domain auth checks (D5.1)

A static DNS lookup helper for an org's sending domain(s) reporting SPF / DKIM /
DMARC record presence and basic validity, surfaced as setup guidance. Heavier
(outbound DNS, environment-dependent); scoped as a follow-up, not core D5.

### UI

A Deliverability dashboard page (charts for rate trends, a per-domain table, an
alerts panel) plus the `SuppressionPolicy` and `DomainThrottle` controls from D1
/ D2 surfaced here. Tests cover the aggregation math (rate computations, hard/
soft split, domain grouping) and alert threshold evaluation.

---

## Decisions to record (in `docs/DECISIONS.md`)

- **Soft Bounces Use a Rolling Threshold, Not Immediate Suppression** — why
  classified soft bounces accumulate to a per-org threshold before suppressing,
  and why unknown bounces stay conservative (treated as hard).
- **Per-Domain Throttling Is Worker-Side, Not a BullMQ Limiter** — why a Redis
  token bucket + `moveToDelayed` instead of the global queue rate limiter (OSS
  BullMQ has no per-key limiter).
- **Dynamic Segments Re-Resolve at Send Time** — `Segment` (rule tree) vs the
  Phase C static `source = SEGMENT` list snapshot; a campaign targets a list
  *or* a segment.
- **A/B Testing Splits a Test Fraction, Then Sends a Winner** — the
  test-window + decision-job design and the tie-break rule.

## Verification (per feature, before marking the item done)

- `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`,
  `pnpm test:smoke:docker`, `pnpm license:audit`, `pnpm cloud:boundary`.
- Each migration verified against a throwaway Postgres 16: `migrate deploy`
  applies in order and `migrate diff` reports no drift.
- Update `docs/STATUS.md` (a Phase D verification block) and check the matching
  box in `docs/ROADMAP.md`.

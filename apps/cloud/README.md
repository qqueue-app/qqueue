# QQueue Managed Cloud

This directory is the proprietary Phase 7 boundary for QQueue managed-cloud
features.

Copyright (C) 2026 Nana Aboagye Boateng. All rights reserved.

Code in this directory is governed by [LICENSE](LICENSE), not the root
AGPL-3.0-only license. Keep all cloud-only billing, metering, hosted
onboarding, managed infrastructure, tenant operations, and abuse/deliverability
controls here unless a piece is intentionally reusable AGPL core infrastructure.

## Boundary Rules

- Core apps and packages may not import from `apps/cloud`.
- Cloud code may import stable AGPL core primitives from `apps/api`,
  `apps/worker`, and `packages/*` when that keeps product behavior shared.
- Billing provider integrations, customer IDs, subscription lifecycle handling,
  plan enforcement, hosted onboarding, and managed sending infrastructure belong
  here.
- Reusable contracts that self-hosted users need should stay in
  `packages/shared`.
- New source files in this directory should use the proprietary SPDX header:

```ts
// SPDX-License-Identifier: LicenseRef-QQueue-Commercial
// Copyright (C) 2026 Nana Aboagye Boateng
```

## Current Status

Buildable scaffold (Phase 7, slice 0). The directory is now a real
`@qqueue/cloud` app — an Express skeleton with `dev`/`build`/`typecheck`/`test`
scripts, env config, an error handler, and three feature modules (`billing`,
`workspaces`, `usage-limits`) laid out in the core `routes/controller/service`
convention.

What works today:

- A health check and a real plan catalog (`src/plans/catalog.ts`, placeholder
  tiers/limits) served at `/cloud/v1/billing/plans`.
- Pure quota evaluation (`src/modules/usage-limits/service.ts`) that the
  queue/worker enforcement layer will call later.

Slice 1 (data layer) adds the proprietary billing/metering data model in
`../api/prisma/schema/cloud.prisma` (`Subscription`, `Seat`, `UsageCounter`,
related to the core `Organization` with cascade FKs) and wires the service layer:

- `billing` — subscription lookup, idempotent `ensureSubscription` (free/trialing
  default), and `getPlanForOrganization` (catalog-validated, falls back to free).
- `usage-limits` — `incrementUsage` (upsert counter), `loadSnapshot`, and
  `getCurrentUsage` (snapshot evaluated against the tenant's effective plan).
  This is what the queue/worker enforcement layer will call.

The Stripe checkout/webhook path and the authenticated HTTP surface still return
`501 not_implemented` on purpose. Do not add production billing behavior until the
commercial license terms are reviewed by counsel. Remaining slices: Stripe
integration, queue/worker enforcement hook, and the auth + tenant-scoping audit.

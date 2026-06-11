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

This is a scaffold only. Do not add production cloud behavior until the
commercial license terms, CLA enforcement, and dependency license audit are in
place.

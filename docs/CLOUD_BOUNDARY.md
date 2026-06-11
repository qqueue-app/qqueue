# Managed Cloud Boundary

QQueue uses an open-core model in a single repository:

- The core platform remains AGPL-3.0-only.
- Managed-cloud Phase 7 code lives under `apps/cloud/`.
- `apps/cloud/` has its own commercial license.

The open-source core should remain genuinely useful for self-hosters. The
proprietary cloud layer should focus on managed convenience, billing,
deliverability, abuse prevention, and hosted operations.

## AGPL Core

Keep these in the AGPL core:

- Authentication primitives
- Organizations
- SMTP connections
- Contacts
- Templates
- Campaigns
- Transactional API
- Queues
- Workers
- Shared schemas/types

## Proprietary Cloud

Keep these in `apps/cloud/`:

- Billing provider integrations
- Plans, subscriptions, seats, billing customer IDs, and invoices
- Usage limits and per-plan quota enforcement policy
- Hosted onboarding flows
- Managed shared or pooled sending infrastructure
- Abuse controls
- Deliverability controls
- Cloud admin dashboards
- Advanced deliverability features
- Reputation scoring
- Warmup automation
- Bounce intelligence
- ISP-specific recommendations
- Inbox placement analytics
- Shared IP pool management
- Multi-tenant hosted operations
- Domain verification automation for the hosted service
- Per-tenant operational controls and throttling policy

## Dependency Direction

Core code must not import from `apps/cloud`.

Cloud code may import from core packages and apps when it builds on stable
platform primitives. If a cloud feature needs a reusable primitive that is also
valuable for self-hosted operators, add that primitive to the AGPL core and keep
only the cloud policy or integration in `apps/cloud`.

## Tenant Boundary

Treat `Organization` as the initial tenant, workspace, and billing boundary
unless a future product requirement proves a separate `Workspace` model is
necessary. Before adding a separate workspace layer, document the user story that
cannot be served by organizations alone.

## Phase 7 Gates

Before production cloud code ships:

- Have the commercial license draft reviewed by qualified legal counsel.
- Enforce contributor sign-off or CLA checks in CI.
- Run `pnpm license:audit`.
- Audit all API and worker database access for tenant scoping.
- Add cross-organization access tests for any touched module.

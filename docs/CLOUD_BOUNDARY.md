# Managed Cloud Boundary

QQueue uses an open-core model in a single repository:

- The core platform remains AGPL-3.0-only.
- Managed-cloud Phase 7 code lives under `apps/cloud/`.
- `apps/cloud/` has its own commercial license.

The goal is to keep the self-hosted product complete while placing hosted
operations and commercial-only capabilities behind a clear license boundary.

## AGPL Core

Keep these in the AGPL core:

- Authentication primitives
- Organization membership and role basics
- SMTP connection management
- Contacts, templates, campaigns, transactional send APIs, and webhooks
- Queue primitives and worker send flow
- Shared Zod schemas and TypeScript contracts needed by self-hosted users
- Generic provider abstractions

## Proprietary Cloud

Keep these in `apps/cloud/`:

- Billing provider integrations
- Plans, subscriptions, seats, billing customer IDs, and invoices
- Usage metering and per-plan quota enforcement policy
- Hosted signup and onboarding flows
- Managed shared or pooled sending infrastructure
- Domain verification automation for the hosted service
- Per-tenant operational controls, throttling policy, and abuse tooling
- Cloud-only dashboards for usage, billing, and tenant operations

## Dependency Direction

Core code must not import from `apps/cloud`.

Cloud code may import from core packages and apps when it builds on stable
platform primitives. If a cloud feature needs a reusable primitive that is also
valuable for self-hosted operators, add that primitive to the AGPL core and keep
only the cloud policy or integration in `apps/cloud`.

## Tenant Boundary

Treat `Organization` as the initial tenant and billing boundary unless a future
product requirement proves a separate `Workspace` model is necessary. Before
adding a separate workspace layer, document the user story that cannot be served
by organizations alone.

## Phase 7 Gates

Before production cloud code ships:

- Replace the placeholder commercial license with final legal terms.
- Enforce contributor sign-off or CLA checks in CI.
- Run a dependency license audit.
- Audit all API and worker database access for tenant scoping.
- Add cross-organization access tests for any touched module.

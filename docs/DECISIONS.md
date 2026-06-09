# Decisions

## Use a Monorepo

QQueue uses a monorepo so apps, shared types, email provider logic, and the SDK can evolve together with a single dependency graph.

## Use pnpm and Turbo

pnpm workspaces provide fast installs and clear package boundaries. Turborepo coordinates app and package scripts across the workspace.

## Keep API and Worker Separate

The API handles HTTP traffic and persistence. Workers handle queue processing, email sending, and campaign expansion. This keeps long-running background work away from request handling.

## Use PostgreSQL as the Primary Database

PostgreSQL is the source of truth for users, organizations, contacts, templates, campaigns, jobs, events, API keys, and SMTP connection metadata.

## Use Redis and BullMQ for Queues

Redis and BullMQ provide a practical queue foundation for campaign scheduling, recipient fan-out, retries, and background email delivery.

## Use a Provider Abstraction Instead of Hardcoding Mailcow

QQueue should support Mailcow-compatible SMTP, generic SMTP, and future provider APIs. A provider interface keeps delivery logic swappable.

## Start with SMTP Provider First

SMTP is the simplest path for self-hosted users and Mailcow compatibility. Provider-specific APIs can be added after the core sending workflow is stable.

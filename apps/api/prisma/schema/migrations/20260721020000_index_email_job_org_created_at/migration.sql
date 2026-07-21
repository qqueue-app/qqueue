-- Index newest-first reads of EmailJob within one organization.
--
-- Three surfaces page backwards through this table scoped to a single org: the
-- outbox (queued/scheduled mail), the dashboard's recent activity, and the
-- composer's recipient suggestions (which reads the last 500 jobs to build the
-- To/Cc/Bcc autocomplete list). The existing indexes cover (organizationId,
-- idempotencyKey), messageId, and (organizationId, origin) — none of which help
-- an ordered scan — so each of those queries sorted every job the org had ever
-- sent.
--
-- Additive only: one new index, no table or column changes. On an install with
-- a large EmailJob table this takes a brief write lock while it builds; run it
-- during a quiet window if that matters, or build the same index by hand with
-- CREATE INDEX CONCURRENTLY first (Prisma wraps migrations in a transaction, so
-- CONCURRENTLY cannot be used here).

-- CreateIndex
CREATE INDEX "EmailJob_organizationId_createdAt_idx" ON "EmailJob"("organizationId", "createdAt");

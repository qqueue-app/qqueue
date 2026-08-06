-- Indexes for the deliverability funnel. Additive only: no data is read,
-- written or backfilled.
--
-- "EmailEvent" carried no indexes whatsoever. Postgres does not index foreign
-- keys automatically, so every deliverability aggregate, every campaign
-- analytics panel, and the per-open DELIVERED lookup on the tracking hot path
-- were sequential scans of the highest-volume table in the schema.

-- CreateIndex
CREATE INDEX "EmailEvent_emailJobId_type_idx" ON "EmailEvent"("emailJobId", "type");

-- CreateIndex
CREATE INDEX "EmailEvent_organizationId_type_occurredAt_idx" ON "EmailEvent"("organizationId", "type", "occurredAt");

-- The funnel selects a job cohort by send time within an organization
-- ("sentAt", falling back to "createdAt" for jobs that never reached a send).

-- CreateIndex
CREATE INDEX "EmailJob_organizationId_sentAt_idx" ON "EmailJob"("organizationId", "sentAt");

-- CreateIndex
CREATE INDEX "EmailJob_organizationId_status_idx" ON "EmailJob"("organizationId", "status");

ALTER TYPE "EmailJobStatus" ADD VALUE 'UNCERTAIN';
ALTER TABLE "EmailJob" ADD COLUMN "groupPrimary" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "recipientField" TEXT, ADD COLUMN "requestHash" TEXT;
ALTER TABLE "EmailDraft" ADD COLUMN "clientId" TEXT,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "lastMutationId" TEXT, ADD COLUMN "completedSendId" TEXT;
CREATE UNIQUE INDEX "EmailDraft_organizationId_createdByUserId_clientId_key"
  ON "EmailDraft"("organizationId", "createdByUserId", "clientId");

ALTER TABLE "EmailJob" ADD COLUMN "groupStatus" "EmailJobStatus";
-- Keep one existing message per group without discarding individual outcomes.
WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "organizationId", "sendGroupId" ORDER BY "createdAt", "id") AS n
  FROM "EmailJob" WHERE "sendGroupId" IS NOT NULL
) UPDATE "EmailJob" SET "groupPrimary" = ranked.n = 1 FROM ranked WHERE "EmailJob"."id" = ranked."id";
WITH summaries AS (
 SELECT "organizationId", "sendGroupId", CASE
 WHEN bool_or("status" = 'PROCESSING') THEN 'PROCESSING'
 WHEN bool_or("status" IN ('PENDING', 'QUEUED')) THEN 'QUEUED'
 WHEN bool_or("status" = 'SENT') THEN 'SENT'
 WHEN bool_or("status" = 'FAILED') THEN 'FAILED'
 WHEN bool_or("status" = 'CANCELLED') THEN 'CANCELLED'
 ELSE 'SUPPRESSED' END::"EmailJobStatus" AS outcome
 FROM "EmailJob" WHERE "sendGroupId" IS NOT NULL GROUP BY "organizationId", "sendGroupId"
) UPDATE "EmailJob" SET "groupStatus" = summaries.outcome FROM summaries
 WHERE "EmailJob"."organizationId" = summaries."organizationId" AND "EmailJob"."sendGroupId" = summaries."sendGroupId" AND "groupPrimary";

ALTER TABLE "EmailDraft" ADD COLUMN "creationHash" TEXT, ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "EmailJob" ADD COLUMN "visibleBcc" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "EmailAttachment" ADD COLUMN "uploadId" TEXT, ADD COLUMN "contentHash" TEXT;
CREATE UNIQUE INDEX "EmailAttachment_organizationId_createdByUserId_uploadId_key" ON "EmailAttachment"("organizationId", "createdByUserId", "uploadId");

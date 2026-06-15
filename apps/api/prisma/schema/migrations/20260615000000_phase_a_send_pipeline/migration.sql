-- Phase A: shared send-pipeline refactor.
-- Additive only — every new column is nullable or has a default, so existing
-- rows stay valid and existing campaign/transactional sends keep working.

-- CreateEnum
CREATE TYPE "EmailOrigin" AS ENUM ('CAMPAIGN', 'TRANSACTIONAL', 'MANUAL');

-- AlterTable
ALTER TABLE "EmailJob" ADD COLUMN     "bcc" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "cc" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "origin" "EmailOrigin" NOT NULL DEFAULT 'TRANSACTIONAL',
ADD COLUMN     "replyTo" TEXT;

-- Backfill: historical campaign jobs should report CAMPAIGN origin rather than
-- the TRANSACTIONAL default. Idempotent and safe to re-run.
UPDATE "EmailJob" SET "origin" = 'CAMPAIGN' WHERE "campaignId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "EmailJob_organizationId_origin_idx" ON "EmailJob"("organizationId", "origin");

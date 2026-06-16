-- Phase D1: bounce-driven auto-suppression.
--
-- Fully additive and backward compatible. A new enum (BounceType, recorded in
-- EmailEvent.metadata JSON, so no column change there) and a new optional
-- per-org policy table. No existing column is altered or dropped.

-- CreateEnum: classification of a bounce for suppression decisions.
CREATE TYPE "BounceType" AS ENUM ('HARD', 'SOFT', 'BLOCK');

-- CreateTable: optional per-organization auto-suppression policy. Absent rows
-- fall back to the env defaults (SOFT_BOUNCE_THRESHOLD / SOFT_BOUNCE_WINDOW_DAYS).
CREATE TABLE "SuppressionPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "softBounceThreshold" INTEGER NOT NULL DEFAULT 3,
    "softBounceWindowDays" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuppressionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SuppressionPolicy_organizationId_key" ON "SuppressionPolicy"("organizationId");

-- AddForeignKey
ALTER TABLE "SuppressionPolicy" ADD CONSTRAINT "SuppressionPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Phase C: contacts & contact lists enhancements.
--
-- Fully additive and backward compatible. New enums, a new column with a
-- default, a new enum value, and a new table — no existing column is altered or
-- dropped, so existing rows stay valid and current sends keep working.

-- CreateEnum: how a contact joined a list.
CREATE TYPE "MembershipSource" AS ENUM ('MANUAL', 'CSV_IMPORT', 'SEGMENT');

-- CreateEnum: why an address is suppressed.
CREATE TYPE "SuppressionReason" AS ENUM ('BOUNCE', 'COMPLAINT', 'UNSUBSCRIBE', 'MANUAL');

-- AlterEnum: suppressed sends are neither sent nor failures.
ALTER TYPE "EmailJobStatus" ADD VALUE 'SUPPRESSED';

-- AlterTable: record membership provenance. Existing rows default to MANUAL.
ALTER TABLE "ContactListMember" ADD COLUMN "source" "MembershipSource" NOT NULL DEFAULT 'MANUAL';

-- CreateTable: org-wide suppression registry.
CREATE TABLE "Suppression" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Suppression_organizationId_idx" ON "Suppression"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_organizationId_email_key" ON "Suppression"("organizationId", "email");

-- AddForeignKey
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

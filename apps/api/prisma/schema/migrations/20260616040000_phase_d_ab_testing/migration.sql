-- Phase D4: A/B subject testing.
--
-- Fully additive and backward compatible: two new enums, a new CampaignVariant
-- table, nullable A/B config columns on Campaign (off by default), and a
-- nullable EmailJob.variantId. Existing campaigns and sends are unaffected.

-- CreateEnum
CREATE TYPE "AbWinnerMetric" AS ENUM ('OPEN', 'CLICK');

-- CreateEnum
CREATE TYPE "AbTestStatus" AS ENUM ('TESTING', 'DECIDED', 'SENT');

-- AlterTable: A/B config on the campaign (disabled by default).
ALTER TABLE "Campaign" ADD COLUMN "abTestEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Campaign" ADD COLUMN "abTestPercent" INTEGER;
ALTER TABLE "Campaign" ADD COLUMN "abWinnerMetric" "AbWinnerMetric";
ALTER TABLE "Campaign" ADD COLUMN "abTestWindowMin" INTEGER;
ALTER TABLE "Campaign" ADD COLUMN "abTestStatus" "AbTestStatus";

-- AlterTable: which variant subject an A/B send used.
ALTER TABLE "EmailJob" ADD COLUMN "variantId" TEXT;

-- CreateTable: subject-line variants for a campaign's A/B test.
CREATE TABLE "CampaignVariant" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "isWinner" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignVariant_campaignId_idx" ON "CampaignVariant"("campaignId");

-- AddForeignKey
ALTER TABLE "CampaignVariant" ADD CONSTRAINT "CampaignVariant_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

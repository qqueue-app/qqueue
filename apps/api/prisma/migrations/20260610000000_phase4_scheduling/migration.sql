-- DropColumn
ALTER TABLE "Campaign" DROP COLUMN "subject";

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "cronExpression" TEXT,
ADD COLUMN     "timezone" TEXT,
ADD COLUMN     "lastRunAt" TIMESTAMP(3),
ADD COLUMN     "nextRunAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "EmailJob" ADD COLUMN     "campaignRunId" TEXT;

-- CreateTable
CREATE TABLE "CampaignRun" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "occurrenceKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENDING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CampaignRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRun_campaignId_occurrenceKey_key" ON "CampaignRun"("campaignId", "occurrenceKey");

-- AddForeignKey
ALTER TABLE "CampaignRun" ADD CONSTRAINT "CampaignRun_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailJob" ADD CONSTRAINT "EmailJob_campaignRunId_fkey" FOREIGN KEY ("campaignRunId") REFERENCES "CampaignRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "EmailJob" ADD COLUMN     "messageId" TEXT;

-- CreateIndex
CREATE INDEX "EmailJob_messageId_idx" ON "EmailJob"("messageId");

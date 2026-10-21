-- Preserve existing campaigns and queued bulk messages with the true default.
ALTER TABLE "Campaign" ADD COLUMN "unsubscribeEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "EmailJob" ADD COLUMN "unsubscribeEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "InboxAccount" ADD COLUMN "uidValidity" TEXT;
ALTER TABLE "InboxAccount" ADD COLUMN "lastSyncError" TEXT;
ALTER TABLE "InboundMessage" ADD COLUMN "replyTo" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "EmailDraft" ADD COLUMN "inboundMessageId" TEXT;

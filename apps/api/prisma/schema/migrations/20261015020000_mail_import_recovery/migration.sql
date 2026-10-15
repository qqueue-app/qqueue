ALTER TABLE "InboxAccount" ADD COLUMN "historyBeforeUid" INTEGER;
UPDATE "InboxAccount" a SET "historyBeforeUid" = COALESCE(
  (SELECT MIN(m."imapUid") - 1 FROM "InboundMessage" m
   WHERE m."inboxAccountId" = a.id AND m."imapUidValidity" = a."uidValidity" AND m."imapUid" > 0),
  a."lastSeenUid") WHERE a."lastSeenUid" IS NOT NULL;

ALTER TABLE "InboundMessage" ADD COLUMN "contentImportPending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InboundMessage" ADD COLUMN "contentAttemptedAt" TIMESTAMP(3);
ALTER TABLE "InboundMessage" ADD COLUMN "bodyStatus" TEXT NOT NULL DEFAULT 'AVAILABLE', ADD COLUMN "bodyError" TEXT;
-- Old imports skipped unavailable parts without recording them. Revisit each
-- known location once so upgrading can recover those files too.
UPDATE "InboundMessage" SET "contentImportPending" = true
  WHERE "imapUid" IS NOT NULL AND "imapUidValidity" IS NOT NULL;
CREATE INDEX "InboundMessage_inboxAccountId_contentImportPending_idx"
  ON "InboundMessage"("inboxAccountId", "contentImportPending");
ALTER TABLE "InboundAttachment" ADD COLUMN "partIndex" INTEGER,
  ADD COLUMN "storageStatus" TEXT NOT NULL DEFAULT 'AVAILABLE', ADD COLUMN "storageError" TEXT;
CREATE UNIQUE INDEX "InboundAttachment_inboundMessageId_partIndex_key"
  ON "InboundAttachment"("inboundMessageId", "partIndex");

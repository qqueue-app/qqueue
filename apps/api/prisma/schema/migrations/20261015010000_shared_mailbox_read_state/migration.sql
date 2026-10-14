ALTER TABLE "InboxAccount" ADD COLUMN "flagsCursor" INTEGER;
ALTER TABLE "InboundMessage" ADD COLUMN "readRevision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "readPending" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "readSyncError" TEXT,
  ADD COLUMN "imapUidValidity" TEXT, ADD COLUMN "readAttemptedAt" TIMESTAMP(3);
CREATE INDEX "InboundMessage_inboxAccountId_readPending_readAttemptedAt_idx"
  ON "InboundMessage"("inboxAccountId", "readPending", "readAttemptedAt");
UPDATE "InboundMessage" m SET "imapUidValidity" = a."uidValidity"
  FROM "InboxAccount" a WHERE m."inboxAccountId" = a.id;

ALTER TABLE "InboundMessage"
  ADD COLUMN "remoteDraftVersion" TEXT,
  ADD COLUMN "remoteDraftFolderId" TEXT,
  ADD COLUMN "remoteDraftUid" INTEGER,
  ADD COLUMN "remoteDraftUidValidity" TEXT,
  ADD COLUMN "remoteDraftBcc" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "InboundAttachment" ADD COLUMN "contentHash" TEXT;
ALTER TABLE "EmailDraft" ADD COLUMN "mailboxDraftSource" JSONB;

-- Existing mailbox drafts need their complete source, including Bcc, imported
-- before an editable private copy can be prepared. Existing writing is retained.
UPDATE "InboundMessage" AS m
SET "contentImportPending" = true, "contentAttemptedAt" = NULL
WHERE EXISTS (
  SELECT 1 FROM "InboundMessageLocation" l
  JOIN "InboxFolder" f ON f.id = l."inboxFolderId"
  WHERE l."inboundMessageId" = m.id AND l.present AND f.present AND f.role = 'DRAFTS'
);

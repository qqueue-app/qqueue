-- Phase A storage sub-task: email attachments in object storage.
--
-- Adds the EmailAttachment table holding attachment metadata. The blob lives in
-- S3-compatible object storage (MinIO for self-host) addressed by `storageKey`;
-- only metadata lives in Postgres. An attachment links to a draft while the user
-- is composing (emailDraftId) and to the EmailJob once the message is sent
-- (emailJobId). Both foreign keys are ON DELETE SET NULL so removing a draft or
-- job never deletes the metadata row out from under a concurrent read.
-- Additive only — no existing table is touched.

-- CreateTable
CREATE TABLE "EmailAttachment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "emailJobId" TEXT,
    "emailDraftId" TEXT,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailAttachment_organizationId_idx" ON "EmailAttachment"("organizationId");

-- CreateIndex
CREATE INDEX "EmailAttachment_emailJobId_idx" ON "EmailAttachment"("emailJobId");

-- CreateIndex
CREATE INDEX "EmailAttachment_emailDraftId_idx" ON "EmailAttachment"("emailDraftId");

-- AddForeignKey
ALTER TABLE "EmailAttachment" ADD CONSTRAINT "EmailAttachment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAttachment" ADD CONSTRAINT "EmailAttachment_emailJobId_fkey" FOREIGN KEY ("emailJobId") REFERENCES "EmailJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAttachment" ADD CONSTRAINT "EmailAttachment_emailDraftId_fkey" FOREIGN KEY ("emailDraftId") REFERENCES "EmailDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Attachments on received mail.
--
-- The IMAP sync parsed these out of every message and threw them away: there
-- was nowhere to put them, so a received message with a PDF showed no PDF.
-- This is the storage half of the fix (blobs go to object storage, metadata
-- here), mirroring how outbound EmailAttachment already works.
--
-- Distinct from EmailAttachment because ownership runs the other way: an
-- outbound attachment is authored then linked into a send (FKs nullable,
-- ON DELETE SET NULL so a deleted draft leaves the blob harmlessly orphaned),
-- whereas an inbound one has no existence apart from the message it arrived
-- on — hence a required FK with ON DELETE CASCADE.
--
-- Additive only: a new table with no backfill and no changes to existing ones.
-- Already-synced messages stay as they are; their attachment bytes were never
-- persisted and can only be recovered by re-syncing the mailbox.

-- CreateTable
CREATE TABLE "InboundAttachment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "inboundMessageId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentId" TEXT,
    "isInline" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InboundAttachment_organizationId_idx" ON "InboundAttachment"("organizationId");

-- CreateIndex
CREATE INDEX "InboundAttachment_inboundMessageId_idx" ON "InboundAttachment"("inboundMessageId");

-- AddForeignKey
ALTER TABLE "InboundAttachment" ADD CONSTRAINT "InboundAttachment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundAttachment" ADD CONSTRAINT "InboundAttachment_inboundMessageId_fkey" FOREIGN KEY ("inboundMessageId") REFERENCES "InboundMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

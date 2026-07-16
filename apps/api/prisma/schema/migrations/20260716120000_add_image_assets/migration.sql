-- Editor image uploads: blobs embedded in email HTML.
--
-- Distinct from EmailAttachment because the access model is the opposite:
-- attachments are private and travel inside the message, while these are
-- fetched over plain HTTP by recipients' mail clients with no session. The
-- public URL is addressed by "publicId" (a random token) rather than the cuid
-- primary key, so assets can't be enumerated.
--
-- Additive only: a new table with no backfill and no changes to existing ones.

-- CreateTable
CREATE TABLE "ImageAsset" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImageAsset_publicId_key" ON "ImageAsset"("publicId");

-- CreateIndex
CREATE INDEX "ImageAsset_organizationId_idx" ON "ImageAsset"("organizationId");

-- AddForeignKey
ALTER TABLE "ImageAsset" ADD CONSTRAINT "ImageAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

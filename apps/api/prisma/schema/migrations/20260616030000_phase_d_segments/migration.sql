-- Phase D3: dynamic segmentation.
--
-- Fully additive and backward compatible: a new Segment table holding a JSON
-- rule tree, and a nullable Campaign.segmentId so a campaign can target a
-- dynamic segment instead of a static contact list. Existing campaigns keep
-- contactListId and are unaffected.

-- CreateTable: saved rule-tree audiences resolved at send time.
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rules" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Segment_organizationId_idx" ON "Segment"("organizationId");

-- AddForeignKey
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: a campaign may target a segment instead of a contact list.
ALTER TABLE "Campaign" ADD COLUMN "segmentId" TEXT;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

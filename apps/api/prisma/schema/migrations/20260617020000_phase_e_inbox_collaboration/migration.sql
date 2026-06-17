-- Phase E inbox collaboration: reply metadata, assignment, and internal notes.
ALTER TABLE "InboundMessage"
  ADD COLUMN "assignedToUserId" TEXT;

CREATE TABLE "InboundMessageNote" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "inboundMessageId" TEXT NOT NULL,
  "authorUserId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InboundMessageNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InboundMessage_organizationId_assignedToUserId_idx"
  ON "InboundMessage"("organizationId", "assignedToUserId");

CREATE INDEX "InboundMessageNote_organizationId_inboundMessageId_idx"
  ON "InboundMessageNote"("organizationId", "inboundMessageId");

CREATE INDEX "InboundMessageNote_authorUserId_idx"
  ON "InboundMessageNote"("authorUserId");

ALTER TABLE "InboundMessage"
  ADD CONSTRAINT "InboundMessage_assignedToUserId_fkey"
  FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InboundMessageNote"
  ADD CONSTRAINT "InboundMessageNote_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InboundMessageNote"
  ADD CONSTRAINT "InboundMessageNote_inboundMessageId_fkey"
  FOREIGN KEY ("inboundMessageId") REFERENCES "InboundMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InboundMessageNote"
  ADD CONSTRAINT "InboundMessageNote_authorUserId_fkey"
  FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

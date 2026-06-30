-- Phase F: link sends to a SenderIdentity so From + DKIM derive from a
-- registered identity. All columns are nullable for backward compatibility —
-- existing jobs/campaigns/drafts keep using the SMTP connection's From.
ALTER TABLE "EmailJob" ADD COLUMN "senderIdentityId" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "senderIdentityId" TEXT;
ALTER TABLE "EmailDraft" ADD COLUMN "senderIdentityId" TEXT;

CREATE INDEX "EmailJob_senderIdentityId_idx" ON "EmailJob"("senderIdentityId");
CREATE INDEX "Campaign_senderIdentityId_idx" ON "Campaign"("senderIdentityId");
CREATE INDEX "EmailDraft_senderIdentityId_idx" ON "EmailDraft"("senderIdentityId");

-- Deleting an identity nulls these references rather than cascading deletes of
-- jobs/campaigns/drafts.
ALTER TABLE "EmailJob"
  ADD CONSTRAINT "EmailJob_senderIdentityId_fkey"
  FOREIGN KEY ("senderIdentityId") REFERENCES "SenderIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Campaign"
  ADD CONSTRAINT "Campaign_senderIdentityId_fkey"
  FOREIGN KEY ("senderIdentityId") REFERENCES "SenderIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmailDraft"
  ADD CONSTRAINT "EmailDraft_senderIdentityId_fkey"
  FOREIGN KEY ("senderIdentityId") REFERENCES "SenderIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

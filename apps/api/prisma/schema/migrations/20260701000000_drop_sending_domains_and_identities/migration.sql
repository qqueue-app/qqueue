-- Reverse of phase_f_sending_domains + phase_f_sender_identity_links: remove the
-- Sending Domains & Sender Identities feature from the core product. Kept as a
-- forward (additive) migration rather than deleting the originals, so existing
-- databases that already applied them migrate cleanly.

-- 1. Drop the sender-identity links on the send pipeline (FKs into SenderIdentity).
ALTER TABLE "EmailJob" DROP CONSTRAINT IF EXISTS "EmailJob_senderIdentityId_fkey";
ALTER TABLE "Campaign" DROP CONSTRAINT IF EXISTS "Campaign_senderIdentityId_fkey";
ALTER TABLE "EmailDraft" DROP CONSTRAINT IF EXISTS "EmailDraft_senderIdentityId_fkey";

DROP INDEX IF EXISTS "EmailJob_senderIdentityId_idx";
DROP INDEX IF EXISTS "Campaign_senderIdentityId_idx";
DROP INDEX IF EXISTS "EmailDraft_senderIdentityId_idx";

ALTER TABLE "EmailJob" DROP COLUMN IF EXISTS "senderIdentityId";
ALTER TABLE "Campaign" DROP COLUMN IF EXISTS "senderIdentityId";
ALTER TABLE "EmailDraft" DROP COLUMN IF EXISTS "senderIdentityId";

-- 2. Drop the tables (SenderIdentity references SendingDomain, so drop it first).
DROP TABLE IF EXISTS "SenderIdentity";
DROP TABLE IF EXISTS "SendingDomain";

-- 3. Drop the DKIM enums.
DROP TYPE IF EXISTS "DkimStatus";
DROP TYPE IF EXISTS "DkimMode";

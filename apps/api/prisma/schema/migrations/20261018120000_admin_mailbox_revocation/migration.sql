-- Existing grants and implicit admin access remain valid on upgrade.
ALTER TABLE "SmtpConnectionGrant" ADD COLUMN "revoked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InboxAccountGrant" ADD COLUMN "revoked" BOOLEAN NOT NULL DEFAULT false;

-- Existing invitations keep their current behavior: no preassigned mailboxes.
ALTER TABLE "OrganizationInvite" ADD COLUMN "smtpConnectionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

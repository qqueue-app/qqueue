-- Phase 4: send-as grants. MEMBERs may only send from connections they hold a
-- grant for; OWNER/ADMIN may use any org connection and need no row.
CREATE TABLE "SmtpConnectionGrant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "smtpConnectionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmtpConnectionGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SmtpConnectionGrant_smtpConnectionId_userId_key"
    ON "SmtpConnectionGrant"("smtpConnectionId", "userId");

CREATE INDEX "SmtpConnectionGrant_organizationId_userId_idx"
    ON "SmtpConnectionGrant"("organizationId", "userId");

ALTER TABLE "SmtpConnectionGrant"
    ADD CONSTRAINT "SmtpConnectionGrant_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SmtpConnectionGrant"
    ADD CONSTRAINT "SmtpConnectionGrant_smtpConnectionId_fkey"
    FOREIGN KEY ("smtpConnectionId") REFERENCES "SMTPConnection"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SmtpConnectionGrant"
    ADD CONSTRAINT "SmtpConnectionGrant_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

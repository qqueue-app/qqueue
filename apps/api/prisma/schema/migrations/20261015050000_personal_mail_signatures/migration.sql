CREATE TABLE "MailSignature" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "smtpConnectionId" TEXT NOT NULL,
  "text" TEXT NOT NULL DEFAULT '',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MailSignature_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MailSignature_userId_smtpConnectionId_key" ON "MailSignature"("userId", "smtpConnectionId");
CREATE INDEX "MailSignature_organizationId_userId_idx" ON "MailSignature"("organizationId", "userId");
ALTER TABLE "MailSignature" ADD CONSTRAINT "MailSignature_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MailSignature" ADD CONSTRAINT "MailSignature_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MailSignature" ADD CONSTRAINT "MailSignature_smtpConnectionId_fkey" FOREIGN KEY ("smtpConnectionId") REFERENCES "SMTPConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Phase F: Sending Domains & Sender Identities. Decouples the From address from
-- the single authenticating SMTP credential so users can send as noreply@ etc.
-- Managed-mode DKIM columns are added now but only exercised in a later sprint;
-- Sprint 1 wires up EXTERNAL mode (trust upstream signing) only.
CREATE TYPE "DkimMode" AS ENUM ('EXTERNAL', 'MANAGED');
CREATE TYPE "DkimStatus" AS ENUM ('VERIFIED', 'PENDING', 'FAILED', 'NA');

CREATE TABLE "SendingDomain" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "dkimMode" "DkimMode" NOT NULL DEFAULT 'EXTERNAL',
  "dkimSelector" TEXT,
  "dkimPrivateKeyEncrypted" TEXT,
  "dkimPublicKey" TEXT,
  "dkimStatus" "DkimStatus" NOT NULL DEFAULT 'NA',
  "spfNote" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "lastCheckedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SendingDomain_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SenderIdentity" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sendingDomainId" TEXT NOT NULL,
  "fromName" TEXT NOT NULL,
  "fromEmail" TEXT NOT NULL,
  "smtpConnectionId" TEXT NOT NULL,
  "replyTo" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SenderIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SendingDomain_organizationId_domain_key" ON "SendingDomain"("organizationId", "domain");
CREATE INDEX "SendingDomain_organizationId_idx" ON "SendingDomain"("organizationId");

CREATE UNIQUE INDEX "SenderIdentity_organizationId_fromEmail_key" ON "SenderIdentity"("organizationId", "fromEmail");
CREATE INDEX "SenderIdentity_organizationId_idx" ON "SenderIdentity"("organizationId");
CREATE INDEX "SenderIdentity_sendingDomainId_idx" ON "SenderIdentity"("sendingDomainId");
CREATE INDEX "SenderIdentity_smtpConnectionId_idx" ON "SenderIdentity"("smtpConnectionId");

ALTER TABLE "SendingDomain"
  ADD CONSTRAINT "SendingDomain_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SenderIdentity"
  ADD CONSTRAINT "SenderIdentity_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SenderIdentity"
  ADD CONSTRAINT "SenderIdentity_sendingDomainId_fkey"
  FOREIGN KEY ("sendingDomainId") REFERENCES "SendingDomain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SenderIdentity"
  ADD CONSTRAINT "SenderIdentity_smtpConnectionId_fkey"
  FOREIGN KEY ("smtpConnectionId") REFERENCES "SMTPConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

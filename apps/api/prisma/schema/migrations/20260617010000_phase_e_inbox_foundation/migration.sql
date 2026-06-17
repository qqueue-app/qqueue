-- Phase E inbox foundation: optional, feature-flagged read-only IMAP storage.
CREATE TYPE "InboxAccountStatus" AS ENUM ('ACTIVE', 'DISABLED');

CREATE TABLE "InboxAccount" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "host" TEXT NOT NULL,
  "port" INTEGER NOT NULL,
  "secure" BOOLEAN NOT NULL DEFAULT true,
  "usernameEncrypted" TEXT NOT NULL,
  "passwordEncrypted" TEXT NOT NULL,
  "mailbox" TEXT NOT NULL DEFAULT 'INBOX',
  "status" "InboxAccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "lastSyncedAt" TIMESTAMP(3),
  "lastSeenUid" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InboxAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InboundMessage" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "inboxAccountId" TEXT NOT NULL,
  "emailJobId" TEXT,
  "messageId" TEXT NOT NULL,
  "inReplyTo" TEXT,
  "references" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "fromEmail" TEXT NOT NULL,
  "fromName" TEXT,
  "to" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "cc" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "subject" TEXT NOT NULL,
  "text" TEXT,
  "html" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "readAt" TIMESTAMP(3),
  "imapUid" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InboundMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboxAccount_organizationId_email_key" ON "InboxAccount"("organizationId", "email");
CREATE INDEX "InboxAccount_organizationId_idx" ON "InboxAccount"("organizationId");

CREATE UNIQUE INDEX "InboundMessage_inboxAccountId_messageId_key" ON "InboundMessage"("inboxAccountId", "messageId");
CREATE INDEX "InboundMessage_organizationId_receivedAt_idx" ON "InboundMessage"("organizationId", "receivedAt");
CREATE INDEX "InboundMessage_organizationId_readAt_idx" ON "InboundMessage"("organizationId", "readAt");
CREATE INDEX "InboundMessage_emailJobId_idx" ON "InboundMessage"("emailJobId");
CREATE INDEX "InboundMessage_inReplyTo_idx" ON "InboundMessage"("inReplyTo");

ALTER TABLE "InboxAccount"
  ADD CONSTRAINT "InboxAccount_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InboundMessage"
  ADD CONSTRAINT "InboundMessage_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InboundMessage"
  ADD CONSTRAINT "InboundMessage_inboxAccountId_fkey"
  FOREIGN KEY ("inboxAccountId") REFERENCES "InboxAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InboundMessage"
  ADD CONSTRAINT "InboundMessage_emailJobId_fkey"
  FOREIGN KEY ("emailJobId") REFERENCES "EmailJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

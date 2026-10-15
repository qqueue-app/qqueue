-- Short-lived coordination only. No message body or draft content is stored.
CREATE TABLE "ReplyPresence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "inboundMessageId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReplyPresence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReplyPresence_organizationId_userId_clientId_key" ON "ReplyPresence"("organizationId", "userId", "clientId");
CREATE INDEX "ReplyPresence_inboundMessageId_expiresAt_idx" ON "ReplyPresence"("inboundMessageId", "expiresAt");
CREATE INDEX "ReplyPresence_expiresAt_idx" ON "ReplyPresence"("expiresAt");
ALTER TABLE "ReplyPresence" ADD CONSTRAINT "ReplyPresence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReplyPresence" ADD CONSTRAINT "ReplyPresence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReplyPresence" ADD CONSTRAINT "ReplyPresence_inboundMessageId_fkey" FOREIGN KEY ("inboundMessageId") REFERENCES "InboundMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

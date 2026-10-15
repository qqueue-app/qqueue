-- CreateTable
CREATE TABLE "InboxMoveBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "clientId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxMoveBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxMove" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "inboundMessageId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "inboxAccountId" TEXT NOT NULL,
    "sourceLocationId" TEXT NOT NULL,
    "sourceFolderId" TEXT NOT NULL,
    "targetFolderId" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "targetPath" TEXT NOT NULL,
    "sourceUid" INTEGER NOT NULL,
    "sourceUidValidity" TEXT NOT NULL,
    "targetUidValidity" TEXT,
    "targetUidNext" INTEGER,
    "targetUid" INTEGER,
    "sourceHash" TEXT,
    "sourceHeaderId" TEXT,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "attemptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxMove_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InboxMoveBatch_organizationId_userId_clientId_key" ON "InboxMoveBatch"("organizationId", "userId", "clientId");

-- CreateIndex
CREATE INDEX "InboxMove_inboxAccountId_status_attemptedAt_idx" ON "InboxMove"("inboxAccountId", "status", "attemptedAt");

-- CreateIndex
CREATE INDEX "InboxMove_sourceLocationId_status_idx" ON "InboxMove"("sourceLocationId", "status");

-- CreateIndex
CREATE INDEX "InboxMove_inboundMessageId_createdAt_idx" ON "InboxMove"("inboundMessageId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InboxMove_batchId_sourceLocationId_key" ON "InboxMove"("batchId", "sourceLocationId");

-- AddForeignKey
ALTER TABLE "InboxMoveBatch" ADD CONSTRAINT "InboxMoveBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxMoveBatch" ADD CONSTRAINT "InboxMoveBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxMove" ADD CONSTRAINT "InboxMove_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxMove" ADD CONSTRAINT "InboxMove_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxMove" ADD CONSTRAINT "InboxMove_inboundMessageId_fkey" FOREIGN KEY ("inboundMessageId") REFERENCES "InboundMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxMove" ADD CONSTRAINT "InboxMove_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InboxMoveBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A verified move can carry a headerless message into a new UID namespace.
ALTER TABLE "InboundMessageLocation" ADD COLUMN "contentHash" TEXT;

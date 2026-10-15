-- AlterTable
ALTER TABLE "InboundMessage" ADD COLUMN     "flagPending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "flagRevision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "flagSyncError" TEXT,
ADD COLUMN     "flagged" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "InboxFolder" (
    "id" TEXT NOT NULL,
    "inboxAccountId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'OTHER',
    "specialUse" TEXT,
    "present" BOOLEAN NOT NULL DEFAULT true,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "uidValidity" TEXT,
    "lastSeenUid" INTEGER,
    "historyBeforeUid" INTEGER,
    "flagsCursor" INTEGER,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundMessageLocation" (
    "id" TEXT NOT NULL,
    "inboundMessageId" TEXT NOT NULL,
    "inboxFolderId" TEXT NOT NULL,
    "uid" INTEGER NOT NULL,
    "uidValidity" TEXT NOT NULL,
    "present" BOOLEAN NOT NULL DEFAULT true,
    "remoteSeen" BOOLEAN NOT NULL DEFAULT false,
    "remoteFlagged" BOOLEAN NOT NULL DEFAULT false,
    "readAppliedRevision" INTEGER NOT NULL DEFAULT 0,
    "flagAppliedRevision" INTEGER NOT NULL DEFAULT 0,
    "attemptedAt" TIMESTAMP(3),
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundMessageLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InboxFolder_inboxAccountId_present_lastSyncedAt_idx" ON "InboxFolder"("inboxAccountId", "present", "lastSyncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InboxFolder_inboxAccountId_path_key" ON "InboxFolder"("inboxAccountId", "path");

-- CreateIndex
CREATE INDEX "InboundMessageLocation_inboundMessageId_present_idx" ON "InboundMessageLocation"("inboundMessageId", "present");

-- CreateIndex
CREATE INDEX "InboundMessageLocation_inboxFolderId_present_attemptedAt_idx" ON "InboundMessageLocation"("inboxFolderId", "present", "attemptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InboundMessageLocation_inboxFolderId_uidValidity_uid_key" ON "InboundMessageLocation"("inboxFolderId", "uidValidity", "uid");

-- AddForeignKey
ALTER TABLE "InboxFolder" ADD CONSTRAINT "InboxFolder_inboxAccountId_fkey" FOREIGN KEY ("inboxAccountId") REFERENCES "InboxAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundMessageLocation" ADD CONSTRAINT "InboundMessageLocation_inboundMessageId_fkey" FOREIGN KEY ("inboundMessageId") REFERENCES "InboundMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundMessageLocation" ADD CONSTRAINT "InboundMessageLocation_inboxFolderId_fkey" FOREIGN KEY ("inboxFolderId") REFERENCES "InboxFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Preserve every configured folder and its import progress before discovery.
INSERT INTO "InboxFolder" (id, "inboxAccountId", path, name, role, "uidValidity", "lastSeenUid", "historyBeforeUid", "flagsCursor", "lastSyncedAt", "lastSyncError", "updatedAt")
SELECT 'folder_' || md5(id), id, mailbox, mailbox,
  CASE WHEN upper(mailbox) = 'INBOX' THEN 'INBOX' ELSE 'OTHER' END,
  "uidValidity", "lastSeenUid", "historyBeforeUid", "flagsCursor", "lastSyncedAt", "lastSyncError", CURRENT_TIMESTAMP
FROM "InboxAccount";

-- Retain shared actions and legacy UID-validity namespaces. Duplicate legacy
-- locations keep the most recent import as their owner; all writing stays stored.
INSERT INTO "InboundMessageLocation" (id, "inboundMessageId", "inboxFolderId", uid, "uidValidity", present, "remoteSeen", "readAppliedRevision", "flagAppliedRevision")
SELECT DISTINCT ON (f.id, m."imapUidValidity", m."imapUid")
  'location_' || md5(m.id), m.id, f.id, m."imapUid", m."imapUidValidity",
  COALESCE(m."imapUidValidity" = f."uidValidity", false), m."readAt" IS NOT NULL,
  CASE WHEN m."readPending" THEN 0 ELSE m."readRevision" END, m."flagRevision"
FROM "InboundMessage" m JOIN "InboxFolder" f ON f."inboxAccountId" = m."inboxAccountId"
WHERE m."imapUid" > 0 AND m."imapUidValidity" IS NOT NULL
ORDER BY f.id, m."imapUidValidity", m."imapUid", m."createdAt" DESC, m.id DESC;

UPDATE "InboxFolder" SET "isPrimary" = true;
